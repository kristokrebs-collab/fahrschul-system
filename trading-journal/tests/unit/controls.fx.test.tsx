/**
 * Bedienelemente Runde 10: Button-Zustände (Erfolg, Fehler), `useActionStatus`, Rich-Hover-Marker, Magnet, `CopyButton`, `Stepper`,
 * Chip-Abzeichen, Suchfeld-„×“, Fold-Berührung, Toast-Meilenstein, Mini-Konfetti, Auswahlliste (nur Optik).
 */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { magnetOffset, MAGNET_MAX_X, MAGNET_MAX_Y } from "@/motion/buttonMagnet";
import { burstParticles } from "@/motion/Celebrate";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Button } from "@/primitives/Button";
import { chipClass } from "@/primitives/chip";
import { CopyButton } from "@/primitives/CopyButton";
import { Fold, FOLDS_KEY } from "@/primitives/Fold";
import { Input } from "@/primitives/Input";
import { Stepper } from "@/primitives/Stepper";
import { ToastIsland } from "@/primitives/Toast";
import { toast, useToastStore } from "@/primitives/toastStore";
import { useActionStatus } from "@/primitives/useActionStatus";

describe("Button: Erfolg und Fehler", () => {
  it("success: label turns transparent (width stays), a check draws, a green wash fades in, clicks still work", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" success onClick={onClick}>
        Speichern
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Speichern" });
    expect(b).toHaveAttribute("data-status", "success");
    expect(b).not.toHaveAttribute("aria-busy");
    expect(b.className).toContain("text-transparent");
    expect(b.querySelector("svg.fx-check path")).not.toBeNull();
    expect(b.querySelector("span.bg-win")).not.toBeNull();
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("error: the shake hook (`data-status`), a red wash, the label stays readable", () => {
    render(<Button status="error">Senden</Button>);
    const b = screen.getByRole("button", { name: "Senden" });
    expect(b).toHaveAttribute("data-status", "error");
    expect(b.className).not.toContain("text-transparent");
    expect(b.querySelector("svg.fx-check")).toBeNull();
    expect(b.querySelector("span.bg-loss\\/15")).not.toBeNull();
  });

  it("loading wins over success; idle has no status marker; statusIcon={false} keeps the label", () => {
    const { rerender } = render(
      <Button loading success>
        Los
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Los" })).toHaveAttribute("data-status", "loading");
    expect(screen.getByRole("button", { name: "Los" })).toHaveAttribute("aria-busy", "true");
    rerender(<Button>Los</Button>);
    expect(screen.getByRole("button", { name: "Los" })).not.toHaveAttribute("data-status");
    rerender(
      <Button success statusIcon={false}>
        Los
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Los" });
    expect(b.className).not.toContain("text-transparent");
    expect(b.querySelector("svg.fx-check")).toBeNull();
  });
});

describe("Button: reiche Hover-Marker (`data-fx`)", () => {
  it("secondary with a text label: shine + roll + magnet; the roll adds no text to the DOM and the name stays", () => {
    render(<Button>Exportieren</Button>);
    const b = screen.getByRole("button", { name: "Exportieren" });
    expect(b.getAttribute("data-fx")).toBe("shine roll magnet");
    expect(b.textContent).toBe("Exportieren");
    expect(b.querySelector(".btn-roll")?.getAttribute("data-t")).toBe("Exportieren");
  });

  it("primary: shine + magnet; sm: shine only; ghost and danger: nothing; `fx={false}` and non-text labels: no roll", () => {
    render(
      <>
        <Button variant="primary">Weiter</Button>
        <Button variant="primary" size="sm">
          Klein
        </Button>
        <Button variant="ghost">Zurück</Button>
        <Button variant="danger">Löschen</Button>
        <Button fx={false} variant="primary">
          Bezahlen
        </Button>
        <Button>
          <span>Icon</span>
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Weiter" }).getAttribute("data-fx")).toBe("shine magnet");
    expect(screen.getByRole("button", { name: "Klein" }).getAttribute("data-fx")).toBe("shine");
    expect(screen.getByRole("button", { name: "Zurück" })).not.toHaveAttribute("data-fx");
    expect(screen.getByRole("button", { name: "Löschen" })).not.toHaveAttribute("data-fx");
    expect(screen.getByRole("button", { name: "Bezahlen" })).not.toHaveAttribute("data-fx");
    expect(screen.getByRole("button", { name: "Icon" }).getAttribute("data-fx")).toBe("shine magnet");
    expect(screen.getByRole("button", { name: "Icon" }).querySelector(".btn-roll")).toBeNull();
  });

  it("`run`: the border beam exists only while the mouse is over the button on a rich page, never at rest or elsewhere", () => {
    const { rerender } = render(
      <div data-rich="">
        <Button variant="primary" run>
          Neu
        </Button>
      </div>,
    );
    const b = screen.getByRole("button", { name: "Neu" });
    expect(b.querySelector(".fx-ring")).toBeNull();
    fireEvent.pointerEnter(b, { pointerType: "mouse" });
    expect(b.querySelector(".fx-ring")).not.toBeNull();
    fireEvent.pointerLeave(b, { pointerType: "mouse" });
    expect(b.querySelector(".fx-ring")).toBeNull();
    // touch never starts it
    fireEvent.pointerEnter(b, { pointerType: "touch" });
    expect(b.querySelector(".fx-ring")).toBeNull();
    // outside [data-rich] (Übersicht, Cockpit, sheets) the same button stays plain
    rerender(
      <Button variant="primary" run>
        Neu
      </Button>,
    );
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Neu" }), { pointerType: "mouse" });
    expect(screen.getByRole("button", { name: "Neu" }).querySelector(".fx-ring")).toBeNull();
  });
});

describe("Magnet", () => {
  it("leans a tenth of the distance, at most 4 px across and 3 px up/down", () => {
    expect(magnetOffset(20, -10)).toEqual({ x: 2, y: -1 });
    expect(magnetOffset(500, 500)).toEqual({ x: MAGNET_MAX_X, y: MAGNET_MAX_Y });
    expect(magnetOffset(-500, -500)).toEqual({ x: -MAGNET_MAX_X, y: -MAGNET_MAX_Y });
    expect(magnetOffset(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("useActionStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loading → success → idle after the hold; an error falls back too; `false` counts as a failure", async () => {
    const { result } = renderHook(() => useActionStatus(500));
    expect(result.current.status).toBe("idle");
    let p!: Promise<string | undefined>;
    act(() => {
      p = result.current.run(async () => "ok");
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await p;
    });
    expect(result.current.status).toBe("success");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.run(() => {
        throw new Error("nein");
      });
    });
    expect(result.current.status).toBe("error");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.run(() => false);
    });
    expect(result.current.status).toBe("error");
  });
});

describe("CopyButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("copies, shows the drawn check and the done label, then goes back", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    const onResult = vi.fn();
    render(<CopyButton text="geheim" label="Kopieren" doneLabel="Kopiert" onResult={onResult} hold={800} />);
    const b = screen.getByRole("button", { name: "Kopieren" });
    expect(b.querySelector("svg.fx-check")).toBeNull();
    await act(async () => {
      fireEvent.click(b);
    });
    expect(write).toHaveBeenCalledWith("geheim");
    expect(onResult).toHaveBeenCalledWith(true);
    const done = screen.getByRole("button", { name: "Kopiert" });
    expect(done).toHaveAttribute("data-status", "success");
    expect(done.querySelector("svg.fx-check path")).not.toBeNull();
    // the label stays (statusIcon is off): no transparent text
    expect(done.className).not.toContain("text-transparent");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByRole("button", { name: "Kopieren" })).not.toHaveAttribute("data-status");
  });

  it("a failed copy shakes (data-status=error), keeps the label and reports false; `onCopy` wins over `text`", async () => {
    const custom = vi.fn(() => Promise.resolve(false));
    const onResult = vi.fn();
    render(<CopyButton text="x" onCopy={custom} onResult={onResult} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kopieren" }));
    });
    expect(custom).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Kopieren" })).toHaveAttribute("data-status", "error");
  });

  it("reserves the longer label without putting text in the DOM; iconOnly drops the label", () => {
    const { container, rerender } = render(<CopyButton text="x" />);
    expect(container.querySelector(".fx-reserve")?.getAttribute("data-reserve")).toBe("Kopieren");
    expect(container.textContent).toBe("Kopieren");
    rerender(<CopyButton text="x" iconOnly aria-label="Link kopieren" />);
    expect(container.querySelector(".fx-reserve")).toBeNull();
    expect(screen.getByRole("button", { name: "Link kopieren" })).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  function Harness({ start = 3, min = 2, max = 5 }: { start?: number; min?: number; max?: number }) {
    const [v, setV] = useState(start);
    return <Stepper value={v} min={min} max={max} onChange={setV} decreaseLabel="Weniger" increaseLabel="Mehr" testId="n" />;
  }

  it("steps within min and max; the output's text is exactly the figure; the limit button is disabled", () => {
    render(<Harness />);
    const out = screen.getByTestId("n");
    expect(out.textContent).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    expect(out.textContent).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
    expect(out.textContent).toBe("5");
    expect(screen.getByRole("button", { name: "Mehr" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Weniger" }));
    fireEvent.click(screen.getByRole("button", { name: "Weniger" }));
    fireEvent.click(screen.getByRole("button", { name: "Weniger" }));
    expect(out.textContent).toBe("2");
    expect(screen.getByRole("button", { name: "Weniger" })).toBeDisabled();
  });
});

describe("Chip, Suchfeld, Fold", () => {
  it("chipClass carries the badge hook and the tone colours of the tick", () => {
    expect(chipClass(true)).toContain("fx-chip");
    expect(chipClass(true)).toContain("relative");
    expect(chipClass(true, { tone: "win" })).toContain("[--fx-tick:var(--color-win)]");
    expect(chipClass(false)).toContain("fx-chip");
  });

  it("a search Input gets a blank placeholder and a „×“ that clears the value through onChange and keeps the focus", () => {
    const seen: string[] = [];
    function Search() {
      const [q, setQ] = useState("abc");
      return (
        <Input
          type="search"
          aria-label="Suchen"
          value={q}
          onChange={(e) => {
            seen.push(e.target.value);
            setQ(e.target.value);
          }}
        />
      );
    }
    render(<Search />);
    const input = screen.getByLabelText("Suchen");
    expect(input).toHaveAttribute("placeholder", " ");
    fireEvent.click(screen.getByRole("button", { name: "Suche leeren", hidden: true }));
    expect(seen).toEqual([""]);
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("`clearable={false}` leaves a search field to its own clear button", () => {
    render(<Input type="search" clearable={false} aria-label="Eigene Suche" />);
    expect(screen.queryByRole("button", { name: "Suche leeren", hidden: true })).toBeNull();
    expect(screen.getByLabelText("Eigene Suche")).not.toHaveAttribute("clearable");
  });

  it("a text Input has no clear button; a given placeholder is kept", () => {
    render(<Input aria-label="Name" placeholder="z. B. BTC" />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "z. B. BTC");
    expect(screen.queryByRole("button", { name: "Suche leeren", hidden: true })).toBeNull();
  });

  it("Fold marks itself touched on the first tap of the summary (not before)", () => {
    localStorage.removeItem(FOLDS_KEY);
    const { container } = render(
      <Fold id="fx-1" title="Titel" hint="Hinweis">
        <p>Inhalt</p>
      </Fold>,
    );
    const d = container.querySelector("details") as HTMLDetailsElement;
    expect(d).not.toHaveAttribute("data-touched");
    fireEvent.click(d.querySelector("summary") as HTMLElement);
    expect(d).toHaveAttribute("data-touched");
  });
});

describe("Toast-Meilenstein", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("a flagged ok toast reports once (with the symbol disc) after the island has grown; routine toasts never do", () => {
    const onMilestone = vi.fn();
    toast.ok("Routine gespeichert");
    const { rerender } = render(<ToastIsland onMilestone={onMilestone} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMilestone).not.toHaveBeenCalled();
    act(() => useToastStore.getState().clear());
    rerender(<ToastIsland onMilestone={onMilestone} />);
    act(() => {
      toast.ok("Erste 10 Trades im Journal", { milestone: true });
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onMilestone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(onMilestone).toHaveBeenCalledTimes(1);
    expect(onMilestone.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
  });

  it("an error toast never celebrates, flagged or not", () => {
    const onMilestone = vi.fn();
    render(<ToastIsland onMilestone={onMilestone} />);
    act(() => {
      toast.error("Nicht gespeichert", { milestone: true });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onMilestone).not.toHaveBeenCalled();
  });
});

describe("Mini-Konfetti", () => {
  const base = { x: 100, y: 100, tone: "win" as const, seed: 7 };
  it("a mini puff is 12 dots, slower and shorter-lived than a win burst, and deterministic", () => {
    const mini = burstParticles({ ...base, kind: "mini" });
    const win = burstParticles({ ...base, kind: "win" });
    expect(mini).toHaveLength(12);
    expect(mini).toEqual(burstParticles({ ...base, kind: "mini" }));
    const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
    expect(avg(mini.map((p) => p.duration))).toBeLessThan(avg(win.map((p) => p.duration)));
    expect(Math.max(...mini.map((p) => p.size))).toBeLessThanOrEqual(5);
    expect(mini.some((p) => p.record)).toBe(false);
  });
});

describe("Auswahlliste: Optik auf reichen Seiten", () => {
  const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];
  function Select() {
    const [v, setV] = useState("a");
    return <MorphSelect aria-label="Wahl" value={v} options={OPTIONS} onChange={setV} />;
  }

  it("the panel takes the rich flag from its trigger's page, plus the glide marker and the row index; the logic is unchanged", () => {
    render(
      <div data-rich="">
        <Select />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Wahl" }));
    const panel = document.querySelector("[data-pulse-select]") as HTMLElement;
    expect(panel).toHaveAttribute("data-ms-rich");
    const glide = panel.querySelector(".ms-glide") as HTMLElement;
    expect(glide).not.toBeNull();
    expect(glide.style.transform).toBe("translateY(0px)");
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(3);
    expect(opts[2]?.style.getPropertyValue("--i")).toBe("2");
    fireEvent.click(opts[1] as HTMLElement);
    expect(screen.getByRole("button", { name: "Wahl" })).toHaveAttribute("data-value", "b");
  });

  it("a trigger outside [data-rich] keeps the plain panel", () => {
    render(<Select />);
    fireEvent.click(screen.getByRole("button", { name: "Wahl" }));
    expect(document.querySelector("[data-pulse-select]")).not.toHaveAttribute("data-ms-rich");
  });
});
