/**
 * Types of the Kaufthese (F69): a long-term investment thesis the person writes, with the numbers behind it (scenarios through
 * the DCF), the conditions that would REFUTE it (checkable thresholds) and the result of the last check against the filed
 * numbers. Everything the person typed is theirs (free text, prices, rates); everything the app computes comes from
 * deterministic functions and carries its source. Nothing here is advice and nothing is traded.
 */

export const THESES_VERSION = 1 as const;
export const MAX_THESES = 30;
export const MAX_VERSIONS = 30;
export const MAX_CRITERIA = 12;
export const MAX_LIST = 12;
export const TEXT_MAX = 4000;
export const ITEM_MAX = 280;
export const NAME_MAX = 60;

export const SCENARIO_KEYS = ["bear", "base", "bull"] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];
export const SCENARIO_NAMES: Readonly<Record<ScenarioKey, string>> = { bear: "Bär", base: "Basis", bull: "Bulle" };

/** The assumptions of one scenario (fractions). `null` = not entered: the scenario then names what is missing instead of computing. */
export interface Scenario {
  growthStart: number | null;
  growthEnd: number | null;
  /** EBIT margin in the last year (it starts at the base margin and moves in a straight line) */
  marginEnd: number | null;
  reinvest: number | null;
  wacc: number | null;
  terminalGrowth: number | null;
  note: string;
}

/** The company's starting numbers for all scenarios: filed (SEC) or typed. */
export interface ThesisBase {
  revenue: number | null;
  ebitMargin: number | null;
  taxRate: number | null;
  netDebt: number | null;
  shares: number | null;
  currency: string;
  /** where these numbers come from, in words ("SEC EDGAR, Quartal bis 27.06.2026, abgerufen 25.10.2026" / "eigene Eingabe") */
  sourceNote: string;
}

/** A price the person typed, with where it is from – without a source there is no comparison with the value. */
export interface PriceInput {
  value: number;
  /** `YYYY-MM-DD` */
  date: string;
  source: string;
}

export const CRITERION_METRICS = ["revenueYoY", "revenueQoQ", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "netIncomeYoY", "epsYoY", "sharesYoY", "freeCashFlow", "netDebt", "epsDiluted"] as const;
export type CriterionMetric = (typeof CRITERION_METRICS)[number];
export const CRITERION_OPS = ["<", "<=", ">", ">="] as const;
export type CriterionOp = (typeof CRITERION_OPS)[number];

/** "The thesis is in question when <metric> <op> <value>." `value`: percent as typed (5 = 5 %), money in millions, EPS in currency units. */
export interface Criterion {
  id: string;
  metric: CriterionMetric;
  op: CriterionOp;
  value: number;
  note: string;
}

export type CriterionStatus = "triggered" | "clear" | "unknown";

export interface CriterionResult {
  id: string;
  status: CriterionStatus;
  /** the value found, in the criterion's unit; `null` when unknown */
  actual: number | null;
  /** why it is unknown (or a remark) */
  note?: string;
}

/** The last check of the criteria against the filed numbers. */
export interface CheckState {
  /** ms epoch of the check */
  at: number;
  /** end of the quarter checked */
  quarterEnd: string | null;
  /** filing date of the report the quarter comes from */
  filed: string | null;
  /** link to the filing (index page of its folder) */
  url: string | null;
  source: string;
  /** SEC's document the numbers were read from */
  sourceUrl: string;
  /** ms epoch the server read SEC */
  fetchedAt: number;
  results: CriterionResult[];
  /** the quarter is newer than the one of the check before */
  newQuarter: boolean;
  /** the person has looked at this result */
  seen: boolean;
}

/** A saved state of the thesis: it never changes afterwards. */
export interface ThesisSnapshot {
  text: string;
  horizonYears: number;
  buyZone: { low: number | null; high: number | null } | null;
  price: PriceInput | null;
  base: ThesisBase;
  scenarios: Record<ScenarioKey, Scenario>;
  criteria: Criterion[];
  catalysts: string[];
  risks: string[];
  counter: string[];
}

export interface ThesisVersion {
  /** unique across devices (`v2-k3f9`) */
  id: string;
  n: number;
  /** ms */
  at: number;
  note: string;
  snapshot: ThesisSnapshot;
  /** the check that triggered saving or was current then */
  check: { quarterEnd: string | null; triggered: number; total: number } | null;
}

export interface Thesis extends ThesisSnapshot {
  id: string;
  /** the company's ticker as the SEC lists it (`AAPL`); empty for a thesis without SEC data */
  ticker: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** date of the next report as the person entered it, with the source they name – the app does not know report dates */
  nextReport: { date: string; source: string } | null;
  /** "Wiedervorlage" – the date the person wants to look at the thesis again */
  reviewAt: string | null;
  /** check the criteria when a new quarter is filed (only while the app is open) */
  monitoring: boolean;
  check: CheckState | null;
  versions: ThesisVersion[];
  /** entries of `criteria` this version cannot read – written back untouched */
  criteriaExtra: unknown[];
  /** keys of the stored entry this version does not know – written back untouched */
  extra: Record<string, unknown>;
}

export interface ThesesCfg {
  v: typeof THESES_VERSION;
  theses: Thesis[];
  /** stored entries this version cannot read – written back untouched */
  rejected: unknown[];
}
