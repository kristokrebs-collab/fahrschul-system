/**
 * Types of the earnings analyst (F68). Everything here is a NUMBER THE COMPANY FILED or plain arithmetic on such numbers; a
 * missing number is `null` ("keine Daten"), never an estimate. See `README.md` for how the XBRL oddities are handled.
 */
import type { ConceptKey, SecFiling } from "@/market/sec/wire";
import type { FlowMetric, Metric } from "@/market/sec/concepts";

/** How a quarter value that is not tagged as a 3-month value was obtained. */
export type Derivation =
  /** cumulative value of the 10-Q (6 or 9 months) minus the cumulative value before it */
  | "ytd-diff"
  /** full year (10-K) minus the 9-month value of the third 10-Q */
  | "fy-minus-9m"
  /** full year minus the sum of the three single quarters */
  | "fy-minus-quarters"
  /** arithmetic on other cells of the same quarter (gross profit = revenue − cost of revenue, free cash flow = cash flow − capex) */
  | "calc";

/** One number of one quarter with its origin. */
export interface Cell {
  value: number;
  /** `null` = tagged by the company as exactly this period */
  derived: Derivation | null;
  /** the XBRL concept (`null` for a `calc` cell) */
  concept: ConceptKey | null;
  /** the filing the value comes from (the newest one that reports the period) */
  accn: string;
  filed: string;
  /** a later filing reported a different number for the same period: the first value and when it was filed */
  revised: { original: number; originalFiled: string } | null;
  /** derived from per-share or average values (EPS): the sum of parts is only close */
  approx: boolean;
  /** an input of a derived value was restated by a later filing (the pieces may not match exactly) */
  inputsRevised: boolean;
}

/** A change against a base: absolute and, where it is meaningful, relative. */
export interface Delta {
  abs: number;
  /** fraction (0.255 = +25,5 %); `null` when the base is zero or negative (a percentage would mislead) */
  pct: number | null;
  /** why `pct` is empty */
  note?: "base-zero" | "base-negative";
}

export interface DebtPart {
  label: string;
  concept: ConceptKey;
  value: number;
}

/** Financial debt at a balance-sheet date, as the sum of the debt items the company tagged (leases are NOT included). */
export interface DebtCell {
  value: number;
  parts: DebtPart[];
  /** false when the current portion of the long-term debt was not tagged (the sum is then a lower bound) */
  complete: boolean;
}

export interface QuarterRow {
  /** last day of the quarter, `YYYY-MM-DD` */
  end: string;
  start: string;
  /** the company's own fiscal numbering (`null` when no filing says it) */
  fiscalYear: number | null;
  fiscalQuarter: 1 | 2 | 3 | 4 | null;
  /** the calendar quarter by the middle of the period (a quarter ending 2023-04-01 is calendar Q1) */
  calendar: { year: number; q: 1 | 2 | 3 | 4 };
  /** at least one figure of the row was derived (Q4, or a cumulative 10-Q value) */
  derived: boolean;

  revenue: Cell | null;
  costOfRevenue: Cell | null;
  grossProfit: Cell | null;
  operatingIncome: Cell | null;
  netIncome: Cell | null;
  epsDiluted: Cell | null;
  sharesDiluted: Cell | null;
  operatingCashFlow: Cell | null;
  capex: Cell | null;
  freeCashFlow: Cell | null;
  depreciation: Cell | null;
  incomeTax: Cell | null;
  pretaxIncome: Cell | null;

  /** balance sheet at `end` */
  cash: number | null;
  shortTermInvestments: number | null;
  debt: DebtCell | null;
  /** debt − cash − short-term investments; `null` when debt or cash is missing */
  netDebt: number | null;

  /** fractions (0.5 = 50 %) */
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;

  /** the quarter before and the same quarter a year earlier (ends); `null` = not in the data */
  prevEnd: string | null;
  yearAgoEnd: string | null;
  /** the earnings 8-K filed after this quarter (nearest within 100 days), by date – `null` when none is in the list */
  earnings8k: SecFiling | null;
}

/** The values of a row that a comparison, a criterion or a sentence can use. */
export const COMPARE_METRICS = ["revenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted", "operatingCashFlow", "freeCashFlow", "sharesDiluted"] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export interface Comparison {
  qoq: Partial<Record<CompareMetric, Delta>>;
  yoy: Partial<Record<CompareMetric, Delta>>;
  /** change of the margins in percentage points (fractions: 0.012 = 1,2 points) */
  marginQoq: { gross: number | null; operating: number | null; net: number | null; fcf: number | null };
  marginYoy: { gross: number | null; operating: number | null; net: number | null; fcf: number | null };
  /** change of debt / net debt / cash against the quarter before and a year earlier */
  debtQoq: Delta | null;
  debtYoy: Delta | null;
  netDebtQoq: Delta | null;
  netDebtYoy: Delta | null;
}

/** The last four quarters in a row (only when all four exist for the figure). */
export interface Ttm {
  /** end of the newest quarter of the four */
  end: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  depreciation: number | null;
  incomeTax: number | null;
  pretaxIncome: number | null;
}

export type NoteKind = "derived" | "restated" | "lag" | "missing" | "oneoff" | "currency" | "stale" | "old" | "consensus" | "mixed" | "seasonal";

export interface Note {
  kind: NoteKind;
  text: string;
  /** where to read it (a filing) */
  url?: string;
}

/** One sentence of "what changed". */
export interface ChangeLine {
  id: string;
  group: "quarter" | "growth" | "margin" | "profit" | "cash" | "debt" | "shares" | "caution";
  text: string;
}

export interface AnalystResult {
  ticker: string;
  cik: string;
  entity: string;
  /** the currency the amounts are in as the company filed them */
  currency: string;
  /** newest quarter first */
  quarters: QuarterRow[];
  /** change of each quarter against the quarter before and the year before, aligned with `quarters` */
  comparisons: Comparison[];
  ttm: Ttm | null;
  changes: ChangeLine[];
  notes: Note[];
  /** which concepts the numbers come from, per metric (a company can switch concepts over the years) */
  concepts: Partial<Record<Metric, ConceptKey[]>>;
  /** the newest cover-page share count (all classes may not be included) */
  coverShares: { value: number; asOf: string } | null;
  /** consensus / expectations are not available in free data – the result says so instead of leaving it out */
  consensus: { available: false; text: string };
  /** the stamp for the card: where and when */
  stamp: { source: string; sourceUrl: string; asOf: string | null; fetchedAt: number; stale: boolean };
}

export type { FlowMetric };
