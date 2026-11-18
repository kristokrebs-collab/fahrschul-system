/**
 * Kosten- und Belastungstest (F20): the typed, serialisable result. Pure data – no functions, no NaN / Infinity (a missing
 * number is `null`), so it crosses the worker boundary and can be stored or handed on as JSON.
 */
export const STRESS_VERSION = 1 as const;

export type ScenarioId = "base" | "fees2" | "slip2" | "fundOff" | "fundOn" | "fund2" | "delay1" | "stopTight" | "stopWide" | "combined";

export type ScenarioGroup = "base" | "costs" | "funding" | "timing" | "stop" | "combined";

/**
 * `ok` = computed exactly as named · `approx` = computed with a stated substitute because the run lacks the data (the note
 * says which) · `unavailable` = not computed, the note says why.
 */
export type ScenarioStatus = "ok" | "approx" | "unavailable";

/** The numbers of one scenario run; `pf` is null without losses (∞) or without trades. */
export interface ScenarioStats {
  n: number;
  sumR: number;
  avgR: number | null;
  winRate: number | null;
  pf: number | null;
  /** largest drop of the marked-to-market equity from its running peak (fraction) */
  maxDD: number;
  net: number;
  netPct: number;
}

export interface ScenarioRow {
  id: ScenarioId;
  label: string;
  group: ScenarioGroup;
  status: ScenarioStatus;
  note: string | null;
  stats: ScenarioStats | null;
  /** change against the base run (null for the base and for unavailable rows) */
  dSumR: number | null;
  dMaxDD: number | null;
  dPf: number | null;
  dN: number | null;
}

/** The scenario table of one run. */
export interface StressRows {
  v: typeof STRESS_VERSION;
  rows: ScenarioRow[];
}

/** A stretch of consecutive trades in the order they happened. */
export interface TradeSpan {
  /** index of the first / last trade of the stretch (0-based) */
  from: number;
  to: number;
  /** ms: entry of the first trade, exit of the last */
  fromTime: number;
  toTime: number;
  trades: number;
  /** Σ R of the stretch */
  sumR: number;
}

export interface WindowWorst {
  /** number of consecutive trades */
  k: number;
  span: TradeSpan;
}

export interface McView {
  runs: number;
  seed: number;
  /** drawdown in R of the reshuffled order: median / 95 % / 99 % of the paths */
  ddP50: number;
  ddP95: number;
  ddP99: number;
  /** share of the paths whose drawdown is at least the real one (the real order's place in the distribution) */
  shareAtLeastReal: number;
  /** longest losing streak per path: median / 95 % */
  streakP50: number;
  streakP95: number;
}

/** Loss-series stress test from the REAL trade order. */
export interface StreakStress {
  n: number;
  /** Σ R of all trades */
  sumR: number;
  /** longest run of consecutive losers and its Σ R (null without a loser) */
  longestLosing: TradeSpan | null;
  /** worst Σ R over k consecutive trades, for the k that fit */
  worstWindows: WindowWorst[];
  /** deepest peak-to-trough drop of the cumulative R in the real order (null without trades) */
  drawdownR: { depth: number; span: TradeSpan } | null;
  /** the same depth as a share of the capital at the run's risk per trade, no compounding (fraction) */
  drawdownShare: number | null;
  /** order Monte Carlo; null when n is below `MC_MIN_TRADES` */
  mc: McView | null;
  /** why `mc` is missing */
  mcNote: string | null;
}
