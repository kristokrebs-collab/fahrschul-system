import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Field } from "@/primitives/Field";
import { Input, Textarea } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton, SkeletonSwap } from "@/primitives/Skeleton";
import { ToastIsland, type IslandToast } from "@/primitives/Toast";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

/** jsdom has no matchMedia: answer every query with `matches` (hover-capable fine pointer, motion allowed). */
function stubMatchMedia(matches: (q: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: matches(query), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList,
  );
}

afterEach(() => {
  fx.reduced = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Button ripple", () => {
  it("spawns a ripple on press inside an aria-hidden layer and keeps the accessible name", () => {
    render(<Button variant="primary">Speichern</Button>);
    const b = screen.getByRole("button", { name: "Speichern" });
    const layer = b.querySelector("span[aria-hidden]") as HTMLElement;
    expect(layer.className).toContain("overflow-hidden");
    fireEvent.pointerDown(b, { button: 0, clientX: 5, clientY: 5 });
    expect(layer.childElementCount).toBe(1);
    fireEvent.keyDown(b, { key: "Enter" });
    expect(layer.childElementCount).toBe(2);
    expect((layer.firstElementChild as HTMLElement).style.background.replace(/\s/g, "")).toMatch(/rgba?\(4,4,4/);
  });

  it("never ripples while disabled or with ripple={false}", () => {
    render(
      <>
        <Button disabled>Aus</Button>
        <Button ripple={false}>Ohne</Button>
      </>,
    );
    const off = screen.getByRole("button", { name: "Aus" });
    fireEvent.pointerDown(off, { button: 0 });
    expect(off.querySelector("span[aria-hidden]")?.childElementCount ?? 0).toBe(0);
    expect(screen.getByRole("button", { name: "Ohne" }).querySelector("span[aria-hidden]")).toBeNull();
  });
});

describe("Input / Field", () => {
  it("wraps the control with pre-rendered focus + pulse rings and keeps the label association", () => {
    render(
      <Field label="Hebel" htmlFor="lev" suffix="x">
        <Input id="lev" numeric invalid />
      </Field>,
    );
    const input = screen.getByLabelText("Hebel");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.className).toContain("peer");
    expect(input.className).toContain("focus:shadow-none");
    const wrap = input.closest("[data-input]") as HTMLElement;
    expect(wrap.querySelector("[data-input-ring]")).toHaveAttribute("aria-hidden", "true");
    expect(wrap.querySelector("[data-input-pulse]")).not.toBeNull();
    expect(input.closest("[data-field]")).not.toBeNull();
    // the suffix padding now targets the wrapped input
    expect(wrap.parentElement?.className).toContain("[&_input]:pr-14");
  });

  it("Textarea uses the same wrapper", () => {
    render(<Textarea aria-label="Notiz" rows={3} />);
    expect(screen.getByLabelText("Notiz").closest("[data-input]")).not.toBeNull();
  });
});

describe("Segmented hover ghost", () => {
  beforeEach(() => stubMatchMedia((q) => q.includes("hover")));

  it("glides a ghost under the hovered segment, keeps the thumb first and fades out on leave", () => {
    function H() {
      const [v, setV] = useState<"a" | "b">("a");
      return (
        <Segmented
          aria-label="Intervall"
          options={[
            { v: "a", label: "1h" },
            { v: "b", label: "4h" },
          ]}
          value={v}
          onChange={setV}
        />
      );
    }
    render(<H />);
    const a = screen.getByRole("radio", { name: "1h" });
    const b = screen.getByRole("radio", { name: "4h" });
    fireEvent.pointerEnter(b, { pointerType: "mouse" });
    const ghost = b.querySelector("span[aria-hidden]");
    expect(ghost?.className).toContain("bg-white/[0.06]");
    expect((ghost as HTMLElement).style.borderRadius).toBe("8px");
    // checked item: the thumb stays the first aria-hidden span
    fireEvent.pointerEnter(a, { pointerType: "mouse" });
    expect(a.querySelector("span[aria-hidden]")?.className).toContain("border-line-2");
  });

  it("shows no ghost for touch or under reduced motion", () => {
    const opts = [
      { v: "a", label: "1h" },
      { v: "b", label: "4h" },
    ] as const;
    const { unmount } = render(<Segmented aria-label="Intervall" options={opts} value="a" onChange={() => {}} />);
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "4h" }), { pointerType: "touch" });
    expect(screen.getByRole("radio", { name: "4h" }).querySelector("span[aria-hidden]")).toBeNull();
    unmount();
    fx.reduced = true;
    render(<Segmented aria-label="Intervall" options={opts} value="a" onChange={() => {}} />);
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "4h" }), { pointerType: "mouse" });
    expect(screen.getByRole("radio", { name: "4h" }).querySelector("span[aria-hidden]")).toBeNull();
  });
});

describe("Card", () => {
  it("keeps the e2e contract (div.group root with its h2) and the static border without fine pointer", () => {
    const { container } = render(
      <Card title="Live-Daten">
        <p>Inhalt</p>
      </Card>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.className).toContain("group");
    expect(root.querySelector("h2")?.textContent).toContain("Live-Daten");
    expect(container.querySelector(".fx-ring")).toBeNull();
    expect(container.querySelector(".border-line")).not.toBeNull();
  });

  // contract changed on purpose (perf review perf-06): the masked ring layers are no longer mounted at rest – the
  // spotlight ring exists while the pointer is on the card, the arc while it is lit – so idle cards add no layers
  it("mounts the spotlight ring on hover and the proximity arc when lit, on fine-pointer devices (gradientFrom tints both)", async () => {
    stubMatchMedia((q) => !q.includes("reduce"));
    const { container } = render(
      <Card bare gradientFrom="#46a6a0">
        <article>Setup</article>
      </Card>,
    );
    expect(container.querySelector(".fx-ring")).toBeNull();
    fireEvent.pointerEnter(container.querySelector(".group > .group") as HTMLElement, { pointerType: "mouse", clientX: 10, clientY: 10 });
    const spot = container.querySelector(".fx-ring") as HTMLElement;
    expect(spot).not.toBeNull();
    expect((spot.firstElementChild as HTMLElement).style.background).toContain("rgb(70, 166, 160)");
    // a pointer near the card's edge lights the arc
    fireEvent.pointerMove(document, { pointerType: "mouse", clientX: 30, clientY: 30 });
    await waitFor(() => expect(container.querySelectorAll(".fx-ring")).toHaveLength(2));
    const arcRing = container.querySelectorAll(".fx-ring")[1] as HTMLElement;
    expect((arcRing.firstElementChild as HTMLElement).style.background).toContain("conic-gradient");
    expect(arcRing).toHaveAttribute("aria-hidden", "true");
  });

  it("drops every pointer effect under reduced motion", () => {
    stubMatchMedia(() => true);
    fx.reduced = true;
    const { container } = render(
      <Card title="Ruhig">
        <p>Inhalt</p>
      </Card>,
    );
    expect(container.querySelector(".fx-ring")).toBeNull();
  });
});

describe("Skeleton / SkeletonSwap / BorderBeam / Badge", () => {
  it("Skeleton shimmers by transform only", () => {
    const { container } = render(<Skeleton height={40} />);
    const band = container.querySelector("span") as HTMLElement;
    expect(band.className).toContain("animate-fx-shimmer");
    expect(band.className).toContain("[transform:translateX(-100%)]");
    expect(band.className).toContain("motion-reduce:hidden");
  });

  it("SkeletonSwap shows the skeleton until ready, then the content in the same cell", () => {
    const { rerender } = render(
      <SkeletonSwap ready={false} skeleton={<span>lädt</span>}>
        <span>Fertig</span>
      </SkeletonSwap>,
    );
    expect(screen.getByText("lädt")).toBeInTheDocument();
    expect(screen.queryByText("Fertig")).toBeNull();
    rerender(
      <SkeletonSwap ready skeleton={<span>lädt</span>}>
        <span>Fertig</span>
      </SkeletonSwap>,
    );
    expect(screen.getByText("Fertig").parentElement?.className).toContain("[grid-area:1/1]");
  });

  it("BorderBeam loops on the compositor, fires once, and renders nothing for a falsy fire", () => {
    const { container, rerender } = render(<BorderBeam size={110} duration={6} />);
    const loop = container.querySelector(".fx-ring > span") as HTMLElement;
    expect(loop.className).toContain("animate-fx-spin");
    expect(loop.style.animationDuration).toBe("6s");
    rerender(<BorderBeam fire={1} />);
    expect(container.querySelector(".fx-ring > span")?.className).not.toContain("animate-fx-spin");
    rerender(<BorderBeam fire={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("Badge ping renders a decorative ring", () => {
    render(
      <Badge tone="win" ping>
        Live
      </Badge>,
    );
    const badge = screen.getByText("Live");
    expect(badge.querySelector(".fx-ping")).not.toBeNull();
    expect(badge.querySelector("[aria-hidden]")).not.toBeNull();
  });
});

describe("ToastIsland", () => {
  beforeEach(() => vi.useFakeTimers());

  const toasts: IslandToast[] = [
    { id: 1, kind: "ok", title: "Trade gespeichert", value: "+396,00", valueTone: "win" },
    { id: 2, kind: "error", title: "Fehler" },
    { id: 3, kind: "warn", title: "Signal" },
  ];

  it("is the single polite status region, shows a +n queue badge and stays live behind dialogs", () => {
    render(<ToastIsland toasts={toasts} onDismiss={() => {}} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("data-toast-island");
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("+2").closest("[aria-hidden]")).not.toBeNull();
    expect(screen.queryByText("Fehler")).toBeNull();
  });

  it("win toasts announce the final value once while the visible digits roll", () => {
    render(<ToastIsland toasts={[toasts[0] as IslandToast]} onDismiss={() => {}} />);
    const sr = screen.getByText("+396,00", { selector: ".sr-only" });
    expect(sr).toBeInTheDocument();
    expect(screen.getByText("Trade gespeichert")).toBeInTheDocument();
  });

  it("under reduced motion shows the plain value without roll, glow or countdown bar", () => {
    fx.reduced = true;
    render(<ToastIsland toasts={[toasts[0] as IslandToast]} onDismiss={() => {}} />);
    expect(screen.getByText("+396,00").className).toContain("dot-num text-[15px]");
    expect(document.querySelector(".fx-countdown")).toBeNull();
    expect(document.querySelector(".blur-xl")).toBeNull();
  });

  it("pauses the countdown while hovered and resumes with the remaining time", () => {
    const onDismiss = vi.fn();
    render(<ToastIsland toasts={[{ id: 7, kind: "ok", title: "Gespeichert" }]} onDismiss={onDismiss} />);
    const card = screen.getByRole("button").parentElement as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerEnter(card, { pointerType: "mouse" });
    expect(card).toHaveAttribute("data-held");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    expect(card).not.toHaveAttribute("data-held");
    act(() => {
      vi.advanceTimersByTime(1799);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("honours a per-toast duration and keeps `duration: 0` until dismissed", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<ToastIsland toasts={[{ id: 8, kind: "warn", title: "Kurz", duration: 500 }]} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).toHaveBeenCalledWith(8);
    rerender(<ToastIsland toasts={[{ id: 9, kind: "warn", title: "Bleibt", duration: 0 }]} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalledWith(9);
    expect(screen.getByText("Bleibt").closest("button")?.querySelector(".fx-countdown")).toBeNull();
  });
});
