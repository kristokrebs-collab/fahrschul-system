/**
 * Pure bar utilities for the signal engine: live completion of the running candle and exact resampling of
 * smaller bars into a larger timeframe (45m = 3 × 15m, 30m = 2 × 15m, 2h/3h from 1h).
 *
 * Bucket alignment (TradingView rule for 24/7 crypto sessions, exchange time zone UTC): intraday bars start at
 * the session start 00:00 UTC and follow each other every `sec` seconds; a bucket never crosses midnight.
 * For every length that divides a day (30m, 45m, 1h, 2h, 3h, 4h — 86 400 is divisible by 1800, 2700, 3600,
 * 7200, 10 800 and 14 400) this equals plain epoch alignment `floor(t / sec) · sec`. Daily and longer
 * buckets are epoch aligned (1D starts at 00:00 UTC; 1W is not resampled here).
 */
import type { Bar } from "./indicators";

const DAY = 86_400;

/** Open time (unix seconds) of the `sec`-bucket that contains `t`, UTC-session anchored. */
export function bucketOpen(t: number, sec: number): number {
  if (sec >= DAY || DAY % sec === 0) return Math.floor(t / sec) * sec;
  const day = Math.floor(t / DAY) * DAY;
  return day + Math.floor((t - day) / sec) * sec;
}

/**
 * Aggregates ascending bars of length `srcSec` into buckets of `sec`: o = first o, h = max, l = min,
 * c = last c, v = sum (when present). A leading partial bucket (its first constituent is not at the bucket
 * open) is dropped; the last bucket may be partial — it is the running bar of the larger timeframe.
 * `sec` must be a multiple of `srcSec`; `sec === srcSec` returns a copy.
 */
export function resampleBars(bars: readonly Bar[], srcSec: number, sec: number): Bar[] {
  const out: Bar[] = [];
  if (!bars.length || sec <= 0 || srcSec <= 0) return out;
  if (sec === srcSec) return bars.map((b) => ({ ...b }));
  const t0 = bars[0]!.t;
  const k0 = bucketOpen(t0, sec);
  // leading partial bucket: its constituents are skipped
  const skip = t0 !== k0 ? k0 : NaN;
  let cur: Bar | null = null;
  for (const b of bars) {
    const k = bucketOpen(b.t, sec);
    if (k === skip) continue;
    if (cur && cur.t === k) {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      if (b.v !== undefined) cur.v = (cur.v ?? 0) + b.v;
      continue;
    }
    if (cur) out.push(cur);
    cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c };
    if (b.v !== undefined) cur.v = b.v;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Completes the running candle with the live price (or begins the next one), as the chart shows it. Ported 1:1
 * from the other journal (`withLivePrice`, `signals.ts:42-51`). `sec` = bar length in seconds, `atMs` = time
 * of the price. A gap of two or more bars is left alone ("lieber nichts erfinden").
 */
export function withLivePrice(bars: readonly Bar[], sec: number, price: number, atMs: number): readonly Bar[] {
  if (!bars.length || !sec || !isFinite(price)) return bars;
  const now = atMs / 1000;
  const last = bars[bars.length - 1]!;
  if (now < last.t) return bars;
  const k = Math.floor((now - last.t) / sec);
  if (k === 0) return [...bars.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
  if (k === 1) return [...bars, { t: last.t + sec, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price }];
  return bars;
}
