/**
 * F19 – the description of a candle. Hand-computed fixture (short indicator lengths so the arithmetic fits on paper) and the
 * proof that no feature of a candle looks at a later one.
 */
import { describe, expect, it } from "vitest";
import { distance, emaSma, featureBlockedReason, featureSeries, firstValidIndex, relativeVolume, valuesAt } from "@/domain/similar";
import type { SimCandle, SimLens } from "@/domain/similar";
import { T0, H, walk } from "./similar.helpers";


/** Candle with high = close + 1, low = close − 1 (range 2). */
function bar(i: number, close: number, volume: number): SimCandle {
  return { time: T0 + i * H, open: close, high: close + 1, low: close - 1, close, volume, closed: true, closeTime: T0 + (i + 1) * H - 1 };
}

const LENS: SimLens = { rsi: 2, atr: 2, emaFast: 3, emaSlow: 4, volume: 2, slope: 1, trend: 2 };

// closes 10 12 11 13 12, volumes 100 200 100 200 400
const FIX = [bar(0, 10, 100), bar(1, 12, 200), bar(2, 11, 100), bar(3, 13, 200), bar(4, 12, 400)];

describe("featureSeries – hand-computed", () => {
  const { table, atr } = featureSeries(FIX, LENS);

  it("ATR (Wilder, len 2): true ranges 3, 2, 3, 2 → 2,5 · 2,75 · 2,375", () => {
    // TR1 = max(2, |13−10|, |11−10|) = 3; TR2 = max(2, 0, |10−12|) = 2; TR3 = max(2, |14−11|, 1) = 3; TR4 = max(2, 0, |11−13|) = 2
    // ATR2 = (3 + 2) / 2 = 2,5 · ATR3 = (2,5 · 1 + 3) / 2 = 2,75 · ATR4 = (2,75 + 2) / 2 = 2,375
    expect(atr.slice(0, 2)).toEqual([null, null]);
    expect(atr[2]).toBeCloseTo(2.5, 12);
    expect(atr[3]).toBeCloseTo(2.75, 12);
    expect(atr[4]).toBeCloseTo(2.375, 12);
  });

  it("RSI (Wilder, len 2): 66,667 · 85,714 · 54,545", () => {
    // gains 2,0,2,0 / losses 0,1,0,1 → RMA seeds 1 / 0,5 (RS 2 → 66,667), then 1,5 / 0,25 (RS 6 → 85,714), then 0,75 / 0,625 (RS 1,2 → 54,545)
    expect(table.rsi[0]).toBeNull();
    expect(table.rsi[1]).toBeNull();
    expect(table.rsi[2]).toBeCloseTo(100 - 100 / 3, 9);
    expect(table.rsi[3]).toBeCloseTo(100 - 100 / 7, 9);
    expect(table.rsi[4]).toBeCloseTo(100 - 100 / 2.2, 9);
  });

  it("RSI slope (1 candle back): n/a, 19,048, −31,169", () => {
    expect(table.rsiSlope[2]).toBeNull();
    expect(table.rsiSlope[3]).toBeCloseTo(100 - 100 / 7 - (100 - 100 / 3), 9);
    expect(table.rsiSlope[4]).toBeCloseTo(100 - 100 / 2.2 - (100 - 100 / 7), 9);
  });

  it("EMA distance in ATR: EMA3 = 11 · 12 · 12, EMA4 = 11,5 · 11,7", () => {
    // EMA3 seed (10+12+11)/3 = 11, a = 0,5 → 12 → 12 ;  EMA4 seed (10+12+11+13)/4 = 11,5, a = 0,4 → 0,4·12 + 0,6·11,5 = 11,7
    expect(table.emaFast[1]).toBeNull();
    expect(table.emaFast[2]).toBeCloseTo((11 - 11) / 2.5, 12);
    expect(table.emaFast[3]).toBeCloseTo((13 - 12) / 2.75, 12);
    expect(table.emaFast[4]).toBeCloseTo((12 - 12) / 2.375, 12);
    expect(table.emaSlow[2]).toBeNull();
    expect(table.emaSlow[3]).toBeCloseTo((13 - 11.5) / 2.75, 12);
    expect(table.emaSlow[4]).toBeCloseTo((12 - 11.7) / 2.375, 12);
  });

  it("range / ATR and trend of the last 2 candles in ATR", () => {
    expect(table.range[1]).toBeNull();
    expect(table.range[2]).toBeCloseTo(2 / 2.5, 12);
    expect(table.range[3]).toBeCloseTo(2 / 2.75, 12);
    expect(table.range[4]).toBeCloseTo(2 / 2.375, 12);
    expect(table.trend[1]).toBeNull();
    expect(table.trend[2]).toBeCloseTo((11 - 10) / 2.5, 12);
    expect(table.trend[3]).toBeCloseTo((13 - 12) / 2.75, 12);
    expect(table.trend[4]).toBeCloseTo((12 - 11) / 2.375, 12);
  });

  it("relative volume = ln(volume ÷ mean of the last 2): ln(4/3) · ln(2/3) · ln(4/3) · ln(4/3)", () => {
    expect(table.volume[0]).toBeNull();
    expect(table.volume[1]).toBeCloseTo(Math.log(200 / 150), 12);
    expect(table.volume[2]).toBeCloseTo(Math.log(100 / 150), 12);
    expect(table.volume[3]).toBeCloseTo(Math.log(200 / 150), 12);
    expect(table.volume[4]).toBeCloseTo(Math.log(400 / 300), 12);
  });

  it("weekday and session come from the candle's UTC open time (Monday 00:00 → Montag, Asien)", () => {
    expect(table.weekday[0]).toBe(1);
    expect(table.session[0]).toBe(1); // asia
  });

  it("firstValidIndex names the first candle each feature can exist at", () => {
    expect(firstValidIndex("rsi", LENS)).toBe(2);
    expect(firstValidIndex("rsiSlope", LENS)).toBe(3);
    expect(firstValidIndex("emaFast", LENS)).toBe(2);
    expect(firstValidIndex("emaSlow", LENS)).toBe(3);
    expect(firstValidIndex("volume", LENS)).toBe(1);
    expect(firstValidIndex("trend", LENS)).toBe(2);
    // and the table agrees: nothing is defined before it, everything is at it
    for (const id of ["rsi", "rsiSlope", "emaFast", "range", "volume", "trend"] as const) {
      const f = firstValidIndex(id, LENS);
      expect(table[id][f - 1] ?? null, id).toBeNull();
      expect(table[id][f], id).not.toBeNull();
    }
  });
});

describe("helpers", () => {
  it("emaSma is seeded with the SMA of the first len values and null before", () => {
    // a = 2/3: (2/3)·6 + (1/3)·3 = 5, (2/3)·8 + (1/3)·5 = 7
    expect(emaSma([2, 4, 6, 8], 2)).toEqual([null, 3, 5, 7]);
    expect(emaSma([1, 2], 3)).toEqual([null, null]);
  });

  it("relativeVolume is null when a volume in the window is missing or zero", () => {
    expect(relativeVolume([1, undefined, 3], 2)).toEqual([null, null, null]);
    expect(relativeVolume([0, 0, 0], 2)).toEqual([null, null, null]);
  });

  it("distance: root of the mean squared difference in units of each scale; categorical = 0 / 1", () => {
    // rsi scale 10, range scale 0,8: (5/10)² = 0,25 and (0,4/0,8)² = 0,25 → √(0,5 / 2) = 0,5
    expect(distance({ rsi: 50, range: 1 }, { rsi: 55, range: 1.4 }, ["rsi", "range"])).toBeCloseTo(0.5, 12);
    expect(distance({ weekday: 2 }, { weekday: 2 }, ["weekday"])).toBe(0);
    expect(distance({ weekday: 2 }, { weekday: 3 }, ["weekday"])).toBe(1);
    expect(distance({ rsi: null }, { rsi: 50 }, ["rsi"])).toBeNull();
    expect(distance({}, {}, [])).toBeNull();
  });

  it("features that make no sense on a timeframe are blocked with a reason", () => {
    expect(featureBlockedReason("weekday", "1W")).toMatch(/Wochen/);
    expect(featureBlockedReason("weekday", "1D")).toBeNull();
    expect(featureBlockedReason("session", "4h")).toMatch(/Sessions/);
    expect(featureBlockedReason("session", "1h")).toBeNull();
  });
});

describe("no look-ahead: a candle's features use only candles up to itself", () => {
  const candles = walk(260);
  const full = featureSeries(candles).table;

  it("the table of a series cut at candle i equals the full table at i – every i, every feature", () => {
    for (let i = 0; i < candles.length; i += 1) {
      const cut = featureSeries(candles.slice(0, i + 1)).table;
      for (const id of Object.keys(full) as (keyof typeof full)[]) expect(cut[id][i], `${id}@${i}`).toEqual(full[id][i]);
    }
  });

  it("changing candles AFTER i leaves every feature value at 0…i bit-identical", () => {
    const i = 150;
    const changed = candles.map((c, k) => (k > i ? { ...c, open: c.open * 3, high: c.high * 3 + 9, low: c.low / 2, close: c.close * 2.5, volume: (c.volume ?? 0) * 7 } : c));
    const t = featureSeries(changed).table;
    for (const id of Object.keys(full) as (keyof typeof full)[]) expect(t[id].slice(0, i + 1), id).toEqual(full[id].slice(0, i + 1));
    // …while a later candle really does change (the test would be vacuous otherwise)
    expect(t.rsi[i + 5]).not.toEqual(full.rsi[i + 5]);
  });

  it("valuesAt reads exactly one candle's column", () => {
    const v = valuesAt(full, 200, ["rsi", "range"]);
    expect(v).toEqual({ rsi: full.rsi[200], range: full.range[200] });
  });
});
