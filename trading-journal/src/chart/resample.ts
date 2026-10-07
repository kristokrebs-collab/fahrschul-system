/**
 * Candle resampling for chart intervals that have no exchange stream of their own (`30m` from `kline_15m`). Buckets
 * are aligned to the epoch (= UTC midnight for every bar length that divides a day, like TradingView for 24/7
 * crypto); a bucket is `closed` once its last source candle has closed and reaches the bucket end.
 */
import type { Candle } from "@/market/types";

/** Aggregates ascending `src` candles (`srcMs` each) into `ms` buckets. Keeps the input order; no allocation per tick. */
export function resampleCandles(src: readonly Candle[], srcMs: number, ms: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of src) {
    const b = Math.floor(c.time / ms) * ms;
    const ends = c.closed && c.time + srcMs >= b + ms;
    if (!cur || cur.time !== b) {
      if (cur) out.push(cur);
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, closed: ends, closeTime: b + ms - 1 };
      continue;
    }
    if (c.high > cur.high) cur.high = c.high;
    if (c.low < cur.low) cur.low = c.low;
    cur.close = c.close;
    cur.volume += c.volume;
    cur.closed = ends;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The live tail for the forming candle: the last two buckets rebuilt from the source candles that belong to them
 * (a kline frame touches only the newest 15m bar, so this stays O(1) per frame).
 */
export function resampleTail(src: readonly Candle[], srcMs: number, ms: number, buckets = 2): Candle[] {
  if (src.length === 0) return [];
  const last = src[src.length - 1]!;
  const from = Math.floor(last.time / ms) * ms - (buckets - 1) * ms;
  let i = src.length - 1;
  while (i > 0 && src[i - 1]!.time >= from) i--;
  return resampleCandles(src.slice(i), srcMs, ms);
}
