/**
 * A lab run as the overview's backtest reference (P07, pure): `settings.backtest` keeps its exact meaning – win rate
 * (fraction) and the leverage-free price moves of winners, losers and all trades (fractions, losers negative), the
 * same numbers `backtestCompare` computes for the trader's own trades – so `BacktestCompare` runs unchanged.
 */
import type { BacktestReference } from "../types";
import type { RunStats } from "./metrics";

export const STRATEGY_TITLE: Readonly<Record<string, string>> = { box: "Box-zu-Box", mcb: "MCB-Leiter", rules: "Regel-Baukasten" };

/** Short label ("Labor · Box-zu-Box 4h · BTCUSDT · 86 Trades"), at most 60 characters. */
export function referenceLabel(x: { strategy: string; interval: string; symbol: string; n: number }): string {
  const s = `Labor · ${STRATEGY_TITLE[x.strategy] ?? x.strategy} ${x.interval === "1d" ? "1D" : x.interval} · ${x.symbol} · ${x.n} Trades`;
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/** Null when the run has no winner or no loser (the reference needs both averages). */
export function toBacktestReference(stats: RunStats, label: string): BacktestReference | null {
  if (!stats.n || stats.winRate == null || stats.moveWin == null || stats.moveLoss == null || stats.moveExp == null) return null;
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  return { winRate: r4(stats.winRate), avgWin: r4(stats.moveWin), avgLoss: r4(stats.moveLoss), expectancy: r4(stats.moveExp), label };
}
