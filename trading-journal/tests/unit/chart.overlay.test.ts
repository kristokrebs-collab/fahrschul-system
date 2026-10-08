import { describe, expect, it } from "vitest";
import { axisLabelClear, barIndex, barIndexAtOrAfter, overlaps, placeLabels, type Box } from "@/chart/overlayLayout";
import { DEFAULT_LAYERS, RIGHT_RESERVED, SignalOverlay, type DivergenceLine, type StructureOverlay } from "@/chart/primitives/SignalOverlay";
import { ink } from "@/chart/ink";
import { AXIS_LABEL_GAP } from "@/chart/axisLabels";

describe("overlay layout helpers", () => {
  const bars = [{ time: 10 }, { time: 20 }, { time: 30 }, { time: 40 }];
  it("finds bars by open time (exact, and the first at/after)", () => {
    expect(barIndex(bars, 30)).toBe(2);
    expect(barIndex(bars, 25)).toBe(-1);
    expect(barIndex([], 1)).toBe(-1);
    expect(barIndexAtOrAfter(bars, 25)).toBe(2);
    expect(barIndexAtOrAfter(bars, 5)).toBe(0);
    expect(barIndexAtOrAfter(bars, 99)).toBe(4);
  });

  it("places labels by priority, nudges them off taken spots and drops what does not fit", () => {
    const bounds: Box = { x: 0, y: 0, w: 200, h: 100 };
    const out = placeLabels(
      [
        { box: { x: 10, y: 40, w: 50, h: 12 }, prio: 2, nudge: [-14, 14], data: "b" },
        { box: { x: 10, y: 40, w: 50, h: 12 }, prio: 0, data: "a" },
        { box: { x: 10, y: 40, w: 50, h: 12 }, prio: 3, data: "dropped" },
        { box: { x: 150, y: 40, w: 60, h: 12 }, prio: 1, data: "outside" },
        { box: { x: 100, y: 10, w: 20, h: 12 }, prio: 1, data: "obstacle" },
      ],
      [{ x: 95, y: 5, w: 30, h: 20 }],
      bounds,
    );
    expect(out.map((p) => p.data)).toEqual(["a", "b"]);
    expect(out[1]!.box.y).toBe(26);
    for (const a of out) for (const b of out) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
  });

  it("an axis label shows only clear of the other axis labels", () => {
    expect(axisLabelClear(100, [100 + AXIS_LABEL_GAP, null], AXIS_LABEL_GAP)).toBe(true);
    expect(axisLabelClear(100, [110], AXIS_LABEL_GAP)).toBe(false);
    expect(axisLabelClear(null, [], AXIS_LABEL_GAP)).toBe(false);
  });
});

// ------------------------------------------------------------------ the primitive on a fake chart

const HOUR = 3600;
const T0 = 1_790_000_000 - (1_790_000_000 % HOUR);
/** 60 hourly bars, price 100 … 159 (low = close − 1, high = close + 1). */
const BARS = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * HOUR, low: 99 + i, high: 101 + i, close: 100 + i }));
const ms = (i: number) => (T0 + i * HOUR) * 1000;

function mount(opts: { axisPrices?: number[]; width?: number } = {}) {
  const width = opts.width ?? 800;
  const height = 400;
  // 10 px per bar, 2 px per price unit (price 100 at y 360)
  const chart = {
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 60 }), width: () => width, logicalToCoordinate: (i: number) => i * 10 + 5 }),
    panes: () => [{ getHeight: () => height }],
  };
  const series = { priceToCoordinate: (p: number) => 360 - (p - 100) * 2 };
  const o = new SignalOverlay({ bars: () => BARS, axisPrices: () => opts.axisPrices ?? [] });
  let updates = 0;
  o.attached({ chart, series, requestUpdate: () => void updates++ } as never);
  return { o, width, height, updates: () => updates };
}

const div = (p: Partial<DivergenceLine> & Pick<DivergenceLine, "from" | "to">): DivergenceLine => ({ osc: "rsi", kind: "regular", dir: 1, state: "confirmed", active: false, ...p });

const STRUCT: StructureOverlay = {
  swings: [{ time: ms(20), price: 121, high: true, internal: false, label: "HH" }],
  breaks: [{ time: ms(30), level: 121, pivotTime: ms(20), kind: "BOS", dir: 1, internal: false }],
  eqs: [{ kind: "EQL", price: 110, from: { time: ms(10), price: 110 }, to: { time: ms(14), price: 110.05 }, broken: false }],
  supports: [
    { price: 150, top: 150, btm: 147, kind: "ob", dir: 1, time: ms(45), label: "Demand-OB" },
    { price: 140, top: 140, btm: 140, kind: "internal", dir: 1, time: ms(40), label: "Internes Tief" },
  ],
  resistances: [{ price: 170, top: 172, btm: 170, kind: "ob", dir: -1, time: null, label: "Range-Hoch" }],
  support: { price: 150, top: 150, btm: 147, kind: "ob", dir: 1, time: ms(45), label: "Demand-OB" },
  resistance: { price: 170, top: 172, btm: 170, kind: "ob", dir: -1, time: null, label: "Range-Hoch" },
};

function labels(o: SignalOverlay) {
  return o.geometry().labels;
}

describe("SignalOverlay (check overlay primitive)", () => {
  it("MCB dots by candle-close state: ring while provisional, dot once confirmed, under the low / over the high", () => {
    const { o } = mount();
    o.setMarkers([
      { time: ms(59), kind: "bottom", live: true, state: "provisional" },
      { time: ms(30), kind: "top", state: "strong" },
    ]);
    o.updateAllViews();
    const dots = o.geometry().dots;
    expect(dots).toHaveLength(2);
    const top = dots.find((d) => d.style === "strong")!;
    const prov = dots.find((d) => d.style === "provisional")!;
    expect(top.color).toBe(ink.loss);
    expect(top.y).toBeLessThan(360 - (131 - 100) * 2); // above the high of bar 30
    expect(prov.color).toBe(ink.winSoft);
    expect(prov.y).toBeGreaterThan(360 - (158 - 100) * 2); // below the low of bar 59
  });

  it("RSI and WT divergences on the same pivots share one line; hidden dashed, provisional dotted soft; old ones faint", () => {
    const { o } = mount();
    o.setDivergences([
      div({ from: { time: ms(10), price: 109 }, to: { time: ms(20), price: 105 }, active: true }),
      div({ osc: "wt", from: { time: ms(10), price: 109 }, to: { time: ms(20), price: 105 } }),
      div({ kind: "hidden", dir: -1, from: { time: ms(30), price: 131 }, to: { time: ms(40), price: 141 } }),
      div({ dir: 1, state: "provisional", from: { time: ms(50), price: 149 }, to: { time: ms(57), price: 150 } }),
      div({ from: { time: ms(500), price: 1 }, to: { time: ms(501), price: 1 } }), // not on the chart → dropped
    ]);
    o.updateAllViews();
    const lines = o.geometry().divs;
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ color: ink.win, dash: [], alpha: 0.95 });
    expect(lines[1]).toMatchObject({ color: ink.loss, dash: [4, 3] });
    expect(lines[1]!.alpha).toBeLessThan(0.5);
    expect(lines[2]).toMatchObject({ color: ink.winSoft, dash: [1, 3] });
    expect(labels(o).map((l) => l.text)).toContain("RSI · WT");
  });

  it("S/R: nearest support / resistance solid with in-pane labels at the left and axis labels; further levels dotted", () => {
    const { o } = mount();
    o.setStructure(STRUCT);
    o.updateAllViews();
    const g = o.geometry();
    expect(g.hlines).toHaveLength(3);
    const near = g.hlines.filter((l) => l.dash.length === 0);
    expect(near).toHaveLength(2);
    expect(near.every((l) => l.color === ink.mute)).toBe(true);
    // the nearest levels run across the pane (label at the left edge); the order-block band starts at its origin bar,
    // a further level at its origin
    expect(near.map((l) => l.x1)).toEqual([0, 0]);
    expect(g.bands.map((b) => b.x1).sort((a, b) => a - b)).toEqual([0, 455]);
    expect(g.hlines.find((l) => l.dash.length > 0)!.x1).toBe(405);
    expect(g.labels.filter((l) => l.text.startsWith("Support") || l.text.startsWith("Widerstand")).every((l) => l.box.x === 4)).toBe(true);
    const texts = g.labels.map((l) => l.text);
    expect(texts).toContain("Support · Demand-OB 150");
    expect(texts).toContain("Widerstand · Range-Hoch 170");
    expect(o.axisLabelPrices().sort()).toEqual([150, 170]);
    // structure is off by default
    expect(g.segs).toHaveLength(0);
  });

  it("an S/R axis label next to another axis label (e.g. the last price) is hidden, the tick guard learns the rest", () => {
    const { o } = mount({ axisPrices: [151] });
    o.setStructure(STRUCT);
    o.updateAllViews();
    expect(o.axisY(1)).toBeNull();
    expect(o.axisY(-1)).not.toBeNull();
    expect(o.axisLabelPrices()).toEqual([170]);
  });

  it("layers toggle without re-indexing; structure draws BOS / EQL / swing labels", () => {
    const { o } = mount();
    o.setMarkers([{ time: ms(30), kind: "top", state: "confirmed" }]);
    o.setDivergences([div({ from: { time: ms(10), price: 109 }, to: { time: ms(20), price: 105 }, active: true })]);
    o.setStructure(STRUCT);
    o.setLayers({ mcb: false, div: false, sr: false, struct: true });
    o.updateAllViews();
    const g = o.geometry();
    expect(g.dots).toHaveLength(0);
    expect(g.divs).toHaveLength(0);
    expect(g.hlines).toHaveLength(0);
    expect(g.segs).toHaveLength(2);
    expect(g.labels.map((l) => l.text).sort()).toEqual(["BOS", "EQL", "HH"]);
    o.setLayers(DEFAULT_LAYERS);
    o.updateAllViews();
    expect(o.counts()).toMatchObject({ dots: 1, divs: 1, segs: 0 });
  });

  it("labels never overlap each other, a dot or the price-line title strip", () => {
    const { o, width } = mount({ width: 420 });
    o.setMarkers(Array.from({ length: 40 }, (_, i) => ({ time: ms(i + 10), kind: i % 2 ? "top" : "bottom", state: "confirmed" }) as const));
    o.setDivergences(Array.from({ length: 12 }, (_, i) => div({ dir: i % 2 ? 1 : -1, active: i % 3 === 0, from: { time: ms(i * 4), price: 100 + i * 4 }, to: { time: ms(i * 4 + 3), price: 101 + i * 4 } })));
    o.setStructure(STRUCT);
    o.setLayers({ mcb: true, div: true, sr: true, struct: true });
    o.updateAllViews();
    const g = o.geometry();
    expect(g.labels.length).toBeGreaterThan(2);
    for (const a of g.labels) {
      expect(a.box.x + a.box.w).toBeLessThanOrEqual(width - RIGHT_RESERVED);
      for (const b of g.labels) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
      for (const d of g.dots) expect(overlaps(a.box, { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r })).toBe(false);
    }
  });

  it("re-draws without new inputs reuse the geometry; new inputs request a redraw", () => {
    const { o, updates } = mount();
    const before = updates();
    o.setStructure(STRUCT);
    expect(updates()).toBe(before + 1);
    o.updateAllViews();
    const g = o.geometry();
    o.updateAllViews();
    expect(o.geometry()).toBe(g);
    o.setLayers({ ...DEFAULT_LAYERS });
    expect(updates()).toBe(before + 1); // same layers → no redraw request
  });
});

describe("SignalOverlay on a phone-wide pane", () => {
  it("the nearest S/R labels drop the level kind instead of disappearing", () => {
    const { o } = mount({ width: 200 });
    o.setStructure(STRUCT);
    o.updateAllViews();
    const texts = o.geometry().labels.map((l) => l.text);
    expect(texts).toContain("Support 150");
    expect(texts).toContain("Widerstand 170");
  });
});
