/**
 * Candle fixtures for the trendline tests: piecewise-linear closes through control points, wicks of ±`wick`, one candle
 * per `ms`, all closed. Deterministic, no randomness.
 */
import type { EvalCandle } from "@/domain/keylevels";

export const T0 = Date.UTC(2026, 0, 1);
export const H4 = 4 * 3_600_000;

/** Closes by linear interpolation between `[index, price]` control points (indices ascending, first at 0). */
export function zigzag(points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let p = 1; p < points.length; p++) {
    const [i0, v0] = points[p - 1]!;
    const [i1, v1] = points[p]!;
    for (let i = i0; i < i1; i++) out.push(v0 + ((v1 - v0) * (i - i0)) / (i1 - i0));
  }
  out.push(points[points.length - 1]![1]);
  return out;
}

/** Closed candles of `ms` from closes: open = previous close, wicks `wick` beyond open / close. */
export function candlesOf(closes: readonly number[], ms: number = H4, wick = 0.3, t0 = T0): EvalCandle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]!;
    return { time: t0 + i * ms, open: o, high: Math.max(o, c) + wick, low: Math.min(o, c) - wick, close: c, closed: true, closeTime: t0 + (i + 1) * ms - 1 };
  });
}

/** A clock just after the last candle of `candles` closed. */
export const nowAfter = (candles: readonly EvalCandle[], ms: number = H4): number => (candles.length ? candles[candles.length - 1]!.time + ms : T0);

/** The mirror image around `axis` (highs and lows swap). */
export function mirrored(candles: readonly EvalCandle[], axis = 200): EvalCandle[] {
  return candles.map((c) => ({ ...c, open: axis - c.open, close: axis - c.close, high: axis - c.low, low: axis - c.high }));
}

/**
 * A falling resistance through the peaks 30 / 54 / 78 (130 → 124 → 118, −0.25 per bar), a 14-bar rally from 96 that
 * breaks it upward, and a pull-back to the broken line. Flat warm-up first (the ATR needs 15 candles).
 */
export const DOWN_THEN_BREAK: ReadonlyArray<readonly [number, number]> = [
  [0, 100],
  [20, 100],
  [30, 130],
  [42, 100],
  [54, 124],
  [66, 98],
  [78, 118],
  [90, 96],
  [104, 122],
  [118, 108.9],
  [132, 135],
];
