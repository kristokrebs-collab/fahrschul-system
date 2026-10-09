/**
 * Local indicators (Plan 4.9): closed-bar selection 1:1 with the bundle's `UM`, Wilder RSI(14).
 */
import type { Candle } from "./types";

export interface ClosedBar {
  /** close price */
  c: number;
  /** bar CLOSE time, ms */
  t: number;
  /** the candle itself */
  bar: Candle;
}

/**
 * Last bar whose end (`openTime + tf`) is ≤ now + 60 s — the bundle's `UM(bars, tfSeconds)`.
 * Returns `{ c, t }` with `t` = close time in ms, or null.
 */
export function closedBar(bars: readonly Candle[], tfSec: number, now = Date.now()): ClosedBar | null {
  const nowSec = now / 1000;
  let last: Candle | undefined;
  for (const b of bars) {
    if (!b || !Number.isFinite(b.close)) continue;
    if (b.time / 1000 + tfSec <= nowSec + 60) last = b;
  }
  return last ? { c: last.close, t: (last.time / 1000 + tfSec) * 1000, bar: last } : null;
}

export function lastClosed4h(bars: readonly Candle[], now = Date.now()): ClosedBar | null {
  return closedBar(bars, 14_400, now);
}

export function weeklyClose(bars: readonly Candle[], now = Date.now()): ClosedBar | null {
  return closedBar(bars, 604_800, now);
}

/** The bar currently forming (last one whose close time is in the future), or null. */
export function currentBar(bars: readonly Candle[], tfSec: number, now = Date.now()): Candle | null {
  const last = bars[bars.length - 1];
  if (!last) return null;
  return last.time + tfSec * 1000 > now ? last : null;
}

/**
 * Wilder RSI: seed = simple mean of the first `length` gains/losses, then
 * `avg_t = (avg_{t−1}·(length−1) + x_t)/length`. Input = closed candles + the running candle
 * (TradingView convention). Returns null when fewer than `length + 1` closes are available.
 */
export function rsiWilder(closes: readonly number[], length = 14): number | null {
  if (closes.length < length + 1) return null;
  let avgU = 0;
  let avgD = 0;
  for (let i = 1; i <= length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    if (d > 0) avgU += d;
    else avgD -= d;
  }
  avgU /= length;
  avgD /= length;
  for (let i = length + 1; i < closes.length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    const u = d > 0 ? d : 0;
    const dn = d < 0 ? -d : 0;
    avgU = (avgU * (length - 1) + u) / length;
    avgD = (avgD * (length - 1) + dn) / length;
  }
  if (avgD === 0) return avgU === 0 ? 50 : 100;
  const rs = avgU / avgD;
  return 100 - 100 / (1 + rs);
}

/** Weekly RSI from 1w candles (closed + running), `limit=200` convention. */
export function weeklyRsi(bars: readonly Candle[], length = 14): number | null {
  return rsiWilder(
    bars.map((b) => b.close),
    length,
  );
}
