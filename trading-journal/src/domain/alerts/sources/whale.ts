/**
 * Source "Top-Trader-Umschlag": the long share of Binance's top traders (by position, `topLongShortPositionRatio`) crossing the
 * 50 % line. Pure. Honest naming: these are Binance's top-trader cohorts, not "whales" and not a forecast.
 *
 *   held      green when the long share is above 50 %, red when below (the engine counts it as confirmed from `confirm` points on)
 *   margin    how far from 50 % (points)
 *   approach  the way the share is MOVING (change over about one hour): toward green when it rises, toward red when it falls,
 *             with the distance to the confirming line (50 ± `confirm`); a share that barely moves has no approach
 */
import type { AlertReading } from "../types";

export interface RatioPoint {
  /** ms at the period boundary */
  time: number;
  /** long share in percent */
  longPct: number;
}

/** The look-back for the direction of movement. */
export const WHALE_LOOKBACK_MS = 60 * 60_000;
/** A move smaller than this (points) is no direction. */
export const WHALE_MIN_MOVE = 0.1;

const n1 = (v: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Reading of one symbol from its ascending series, or `null` when there are fewer than two usable points. */
export function whaleReading(symbol: string, series: readonly RatioPoint[], confirm: number): AlertReading | null {
  const pts = series.filter((p) => Number.isFinite(p.time) && Number.isFinite(p.longPct) && p.longPct >= 0 && p.longPct <= 100);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1]!;
  const target = last.time - WHALE_LOOKBACK_MS;
  // the newest point at or before the look-back time, else the oldest one we have (a shorter look-back is still a direction)
  let old = pts[0]!;
  for (const p of pts) if (p.time <= target) old = p;
  if (old.time >= last.time) return null;
  const s = last.longPct;
  const chg = s - old.longPct;
  const held = s > 50 ? "green" : s < 50 ? "red" : null;
  let approach: AlertReading["approach"] = null;
  if (Math.abs(chg) >= WHALE_MIN_MOVE) {
    approach = chg > 0 ? { side: "green", distance: Math.max(0, 50 + confirm - s) } : { side: "red", distance: Math.max(0, s - (50 - confirm)) };
  }
  return {
    key: `whale:${symbol}`,
    source: "whale",
    market: symbol,
    held,
    margin: Math.abs(s - 50),
    approach,
    asOf: last.time,
    detail: `Top-Trader (Binance, nach Positionen): ${n1(s)} % long, ${chg >= 0 ? "+" : "−"}${n1(Math.abs(chg))} Punkte in ${Math.max(1, Math.round((last.time - old.time) / 60_000))} Min.`,
  };
}
