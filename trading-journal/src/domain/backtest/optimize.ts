/**
 * Parameter search of the lab (P07, pure): runs a prepared strategy for one parameter set over an index window, scores
 * the result, and picks the best set of a grid. The score is SQN-like – Ø R ÷ sd(R) × √n (n capped at 100) – so a
 * set that wins by luck on four trades never beats a steady one; under `MIN_TRADES` a set does not qualify.
 */
import { runBacktest } from "./engine";
import { sharpeOf } from "./metrics";
import type { LabStrategy, Params, Prepared } from "./strategies/types";
import { paramKey } from "./strategies/types";
import type { BtTrade, EngineCfg, RunResult } from "./types";
import { HIST_MS } from "./types";

/** Fewest trades for a parameter set to count in a comparison. */
export const MIN_TRADES = 5;

export interface Window {
  /** inclusive bar indices */
  from: number;
  to: number;
}

export interface Trial {
  key: string;
  params: Params;
  trades: BtTrade[];
  n: number;
  meanR: number | null;
  sharpe: number | null;
  score: number;
}

/** Runs one parameter set over a window (no equity curve unless asked). */
export function evaluate<F>(strategy: LabStrategy<F, unknown>, prep: Prepared<F>, params: Params, cfg: EngineCfg, win: Window, equity = false): RunResult {
  return runBacktest(prep.bars, strategy.build(prep, params), cfg, { from: win.from, to: win.to, equity, atr: prep.atr, secLen: HIST_MS[prep.interval] / 1000 });
}

/** Score of a trade list (higher is better); `-Infinity` under `MIN_TRADES` or without spread. */
export function scoreOf(trades: readonly BtTrade[]): number {
  const n = trades.length;
  if (n < MIN_TRADES) return -Infinity;
  const rs = trades.map((t) => t.r);
  const sh = sharpeOf(rs);
  if (sh == null) {
    const m = rs.reduce((a, b) => a + b, 0) / n;
    return m > 0 ? 10 : m < 0 ? -10 : 0; // all equal: a sure (rare) case
  }
  return sh * Math.sqrt(Math.min(n, 100));
}

export function trialOf(params: Params, trades: BtTrade[]): Trial {
  const rs = trades.map((t) => t.r);
  return {
    key: paramKey(params),
    params,
    trades,
    n: trades.length,
    meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    sharpe: sharpeOf(rs),
    score: scoreOf(trades),
  };
}

/** Best trial of a list (highest score; ties → more trades, then the earlier set). Null when none qualifies. */
export function bestTrial(trials: readonly Trial[]): Trial | null {
  let best: Trial | null = null;
  for (const t of trials) {
    if (!Number.isFinite(t.score)) continue;
    if (!best || t.score > best.score || (t.score === best.score && t.n > best.n)) best = t;
  }
  return best;
}

/** Splits [from, to] at the share `isShare` into an in-sample and an out-of-sample window. */
export function oosSplit(from: number, to: number, isShare = 0.7): { is: Window; oos: Window } | null {
  const len = to - from + 1;
  if (len < 20) return null;
  const cut = from + Math.max(10, Math.min(len - 10, Math.round(len * isShare)));
  return { is: { from, to: cut - 1 }, oos: { from: cut, to } };
}
