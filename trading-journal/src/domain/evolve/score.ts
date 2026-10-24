/**
 * The score of a variant (pure). It is measured on the TEST windows only and is deliberately a "robust" number, not the best
 * number of the past:
 *
 *   score = Ø R × √n  −  DD_WEIGHT × (largest drop of the cumulative R) ÷ √n  −  COMPLEXITY_W × (extra degrees of freedom)
 *
 * - Ø R × √n grows with the evidence: the same edge on more trades scores higher (it is the t-statistic's numerator without the
 *   spread); a thin sample can never win by luck of a few trades;
 * - the drawdown term punishes a path that was painful on the way (in R, per √n so it does not dwarf long samples);
 * - every knob added beyond the current version costs `COMPLEXITY_W` – an extra degree of freedom must earn its keep;
 * - under `MIN_TEST_TRADES` trades there is no score at all (`null`): the variant does not qualify.
 * R is the engine's R: net of fees, slippage and funding.
 */
import { CI_LEVEL, tTest } from "../analytics/stats";
import type { BtTrade } from "../backtest/types";
import type { WinMetrics } from "./types";

export const MIN_TEST_TRADES = 15;
/** Below this many test trades a proposal carries the warning "kleine Stichprobe". */
export const WARN_TRADES = 30;
export const DD_WEIGHT = 0.5;
export const COMPLEXITY_W = 0.12;

type TradeLike = Pick<BtTrade, "r" | "pnl" | "exitTime" | "entryTime">;

/** Chronological order: exit time, then entry time. */
export const chronological = <T extends Pick<BtTrade, "exitTime" | "entryTime">>(ts: readonly T[]): T[] => [...ts].sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);

export function metricsOf(trades: readonly TradeLike[], capital: number): WinMetrics {
  const ts = chronological(trades);
  const n = ts.length;
  let sumR = 0;
  let wins = 0;
  let gw = 0;
  let gl = 0;
  let pnl = 0;
  let peak = 0;
  let dd = 0;
  for (const t of ts) {
    sumR += t.r;
    pnl += t.pnl;
    if (t.pnl > 0) {
      wins++;
      gw += t.pnl;
    } else if (t.pnl < 0) gl += t.pnl;
    peak = Math.max(peak, sumR);
    dd = Math.max(dd, peak - sumR);
  }
  const tt = n >= 3 ? tTest(ts.map((t) => t.r), 0, CI_LEVEL) : null;
  return {
    n,
    sumR,
    avgR: n ? sumR / n : null,
    avgRCI: tt ? tt.ci : null,
    winRate: n ? wins / n : null,
    maxDdR: dd,
    netPct: capital > 0 ? pnl / capital : 0,
    pf: gl < 0 ? gw / -gl : n && gw > 0 ? Infinity : null,
  };
}

/** The robust score; `null` when the variant has too few test trades to qualify. */
export function robustScore(m: Pick<WinMetrics, "n" | "avgR" | "maxDdR">, extraFreedom: number): number | null {
  if (m.n < MIN_TEST_TRADES || m.avgR == null) return null;
  const root = Math.sqrt(m.n);
  return m.avgR * root - (DD_WEIGHT * m.maxDdR) / root - COMPLEXITY_W * Math.max(0, extraFreedom);
}
