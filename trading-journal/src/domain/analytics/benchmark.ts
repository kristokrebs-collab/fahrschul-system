/**
 * Benchmarks (P03):
 * - `benchmark`: the account's equity (in % of its balance at the comparison start) against buying the market and
 *   holding it (the live symbol's daily candles – the market provider's `kline_1d` cache, ≈ 3 years), day by day from
 *   the first trade (or the first cached day) to the newest candle. Days are UTC days (the candles' grid).
 * - `adaptiveBenchmark`: your own last 90 days against every earlier 90-day window of your own history, as a
 *   percentile ("better than 72 % of your own quarters").
 * Pure: the candles come in as data; without candles there is no buy-and-hold line, never a made-up one.
 */
import type { EnrichedTrade } from "../types";
import { tradeTime } from "@/lib/dates";

export const DAY_MS = 86_400_000;
export const ADAPTIVE_WINDOW_DAYS = 90;
/** Earlier windows needed before a percentile is shown. */
export const ADAPTIVE_MIN_WINDOWS = 30;

export interface DailyClose {
  /** open time of the UTC day (ms) */
  time: number;
  open: number;
  close: number;
}

export interface BenchmarkPoint {
  /** UTC day start (ms) */
  t: number;
  /** own return since the comparison start (fraction) */
  own: number;
  /** buy & hold return since the comparison start (fraction) */
  bh: number;
}

export interface BenchmarkReport {
  points: BenchmarkPoint[];
  own: number;
  bh: number;
  /** own − buy & hold (percentage points as a fraction) */
  alpha: number;
  from: number;
  to: number;
  /** the candles start after the first trade: the comparison starts at the first candle */
  clipped: boolean;
  /** correlation of the daily returns (null below 10 days or without spread) */
  corr: number | null;
}

const utcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/** Own balance at the end of every UTC day from `from` to `to` (inclusive). */
function dailyBalance(closed: readonly EnrichedTrade[], start: number, from: number, to: number): Map<number, number> {
  const net = new Map<number, number>();
  let before = start;
  for (const t of closed) {
    const d = utcDay(+tradeTime(t));
    if (d < from) before += t.pnl || 0;
    else net.set(d, (net.get(d) ?? 0) + (t.pnl || 0));
  }
  const out = new Map<number, number>();
  let bal = before;
  for (let d = from; d <= to; d += DAY_MS) {
    bal += net.get(d) ?? 0;
    out.set(d, bal);
  }
  return out;
}

function correlation(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

/** Own equity vs. buy & hold over the daily candles; `null` without trades or without candles in the range. */
export function benchmark(closed: readonly EnrichedTrade[], start: number, candles: readonly DailyClose[]): BenchmarkReport | null {
  if (!closed.length || !(start > 0)) return null;
  const bars = candles.filter((c) => Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.time)).sort((a, b) => a.time - b.time);
  if (!bars.length) return null;
  const firstTrade = utcDay(+tradeTime(closed[0]!));
  const firstBar = utcDay(bars[0]!.time);
  const from = Math.max(firstTrade, firstBar);
  const to = utcDay(bars[bars.length - 1]!.time);
  if (to < from) return null;
  const bal = dailyBalance(closed, start, from, to);
  const base = bars.find((b) => utcDay(b.time) >= from)!;
  const basePrice = Number.isFinite(base.open) && base.open > 0 ? base.open : base.close;
  const ownBase = (bal.get(from) ?? start) - netOfDay(closed, from);
  if (!(ownBase > 0)) return null;
  const closeByDay = new Map(bars.map((b) => [utcDay(b.time), b.close]));
  const points: BenchmarkPoint[] = [];
  let lastClose = basePrice;
  for (let d = from; d <= to; d += DAY_MS) {
    lastClose = closeByDay.get(d) ?? lastClose;
    points.push({ t: d, own: (bal.get(d) ?? ownBase) / ownBase - 1, bh: lastClose / basePrice - 1 });
  }
  const last = points[points.length - 1]!;
  const ownR: number[] = [];
  const bhR: number[] = [];
  for (let i = 1; i < points.length; i++) {
    ownR.push((1 + points[i]!.own) / (1 + points[i - 1]!.own) - 1);
    bhR.push((1 + points[i]!.bh) / (1 + points[i - 1]!.bh) - 1);
  }
  return { points, own: last.own, bh: last.bh, alpha: last.own - last.bh, from, to, clipped: firstBar > firstTrade, corr: correlation(ownR, bhR) };
}

function netOfDay(closed: readonly EnrichedTrade[], day: number): number {
  let s = 0;
  for (const t of closed) if (utcDay(+tradeTime(t)) === day) s += t.pnl || 0;
  return s;
}

export interface AdaptiveBenchmark {
  /** own return over the last `window` days (fraction) */
  current: number;
  /** share of the earlier windows with a return ≤ current (0–1) */
  percentile: number;
  /** earlier windows compared */
  windows: number;
  window: number;
  best: number;
  worst: number;
}

/**
 * The last `window` days against every earlier `window`-day stretch of the account's own daily equity (calendar
 * days from the first trade to `now`); `null` below `ADAPTIVE_MIN_WINDOWS` earlier windows.
 */
export function adaptiveBenchmark(closed: readonly EnrichedTrade[], start: number, now: number, window = ADAPTIVE_WINDOW_DAYS): AdaptiveBenchmark | null {
  if (!closed.length || !(start > 0)) return null;
  const from = utcDay(+tradeTime(closed[0]!));
  const to = utcDay(now);
  if (to < from) return null;
  const bal = dailyBalance(closed, start, from, to);
  const series: number[] = [start];
  for (let d = from; d <= to; d += DAY_MS) series.push(bal.get(d) ?? series[series.length - 1]!);
  const rets: number[] = [];
  for (let i = window; i < series.length; i++) {
    const a = series[i - window]!;
    if (a > 0) rets.push(series[i]! / a - 1);
  }
  if (rets.length < ADAPTIVE_MIN_WINDOWS + 1) return null;
  const current = rets[rets.length - 1]!;
  const earlier = rets.slice(0, -1);
  const below = earlier.filter((r) => r <= current).length;
  return { current, percentile: below / earlier.length, windows: earlier.length, window, best: Math.max(...earlier), worst: Math.min(...earlier) };
}
