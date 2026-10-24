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
 *
 * The R of a trade is the engine's R (net of fees, slippage and funding) with two safeguards that keep luck and assumptions out
 * of the ranking:
 *  - FUNDING INCOME does not count. Costs do (a long that pays funding is penalised), income does not: with a flat funding
 *    assumption a rule set that simply sits short for days "earns" the carry, and with the real history it earns it only as long
 *    as the sign of the funding rate stays the same. What was left out is shown (`incomeR`).
 *  - A single trade counts at most ±`R_CAP` R (winsorising): a tight stop with no target can produce one 70 R winner whose luck
 *    would otherwise decide the whole ranking.
 * Both apply to score, Ø R, drawdown, win rate, net result, profit factor and the time blocks of the multiple-testing check, so
 * every figure of a proposal is measured the same way.
 */
import { CI_LEVEL, tTest } from "../analytics/stats";
import type { WinMetrics } from "./types";

export const MIN_TEST_TRADES = 15;
/** Below this many test trades a proposal carries the warning "kleine Stichprobe". */
export const WARN_TRADES = 30;
export const DD_WEIGHT = 0.5;
export const COMPLEXITY_W = 0.12;
/** One trade counts at most this many R, up or down (winsorising: the outlier stays a winner, but its luck is limited). */
export const R_CAP = 5;
export const capR = (r: number): number => Math.max(-R_CAP, Math.min(R_CAP, r));

/** What the score needs of a trade – the engine's trade and the forward account's stored trade both have it. */
export interface TradeFacts {
  r: number;
  pnl: number;
  /** funding cost as the engine books it: positive = paid, negative = received */
  funding: number;
  entry: number;
  stop: number;
  qty: number;
  exitTime: number;
  entryTime: number;
}

/** The money one R stands for in this trade (planned risk), from the trade itself. */
export function riskMoney(t: Pick<TradeFacts, "r" | "pnl" | "entry" | "stop" | "qty">): number {
  if (t.r !== 0 && t.pnl !== 0) return Math.abs(t.pnl / t.r);
  return Math.abs(t.entry - t.stop) * t.qty;
}

/** Funding received on this trade, in money (≥ 0). */
export const fundingIncome = (t: Pick<TradeFacts, "funding">): number => Math.max(0, -t.funding);

/** The trade's result in money without funding income. */
export const scoredPnl = (t: Pick<TradeFacts, "pnl" | "funding">): number => t.pnl - fundingIncome(t);

/** The trade's R as the optimiser counts it: without funding income, limited to ±`R_CAP`. */
export function scoredR(t: Pick<TradeFacts, "r" | "pnl" | "funding" | "entry" | "stop" | "qty">): number {
  const risk = riskMoney(t);
  return capR(risk > 0 ? t.r - fundingIncome(t) / risk : t.r);
}

/** Chronological order: exit time, then entry time. */
export const chronological = <T extends Pick<TradeFacts, "exitTime" | "entryTime">>(ts: readonly T[]): T[] => [...ts].sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);

export function metricsOf(trades: readonly TradeFacts[], capital: number): WinMetrics {
  const ts = chronological(trades);
  const rs = ts.map(scoredR);
  const n = ts.length;
  let sumR = 0;
  let wins = 0;
  let gw = 0;
  let gl = 0;
  let pnl = 0;
  let income = 0;
  let peak = 0;
  let dd = 0;
  ts.forEach((t, i) => {
    sumR += rs[i]!;
    const p = scoredPnl(t);
    pnl += p;
    const risk = riskMoney(t);
    if (risk > 0) income += fundingIncome(t) / risk;
    if (p > 0) {
      wins++;
      gw += p;
    } else if (p < 0) gl += p;
    peak = Math.max(peak, sumR);
    dd = Math.max(dd, peak - sumR);
  });
  const tt = n >= 3 ? tTest(rs, 0, CI_LEVEL) : null;
  const best3 = [...rs].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + Math.max(0, b), 0);
  return {
    n,
    sumR,
    avgR: n ? sumR / n : null,
    avgRCI: tt ? tt.ci : null,
    winRate: n ? wins / n : null,
    maxDdR: dd,
    netPct: capital > 0 ? pnl / capital : 0,
    pf: gl < 0 ? gw / -gl : n && gw > 0 ? Infinity : null,
    best3Share: sumR > 0 ? Math.min(1, best3 / sumR) : null,
    incomeR: income,
  };
}

/** The robust score; `null` when the variant has too few test trades to qualify. */
export function robustScore(m: Pick<WinMetrics, "n" | "avgR" | "maxDdR">, extraFreedom: number): number | null {
  if (m.n < MIN_TEST_TRADES || m.avgR == null) return null;
  const root = Math.sqrt(m.n);
  return m.avgR * root - (DD_WEIGHT * m.maxDdR) / root - COMPLEXITY_W * Math.max(0, extraFreedom);
}
