/**
 * Price-trendline chart layer (F05): the primitive on a fake chart (x / y geometry in time and price, the dotted
 * extension, culling, captions, the mirror = only the price axis flips) and the mapping from the structure view to chart
 * lines (which timeframes, anchors, solid / extension ends, captions).
 */
import { describe, expect, it } from "vitest";
import { ink } from "@/chart/ink";
import { logicalFrac, priceAtTime, TrendlinePrimitive, trendColor, type ChartTrendline } from "@/chart/primitives/TrendlinePrimitive";
import { KEY_TF_MS, KEY_TIMEFRAMES } from "@/domain/keylevels";
import { analyzeTrendlines } from "@/domain/trendlines";
import type { TrendTfItem } from "@/market/trendlines/store";
import { chartTrendlinesKey, EXTEND_BARS, toChartTrendlines } from "@/views/markt/chartTrendlines";
import { candlesOf, DOWN_THEN_BREAK, H4, mirrored, nowAfter, T0, zigzag } from "./trendFixtures";

const H = 3600;
const B0 = 1_790_000_000 - (1_790_000_000 % H);
/** 100 hourly bars */
const bars = Array.from({ length: 100 }, (_, i) => ({ time: B0 + i * H }));
const ms = (i: number) => (B0 + i * H) * 1000;

function attach(p: TrendlinePrimitive, opts: { from?: number; to?: number; width?: number; flip?: boolean } = {}) {
  const width = opts.width ?? 1000;
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: opts.from ?? 0, to: opts.to ?? 110 }), width: () => width, logicalToCoordinate: (i: number) => (Number.isInteger(i) ? i * 8 + 4 : 0) }),
    panes: () => [{ getHeight: () => 400 }],
  };
  // price 80 … 120 on 400 px; the mirror (`invertScale`) puts the highs at the bottom
  const series = { priceToCoordinate: (pr: number) => (opts.flip ? (pr - 80) * 10 : 400 - (pr - 80) * 10) };
  p.attached({ chart, series, requestUpdate: () => undefined } as never);
}
const host = (reserved: Array<{ x: number; y: number; w: number; h: number }> = []) => ({ bars: () => bars, intervalSec: () => H, reserved: () => reserved });
const L = (over: Partial<ChartTrendline> = {}): ChartTrendline => ({ id: "a", t1: ms(10), p1: 110, t2: ms(30), p2: 100, solidTo: ms(50), extendTo: ms(60), tone: "mute", label: "4H ↘", captionAbove: true, ...over });

describe("logicalFrac / priceAtTime", () => {
  it("bar times are whole indices, times between bars fractional, past the last bar the grid goes on, before the first it goes negative", () => {
    expect(logicalFrac(bars, B0 + 10 * H, H)).toBe(10);
    expect(logicalFrac(bars, B0 + 10 * H + H / 2, H)).toBeCloseTo(10.5, 9);
    expect(logicalFrac(bars, B0 + 105 * H, H)).toBe(105);
    expect(logicalFrac(bars, B0 - 2 * H, H)).toBe(-2);
    expect(logicalFrac([], B0, H)).toBeNull();
  });

  it("the price on the line is linear in time, also outside the two points", () => {
    const l = L();
    expect(priceAtTime(l, l.t1)).toBe(110);
    expect(priceAtTime(l, l.t2)).toBe(100);
    expect(priceAtTime(l, ms(50))).toBeCloseTo(90, 9);
    expect(priceAtTime(l, ms(0))).toBeCloseTo(115, 9);
  });
});

describe("TrendlinePrimitive geometry", () => {
  it("draws the line between its times at its prices, the extension on the same line", () => {
    const p = new TrendlinePrimitive(host());
    attach(p);
    p.setLines([L()]);
    p.updateAllViews();
    const g = p.geometry();
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ x1: 10 * 8 + 4, y1: 400 - 30 * 10, x2: 50 * 8 + 4, y2: 400 - 10 * 10, x3: 60 * 8 + 4, y3: 400 - 5 * 10 });
    // collinear: the extension continues the slope of the solid part
    const s1 = (g[0]!.y2 - g[0]!.y1) / (g[0]!.x2 - g[0]!.x1);
    const s2 = (g[0]!.y3! - g[0]!.y2) / (g[0]!.x3! - g[0]!.x2);
    expect(s2).toBeCloseTo(s1, 9);
  });

  it("a time between two bars lands between their x; a broken line has no extension", () => {
    const p = new TrendlinePrimitive(host());
    attach(p);
    p.setLines([L({ t1: ms(10) + (H * 1000) / 2, extendTo: null })]);
    p.updateAllViews();
    expect(p.geometry()[0]!.x1).toBeCloseTo(10.5 * 8 + 4, 3);
    expect(p.geometry()[0]!.x3).toBeNull();
  });

  it("the mirror flips only the price axis: same x, mirrored y, the line still runs through the same prices", () => {
    const plain = new TrendlinePrimitive(host());
    const flipped = new TrendlinePrimitive(host());
    attach(plain);
    attach(flipped, { flip: true });
    plain.setLines([L()]);
    flipped.setLines([L()]);
    plain.updateAllViews();
    flipped.updateAllViews();
    const a = plain.geometry()[0]!;
    const b = flipped.geometry()[0]!;
    for (const k of ["x1", "x2", "x3"] as const) expect(b[k]).toBe(a[k]);
    for (const k of ["y1", "y2", "y3"] as const) expect(b[k]! + a[k]!).toBeCloseTo(400, 9);
  });

  it("a line wholly outside the visible range is not drawn; no bars or no lines draw nothing", () => {
    const p = new TrendlinePrimitive(host());
    attach(p, { from: 70, to: 100 });
    p.setLines([L({ id: "left", solidTo: ms(40), extendTo: ms(45) }), L({ id: "seen", t1: ms(60), t2: ms(70), solidTo: ms(90), extendTo: null })]);
    p.updateAllViews();
    expect(p.geometry().map((g) => g.id)).toEqual(["seen"]);
    const none = new TrendlinePrimitive({ bars: () => [], intervalSec: () => H });
    attach(none);
    none.setLines([L()]);
    none.updateAllViews();
    expect(none.geometry()).toEqual([]);
    const empty = new TrendlinePrimitive(host());
    attach(empty);
    empty.updateAllViews();
    expect(empty.geometry()).toEqual([]);
  });

  it("the caption sits at the end of the solid part on the chosen side and keeps clear of reserved boxes and the price strip", () => {
    const reserved: Array<{ x: number; y: number; w: number; h: number }> = [];
    const p = new TrendlinePrimitive(host(reserved));
    attach(p);
    p.setLines([L({ solidTo: ms(50), extendTo: null })]);
    p.updateAllViews();
    const free = p.geometry()[0]!.label!;
    expect(free.text).toBe("4H ↘");
    // above the line (smaller y) at the end of the solid part
    const g0 = p.geometry()[0]!;
    const yAt = (x: number) => g0.y1 + ((g0.y2 - g0.y1) * (x - g0.x1)) / (g0.x2 - g0.x1);
    expect(free.box.y + free.box.h).toBeLessThanOrEqual(yAt(free.box.x + free.box.w / 2));
    expect(free.box.x + free.box.w).toBeLessThanOrEqual(g0.x2 + 1);
    const below = new TrendlinePrimitive(host());
    attach(below);
    below.setLines([L({ captionAbove: false, extendTo: null })]);
    below.updateAllViews();
    const bl = below.geometry()[0]!.label!;
    expect(bl.box.y).toBeGreaterThan(yAt(bl.box.x + bl.box.w / 2) - 1);
    // a reserved box right where it sits: it moves off it or is left out – never on top
    reserved.push({ ...free.box });
    p.invalidate();
    p.updateAllViews();
    const moved = p.geometry()[0]!.label;
    if (moved) expect(moved.box.y >= free.box.y + free.box.h || moved.box.y + moved.box.h <= free.box.y || moved.box.x >= free.box.x + free.box.w || moved.box.x + moved.box.w <= free.box.x).toBe(true);
    // a line that ends right at the strip keeps its caption left of it
    const edge = new TrendlinePrimitive(host());
    attach(edge);
    edge.setLines([L({ p2: 109.5, solidTo: ms(120), extendTo: null })]);
    edge.updateAllViews();
    const l = edge.geometry()[0]!.label!;
    expect(l.box.x + l.box.w).toBeLessThanOrEqual(1000 - 64);
  });

  it("blind mode draws win / loss in the foreground ink, the neutral tones unchanged", () => {
    expect(trendColor("win", false)).toBe(ink.win);
    expect(trendColor("loss", false)).toBe(ink.loss);
    expect(trendColor("win", true)).toBe(ink.fg);
    expect(trendColor("loss", true)).toBe(ink.fg);
    expect(trendColor("mute", true)).toBe(ink.mute);
    expect(trendColor("fg", true)).toBe(ink.fg);
  });
});

// ------------------------------------------------------------------------------------------ analysis → chart lines

const falling = candlesOf(zigzag(DOWN_THEN_BREAK));
const itemOf = (n: number, tf: "4h" | "1D" = "4h"): TrendTfItem => {
  const cs = falling.slice(0, n);
  const analysis = analyzeTrendlines(cs, tf, nowAfter(cs, H4));
  return { tf, selected: true, avail: { tf, ok: true, reason: null }, analysis };
};

describe("toChartTrendlines", () => {
  it("an unbroken line: solid to the newest closed candle, dotted four candles on, anchored at its two pivots", () => {
    const [l] = toChartTrendlines([itemOf(100)], H4);
    const a = itemOf(100).analysis!;
    const v = a.price.down.active!;
    expect(l).toBeDefined();
    expect(l!.t1).toBe(v.aTime);
    expect(l!.p1).toBe(v.a.v);
    expect(l!.t2).toBe(v.bTime);
    expect(l!.p2).toBe(v.b.v);
    expect(l!.solidTo).toBe(a.asOf);
    expect(l!.extendTo).toBe(a.asOf! + EXTEND_BARS * H4);
    expect(l!.label).toMatch(/^4H ↘/);
    expect(l!.captionAbove).toBe(true);
    // the line really runs through both pivots
    expect(priceAtTime(l!, l!.t1)).toBeCloseTo(v.a.v, 9);
    expect(priceAtTime(l!, l!.t2)).toBeCloseTo(v.b.v, 9);
  });

  it("a broken line ends one candle after the break, has no extension and says Bruch ↑; an approach is heavier", () => {
    const lines = toChartTrendlines([itemOf(101)], H4);
    expect(lines).toHaveLength(1);
    const b = lines[0]!;
    const v = itemOf(101).analysis!.price.down.broken!;
    expect(b.solidTo).toBe(v.brokeTime! + H4);
    expect(b.extendTo).toBeNull();
    expect(b.tone).toBe("win");
    expect(b.label).toBe("4H ↘ Bruch ↑");
    expect(b.strong).toBe(true);
    const near = toChartTrendlines([itemOf(100)], H4)[0]!;
    expect(near.label).toBe("4H ↘ nah");
    expect(near.strong).toBe(true);
    expect(near.tone).toBe("fg");
    const far = toChartTrendlines([itemOf(62)], H4)[0]!;
    expect(far.label).toBe("4H ↘");
    expect(far.strong).toBe(false);
    expect(far.tone).toBe("mute");
  });

  it("retest phases get their own caption", () => {
    expect(toChartTrendlines([itemOf(119)], H4).find((l) => l.id.includes(":b:"))!.label).toBe("4H ↘ Retest ok");
  });

  it("a rising line is the mirror: Aufwärts arrow, caption below, broken downward in the loss tone", () => {
    const cs = mirrored(falling).slice(0, 101);
    const analysis = analyzeTrendlines(cs, "4h", nowAfter(cs, H4));
    const [l] = toChartTrendlines([{ tf: "4h", selected: true, avail: { tf: "4h", ok: true, reason: null }, analysis }], H4);
    expect(l!.label).toBe("4H ↗ Bruch ↓");
    expect(l!.tone).toBe("loss");
    expect(l!.captionAbove).toBe(false);
  });

  it("only timeframes at least as long as the chart's interval; a longer one is anchored in the middle of its candles", () => {
    const it4 = itemOf(100);
    expect(toChartTrendlines([it4], KEY_TF_MS["1D"])).toEqual([]);
    const weekly = { ...itemOf(100, "1D") };
    const onSame = toChartTrendlines([weekly], KEY_TF_MS["1D"])[0]!;
    const onFour = toChartTrendlines([weekly], H4)[0]!;
    const shift = (KEY_TF_MS["1D"] - H4) / 2;
    expect(onFour.t1 - onSame.t1).toBe(shift);
    expect(onFour.solidTo - onSame.solidTo).toBe(shift);
    expect(onFour.p1).toBe(onSame.p1);
  });

  it("nothing for a locked timeframe, one with too few candles or one that is not selected", () => {
    const few = { ...itemOf(30) };
    expect(few.analysis!.status).toBe("few");
    expect(toChartTrendlines([few], H4)).toEqual([]);
    expect(toChartTrendlines([{ tf: "1h", selected: true, avail: { tf: "1h", ok: false, reason: "1h-Kerzen werden geladen …" }, analysis: null }], H4)).toEqual([]);
  });

  it("ids are stable per line and the key changes with the content only", () => {
    const a = toChartTrendlines([itemOf(100)], H4);
    const b = toChartTrendlines([itemOf(100)], H4);
    expect(a.map((l) => l.id)).toEqual(b.map((l) => l.id));
    expect(chartTrendlinesKey(a)).toBe(chartTrendlinesKey(b));
    expect(chartTrendlinesKey(a)).not.toBe(chartTrendlinesKey(toChartTrendlines([itemOf(101)], H4)));
    expect(KEY_TIMEFRAMES).toContain("4h");
    expect(T0).toBeGreaterThan(0);
  });
});
