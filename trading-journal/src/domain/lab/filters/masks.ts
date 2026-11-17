/**
 * Per-bar yes / no series of the series-based filters (F17). Every value at bar i uses bars ≤ i only: the RSI of the
 * closed candle, and a higher-timeframe candle only once it had CLOSED at the close of bar i (built from complete
 * buckets of the execution bars – a hole in the data drops the bucket). 1 = passes, 0 = fails, 2 = UNKNOWN (not enough
 * history yet): an unknown never lets a signal through, and the comparison counts it separately.
 */
import { aggregateBars, closedCount, weekOpenS } from "../../backtest/bars";
import { ema, rsi } from "../../signals";
import type { Bar } from "../../backtest/types";
import { trendTimeframe } from "./types";
import type { HistInterval } from "../../backtest/types";

export const PASS = 1 as const;
export const FAIL = 0 as const;
export const UNKNOWN_MASK = 2 as const;

export interface SideMask {
  long: Uint8Array;
  short: Uint8Array;
}

const emptyMask = (n: number): SideMask => ({ long: new Uint8Array(n).fill(UNKNOWN_MASK), short: new Uint8Array(n).fill(UNKNOWN_MASK) });

/** RSI(14) zone: long while RSI ≤ `limit`, short while RSI ≥ 100 − `limit`. */
export function rsiMask(bars: readonly Bar[], limit: number, len = 14): SideMask {
  const m = emptyMask(bars.length);
  const r = rsi(
    bars.map((b) => b.c),
    len,
  );
  for (let i = 0; i < bars.length; i++) {
    const v = r[i];
    if (v == null || !Number.isFinite(v)) continue;
    m.long[i] = v <= limit ? PASS : FAIL;
    m.short[i] = v >= 100 - limit ? PASS : FAIL;
  }
  return m;
}

/** The higher-timeframe bars (complete buckets) the trend filter reads, or null when the execution bars cannot form them. */
export function trendBars(bars: readonly Bar[], interval: HistInterval, execSec: number): { bars: Bar[]; sec: number } | null {
  const tf = trendTimeframe(interval);
  if (tf.sec <= execSec) return null;
  if (tf.sec === 604_800) return execSec === 86_400 ? { bars: aggregateBars(bars, weekOpenS, 7), sec: tf.sec } : null;
  if (tf.sec % execSec !== 0) return null;
  return { bars: aggregateBars(bars, (t) => Math.floor(t / tf.sec) * tf.sec, tf.sec / execSec), sec: tf.sec };
}

/** Higher trend: the closed higher-timeframe candle's close above (long) / below (short) its EMA(`len`). */
export function trendMask(bars: readonly Bar[], interval: HistInterval, execSec: number, len: number): SideMask {
  const m = emptyMask(bars.length);
  const htf = trendBars(bars, interval, execSec);
  if (!htf || htf.bars.length < len) return m;
  const closes = htf.bars.map((b) => b.c);
  const avg = ema(closes, len);
  for (let i = 0; i < bars.length; i++) {
    const k = closedCount(htf.bars, htf.sec, bars[i]!.t + execSec);
    if (k < len) continue;
    const c = closes[k - 1]!;
    const e = avg[k - 1]!;
    if (!Number.isFinite(e)) continue;
    m.long[i] = c > e ? PASS : FAIL;
    m.short[i] = c < e ? PASS : FAIL;
  }
  return m;
}
