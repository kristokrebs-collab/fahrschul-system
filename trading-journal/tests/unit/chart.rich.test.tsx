/**
 * Runde 10 – the rich chart / number / list motion (`src/chart/rich.ts`, `CountText`, `rows`, `ChartPlaceholder`, `fanDraw`).
 * The rules under test: nothing changes outside `[data-rich]` (the Übersicht and the Cockpit keep their picture), the DOM text
 * is the final text whenever nothing counts, lists arm once and release once, the fan's colours follow the end of each run.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartPlaceholder } from "@/chart/ChartPlaceholder";
import { CountText, countText, parseCount } from "@/chart/CountText";
import { isRich } from "@/chart/rich";
import { Rows } from "@/chart/rows";
import type { MonteCarloResult } from "@/domain/analytics";
import { EmptyState } from "@/primitives/EmptyState";
import { drawFanScene, FAN_LINE_ALPHA, fanFrame, niceTicks, paintFan, readFanPaint, sampleSplit, stepAtX, stepStats } from "@/views/analyse/fanDraw";
import { fanGeometry } from "@/views/analyse/MonteCarloCard";

class FakeIO {
  static all: FakeIO[] = [];
  observed = new Set<Element>();
  constructor(public cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}
/** Tells every observer that `el` is on screen. */
const show = (el: Element) => act(() => FakeIO.all.forEach((o) => o.observed.has(el) && o.cb([{ target: el, isIntersecting: true }])));

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

describe("isRich", () => {
  it("is true only below a data-rich layer", () => {
    const { container } = render(
      <div>
        <div data-rich="">
          <span data-testid="in" />
        </div>
        <span data-testid="out" />
      </div>,
    );
    expect(isRich(container.querySelector("[data-testid=in]"))).toBe(true);
    expect(isRich(container.querySelector("[data-testid=out]"))).toBe(false);
    expect(isRich(null)).toBe(false);
  });
});

describe("parseCount / countText", () => {
  it("finds exactly one German number and keeps prefix, suffix, sign and decimals", () => {
    const p = parseCount("+0,42 R")!;
    expect(p).toMatchObject({ pre: "", post: " R", value: 0.42, decimals: 2, plus: true });
    expect(countText(p, 0)).toBe("+0,00 R");
    expect(countText(p, 0.42)).toBe("+0,42 R");
    const g = parseCount("−1.232,5 USDT")!;
    expect(g.value).toBe(-1232.5);
    expect(g.grouped).toBe(true);
    expect(countText(g, -616.25)).toBe("−616,3 USDT");
    expect(countText(g, -1232.5)).toBe("−1.232,5 USDT");
    expect(countText(parseCount("45 %")!, 12.4)).toBe("12 %");
  });
  it("leaves dates, ranges, fractions and plain words alone", () => {
    for (const t of ["26.04.2026", "−0,12 … +0,80 R", "11 / 20 Trades", "12:30", "klar", "–"]) expect(parseCount(t)).toBeNull();
  });
  it("never shows a minus sign in front of zero while counting a negative figure", () => {
    expect(countText(parseCount("−140 USDT")!, -0.2)).toBe("0 USDT");
  });
});

describe("CountText", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the final text outside a rich page (nothing counts)", () => {
    render(<CountText text="+0,42 R" className="x" />);
    expect(screen.getByText("+0,42 R")).toBeInTheDocument();
  });

  it("on a rich page it rests at 0 until the figure is on screen, then counts to the final text", async () => {
    const { container } = render(
      <div data-rich="">
        <CountText text="+0,42 R" />
      </div>,
    );
    const el = container.querySelector("span")!;
    expect(el.textContent).toBe("+0,00 R");
    show(el);
    // motion animates on its own frame loop: wait until it has settled on the final text
    await vi.waitFor(() => expect(el.textContent).toBe("+0,42 R"), { timeout: 3000 });
  });

  it("a revealKey counts only the first time in a session", () => {
    const first = render(
      <div data-rich="">
        <CountText text="+7 R" revealKey="t:once" />
      </div>,
    );
    const a = first.container.querySelector("span")!;
    expect(a.textContent).toBe("+0 R");
    show(a);
    first.unmount();
    const second = render(
      <div data-rich="">
        <CountText text="+7 R" revealKey="t:once" />
      </div>,
    );
    expect(second.container.querySelector("span")!.textContent).toBe("+7 R");
  });
});

describe("Rows", () => {
  it("does nothing outside a rich page", () => {
    const { container } = render(
      <Rows className="grid">
        <li>a</li>
        <li>b</li>
      </Rows>,
    );
    const ul = container.querySelector("ul")!;
    expect(ul.hasAttribute("data-rows-arm")).toBe(false);
  });

  it("arms before the first view, plays once when seen and is plain again afterwards", () => {
    vi.useFakeTimers();
    const { container } = render(
      <div data-rich="">
        <Rows as="ol">
          <li>a</li>
          <li>b</li>
        </Rows>
      </div>,
    );
    const ol = container.querySelector("ol")!;
    expect(ol.hasAttribute("data-rows-arm")).toBe(true);
    show(ol);
    expect(ol.hasAttribute("data-rows-arm")).toBe(false);
    expect(ol.hasAttribute("data-rows-go")).toBe(true);
    act(() => void vi.advanceTimersByTime(1100));
    expect(ol.hasAttribute("data-rows-go")).toBe(false);
    // a second sighting never replays
    show(ol);
    expect(ol.hasAttribute("data-rows-go")).toBe(false);
    vi.useRealTimers();
  });

  it("an empty list does not arm; it arms when its first row arrives", () => {
    const ui = (n: number) => (
      <div data-rich="">
        <Rows>{Array.from({ length: n }, (_, i) => <li key={i}>x</li>)}</Rows>
      </div>
    );
    const { container, rerender } = render(ui(0));
    const ul = container.querySelector("ul")!;
    expect(ul.hasAttribute("data-rows-arm")).toBe(false);
    rerender(ui(2));
    expect(ul.hasAttribute("data-rows-arm")).toBe(true);
  });
});

describe("ChartPlaceholder and EmptyState chart", () => {
  it("renders the breathing line with its honest text", () => {
    render(<ChartPlaceholder text="Noch keine Daten" />);
    expect(screen.getByText("Noch keine Daten")).toBeInTheDocument();
    expect(document.querySelector("[data-chart-ph] .chart-ph__line")).not.toBeNull();
  });
  it("EmptyState chart puts the line in, hidden unless a data-rich layer is above (CSS class)", () => {
    const { container } = render(<EmptyState chart title="Leer" line={false} />);
    const ph = container.querySelector("[data-chart-ph]")!;
    expect(ph).not.toBeNull();
    expect(ph.className).toContain("hidden");
    expect(ph.className).toContain("[[data-rich]_&]:grid");
    // out of the flow: it never changes the height of the box
    expect(ph.className).toContain("absolute");
  });
});

/** A small deterministic result: horizon 4, bands ordered p5 < … < p95, three kept paths (two end above the start, one below). */
const RES: MonteCarloResult = {
  runs: 2000,
  horizon: 4,
  seed: 1,
  method: "bootstrap",
  bands: ([5, 25, 50, 75, 95] as const).map((p, k) => ({ p, values: [0, 1, 2, 3, 4].map((i) => (k - 2) * i) })),
  final: { p5: -8, p25: -4, p50: 0, p75: 4, p95: 8 } as MonteCarloResult["final"],
  maxDD: [],
  ddProb: [],
  ruin: null,
  longestLoss: null,
  paths: [
    [0, 1, 2, 3, 4],
    [0, 0, 1, 1, 0],
    [0, -1, -2, -2, -3],
  ],
};

describe("fan geometry helpers", () => {
  const geo = fanGeometry(RES, 204, 100)!;
  const f = fanFrame(geo, RES);
  it("maps steps to pixels and back (nearest step, clamped)", () => {
    expect(f.x(0)).toBe(4);
    expect(f.x(4)).toBe(200);
    expect(stepAtX(f, -50)).toBe(0);
    expect(stepAtX(f, 4 + 98)).toBe(2);
    expect(stepAtX(f, 9999)).toBe(4);
  });
  it("reads the percentile values of all runs after a trade", () => {
    expect(stepStats(RES, 3)).toEqual({ p5: -6, p25: -3, p50: 0, p75: 3, p95: 6 });
    expect(stepStats(RES, 99)).toBeNull();
  });
  it("counts the drawn sample by the end of each run (≥ start is green)", () => {
    expect(sampleSplit(RES)).toEqual({ win: 2, loss: 1 });
  });
  it("niceTicks gives round values", () => {
    expect(niceTicks(-23, 31, 4)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(1, 1)).toEqual([]);
  });
});

/** A recording 2D context: every call and the style at the time of each stroke / fill. */
function recorder() {
  const log: { op: string; style?: unknown; alpha?: number; comp?: string; blur?: number }[] = [];
  const state = { strokeStyle: "", fillStyle: "", globalAlpha: 1, globalCompositeOperation: "source-over", shadowBlur: 0, shadowColor: "", lineWidth: 1, font: "", textBaseline: "", textAlign: "", lineJoin: "", lineCap: "" } as Record<string, unknown>;
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (k === "measureText") return () => ({ width: 10 });
      return (..._a: unknown[]) => {
        if (k === "stroke" || k === "fill" || k === "fillText") log.push({ op: k, style: k === "stroke" ? t.strokeStyle : t.fillStyle, alpha: t.globalAlpha as number, comp: t.globalCompositeOperation as string, blur: t.shadowBlur as number });
        if (k === "save" || k === "restore") log.push({ op: k });
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

describe("drawFanScene", () => {
  const geo = fanGeometry(RES, 204, 100)!;
  it("strokes the sample lines green / red by their end, with alpha, additive on ink, and glows the median", () => {
    const { ctx, log } = recorder();
    const paint = { fg: "#f2f2f2", win: "#3ddc84", loss: "#ff4d4f", tick: "#5f5f5f", paper: false };
    drawFanScene(ctx, RES, geo, paint, (v) => String(v));
    const lines = log.filter((l) => l.op === "stroke" && l.alpha === FAN_LINE_ALPHA);
    expect(lines.filter((l) => l.style === paint.win)).toHaveLength(2);
    expect(lines.filter((l) => l.style === paint.loss)).toHaveLength(1);
    expect(lines.every((l) => l.comp === "lighter")).toBe(true);
    // the median: a stroke with a blur of 12 on ink
    expect(log.some((l) => l.op === "stroke" && l.blur === 12 && l.style === paint.fg)).toBe(true);
  });
  it("on paper there is no additive blending and a quieter glow", () => {
    const { ctx, log } = recorder();
    drawFanScene(ctx, RES, geo, { fg: "#121212", win: "#0a783b", loss: "#cc1e29", tick: "#6b6b6b", paper: true }, (v) => String(v));
    expect(log.filter((l) => l.op === "stroke" && l.alpha === FAN_LINE_ALPHA).every((l) => l.comp === "source-over")).toBe(true);
    expect(log.some((l) => l.op === "stroke" && l.blur === 5)).toBe(true);
  });
  it("readFanPaint follows the live ink", () => {
    expect(readFanPaint().paper).toBe(false);
  });
});

describe("paintFan", () => {
  const geo = fanGeometry(RES, 204, 100)!;
  let frames: ((t: number) => void)[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function canvasWith() {
    const draws: number[] = [];
    const ctx = { setTransform: () => undefined, clearRect: () => undefined, drawImage: (_i: unknown, _sx: number, _sy: number, sw: number) => draws.push(sw) } as unknown as CanvasRenderingContext2D;
    const { ctx: octx } = recorder();
    const c = document.createElement("canvas");
    const real = Document.prototype.createElement;
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = real.call(document, tag);
      if (tag === "canvas" && el !== c) (el as HTMLCanvasElement).getContext = (() => octx) as never;
      return el;
    }) as never);
    c.getContext = (() => ctx) as never;
    return { c, draws };
  }

  it("without animation: one blit of the whole picture, done at once, DPR ≤ 2", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const { c, draws } = canvasWith();
    const done = vi.fn();
    paintFan(c, RES, geo, { animate: false, onDone: done, tickLabel: String });
    expect(done).toHaveBeenCalledTimes(1);
    expect(c.width).toBe(408);
    expect(draws).toEqual([408]);
  });

  it("a slow device: the scene paint is sliced – the first slice runs at once, the rest on later frames, nothing is shown half-painted", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { c, draws } = canvasWith();
    const done = vi.fn();
    // every clock read costs 10 ms: one step exceeds the 8 ms slice budget
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
    paintFan(c, RES, geo, { animate: false, onDone: done, tickLabel: String });
    expect(done).not.toHaveBeenCalled();
    expect(draws).toEqual([]);
    expect(frames.length).toBe(1);
    for (let n = 0; n < 50 && frames.length; n++) frames.shift()!(clock);
    expect(done).toHaveBeenCalledTimes(1);
    expect(draws).toEqual([204]);
  });

  it("cleanup stops a sliced paint: nothing is drawn afterwards", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { c, draws } = canvasWith();
    const done = vi.fn();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
    const stop = paintFan(c, RES, geo, { animate: false, onDone: done, tickLabel: String });
    stop();
    for (let n = 0; n < 50 && frames.length; n++) frames.shift()!(clock);
    expect(done).not.toHaveBeenCalled();
    expect(draws).toEqual([]);
  });

  it("with animation: a growing strip, ease-out (fast first), done exactly once at the end", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { c, draws } = canvasWith();
    const done = vi.fn();
    paintFan(c, RES, geo, { animate: true, onDone: done, tickLabel: String });
    let t = performance.now();
    const step = (ms: number) => {
      t += ms;
      const cb = frames.shift();
      cb?.(t);
    };
    step(0);
    step(40);
    step(40);
    expect(done).not.toHaveBeenCalled();
    const grown = draws.slice(1);
    expect(grown.every((w, i) => i === 0 || w >= grown[i - 1]!)).toBe(true);
    // ease-out: after about 5 % of the time the strip is already well past 5 %
    expect(grown[grown.length - 1]! / 204).toBeGreaterThan(0.1);
    for (let i = 0; i < 80 && frames.length; i++) step(40);
    expect(done).toHaveBeenCalledTimes(1);
    expect(draws[draws.length - 1]).toBe(204);
  });
});
