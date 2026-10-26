/**
 * Squeeze observation (F07), the loaded history: the series that were loaded afterwards from Binance's public history
 * („Börsenhistorie nachladen“, `…Hist`) put into the shape the reading and the sample statement expect (`SqueezeData`).
 * Pure. This is a separate data set from what the app collected itself – the card evaluates both on their own and never
 * merges them.
 *
 * The one transformation that is not a plain copy: the funding rate. The collected archive stores the „last settled rate“
 * the exchange reports with every price sample; the history has the settlements themselves. So at every price sample the rate
 * is the most recent settlement at or before it – the same thing the exchange reports – but only while that settlement is
 * younger than `FUNDING_MAX_AGE_MS` (an 8-hour rhythm plus slack). A longer silence is „keine Daten“, never an old rate
 * dressed as current. Nothing is interpolated, smoothed or filled.
 */
import type { LsPt, OiPt, PremiumPt, SqueezeData } from "./types";

const HOUR = 3_600_000;
/** A funding settlement counts as „the last settled rate“ for this long (8 h rhythm + one hour of slack). */
export const FUNDING_MAX_AGE_MS = 9 * HOUR;

export interface HistoryRows {
  /** mark price at the end of each closed 5-minute candle */
  mark: ReadonlyArray<{ t: number; mark: number }>;
  /** funding settlements */
  funding: ReadonlyArray<{ t: number; rate: number }>;
  oi: readonly OiPt[];
  /** all accounts */
  ls: readonly LsPt[];
  /** top-trader positions */
  top: readonly LsPt[];
}

/** `HistoryRows` (each ascending by time) → `SqueezeData`. The price samples are the mark-price grid. */
export function squeezeDataFromHistory(h: HistoryRows): SqueezeData {
  const premium: PremiumPt[] = [];
  let j = -1;
  for (const m of h.mark) {
    while (j + 1 < h.funding.length && h.funding[j + 1]!.t <= m.t) j += 1;
    const f = j >= 0 ? h.funding[j]! : null;
    premium.push({ t: m.t, mark: m.mark, rate: f && m.t - f.t <= FUNDING_MAX_AGE_MS ? f.rate : null });
  }
  return { premium, oi: h.oi, ls: h.ls, top: h.top };
}

/** What the loaded history covers, for the card („x Tage, bis …“); `null` without any price sample. */
export function historyCoverage(h: Pick<HistoryRows, "mark">): { first: number; last: number; hours: number } | null {
  const a = h.mark[0];
  const b = h.mark[h.mark.length - 1];
  return a && b ? { first: a.t, last: b.t, hours: (b.t - a.t) / HOUR } : null;
}
