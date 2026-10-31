/**
 * MAE / MFE efficiency (P03) over the excursions P06 measures and stores on the trade (`mae`, `mfe` as price
 * distances ≥ 0, `maeR` / `mfeR` in R; see `src/domain/excursion.ts`):
 * - scatter points MAE R × MFE R with the realised R;
 * - exit efficiency = realised favourable move ÷ MFE (how much of the best move a winner kept; capped at 100 %, the
 *   measurement uses whole candles);
 * - entry efficiency = MAE ÷ stop distance (how much of the planned risk the market used; small = precise entry);
 * - money left on the table = Σ (MFE − realised move) × quantity over the winners; losers that were ≥ 1 R in profit;
 * - stop / target hints from the distribution (80 % of the winners never went further against you than …).
 * Trades without stored excursions are simply not part of it (`total` says how many closed trades exist).
 */
import type { EnrichedTrade, TradeResult } from "../types";
import { captureRatio } from "../excursion";
import { mean, median, quantile } from "./stats";

/** Trades with excursions needed for the efficiencies and hints. */
export const EXCURSION_MIN_N = 5;

export interface ExcursionPoint {
  id: string;
  maeR: number;
  mfeR: number;
  r: number | null;
  result: TradeResult;
  /** exit efficiency of this trade (realised ÷ MFE), winners only */
  capture: number | null;
}

export interface Summary {
  mean: number | null;
  median: number | null;
  n: number;
}

export interface ExcursionReport {
  points: ExcursionPoint[];
  /** closed trades with a measured MAE / MFE */
  n: number;
  /** all closed trades */
  total: number;
  exitEfficiency: Summary;
  entryEfficiency: Summary;
  /** money left on the table by the winners (Σ (MFE − realised move) × qty, in currency) */
  leftOnTable: { money: number; n: number };
  /** losers that had been at least 1 R in profit */
  givenBack: EnrichedTrade[];
  /** 80th percentile of the winners' MAE in R ("80 % never went further against you than …") */
  winnerMaeP80: number | null;
  /** median MFE in R of all measured trades */
  mfeMedian: number | null;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const stopDist = (t: EnrichedTrade): number | null => (fin(t.entry) && fin(t.stop) && t.entry > 0 && t.stop > 0 && t.entry !== t.stop ? Math.abs(t.entry - t.stop) : null);

/** MAE / MFE of a trade in R (stored R, else distance ÷ stop distance), `null` when not measured. */
export function excursionR(t: EnrichedTrade): { maeR: number; mfeR: number } | null {
  const d = stopDist(t);
  const maeR = fin(t.maeR) ? t.maeR : fin(t.mae) && d ? t.mae / d : null;
  const mfeR = fin(t.mfeR) ? t.mfeR : fin(t.mfe) && d ? t.mfe / d : null;
  return maeR != null && mfeR != null ? { maeR: Math.abs(maeR), mfeR: Math.abs(mfeR) } : null;
}

const qtyOf = (t: EnrichedTrade): number | null => (fin(t.qty) && t.qty > 0 ? t.qty : fin(t.size) && fin(t.entry) && t.size > 0 && t.entry > 0 ? t.size / t.entry : null);

const summary = (xs: readonly number[]): Summary => ({ mean: mean(xs), median: median(xs), n: xs.length });

export function excursionReport(closed: readonly EnrichedTrade[]): ExcursionReport {
  const points: ExcursionPoint[] = [];
  const captures: number[] = [];
  const entries: number[] = [];
  const winnerMae: number[] = [];
  const mfes: number[] = [];
  const givenBack: EnrichedTrade[] = [];
  let left = 0;
  let leftN = 0;
  for (const t of closed) {
    const ex = excursionR(t);
    if (!ex) continue;
    const winner = t.result === "win";
    let capture: number | null = null;
    if (winner && fin(t.entry) && fin(t.exit) && fin(t.mfe)) {
      const c = captureRatio(t.side, t.entry, t.exit, t.mfe);
      if (c != null) {
        capture = Math.max(0, Math.min(1, c));
        captures.push(capture);
      }
      const qty = qtyOf(t);
      const moved = t.side === "short" ? t.entry - t.exit : t.exit - t.entry;
      if (qty != null && t.mfe > moved) {
        left += (t.mfe - Math.max(0, moved)) * qty;
        leftN++;
      }
    }
    if (winner) winnerMae.push(ex.maeR);
    if (t.result === "loss" && ex.mfeR >= 1) givenBack.push(t);
    entries.push(ex.maeR);
    mfes.push(ex.mfeR);
    points.push({ id: t.id, maeR: ex.maeR, mfeR: ex.mfeR, r: fin(t.r) ? t.r : null, result: t.result, capture });
  }
  const enough = points.length >= EXCURSION_MIN_N;
  return {
    points,
    n: points.length,
    total: closed.length,
    exitEfficiency: summary(captures),
    entryEfficiency: summary(entries),
    leftOnTable: { money: left, n: leftN },
    givenBack,
    winnerMaeP80: enough && winnerMae.length >= 3 ? quantile(winnerMae, 0.8) : null,
    mfeMedian: enough ? median(mfes) : null,
  };
}
