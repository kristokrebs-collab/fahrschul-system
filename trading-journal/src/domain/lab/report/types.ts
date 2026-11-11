/**
 * Strategie-Prüfbericht (F18): the typed, serialisable result of `auditRun` – the checks that sit NEXT to the overfitting
 * verdict, walk-forward and parameter stability the Labor already shows (those are linked, not repeated). Pure data, no
 * NaN / Infinity (a missing number is `null`). Every statement carries the sample it rests on.
 */
import type { CoverageRow, LabResult } from "../../backtest/job";
import type { RobustVerdict } from "../../backtest/overfit";

export const AUDIT_VERSION = 1 as const;

export interface OutlierRow {
  /** the k best (or worst) trades by R are taken out */
  k: number;
  kind: "best" | "worst";
  /** Σ R of the removed trades */
  removedSumR: number;
  /** what is left */
  remainN: number;
  remainSumR: number;
  remainAvgR: number | null;
  /** profit factor in money of the rest (null without losses) */
  remainPf: number | null;
  remainNet: number;
  /** the sign of Σ R is different from the full run's */
  flipsSign: boolean;
  /** the removed trades are at least a fifth of all trades: the row says little */
  thin: boolean;
}

/** `tragfaehig` = stays positive without the best 5 · `abhaengig` = turns ≤ 0 · `verlust` = not positive to begin with · `zuwenig` = too few trades to say */
export type OutlierVerdict = "tragfaehig" | "abhaengig" | "verlust" | "zuwenig";

export interface OutlierView {
  n: number;
  sumR: number;
  avgR: number | null;
  pf: number | null;
  net: number;
  rows: OutlierRow[];
  verdict: OutlierVerdict;
  /** one hedged sentence with the numbers */
  text: string;
}

export interface GapSpanView {
  /** ms: end of the last bar before the hole / open of the first bar after it */
  fromMs: number;
  toMs: number;
  missing: number;
}

export interface DataView {
  rows: CoverageRow[];
  interval: string;
  expected: number;
  received: number;
  receivedShare: number | null;
  gaps: number;
  missing: number;
  /** missing ÷ (received + missing) of the execution series, null without bars */
  missingShare: number | null;
  warmupWanted: number;
  warmupGot: number;
  /** the largest holes inside the run's period (≤ 5) */
  spans: GapSpanView[];
  /** holes of the period in total (can exceed `spans`) */
  spanCount: number;
  /** trades that were open across a hole; null when the bars are not at hand */
  tradesOverGap: number | null;
  /** plain sentences */
  notes: string[];
}

export interface SignalsView {
  examined: number;
  /** null = the strategy does not tell */
  edges: number | null;
  conflicts: number | null;
  candidates: number | null;
  blockedByPosition: number | null;
  /** handed to the engine while flat */
  handed: number;
  /** open of the next candle already beyond stop or target · stop too close / no size */
  skippedGap: number;
  skippedRisk: number;
  executed: number;
  /** (skippedGap + skippedRisk) ÷ handed, null without signals */
  skippedShare: number | null;
  /** signals that only became visible AFTER their candle: not measured in the run, excluded by construction */
  late: { n: null; text: string };
}

export interface QuietStretch {
  fromMs: number;
  toMs: number;
  days: number;
  /** share of the period */
  share: number;
}

export interface ThirdView {
  from: number;
  to: number;
  n: number;
  sumR: number;
}

export interface PeriodsView {
  from: number;
  to: number;
  days: number;
  /** the 70 / 30 split: the cut, the out-of-sample share, its trades; `used` = a winner was chosen and traded it */
  oos: { cutTime: number | null; share: number | null; n: number | null; used: boolean };
  /** the rolling windows: how much of the period was traded unseen, how much was only ever training */
  walkForward: { windows: number; testShare: number | null; trainOnlyShare: number | null; emptyWindows: number; testTrades: number } | null;
  /** the longest stretches without any open trade (≤ 3, at least a day) */
  quiet: QuietStretch[];
  /** the period in three equal parts: where the result was made */
  thirds: ThirdView[];
  notes: string[];
}

export interface Audit {
  v: typeof AUDIT_VERSION;
  n: number;
  outliers: OutlierView;
  data: DataView;
  signals: SignalsView;
  periods: PeriodsView;
  /** what the Labor's own robustness verdict says (linked, not recomputed) */
  robust: { verdict: RobustVerdict; text: string; reasons: LabResult["robust"]["reasons"] };
}
