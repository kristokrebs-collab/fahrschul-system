/**
 * F62 "Chart spiegeln" – the PURE part (`src/chart/mirror.ts`, `filterRsiOverlay`, `RsiPane.setView`, `visibleMarkers`):
 * the mirror is a display transform of the price axis only. Flipping twice is the original view exactly; data values,
 * bar times and breakout timestamps are never touched; the RSI is not mirrored unless asked for (100−RSI).
 */
import { describe, expect, it, vi } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import {
  DEFAULT_MIRROR_LAYERS,
  PLAIN_VIEW,
  allLayersOn,
  anchorOf,
  axisFraction,
  chartMirrorOf,
  clipAtAnchor,
  flip,
  lastClosedAnchor,
  mirrorRsi,
  priceAtFraction,
  scaleInversion,
  viewBars,
  type MirrorView,
} from "@/chart/mirror";
import { rsiLines, type RsiLineState } from "@/domain/boxes";
import { DEFAULT_RSI_VIEW, RsiPane, filterRsiOverlay, rsiOverlayData, type RsiBar } from "@/chart/rsiPane";
import type { RsiOverlayData } from "@/chart/primitives/RsiOverlay";
import type { TradeMarker } from "@/chart/markers";
import { NO_BLIND } from "@/domain/biasTest";
import { visibleMarkers } from "@/views/biasTest/model";

/** Small seeded PRNG (mulberry32): the property runs are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("flip", () => {
  it("flipping twice is the original view, exactly", () => {
    const v: MirrorView = { flipped: false, rsiMirrored: true, layers: { ...DEFAULT_MIRROR_LAYERS, trendlines: false } };
    const once = flip(v);
    expect(once.flipped).toBe(true);
    expect(flip(once)).toEqual(v);
    // the layers and the RSI choice ride along untouched
    expect(once.layers).toEqual(v.layers);
    expect(once.rsiMirrored).toBe(true);
    expect(PLAIN_VIEW.flipped).toBe(false);
  });

  it("property: axisFraction ∘ flip ∘ flip = identity, and a flip is the exact complement", () => {
    const r = rng(7);
    for (let k = 0; k < 500; k++) {
      const lo = 1000 + r() * 90_000;
      const hi = lo + 1 + r() * 20_000;
      const price = lo + r() * (hi - lo);
      const plain = axisFraction(price, lo, hi, false);
      const flipped = axisFraction(price, lo, hi, true);
      expect(plain + flipped).toBeCloseTo(1, 12);
      // flipping the flipped axis again lands where the plain axis puts the price
      expect(axisFraction(price, lo, hi, !true)).toBeCloseTo(plain, 12);
      // and the inverse mapping gives the ORIGINAL price back on both axes: nothing is mathematically inverted
      expect(priceAtFraction(plain, lo, hi, false)).toBeCloseTo(price, 8);
      expect(priceAtFraction(flipped, lo, hi, true)).toBeCloseTo(price, 8);
    }
    // top edge = the high on a plain axis, the low on a flipped one
    expect(axisFraction(110, 100, 110, false)).toBe(0);
    expect(axisFraction(110, 100, 110, true)).toBe(1);
    expect(axisFraction(5, 5, 5, true)).toBe(0.5);
  });

  it("viewBars returns the very same bars: no price, no time is mapped", () => {
    const bars = Object.freeze([Object.freeze({ time: 1_700_000_000_000, open: 1, high: 3, low: 0.5, close: 2 }), Object.freeze({ time: 1_700_003_600_000, open: 2, high: 4, low: 1, close: 3 })]);
    const snapshot = JSON.stringify(bars);
    for (const v of [PLAIN_VIEW, flip(PLAIN_VIEW), flip(flip(PLAIN_VIEW))]) {
      const out = viewBars(bars, v);
      expect(out).toBe(bars);
      expect(JSON.stringify(out)).toBe(snapshot);
    }
  });

  it("RSI: only 100−RSI on request, and only while the price axis is flipped", () => {
    expect(scaleInversion(PLAIN_VIEW)).toEqual({ price: false, rsi: false });
    expect(scaleInversion({ flipped: true, rsiMirrored: false })).toEqual({ price: true, rsi: false });
    expect(scaleInversion({ flipped: true, rsiMirrored: true })).toEqual({ price: true, rsi: true });
    expect(scaleInversion({ flipped: false, rsiMirrored: true })).toEqual({ price: false, rsi: false });
    expect(mirrorRsi(30)).toBe(70);
    expect(mirrorRsi(mirrorRsi(41.7))).toBeCloseTo(41.7, 12);
  });

  it("chartMirrorOf carries the flip, the RSI choice, the two RSI layers and the blind colours", () => {
    const v: MirrorView = { flipped: true, rsiMirrored: true, layers: { ...DEFAULT_MIRROR_LAYERS, breakouts: false } };
    expect(chartMirrorOf(v, true)).toEqual({ flipped: true, rsiMirrored: true, trendlines: true, breakouts: false, neutral: true });
    expect(allLayersOn(DEFAULT_MIRROR_LAYERS)).toBe(true);
    expect(allLayersOn(v.layers)).toBe(false);
  });
});

describe("anchor (no look-ahead)", () => {
  const H = 3_600_000;
  const bars = [0, 1, 2, 3, 4].map((i) => ({ time: 1_700_000_000_000 + i * H }));
  it("lastClosedAnchor: the newest bar that is closed at `now`", () => {
    const now = bars[4]!.time + H / 2; // bar 4 is forming
    expect(lastClosedAnchor(bars, H, now)).toBe(bars[3]!.time);
    expect(lastClosedAnchor(bars, H, bars[4]!.time + H)).toBe(bars[4]!.time);
    expect(lastClosedAnchor(bars, H, bars[0]!.time)).toBeNull();
    expect(lastClosedAnchor([], H, now)).toBeNull();
  });
  it("clipAtAnchor drops every later bar and keeps the earlier ones untouched", () => {
    const clipped = clipAtAnchor(bars, bars[2]!.time);
    expect(clipped).toEqual(bars.slice(0, 3));
    expect(clipped[0]).toBe(bars[0]);
    expect(anchorOf(clipped)).toBe(bars[2]!.time);
    expect(anchorOf([])).toBeNull();
  });
});

// ------------------------------------------------------------------ RSI pane view

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

describe("filterRsiOverlay", () => {
  // one active trendline, one broken line, one break dot (hand-made: the geometry is not under test here)
  const data: RsiOverlayData = {
    lines: [
      { kind: "res", a: { i: 3, v: 70 }, slope: -0.5, end: 90, extend: 96, broken: false, fresh: false },
      { kind: "sup", a: { i: 10, v: 30 }, slope: 0.2, end: 61, extend: null, broken: true, fresh: true },
    ],
    breaks: [{ i: 60, v: 28, dir: -1, fresh: true, provisional: false }],
  };

  it("the real engine still gives a break the overlay can hide", () => {
    const bars = brokenUp();
    const st = rsiLines(bars.map((b) => ({ t: b.time, o: b.close, h: b.close, l: b.close, c: b.close }))) as RsiLineState;
    const real = rsiOverlayData(st, bars.length - 1, null);
    expect(real.breaks.length).toBeGreaterThan(0);
    expect(filterRsiOverlay(real, { trendlines: true, breakouts: false }).breaks).toEqual([]);
  });

  it("everything on → the very same data", () => {
    expect(filterRsiOverlay(data, { trendlines: true, breakouts: true })).toBe(data);
  });

  it("trendlines off hides the active lines only; breakouts off hides break dots and the broken line only", () => {
    const noLines = filterRsiOverlay(data, { trendlines: false, breakouts: true });
    expect(noLines.lines.every((l) => l.broken)).toBe(true);
    expect(noLines.breaks).toEqual(data.breaks);
    const noBreaks = filterRsiOverlay(data, { trendlines: true, breakouts: false });
    expect(noBreaks.lines.every((l) => !l.broken)).toBe(true);
    expect(noBreaks.breaks).toEqual([]);
    expect(filterRsiOverlay(data, { trendlines: false, breakouts: false })).toEqual({ lines: [], breaks: [] });
  });

  it("the breakout timestamps (bar indices) stay identical whatever is shown", () => {
    const idx = data.breaks.map((b) => b.i);
    expect(filterRsiOverlay(data, { trendlines: false, breakouts: true }).breaks.map((b) => b.i)).toEqual(idx);
  });
});

interface FakeScale {
  applyOptions: ReturnType<typeof vi.fn>;
}
function fakeRsiChart() {
  const scales: FakeScale[] = [];
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    createPriceLine: vi.fn((o: unknown) => o),
    removePriceLine: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    priceToCoordinate: (v: number) => 100 - v,
    priceScale: () => {
      const s: FakeScale = { applyOptions: vi.fn() };
      scales.push(s);
      return s;
    },
    getPane: () => ({ paneIndex: () => 1, getHeight: () => 120 }),
  };
  return { chart: { addSeries: vi.fn(() => series) }, series, scales };
}

describe("RsiPane.setView", () => {
  it("mirroring the RSI axis only sets the scale option: data, values and break times are untouched; twice = original", () => {
    const { chart, series, scales } = fakeRsiChart();
    const pane = new RsiPane(chart as never, 1);
    pane.setBars(brokenUp());
    const setDataCalls = series.setData.mock.calls.length;
    const before = { last: pane.lastValue(), fresh: pane.freshBreak(), lines: pane.lineState() };

    pane.setView({ mirrored: true });
    pane.setView({ mirrored: false });

    const opts = scales.flatMap((s) => s.applyOptions.mock.calls.map((c) => c[0]));
    expect(opts).toEqual([{ invertScale: true }, { invertScale: false }]);
    expect(series.setData.mock.calls.length).toBe(setDataCalls);
    expect(pane.lastValue()).toBe(before.last);
    expect(pane.freshBreak()).toEqual(before.fresh);
    expect(pane.lineState()).toBe(before.lines);
    expect(pane.isMirrored()).toBe(false);
  });

  it("an unchanged axis is not re-applied; breakouts off removes the glow's break but keeps the data", () => {
    const { chart, scales } = fakeRsiChart();
    const pane = new RsiPane(chart as never, 1);
    pane.setBars(brokenUp());
    expect(pane.freshBreak()).not.toBeNull();
    pane.setView({ breakouts: false });
    expect(pane.freshBreak()).toBeNull();
    pane.setView({ breakouts: true });
    expect(pane.freshBreak()).not.toBeNull();
    expect(scales.flatMap((s) => s.applyOptions.mock.calls)).toHaveLength(0);
    expect(DEFAULT_RSI_VIEW.mirrored).toBe(false);
  });
});

// ------------------------------------------------------------------ markers of a frozen / blind picture

describe("visibleMarkers", () => {
  const H = 3_600_000;
  const T0 = 1_700_000_000_000;
  const mk = (id: string, time: number): TradeMarker => ({ id, time, side: "long", entry: 100, exit: 110, pnl: 10, result: "win" });
  const list = [mk("a", T0), mk("b", T0 + 5 * H), mk("c", T0 + 9 * H)];
  const base = { layerOn: true, anchorMs: null, intervalMs: H, blind: NO_BLIND };

  it("untouched when nothing is frozen or covered", () => {
    expect(visibleMarkers(list, base)).toEqual(list);
  });
  it("layer off or position covered: none", () => {
    expect(visibleMarkers(list, { ...base, layerOn: false })).toEqual([]);
    expect(visibleMarkers(list, { ...base, blind: { ...NO_BLIND, hidePosition: true } })).toEqual([]);
  });
  it("frozen: later trades are the future and vanish; the rest loses exit, result and P&L", () => {
    const out = visibleMarkers(list, { ...base, anchorMs: T0 + 5 * H });
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    for (const m of out) expect([m.exit, m.pnl, m.result]).toEqual([null, null, "open"]);
    // a trade inside the anchor bar was already known; one in the next bar was not
    expect(visibleMarkers(list, { ...base, anchorMs: T0 + 4 * H }).map((m) => m.id)).toEqual(["a"]);
  });
  it("P&L covered: entries stay, exits and results go", () => {
    const out = visibleMarkers(list, { ...base, blind: { ...NO_BLIND, hidePnl: true } });
    expect(out).toHaveLength(3);
    expect(out.every((m) => m.entry === 100 && m.exit === null && m.pnl === null && m.result === "open")).toBe(true);
  });
});
