/**
 * "Warum so schwach?" (F73): the typed, serialisable result of `diagnoseRun`. Pure data – no functions, no NaN / Infinity
 * (missing numbers are `null`), so it can be stored, shown in the Labor and handed to the AI assistant as JSON.
 *
 * Every `Finding` is an OBSERVATION with the numbers it rests on (`evidence`), never a proven cause.
 */
import type { CoverageRow, LabStrategyId, VariantLite } from "../../backtest/job";
import type { SlippageModel } from "../../backtest/types";
import type { CustomConfig } from "../rules/types";

export const DIAGNOSIS_VERSION = 1 as const;

/** What the run was computed with (the part of the lab set-up the diagnosis needs). */
export interface DiagnoseCfg {
  strategy: LabStrategyId;
  /** costs of the run */
  costs: { exchange: string; makerBps: number; takerBps: number; slippage: SlippageModel; funding: "history" | "flat" | "none" };
  capital: number;
  /** percent per trade (1 = 1 %) */
  riskPct: number;
  maxLeverage: number;
  /** the custom idea (plain-language finding texts); absent for the templates */
  custom?: CustomConfig | null;
}

/** The bars of the run: the execution bars in the index space of the trades (`LabResult.trades[].entryIndex`). */
export interface DiagnoseData {
  bars: readonly { t: number; o: number; h: number; l: number; c: number; v?: number }[];
}

export type Severity = "high" | "medium" | "info";

export interface Evidence {
  label: string;
  value: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  /** short headline */
  title: string;
  /** one or two sentences: the observation with its numbers, hedged where it is only a hint */
  text: string;
  evidence: Evidence[];
}

export type SampleLevel = "none" | "tiny" | "small" | "ok" | "good";

export interface CoverageView {
  rows: CoverageRow[];
  /** bars of the period that should exist / that do / the share, holes of the execution series */
  expected: number;
  received: number;
  receivedShare: number | null;
  gaps: number;
  missing: number;
  /** warm-up bars before the period: wanted by the strategy / found */
  warmupWanted: number;
  warmupGot: number;
  warmupOk: boolean;
}

export interface FunnelStageView {
  id: string;
  label: string;
  count: number;
  /** bars with not enough data (rule rows) */
  unknown?: number;
  /** nesting level of the rule rows */
  depth?: number;
  kind: "stage" | "side" | "group" | "leaf" | "loss";
}

export interface CostView {
  /** sums over all trades in money: result without any cost / after fees / slippage / funding (costs positive) */
  gross: number;
  fees: number;
  slippage: number;
  funding: number;
  net: number;
  /** costs ÷ |gross|, null when gross is ~0 */
  costShare: number | null;
  /** Ø and median cost per trade in R (cost ÷ planned risk) */
  avgCostR: number | null;
  medCostR: number | null;
  /** Σ R without costs / with */
  grossR: number;
  netR: number;
}

export interface ExitRow {
  reason: string;
  label: string;
  n: number;
  share: number;
  avgR: number | null;
  sumR: number;
  winShare: number | null;
}

export interface SideRow {
  side: "long" | "short";
  n: number;
  winRate: number | null;
  avgR: number | null;
  net: number;
}

export interface BucketRow {
  key: number;
  label: string;
  n: number;
  avgR: number | null;
  winRate: number | null;
}

export interface PayoffView {
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  medWinR: number | null;
  medLossR: number | null;
  avgR: number | null;
  medR: number | null;
  /** win rate at which Ø win × p = Ø loss × (1 − p) */
  breakEvenWinRate: number | null;
  /** the three best trades' R as a share of the total R (null when the total is not positive) */
  top3Share: number | null;
}

export interface ExcursionView {
  /** median stop distance in ATR(14) of the signal bar / in percent of the entry */
  stopAtrMed: number | null;
  stopPctMed: number | null;
  /** median MFE / MAE in R of all trades / of the losers */
  mfeMed: number | null;
  maeMed: number | null;
  loserMfeMed: number | null;
  /** share of losers that were at least +1 R / +0,5 R in profit at some point */
  losersReached1R: number | null;
  losersReachedHalfR: number | null;
  /** share of the losing stop-outs that happened within 3 candles */
  quickStopShare: number | null;
  quickStopN: number;
  stopLosses: number;
}

export interface CompareRow {
  id: string;
  label: string;
  kind: "base" | VariantLite["kind"];
  n: number;
  avgR: number | null;
  sumR: number;
  net: number;
  winRate: number | null;
  /** Ø R minus the base's Ø R (null for the base) */
  deltaAvgR: number | null;
}

export interface SampleView {
  n: number;
  level: SampleLevel;
  /** plain notes: what the number of trades does and does not allow */
  warnings: string[];
}

export interface Diagnosis {
  v: typeof DIAGNOSIS_VERSION;
  strategy: LabStrategyId;
  n: number;
  coverage: CoverageView;
  funnel: FunnelStageView[];
  costs: CostView;
  exits: ExitRow[];
  sides: SideRow[];
  byHour: BucketRow[];
  byWeekday: BucketRow[];
  payoff: PayoffView;
  excursion: ExcursionView;
  /** trades whose stop bar also held a take-profit (the engine took the stop) */
  ambiguous: { n: number; share: number | null };
  sample: SampleView;
  compare: CompareRow[];
  /** ranked: high before medium before info, then by size */
  findings: Finding[];
}
