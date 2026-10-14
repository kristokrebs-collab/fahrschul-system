/**
 * RSI pane (P02, `src/chart/rsiPane.ts` + `primitives/RsiOverlay.ts` + `PaneController` kind `rsi`): Wilder parity with
 * `rsi()` (full) and the O(1) live step, whitespace lead-in, the trendline overlay data (provisional break of the forming
 * bar), the pane on a fake chart (reference lines 70 / 50 / 30, one update per push, closed-bar recompute only), the
 * overlay geometry on the RSI pane's own height, and the `remove()` fix for two sub panes.
 */
import { describe, expect, it, vi } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import { rsi } from "@/domain/signals/indicators";
import { rsiLines, type RsiLineState } from "@/domain/boxes";
import { PaneController } from "@/chart/panes";
import { RSI_LEVELS, RsiPane, rsiOverlayData, toRsiData, wilderState, wilderStep, type RsiBar } from "@/chart/rsiPane";
import { RsiOverlay } from "@/chart/primitives/RsiOverlay";
import type { UTCTimestamp } from "lightweight-charts";

const raw = (btc4h as { bars: number[][] }).bars;
const BARS: RsiBar[] = raw.slice(-400).map(([t, , , , c]) => ({ time: t as UTCTimestamp, close: c! }));
const closes = BARS.map((b) => b.close);

describe("Wilder RSI", () => {
  it("wilderState + wilderStep equal rsi() on the last bar (O(1) live value)", () => {
    const full = rsi(closes, 14);
    const s = wilderState(closes, 14, closes.length - 2)!;
    expect(wilderStep(s, closes[closes.length - 1]!)).toBeCloseTo(full[full.length - 1]!, 9);
    // any forming close
    const moved = [...closes.slice(0, -1), closes[closes.length - 1]! + 500];
    expect(wilderStep(s, moved[moved.length - 1]!)).toBeCloseTo(rsi(moved, 14).at(-1)!, 9);
    expect(wilderState(closes.slice(0, 10), 14)).toBeNull();
  });

  it("NaN lead-in values become whitespace points on the candle grid", () => {
    const d = toRsiData(BARS.slice(0, 20).map((b) => b.time), rsi(closes.slice(0, 20)));
    expect(d).toHaveLength(20);
    expect("value" in d[0]!).toBe(false);
    expect("value" in d[13]!).toBe(false);
    expect("value" in d[14]!).toBe(true);
  });
});

/** RSI series with falling highs, then a rally (a falling RSI line broken upward) – the engine test's shape. */
function brokenUp(): RsiBar[] {
  const out: RsiBar[] = [];
  let p = 100;
  for (let i = 0; i < 160; i++) {
    p += Math.sin(i / 5) * (1.6 - i / 160) - 0.12;
    out.push({ time: (1_700_000_000 + i * 3600) as UTCTimestamp, close: p });
  }
  for (let i = 0; i < 8; i++) {
    p += 1.4;
    out.push({ time: (1_700_000_000 + (160 + i) * 3600) as UTCTimestamp, close: p });
  }
  return out;
}

describe("trendline overlay data", () => {
  it("broken line in its tone up to the break, the glowing break marker, active lines extended (dotted)", () => {
    const bars = brokenUp();
    const st = rsiLines(bars.map((b) => ({ t: b.time, o: b.close, h: b.close, l: b.close, c: b.close }))) as RsiLineState;
    const d = rsiOverlayData(st, bars.length - 1, null);
    const up = d.breaks.find((b) => b.dir === 1)!;
    expect(up).toBeDefined();
    expect(up.i).toBe(st.breakUp!.brokeAt);
    expect(up.fresh).toBe(true);
    expect(up.provisional).toBe(false);
    const broken = d.lines.find((l) => l.broken)!;
    expect(broken.end).toBe(Math.min(bars.length - 1, st.breakUp!.brokeAt! + 1));
    expect(broken.extend).toBeNull();
    for (const l of d.lines.filter((x) => !x.broken)) expect(l.extend).toBe(bars.length - 1 + 6);
  });

  it("a forming bar beyond the active line is a provisional break (counts at the close)", () => {
    const st: RsiLineState = {
      rsi: [],
      last: 40,
      res: { kind: "res", a: { i: 0, v: 70 }, b: { i: 10, v: 60 }, slope: -1, touches: 2, brokeAt: null },
      sup: null,
      breakUp: null,
      breakDown: null,
      ageUp: null,
      ageDown: null,
      distRes: 5,
      distSup: null,
    };
    // line at bar 21 = 70 − 21 = 49 → live 52 is beyond (tol 0.6)
    expect(rsiOverlayData(st, 20, 52).breaks).toEqual([{ i: 21, v: 52, dir: 1, fresh: true, provisional: true }]);
    expect(rsiOverlayData(st, 20, 48).breaks).toEqual([]);
    expect(rsiOverlayData(null, 20, 52)).toEqual({ lines: [], breaks: [] });
  });
});

// ------------------------------------------------------------------ fake chart with lightweight-charts pane semantics

interface FakeSeries {
  pane: number;
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
  attachPrimitive: ReturnType<typeof vi.fn>;
  detachPrimitive: ReturnType<typeof vi.fn>;
  priceToCoordinate: (v: number) => number;
  getPane: () => { paneIndex(): number; getHeight(): number };
}

/** Panes drop when their last series is removed (default `preserveEmptyPane: false`), panes below shift up. */
function fakeChart() {
  const series: FakeSeries[] = [];
  const paneCount = () => Math.max(1, ...series.map((s) => s.pane + 1));
  const chart = {
    series,
    addSeries: vi.fn((_def: unknown, _opts: unknown, pane = 0) => {
      const s: FakeSeries = {
        pane,
        setData: vi.fn(),
        update: vi.fn(),
        createPriceLine: vi.fn((o: unknown) => o),
        removePriceLine: vi.fn(),
        attachPrimitive: vi.fn(),
        detachPrimitive: vi.fn(),
        priceToCoordinate: (v: number) => 100 - v,
        getPane: () => ({ paneIndex: () => s.pane, getHeight: () => 120 }),
      };
      series.push(s);
      return s;
    }),
    removeSeries: vi.fn((s: FakeSeries) => {
      const idx = series.indexOf(s);
      if (idx >= 0) series.splice(idx, 1);
      // lightweight-charts drops the emptied pane and shifts the ones below it up
      if (s.pane > 0 && !series.some((x) => x.pane === s.pane)) for (const x of series) if (x.pane > s.pane) x.pane -= 1;
    }),
    removePane: vi.fn((i: number) => {
      for (let k = series.length - 1; k >= 0; k--) if (series[k]!.pane === i) series.splice(k, 1);
      for (const x of series) if (x.pane > i) x.pane -= 1;
    }),
    panes: () => Array.from({ length: paneCount() }, (_, i) => ({ setStretchFactor: vi.fn(), getHeight: () => 120, getSeries: () => series.filter((s) => s.pane === i) })),
  };
  return chart;
}

describe("RsiPane on a chart", () => {
  it("one line in pane 1 with dotted 70 / 30 and a faint 50, data on the candle grid, the overlay attached", () => {
    const c = fakeChart();
    const p = new RsiPane(c as never, 1);
    const s = c.series[0]!;
    expect(s.pane).toBe(1);
    expect(s.createPriceLine.mock.calls.map((x) => (x[0] as { price: number }).price)).toEqual(RSI_LEVELS.map((l) => l.price));
    expect(s.attachPrimitive).toHaveBeenCalledWith(p.overlay);
    p.setBars(BARS);
    expect(s.setData).toHaveBeenCalledTimes(1);
    expect((s.setData.mock.calls[0]![0] as unknown[]).length).toBe(BARS.length);
    expect(p.lastValue()).toBeCloseTo(rsi(closes).at(-1)!, 9);
    expect(p.valueAt(BARS[200]!.time)).toBeCloseTo(rsi(closes)[200]!, 9);
  });

  it("push: one O(1) update of the forming bar; an older bar time or the same value does nothing", () => {
    const c = fakeChart();
    const p = new RsiPane(c as never, 1);
    p.setBars(BARS);
    const s = c.series[0]!;
    const last = BARS[BARS.length - 1]!;
    p.push({ time: last.time, close: last.close + 300 });
    expect(s.update).toHaveBeenCalledTimes(1);
    const v = (s.update.mock.calls[0]![0] as { value: number }).value;
    expect(v).toBeCloseTo(rsi([...closes.slice(0, -1), last.close + 300]).at(-1)!, 9);
    p.push({ time: last.time, close: last.close + 300 });
    p.push({ time: (last.time - 14_400) as UTCTimestamp, close: 1 });
    expect(s.update).toHaveBeenCalledTimes(1);
    expect(s.setData).toHaveBeenCalledTimes(1); // the trendlines are not recomputed per print
  });

  it("the overlay sits on the RSI pane's own height (never pane 0) and draws lines and the break", () => {
    const o = new RsiOverlay();
    const series = { priceToCoordinate: (v: number) => 100 - v, getPane: () => ({ getHeight: () => 100 }) };
    const chart = { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 50 }), width: () => 500, logicalToCoordinate: (i: number) => i * 10 }), panes: () => [{ getHeight: () => 0 }] };
    o.attached({ chart, series, requestUpdate: () => undefined } as never);
    o.setData({ lines: [{ kind: "res", a: { i: 2, v: 70 }, slope: -1, end: 20, extend: 26, broken: false, fresh: false }], breaks: [{ i: 30, v: 55, dir: 1, fresh: true, provisional: false }] });
    o.updateAllViews();
    expect(o.counts()).toEqual({ lines: 2, breaks: 1 });
    const g = o.geometry();
    expect(g.segs[0]).toMatchObject({ x1: 20, y1: 30, x2: 200, y2: 100 - (70 - 18) });
    expect(g.dots[0]).toMatchObject({ x: 300, y: 45, fresh: true, text: "Bruch ↑" });
  });
});

describe("PaneController kind rsi + remove() with two sub panes", () => {
  it("switching to rsi computes from the bars it was given; leaving it removes only its own pane", () => {
    const c = fakeChart();
    const pc = new PaneController(c as never);
    pc.setBars(BARS);
    pc.set("rsi");
    expect(pc.current()).toBe("rsi");
    expect(pc.rsi()).not.toBeNull();
    expect(pc.paneIndex()).toBe(1);
    expect(c.series[0]!.setData).toHaveBeenCalledTimes(1);
    pc.pushLive({ time: BARS[BARS.length - 1]!.time, close: 1 });
    expect(c.series[0]!.update).toHaveBeenCalledTimes(1);
    // another sub pane below (index 2), e.g. a second indicator
    const other = c.addSeries({}, {}, 2) as FakeSeries;
    pc.set("ratio");
    // lightweight-charts dropped pane 1 and moved the other one up: it must survive
    expect(c.series).toContain(other);
    expect(c.removePane).not.toHaveBeenCalled();
    expect(pc.current()).toBe("ratio");
    pc.dispose();
    expect(c.series).toEqual([other]);
  });
});
