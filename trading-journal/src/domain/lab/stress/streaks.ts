/**
 * Verlustserien-Stresstest (F20) from the REAL trade order, no engine re-run: the longest run of losers, the worst
 * stretches of 3 / 5 / 10 consecutive trades, the deepest drawdown of the cumulative R, and an order Monte Carlo – the
 * same trades reshuffled with a FIXED seed (`monteCarlo`, method `reshuffle`), so the same result gives the same
 * numbers. Reshuffling keeps every trade and its size; it only asks "what if the losers had come in a different order?".
 */
import { monteCarlo } from "../../analytics/montecarlo";
import { quantileSorted } from "../../analytics/stats";
import type { BtTrade } from "../../backtest/types";
import type { McView, StreakStress, TradeSpan, WindowWorst } from "./types";

/** Fewest trades for the order Monte Carlo (below it the distribution of the order is too coarse to read). */
export const MC_MIN_TRADES = 10;
export const MC_RUNS = 2000;
export const MC_SEED = 20_260_419;
/** Stretch lengths of the "worst k trades in a row" rows. */
export const WORST_KS = [3, 5, 10] as const;

function spanOf(trades: readonly BtTrade[], from: number, to: number): TradeSpan {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += trades[i]!.r;
  return { from, to, fromTime: trades[from]!.entryTime, toTime: trades[to]!.exitTime, trades: to - from + 1, sumR: sum };
}

/** Worst (lowest) Σ R over `k` consecutive trades; the earliest on a tie. Null when fewer than `k` trades. */
export function worstWindow(trades: readonly BtTrade[], k: number): TradeSpan | null {
  if (k < 1 || trades.length < k) return null;
  let sum = 0;
  for (let i = 0; i < k; i++) sum += trades[i]!.r;
  let best = sum;
  let at = 0;
  for (let i = k; i < trades.length; i++) {
    sum += trades[i]!.r - trades[i - k]!.r;
    if (sum < best - 1e-12) {
      best = sum;
      at = i - k + 1;
    }
  }
  return spanOf(trades, at, at + k - 1);
}

/** Longest run of consecutive losing trades (money < 0); the earliest on a tie. */
export function longestLosing(trades: readonly BtTrade[]): TradeSpan | null {
  let bestFrom = -1;
  let bestLen = 0;
  let from = -1;
  for (let i = 0; i <= trades.length; i++) {
    const loss = i < trades.length && trades[i]!.pnl < 0;
    if (loss && from < 0) from = i;
    if (!loss && from >= 0) {
      if (i - from > bestLen) {
        bestLen = i - from;
        bestFrom = from;
      }
      from = -1;
    }
  }
  return bestLen ? spanOf(trades, bestFrom, bestFrom + bestLen - 1) : null;
}

/** Deepest peak-to-trough drop of the cumulative R (the peak may be the start at 0); null without a drop. */
export function drawdownOfR(trades: readonly BtTrade[]): { depth: number; span: TradeSpan } | null {
  let cum = 0;
  let peak = 0;
  let peakAfter = 0; // index of the first trade after the peak
  let depth = 0;
  let from = 0;
  let to = -1;
  for (let i = 0; i < trades.length; i++) {
    cum += trades[i]!.r;
    if (cum > peak) {
      peak = cum;
      peakAfter = i + 1;
    }
    if (peak - cum > depth + 1e-12) {
      depth = peak - cum;
      from = peakAfter;
      to = i;
    }
  }
  return depth > 0 && to >= from ? { depth, span: spanOf(trades, from, to) } : null;
}

/** The loss-series stress test of a trade list; `riskPct` = percent of capital risked per trade (1 = 1 %). */
export function lossStreakStress(trades: readonly BtTrade[], riskPct: number): StreakStress {
  const n = trades.length;
  const dd = drawdownOfR(trades);
  const worst: WindowWorst[] = [];
  for (const k of WORST_KS) {
    const span = worstWindow(trades, k);
    if (span) worst.push({ k, span });
  }
  let mc: McView | null = null;
  let mcNote: string | null = null;
  if (n < MC_MIN_TRADES) {
    mcNote = n ? `Mit ${n} Trades ist die Reihenfolge-Simulation zu grob. Ab ${MC_MIN_TRADES} Trades wird sie gerechnet.` : "Ohne Trades gibt es nichts zu mischen.";
  } else {
    const r = monteCarlo(
      trades.map((t) => t.r),
      { runs: MC_RUNS, seed: MC_SEED, method: "reshuffle" },
    );
    const real = dd?.depth ?? 0;
    const sorted = r.maxDD;
    const atLeast = sorted.filter((d) => d >= real - 1e-9).length / Math.max(1, sorted.length);
    mc = {
      runs: r.runs,
      seed: r.seed,
      ddP50: quantileSorted(sorted, 0.5) ?? 0,
      ddP95: quantileSorted(sorted, 0.95) ?? 0,
      ddP99: quantileSorted(sorted, 0.99) ?? 0,
      shareAtLeastReal: atLeast,
      streakP50: r.longestLoss?.p50 ?? 0,
      streakP95: r.longestLoss?.p95 ?? 0,
    };
  }
  return {
    n,
    sumR: trades.reduce((s, t) => s + t.r, 0),
    longestLosing: longestLosing(trades),
    worstWindows: worst,
    drawdownR: dd,
    drawdownShare: dd && riskPct > 0 ? (dd.depth * riskPct) / 100 : null,
    mc,
    mcNote,
  };
}
