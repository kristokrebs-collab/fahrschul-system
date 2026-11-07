/**
 * Runde 10 – the rich-page effects (`@/motion/rich`, `PageAura`, `EmptyArt`, `Card` veil / tilt / highlight, the page header's
 * pulled-up words). The contract: they exist ONLY inside a rich page layer (`RichContext`, set by `PageHost` for every page
 * except the Übersicht and the Cockpit), never under reduced motion, never without a mouse where a mouse is needed – and
 * everything else renders exactly as before.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Float } from "@/motion/rich/Float";
import { gridCell, isRichPage, Quiet, RichContext, useRich, useRichFx, waveDelay, WAVE_MAX } from "@/motion/rich";
import { stagger } from "@/motion/tokens";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { pickArt } from "@/primitives/emptyArt";
import type { Streak } from "@/domain/growth";
import { PageHeader } from "@/views/setups/PageHeader";
import { StreakBadge } from "@/views/wachstum/StreakBadge";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

function stubMatchMedia(matches: (q: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: matches(query), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList,
  );
}
const MOUSE = (q: string) => q.includes("hover: hover") || q.includes("pointer: fine");
const rich = (node: ReactNode) => <RichContext.Provider value>{node}</RichContext.Provider>;

afterEach(() => {
  fx.reduced = false;
  vi.unstubAllGlobals();
});

describe("rich context", () => {
  it("is off outside a rich page and on inside one", () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useRich());
      return null;
    }
    render(<Probe />);
    render(rich(<Probe />));
    expect(seen).toEqual([false, true]);
  });

  it("useRichFx is off under reduced motion even inside a rich page", () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useRichFx());
      return null;
    }
    render(rich(<Probe />));
    fx.reduced = true;
    render(rich(<Probe />));
    expect(seen).toEqual([true, false]);
  });

  it("the Übersicht and the Cockpit are not rich pages, every other page is", () => {
    expect(isRichPage("overview")).toBe(false);
    expect(isRichPage("cockpit")).toBe(false);
    for (const p of ["coach", "wachstum", "community", "konto", "preise", "funktionen", "plan", "studio", "setups", "trades", "aktien", "labor", "settings"]) expect(isRichPage(p)).toBe(true);
  });
});

describe("silent boundary", () => {
  it("a decoration that cannot load is simply absent – its sibling text stays", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("chunk failed");
    }
    render(
      <div>
        <Quiet>
          <Broken />
        </Quiet>
        <p>Text bleibt</p>
      </div>,
    );
    expect(screen.getByText("Text bleibt")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("diagonal wave", () => {
  it("tiles on one anti-diagonal share a delay, each diagonal comes stagger.reveal later", () => {
    expect(waveDelay(0, 0)).toBe(0);
    expect(waveDelay(1, 0)).toBe(waveDelay(0, 1));
    expect(waveDelay(2, 1)).toBeCloseTo(3 * stagger.reveal, 10);
    expect(waveDelay(1, 1, 0.5)).toBeCloseTo(0.5 + 2 * stagger.reveal, 10);
  });

  it("is capped, so a 48-tile grid lands within WAVE_MAX steps", () => {
    expect(waveDelay(40, 40)).toBeCloseTo(WAVE_MAX * stagger.reveal, 10);
    expect(waveDelay(-3, -3)).toBe(0);
  });

  it("gridCell maps a row-major index onto column and row", () => {
    expect(gridCell(0, 3)).toEqual({ col: 0, row: 0 });
    expect(gridCell(4, 3)).toEqual({ col: 1, row: 1 });
    expect(gridCell(7, 1)).toEqual({ col: 0, row: 7 });
    expect(gridCell(5, 0)).toEqual({ col: 0, row: 5 });
  });
});

describe("page header", () => {
  it("renders exactly as before outside a rich page: no aura, plain words", () => {
    const { container } = render(<PageHeader title="Coach Heute" lead="Lead" ghost="Muster" />);
    expect(container.querySelector(".rich-aura")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Coach Heute");
    expect(container.querySelector("[class*='clip-path']")).toBeNull();
  });

  it("inside a rich page the words are pulled up out of a clip and the aura (with the ghost word) mounts lazily", async () => {
    stubMatchMedia(MOUSE);
    const { container } = render(rich(<PageHeader title="Coach Heute" lead="Lead" ghost="Muster" />));
    // the accessible name of the h1 stays the plain title
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Coach Heute");
    expect(container.querySelectorAll("h1 [class*='clip-path']")).toHaveLength(2);
    const aura = await screen.findByTestId("rich-aura");
    expect(aura).toHaveAttribute("aria-hidden", "true");
    expect(aura.querySelector("[data-ghost='Muster']")).not.toBeNull();
    // a mouse gets the pointer spotlight
    expect(aura.querySelector(".rich-aura__spot")).not.toBeNull();
  });

  it("no spotlight without a mouse, no aura at all under reduced motion", async () => {
    stubMatchMedia(() => false);
    const touch = render(rich(<PageHeader title="Wachstum" lead="Lead" />));
    const aura = await screen.findByTestId("rich-aura");
    expect(aura.querySelector(".rich-aura__spot")).toBeNull();
    expect(aura.querySelector(".rich-aura__ghost")).toBeNull();
    touch.unmount();
    fx.reduced = true;
    const { container } = render(rich(<PageHeader title="Wachstum" lead="Lead" />));
    expect(container.querySelector(".rich-aura")).toBeNull();
    expect(container.querySelector("h1 [class*='clip-path']")).toBeNull();
  });
});

describe("empty state", () => {
  it("keeps the dot-matrix ∅ outside a rich page", () => {
    const { container } = render(<EmptyState title="Noch nichts" line={false} />);
    expect(container.querySelector("[data-testid='empty-art']")).toBeNull();
    expect(container.querySelector("svg, canvas")).not.toBeNull();
  });

  it("shows a running picture of its own kind on a rich page (the box is there at once, the art arrives into it)", async () => {
    const { container } = render(rich(<EmptyState title="Noch nichts" art="orbit" line={false} action={<button type="button">Los</button>} />));
    // in the flow it is as high as the dot glyph (33 px), the 64 × 40 picture overhangs inside it
    expect(container.querySelector("[style*='width: 64px'][style*='height: 33px']")).not.toBeNull();
    expect(container.querySelector("[data-empty-art-box][style*='height: 40px']")).not.toBeNull();
    const art = await screen.findByTestId("empty-art");
    expect(art).toHaveAttribute("data-kind", "orbit");
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Los" })).toBeInTheDocument();
  });

  it("picks the picture from the title, always the same one", () => {
    expect(pickArt("Noch keine Trades")).toBe(pickArt("Noch keine Trades"));
    expect(new Set(["a", "bb", "ccc", "dddd", "Noch kein Ziel", "Keine Muster", "Profil im Aufbau"].map(pickArt)).size).toBeGreaterThan(1);
  });

  it("static under reduced motion: the old ∅", () => {
    fx.reduced = true;
    const { container } = render(rich(<EmptyState title="Noch nichts" line={false} />));
    expect(container.querySelector("[data-testid='empty-art']")).toBeNull();
  });
});

describe("card", () => {
  it("adds the frosted veil only on a rich page with a mouse", () => {
    stubMatchMedia(MOUSE);
    const plain = render(<Card title="Karte">x</Card>);
    expect(plain.container.querySelector("span.shadow-\\[inset_0_1px_0_rgb\\(var\\(--veil-rgb\\,255_255_255\\)\\/0\\.08\\)\\]")).toBeNull();
    plain.unmount();
    const on = render(rich(<Card title="Karte">x</Card>));
    expect(on.container.querySelector("span[class*='group-hover:opacity-100'][class*='from-white']")).not.toBeNull();
    on.unmount();
    stubMatchMedia(() => false);
    const touch = render(rich(<Card title="Karte">x</Card>));
    expect(touch.container.querySelector("span[class*='from-white/\\[0\\.05\\]']")).toBeNull();
  });

  it("tilts only when asked to: the surface carries a transform style while the mouse is on it and none at rest", () => {
    stubMatchMedia(MOUSE);
    const { container } = render(rich(<Card title="Karte" tilt data-testid="c">x</Card>));
    const surface = container.querySelector("[data-testid='c']") as HTMLElement;
    // a tilting card must not let a CSS transition smear the transform that Motion writes
    expect(surface.className).toContain("transition-[translate]");
    expect(surface.className).not.toContain("transition-transform");
    expect(surface.style.transform === "" || surface.style.transform === "none").toBe(true);
    const plain = render(rich(<Card title="Ruhig" data-testid="p">x</Card>));
    expect((plain.container.querySelector("[data-testid='p']") as HTMLElement).className).toContain("transition-transform");
  });

  it("a highlighted card runs one beam lap when it is first seen (no observer in jsdom: none) and when a mouse enters", async () => {
    stubMatchMedia(MOUSE);
    const { container } = render(rich(<Card title="Karte" highlight data-testid="h">x</Card>));
    const surface = container.querySelector("[data-testid='h']") as HTMLElement;
    expect(screen.queryByTestId("card-beam")).toBeNull();
    fireEvent.pointerEnter(surface, { pointerType: "mouse", clientX: 3, clientY: 3 });
    await waitFor(() => expect(screen.getByTestId("card-beam")).toBeInTheDocument());
  });
});

describe("streak flame", () => {
  const streak = { key: "checkin", label: "Check-in", current: 3, best: 5, unit: "Tage", pending: false } as unknown as Streak;

  it("only a running streak on a rich page carries the flame; the Cockpit's board and a broken streak stay as they were", () => {
    const plain = render(<StreakBadge streak={streak} />);
    expect(plain.container.querySelector(".ml-auto.self-center")).toBeNull();
    plain.unmount();
    const on = render(rich(<StreakBadge streak={streak} />));
    expect(on.container.querySelector(".ml-auto.self-center")).not.toBeNull();
    on.unmount();
    const broken = render(rich(<StreakBadge streak={{ ...streak, current: 0 }} />));
    expect(broken.container.querySelector(".ml-auto.self-center")).toBeNull();
  });
});

describe("float", () => {
  it("wraps a pill in a floating box on a rich page and renders it bare elsewhere", () => {
    const bare = render(
      <Float>
        <span>Pro</span>
      </Float>,
    );
    expect(bare.container.querySelector(".rich-float")).toBeNull();
    bare.unmount();
    const on = render(
      rich(
        <Float delay={2}>
          <span>Pro</span>
        </Float>,
      ),
    );
    const box = on.container.querySelector(".rich-float") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.animationDelay).toBe("-2s");
    expect(box.textContent).toBe("Pro");
  });
});
