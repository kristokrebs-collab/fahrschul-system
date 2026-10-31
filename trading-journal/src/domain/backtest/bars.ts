/**
 * Bar helpers of the backtest (P07, pure): ATR series, higher-timeframe aggregation on the exchange's grid (UTC days,
 * Monday weeks like Binance), lookups by time and data checks. Bars use the signal engine's `Bar` (`t` = open time in
 * UNIX SECONDS).
 */
import { atr } from "../signals/structure";
import type { Bar, BarsBy, HistInterval } from "./types";
import { HIST_MS, HIST_SOURCE } from "./types";

const DAY_S = 86_400;
const WEEK_S = 7 * DAY_S;

/** ATR(14) (Wilder) per bar; before 14 bars the running mean range (never NaN, never 0 on a moving market). */
export function atrSeries(bars: readonly Bar[], len = 14): number[] {
  const a = atr(bars, len);
  let sum = 0;
  return a.map((v, i) => {
    sum += bars[i]!.h - bars[i]!.l;
    return Number.isFinite(v) && v > 0 ? v : sum / (i + 1);
  });
}

/** Open of the UTC day / the Monday week (Binance weeks open Monday 00:00 UTC; the epoch was a Thursday). */
export const dayOpenS = (t: number): number => Math.floor(t / DAY_S) * DAY_S;
export const weekOpenS = (t: number): number => Math.floor((t - 4 * DAY_S) / WEEK_S) * WEEK_S + 4 * DAY_S;

/**
 * Aggregates ascending bars into buckets (`open(t)` = bucket open): o first, h max, l min, c last, v sum. A bucket is
 * kept only when complete (`count` source bars) – except the newest, which is dropped as well: a backtest only sees
 * closed higher-timeframe bars.
 */
export function aggregateBars(bars: readonly Bar[], open: (t: number) => number, count: number): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let n = 0;
  const flush = () => {
    if (cur && n === count) out.push(cur);
  };
  for (const b of bars) {
    const k = open(b.t);
    if (cur && cur.t === k) {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      if (b.v !== undefined) cur.v = (cur.v ?? 0) + b.v;
      n++;
      continue;
    }
    flush();
    cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, ...(b.v !== undefined ? { v: b.v } : {}) };
    n = 1;
  }
  flush();
  return out;
}

/** 4h → 1D (6 bars per UTC day), 1D → 1W (7 days per Monday week); complete buckets only. */
export const toDaily = (h4: readonly Bar[]): Bar[] => aggregateBars(h4, dayOpenS, 6);
export const toWeekly = (d1: readonly Bar[]): Bar[] => aggregateBars(d1, weekOpenS, 7);

/** Number of bars of `bars` that have CLOSED at `atS` (seconds): `bars[k].t + secLen ≤ atS`. Binary search. */
export function closedCount(bars: readonly Bar[], secLen: number, atS: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t + secLen <= atS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first bar whose open time is ≥ `atS`, or `bars.length`. */
export function indexAtOrAfter(bars: readonly Bar[], atS: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t < atS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Holes in a series (consecutive bars further apart than one interval): count and the bars missing. */
export function gapsOf(bars: readonly Bar[], secLen: number): { gaps: number; missing: number } {
  let gaps = 0;
  let missing = 0;
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i]!.t - bars[i - 1]!.t;
    if (d > secLen) {
      gaps++;
      missing += Math.round(d / secLen) - 1;
    }
  }
  return { gaps, missing };
}

/** One hole of a series: between the bars `index - 1` and `index` (open times in seconds) `missing` bars are absent. */
export interface GapSpan {
  index: number;
  /** open of the last bar before the hole / of the first bar after it (seconds) */
  fromS: number;
  toS: number;
  missing: number;
}

/** The holes of a series one by one (the same rule as `gapsOf`, whose totals they add up to). */
export function gapSpans(bars: readonly Bar[], secLen: number): GapSpan[] {
  const out: GapSpan[] = [];
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i]!.t - bars[i - 1]!.t;
    if (d > secLen) out.push({ index: i, fromS: bars[i - 1]!.t, toS: bars[i]!.t, missing: Math.round(d / secLen) - 1 });
  }
  return out;
}

/** Ascending, de-duplicated (last write wins), finite bars only. */
export function cleanBars(bars: readonly Bar[]): Bar[] {
  const sorted = bars.filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.h >= b.l).sort((a, b) => a.t - b.t);
  const out: Bar[] = [];
  for (const b of sorted) {
    if (out.length && out[out.length - 1]!.t === b.t) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

/**
 * Completes `data` with the DERIVED intervals in `wanted` (`30m` = 2 × 15m, `2h` = 2 × 1h): complete exchange buckets
 * only, on the UTC grid (every length divides a day, so epoch alignment is the exchange's). Data that is already there
 * stays; a missing source leaves the derived interval empty.
 */
export function deriveBars(data: BarsBy, wanted: readonly HistInterval[]): BarsBy {
  const out: BarsBy = { ...data };
  for (const iv of wanted) {
    const src = HIST_SOURCE[iv];
    if (src === iv || out[iv]) continue;
    const base = data[src];
    if (!base) continue;
    const sec = HIST_MS[iv] / 1000;
    out[iv] = aggregateBars(base, (t) => Math.floor(t / sec) * sec, HIST_MS[iv] / HIST_MS[src]);
  }
  return out;
}
