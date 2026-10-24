/**
 * Background optimiser (Hintergrund-Optimierer): shared types. Pure data, no behaviour.
 *
 * Vocabulary
 * - "Strategie" = one rule set of the lab ("Eigene Idee", `CustomConfig`) with its market and cost assumptions.
 * - "Versuch" / trial = one tested variant (a mutated rule set), scored on the walk-forward TEST windows only.
 * - "Vorschlag" = a trial that beat the current version by a margin and survived the checks (plateau, confirmation window,
 *   multiple-testing correction). Only the user turns a proposal into anything (new version, challenger, or reject).
 */
import type { Interval } from "../analytics/stats";
import type { BarsBy, EngineCfg } from "../backtest/types";
import type { CustomConfig, TfId } from "../lab/rules/types";
import type { SignalCfg } from "../signals/config";

export const EVOLVE_VERSION = 1 as const;

/** The kinds of small, explainable steps. One kind = one sentence "Was wurde geändert". */
export const MUTATION_KINDS = [
  "ruleLevel",
  "ruleLength",
  "stopSize",
  "targetR",
  "breakEven",
  "trail",
  "partial",
  "timeStop",
  "exitSwap",
  "addSession",
  "addTrend",
  "addVolatility",
  "addVolume",
  "dropFilter",
  "sides",
] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

export const isMutationKind = (v: unknown): v is MutationKind => typeof v === "string" && (MUTATION_KINDS as readonly string[]).includes(v);

/** What the user sees in lists ("Schwelle einer Regel verschieben"). */
export const KIND_LABEL: Readonly<Record<MutationKind, string>> = {
  ruleLevel: "Schwelle einer Regel verschieben",
  ruleLength: "Länge oder Anzahl einer Regel ändern",
  stopSize: "Stop-Abstand ändern",
  targetR: "Ziel (R) ändern",
  breakEven: "Break-even",
  trail: "Trailing-Stop",
  partial: "Teilgewinn",
  timeStop: "Zeit-Stop",
  exitSwap: "Ausstieg tauschen",
  addSession: "Session-Filter",
  addTrend: "Trend-Filter",
  addVolatility: "Volatilitäts-Filter",
  addVolume: "Volumen-Filter",
  dropFilter: "Filter entfernen",
  sides: "Richtung (Long / Short)",
};

/** Kinds that add, change or remove a FILTER (the "Filter" view of the learning card). */
export const FILTER_KINDS: readonly MutationKind[] = ["addSession", "addTrend", "addVolatility", "addVolume", "dropFilter"];

/** One performed step. */
export interface Step {
  kind: MutationKind;
  /** one plain-language sentence, e.g. „RSI(14) unter 30“ wurde zu „RSI(14) unter 25“. */
  text: string;
}

export interface Mutated {
  config: CustomConfig;
  steps: Step[];
}

// ── numbers of a tested variant ──────────────────────────────────────────────────────────────────────────────

/** Key numbers of a trade list (net of fees, slippage and funding – the engine's R). */
export interface WinMetrics {
  n: number;
  sumR: number;
  avgR: number | null;
  /** 80 % t-interval of Ø R (null under 3 trades) */
  avgRCI: Interval | null;
  winRate: number | null;
  /** largest drop of the cumulative R, in R */
  maxDdR: number;
  /** Σ money of the trades ÷ start capital (windows are not compounded into each other) */
  netPct: number;
  pf: number | null;
}

export interface WindowMs {
  from: number;
  to: number;
}

/** One test window's result of a variant. */
export interface PerWindow {
  n: number;
  sumR: number;
}

export interface Evaluation {
  key: string;
  /** robust score on the test windows; `null` = not qualified (too few trades) */
  score: number | null;
  /** all test windows together */
  test: WinMetrics;
  perWindow: PerWindow[];
  /** the training segment before the first test window (a reference, never the headline) */
  train: { n: number; avgR: number | null };
  freedom: number;
}

// ── the protocol ─────────────────────────────────────────────────────────────────────────────────────────────

export type TrialVia = "baseline" | "mutation" | "restart" | "neighbor";

/** One tested variant in the trial log. `seed` + `i` identify it: the same data and seed reproduce the same sequence. */
export interface LogEntry {
  /** strategy id */
  sid: string;
  /** session seed of the strategy's search */
  seed: number;
  /** number of the trial in the session (0 = the current version) */
  i: number;
  /** ms, stamped when the entry reached the log */
  at: number;
  key: string;
  parent: string | null;
  via: TrialVia;
  kinds: MutationKind[];
  text: string;
  score: number | null;
  n: number;
  avgR: number | null;
}

// ── running a search ─────────────────────────────────────────────────────────────────────────────────────────

export interface EvolveOpts {
  /** consecutive test windows */
  folds: number;
  /** sub-blocks per test window for the multiple-testing series */
  sub: number;
  /** share of the period used as training before the first test window / as confirmation window at the end */
  trainFrac: number;
  holdoutFrac: number;
  /** elite size */
  elite: number;
  /** chance of a random restart (current version + several steps) */
  restartP: number;
  /** trials without a better best score before a run ends as "converged" */
  stagnation: number;
  /** proposals per strategy */
  proposals: number;
  /** bootstrap repetitions of the reality check */
  boot: number;
  /** neighbour checks per proposal */
  neighbors: number;
  /** a proposal must beat the current version's score by this much */
  minGain: number;
}

export interface StrategyInput {
  id: string;
  name: string;
  /** key into `MultiInput.datasets` */
  datasetKey: string;
  base: CustomConfig;
  signal: SignalCfg;
  symbol: string;
  /** first tradable time (ms); bars before it are warm-up */
  fromMs: number;
  engine: EngineCfg;
  /** trials of this run (the current version's evaluation is extra) */
  maxTrials: number;
  /** earlier trials on (mostly) the same data, already weighted by the overlap; they raise the bar of the multiple-testing correction */
  priorTrials: number;
  /** weight per mutation kind (1 = neutral); learned from the user's decisions */
  weights?: Partial<Record<MutationKind, number>>;
}

export interface MultiInput {
  datasets: Record<string, BarsBy>;
  strategies: StrategyInput[];
  seed: number;
  opts?: Partial<EvolveOpts>;
}

export interface LeaderRow {
  key: string;
  rank: number;
  score: number;
  /** score minus the current version's score */
  gain: number;
  n: number;
  avgR: number | null;
  freedom: number;
  /** what differs from the current version, plain language (first lines) */
  changes: string[];
}

export interface StrategySnapshot {
  id: string;
  name: string;
  phase: "prepare" | "search" | "wait" | "check" | "done" | "failed";
  /** trials of this run so far / budget */
  trials: number;
  budget: number;
  /** trials since the best score last improved */
  stagnation: number;
  generation: number;
  base: { score: number | null; n: number; avgR: number | null; freedom: number } | null;
  rows: LeaderRow[];
  /** the sentence of the variant tested last */
  lastText: string | null;
  priorTrials: number;
  error: string | null;
  /** the windows the numbers are measured on (ms) */
  windows: { train: WindowMs; tests: WindowMs[]; holdout: WindowMs } | null;
  /** why the search is limited (e.g. a heavy block in the rules) */
  notes: string[];
}

export interface MultiSnapshot {
  phase: "running" | "stopping" | "check" | "done";
  strategies: StrategySnapshot[];
  trialsDone: number;
  trialsBudget: number;
  progress: number;
}

// ── proposals ────────────────────────────────────────────────────────────────────────────────────────────────

export type Decision = "open" | "saved" | "challenger" | "rejected";

export interface Expected {
  avgR: number | null;
  avgRCI: Interval | null;
  /** net result per 30 days in % of the start capital, from the test windows */
  pctPer30d: number | null;
  n: number;
  days: number;
}

export interface Overfit {
  /** chance that a result at least this good arises by luck alone after all tried variants (0…1) */
  p: number;
  /** the same before the correction for earlier trials */
  pRun: number;
  /** the same without any correction (one single test of this variant) – for contrast */
  pNaive: number | null;
  /** variants of this run (all strategies) / earlier ones (weighted) */
  trialsRun: number;
  trialsPrior: number;
  strategiesInRun: number;
}

export interface Plateau {
  checked: number;
  ok: number;
}

export interface ProposalWindowRow {
  from: number;
  to: number;
  baseN: number;
  baseSumR: number;
  candN: number;
  candSumR: number;
}

export interface HoldoutPair {
  window: WindowMs;
  base: WinMetrics;
  cand: WinMetrics;
}

/** The result of the job, before the app gives it an id and a time. */
export interface ProposalDraft {
  /** strategy id the proposal belongs to */
  sid: string;
  strategyName: string;
  symbol: string;
  interval: TfId;
  seed: number;
  /** `customKey` of the rules the search started from */
  baseKey: string;
  baseConfig: CustomConfig;
  config: CustomConfig;
  key: string;
  kinds: MutationKind[];
  /** v1 → v2 in plain language */
  changes: string[];
  windows: ProposalWindowRow[];
  test: { base: WinMetrics; cand: WinMetrics };
  train: { base: { n: number; avgR: number | null }; cand: { n: number; avgR: number | null } };
  holdout: HoldoutPair | null;
  score: number;
  baseScore: number | null;
  windowsBetter: number;
  overfit: Overfit;
  plateau: Plateau | null;
  freedom: { base: number; cand: number };
  expected: Expected;
  warnings: string[];
  /** candles the numbers were measured on: last closed candle (ms) */
  dataTo: number;
}

export interface StoredProposal extends ProposalDraft {
  id: string;
  createdAt: number;
  decision: Decision;
  decidedAt?: number;
  /** optional reason of a rejection (≤ 200 characters) */
  reason?: string;
  /** what "save as new version" produced, e.g. „Version 3 von Rückkauf“ */
  savedAs?: string;
  /** id of the forward account of "Als Herausforderer live testen" */
  challengerId?: string;
  /** the first non-early verdict of the live check (recorded once, feeds the learning) */
  outcome?: { at: number; level: "confirmed" | "below"; avgR: number | null; pctPer30d: number | null; n: number; days: number };
}

export interface TournamentRow {
  sid: string;
  strategyName: string;
  /** "Jetzige Version" or "Vorschlag k" */
  label: string;
  proposalKey: string | null;
  n: number;
  avgR: number | null;
  sumR: number;
  /** n × √… ranking value; null = too few trades in the confirmation window to rank */
  rankValue: number | null;
  /** chance of luck after ALL strategies and variants (proposals only) */
  p: number | null;
}

export interface StrategyResult {
  id: string;
  reason: "budget" | "converged" | "stopped" | "exhausted" | "failed";
  trials: number;
  dupes: number;
  error: string | null;
  proposals: ProposalDraft[];
  base: { score: number | null; n: number; avgR: number | null } | null;
}

export interface MultiResult {
  strategies: StrategyResult[];
  tournament: TournamentRow[];
  trialsRun: number;
  trialsPrior: number;
}
