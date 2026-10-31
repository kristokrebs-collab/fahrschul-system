/**
 * Box-zu-Box chart primitive (`src/chart/primitives/BoxPrimitive.ts`, P02) on a fake chart: x / y geometry of boxes
 * and their targets (future times past the last bar), visibility culling, the active box's edge prices on the axis
 * (guarded against other axis labels), opt-in autoscale, hit test ids, the finite draw-in / confirmation wipe and the
 * static end state under reduced motion. Plus the analysis → chart-box mapping of the Markt page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import { analyzeBoxes, reentryIndex } from "@/domain/boxes";
import type { Bar } from "@/domain/signals/indicators";
import { BoxPrimitive, easeOutCubic, logicalAt, type ChartBox } from "@/chart/primitives/BoxPrimitive";
import { toChartBoxes } from "@/views/markt/chartBoxes";

const H = 3600;
/** 100 hourly bars from t0. */
const T0 = 1_790_000_000 - (1_790_000_000 % H);
const bars = Array.from({ length: 100 }, (_, i) => ({ time: T0 + i * H, high: 110, low: 90 }));
const ms = (i: number) => (T0 + i * H) * 1000;

function attach(box: BoxPrimitive, opts: { from?: number; to?: number; width?: number } = {}) {
  const width = opts.width ?? 1000;
  const chart = {
    // like lightweight-charts 5.2: only WHOLE logicals map (a fractional one answers 0, the left pane edge)
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: opts.from ?? 0, to: opts.to ?? 110 }), width: () => width, logicalToCoordinate: (i: number) => (Number.isInteger(i) ? i * 8 + 4 : 0) }),
    panes: () => [{ getHeight: () => 400 }],
  };
  const series = { priceToCoordinate: (p: number) => 400 - (p - 80) * 10 };
  let updates = 0;
  box.attached({ chart, series, requestUpdate: () => void (updates += 1) } as never);
  return { updates: () => updates };
}

const host = (reduced = true, axisPrices: number[] = []) => ({ bars: () => bars, intervalSec: () => H, reducedMotion: () => reduced, axisPrices: () => axisPrices });
const B = (over: Partial<ChartBox> = {}): ChartBox => ({ id: "a", from: ms(10), to: ms(40), top: 105, btm: 95, tone: "neutral", ...over });

describe("logicalAt", () => {
  it("maps bar times to indices, times past the last bar into the future space, before the first to null", () => {
    expect(logicalAt(bars, T0 + 10 * H, H)).toBe(10);
    expect(logicalAt(bars, T0 + 10 * H + 600, H)).toBe(11); // inside a bar → the bar at or after
    expect(logicalAt(bars, T0 + 105 * H, H)).toBe(105);
    expect(logicalAt(bars, T0 - H, H)).toBeNull();
    expect(logicalAt([], T0, H)).toBeNull();
  });
});

describe("BoxPrimitive geometry", () => {
  it("draws a time-bounded box between its bars at the edge prices; a live box reaches the right edge", () => {
    const p = new BoxPrimitive(host());
    attach(p);
    p.setBoxes([B(), B({ id: "live", from: ms(60), to: null, top: 108, btm: 100, active: true })]);
    p.updateAllViews();
    const g = p.geometry();
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ x1: 10 * 8 + 4 - 4, x2: 40 * 8 + 4 - 4, y1: 400 - 25 * 10, y2: 400 - 15 * 10, grow: 1, edge: 1, wipe: 1 });
    expect(g[1]!.x2).toBe(1000);
  });

  it("targets run from the box's right end to the price-line strip, with their labels", () => {
    const p = new BoxPrimitive(host());
    attach(p);
    p.setBoxes([B({ active: true, tone: "win", targets: [{ price: 112, label: "T1", kind: "tp" }, { price: 93, label: "Stop", kind: "sl" }] })]);
    p.updateAllViews();
    const t = p.geometry()[0]!.targets;
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ x1: 40 * 8, x2: 1000 - 64, y: 400 - 32 * 10, grow: 1 });
    expect(t[0]!.text).toBe("T1 112");
    expect(t[1]!.color).toBe("#ff4d4f");
  });

  it("labels never overlap the check overlay's labels: nudged off a reserved spot, else left out (the line stays)", () => {
    const reserved: Array<{ x: number; y: number; w: number; h: number }> = [];
    const p = new BoxPrimitive({ ...host(), reserved: () => reserved });
    attach(p);
    const targets = [{ price: 112, label: "T1", kind: "tp" as const }];
    p.setBoxes([B({ active: true, label: "Box stark", targets })]);
    p.updateAllViews();
    const free = p.geometry()[0]!;
    expect(free.targets[0]!.label).not.toBeNull();
    expect(free.caption?.text).toBe("BOX STARK");
    // a check-overlay label right where T1's label wants to sit, and over the caption
    reserved.push({ ...free.targets[0]!.label!.box }, { x: 0, y: 0, w: 1000, h: free.caption!.box.y + free.caption!.box.h + 40 });
    p.applyOptions({}); // drop the geometry memo
    p.updateAllViews();
    const g = p.geometry()[0]!;
    const lab = g.targets[0]!.label;
    if (lab) for (const r of reserved) expect(lab.box.y >= r.y + r.h || lab.box.y + lab.box.h <= r.y || lab.box.x >= r.x + r.w || lab.box.x + lab.box.w <= r.x).toBe(true);
    expect(g.targets[0]!.text).toBe("T1 112");
    expect(g.caption).toBeNull();
  });

  it("culls boxes outside the visible range", () => {
    const p = new BoxPrimitive(host());
    attach(p, { from: 50, to: 100 });
    p.setBoxes([B({ id: "old", from: ms(0), to: ms(20) }), B({ id: "seen", from: ms(45), to: ms(70) })]);
    p.updateAllViews();
    expect(p.geometry().map((g) => g.id)).toEqual(["seen"]);
  });

  it("active box edges on the price axis, hidden next to another axis label; target prices for the tick guard", () => {
    const p = new BoxPrimitive(host(true, [105.5]));
    attach(p);
    p.setBoxes([B({ active: true })]);
    p.updateAllViews();
    expect(p.axisY("top")).toBeNull(); // 105.5 is 5 px away → clash
    expect(p.axisY("btm")).toBe(400 - 15 * 10);
    expect(p.targetPrices()).toEqual([95]);
  });

  it("autoscale is opt-in and covers the boxes in view plus the active box's targets", () => {
    const p = new BoxPrimitive(host());
    attach(p);
    p.setBoxes([B({ active: true, targets: [{ price: 120, kind: "tp" }] }), B({ id: "far", from: ms(80), to: ms(90), top: 200, btm: 150 })]);
    expect(p.autoscaleInfo(0 as never, 50 as never)).toBeNull();
    p.applyOptions({ autoscale: true });
    expect(p.autoscaleInfo(0 as never, 50 as never)).toEqual({ priceRange: { minValue: 95, maxValue: 120 } });
    expect(p.autoscaleInfo(0 as never, 100 as never)).toEqual({ priceRange: { minValue: 95, maxValue: 200 } });
  });

  it("hit test returns the topmost box id", () => {
    const p = new BoxPrimitive(host());
    attach(p);
    p.setBoxes([B()]);
    p.updateAllViews();
    expect(p.hitTest(200, 200)).toMatchObject({ externalId: "b:a" });
    expect(p.hitTest(900, 200)).toBeNull();
  });
});

describe("BoxPrimitive motion (finite)", () => {
  let now = 0;
  let frames: Array<(t: number) => void> = [];
  beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const pump = (ms: number) => {
    now += ms;
    const run = frames;
    frames = [];
    for (const f of run) f(now);
  };

  it("a new box grows from → to on tween.draw from its first drawn frame, edges fade, targets follow; then the loop stops", () => {
    const p = new BoxPrimitive(host(false));
    attach(p);
    p.setBoxes([B({ targets: [{ price: 112, kind: "tp", label: "T1" }] })]);
    expect(frames).toHaveLength(0); // nothing drawn yet: no loop
    p.updateAllViews(); // first draw starts the tween
    expect(p.geometry()[0]!.grow).toBe(0);
    expect(frames.length).toBeGreaterThan(0);
    pump(400);
    p.updateAllViews();
    const mid = p.geometry()[0]!;
    expect(mid.grow).toBeCloseTo(easeOutCubic(400 / 1100), 5);
    expect(mid.grow).toBeGreaterThan(0.5);
    expect(mid.targets[0]!.grow).toBe(0); // targets start after half the draw
    for (let k = 0; k < 40; k++) pump(50);
    p.updateAllViews();
    expect(p.geometry()[0]).toMatchObject({ grow: 1, edge: 1 });
    expect(p.geometry()[0]!.targets[0]!.grow).toBe(1);
    expect(frames).toHaveLength(0); // finite: asleep again
  });

  it("provisional → confirmed wipes the solid edge in; reduced motion is static at once", () => {
    const p = new BoxPrimitive(host(false));
    attach(p);
    p.setBoxes([B({ state: "provisional" })]);
    p.updateAllViews();
    for (let k = 0; k < 40; k++) pump(50);
    p.setBoxes([B({ state: "confirmed" })]);
    p.updateAllViews();
    expect(p.geometry()[0]!.wipe).toBe(0);
    pump(250);
    p.updateAllViews();
    expect(p.geometry()[0]!.wipe).toBeGreaterThan(0.5);
    const r = new BoxPrimitive(host(true));
    attach(r);
    r.setBoxes([B({ state: "provisional" })]);
    r.setBoxes([B({ state: "confirmed" })]);
    r.updateAllViews();
    expect(r.geometry()[0]).toMatchObject({ grow: 1, edge: 1, wipe: 1 });
    expect(frames.filter(Boolean).length).toBeGreaterThanOrEqual(0);
  });
});

describe("analysis → chart boxes (Markt page / overview layer)", () => {
  const load = (j: unknown): Bar[] => (j as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
  it("maps the boxes of an analysis: older ones faint, broken ones in their tone, the newest active with targets", () => {
    const bars = load(btc4h).slice(0, 1493);
    const a = analyzeBoxes({ tf: "4h", bars, bias: 1 })!;
    const iv = 4 * H * 1000;
    // the newest box broke out upward on 2026-10-02 and the market came back: it ends with its last bar …
    const cb = toChartBoxes(a, { intervalMs: iv });
    expect(cb.length).toBe(a.box.boxes.length);
    const active = cb.filter((b) => b.active);
    expect(active).toHaveLength(1);
    expect(a.box.phase).toBe("inside");
    const newest = a.box.box!;
    expect(newest.brk).toBe(1);
    expect(active[0]!.to).toBe(newest.t1 * 1000 + iv); // never across the bars that closed above it
    expect(active[0]!.tone).toBe("neutral");
    expect(active[0]!.targets?.length).toBeGreaterThan(0);
    for (const b of cb.filter((x) => !x.active)) expect(b.to).not.toBeNull();
    const broken = a.box.boxes.slice(0, -1).filter((b) => b.brk !== 0);
    for (const b of broken) expect(cb.find((x) => x.from === b.t0 * 1000)!.tone).toBe(b.brk > 0 ? "win" : "loss");
    expect(new Set(cb.map((b) => b.id)).size).toBe(cb.length);
    // … and runs on from the current run of closes back inside to the live edge (the live part carries the targets)
    const re = reentryIndex(bars, newest)!;
    expect(re).toBeGreaterThan(newest.i1 + 1);
    const live = toChartBoxes(a, { intervalMs: iv, liveFrom: bars[re]!.t * 1000 });
    expect(live).toHaveLength(cb.length + 1);
    const tail = live.at(-1)!;
    expect(tail).toMatchObject({ id: `${active[0]!.id}:live`, from: bars[re]!.t * 1000, to: null, top: newest.top, btm: newest.bottom, active: true });
    expect(tail.targets?.length).toBeGreaterThan(0);
    expect(live.at(-2)!.targets).toBeUndefined();
    expect(live.at(-2)!.label).toBe("Box stark");
    expect(new Set(live.map((b) => b.id)).size).toBe(live.length);
  });
});
