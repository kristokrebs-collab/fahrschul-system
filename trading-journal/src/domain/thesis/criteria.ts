/**
 * "Was würde meine These widerlegen?" – the conditions as checkable thresholds, and their check against the filed numbers of
 * the newest quarter. A criterion is "the thesis is in question when <metric> <op> <value>" (e.g. revenue growth against the
 * year before < 5 %). The check reads the `AnalystResult` of the newest quarter and says `triggered`, `clear` or `unknown` (a
 * number that is not there, or a percentage that would mislead because the base was zero or negative, is `unknown` – never
 * a guess). Pure.
 */
import { archiveFolder } from "@/market/sec/filings";
import type { AnalystResult, QuarterRow, Comparison } from "@/domain/analyst/types";
import { dateDe, money, NO_DATA, perShare } from "@/domain/analyst/fmt";
import { n1 } from "@/lib/format";
import type { CheckState, Criterion, CriterionMetric, CriterionOp, CriterionResult, CriterionStatus, Thesis } from "./types";

export type MetricUnit = "pct" | "money" | "perShare";

export interface MetricDef {
  id: CriterionMetric;
  label: string;
  unit: MetricUnit;
  /** how the unit reads in the input: "%", "Mio.", "je Aktie" */
  unitText: string;
}

export const METRIC_DEFS: readonly MetricDef[] = [
  { id: "revenueYoY", label: "Umsatzwachstum zum Vorjahresquartal", unit: "pct", unitText: "%" },
  { id: "revenueQoQ", label: "Umsatzwachstum zum Vorquartal", unit: "pct", unitText: "%" },
  { id: "grossMargin", label: "Bruttomarge", unit: "pct", unitText: "%" },
  { id: "operatingMargin", label: "Operative Marge", unit: "pct", unitText: "%" },
  { id: "netMargin", label: "Nettomarge", unit: "pct", unitText: "%" },
  { id: "fcfMargin", label: "Marge des freien Cashflows", unit: "pct", unitText: "%" },
  { id: "netIncomeYoY", label: "Nettoergebnis zum Vorjahresquartal", unit: "pct", unitText: "%" },
  { id: "epsYoY", label: "Verwässertes EPS zum Vorjahresquartal", unit: "pct", unitText: "%" },
  { id: "sharesYoY", label: "Aktienzahl zum Vorjahresquartal (Verwässerung)", unit: "pct", unitText: "%" },
  { id: "freeCashFlow", label: "Freier Cashflow des Quartals", unit: "money", unitText: "Mio." },
  { id: "netDebt", label: "Nettoverschuldung", unit: "money", unitText: "Mio." },
  { id: "epsDiluted", label: "Verwässertes EPS des Quartals", unit: "perShare", unitText: "je Aktie" },
];

export const metricDef = (id: CriterionMetric): MetricDef => METRIC_DEFS.find((m) => m.id === id)!;

const PCT_WHY = "Vergleichswert fehlt oder ist null oder negativ – ein Prozentwert wäre irreführend";

/** The value of a metric for a quarter in the unit of the criterion (percent as 5 = 5 %, money in millions), or why there is none. */
export function metricValue(metric: CriterionMetric, q: QuarterRow, c: Comparison): { value: number | null; why?: string } {
  const pctOf = (d: { pct: number | null } | undefined | null): { value: number | null; why?: string } => (d && d.pct != null ? { value: d.pct * 100 } : { value: null, why: PCT_WHY });
  const frac = (f: number | null): { value: number | null; why?: string } => (f != null ? { value: f * 100 } : { value: null, why: "nicht in den Daten" });
  switch (metric) {
    case "revenueYoY":
      return pctOf(c.yoy.revenue);
    case "revenueQoQ":
      return pctOf(c.qoq.revenue);
    case "netIncomeYoY":
      return pctOf(c.yoy.netIncome);
    case "epsYoY":
      return pctOf(c.yoy.epsDiluted);
    case "sharesYoY":
      return pctOf(c.yoy.sharesDiluted);
    case "grossMargin":
      return frac(q.grossMargin);
    case "operatingMargin":
      return frac(q.operatingMargin);
    case "netMargin":
      return frac(q.netMargin);
    case "fcfMargin":
      return frac(q.fcfMargin);
    case "freeCashFlow":
      return q.freeCashFlow ? { value: q.freeCashFlow.value / 1e6 } : { value: null, why: "nicht in den Daten" };
    case "netDebt":
      return q.netDebt != null ? { value: q.netDebt / 1e6 } : { value: null, why: "nicht in den Daten" };
    case "epsDiluted":
      return q.epsDiluted ? { value: q.epsDiluted.value } : { value: null, why: "nicht in den Daten" };
  }
}

export function holds(op: CriterionOp, actual: number, threshold: number): boolean {
  switch (op) {
    case "<":
      return actual < threshold;
    case "<=":
      return actual <= threshold;
    case ">":
      return actual > threshold;
    case ">=":
      return actual >= threshold;
  }
}

const OP_WORDS: Record<CriterionOp, string> = { "<": "unter", "<=": "höchstens", ">": "über", ">=": "mindestens" };

/** The condition in a sentence: "Umsatzwachstum zum Vorjahresquartal unter 5 %". */
export function criterionText(c: Pick<Criterion, "metric" | "op" | "value">): string {
  const d = metricDef(c.metric);
  return `${d.label} ${OP_WORDS[c.op]} ${n1(c.value).replace(/,0$/, "")} ${d.unitText}`;
}

/** An actual value as text in the criterion's unit. */
export function actualText(metric: CriterionMetric, actual: number | null, currency: string): string {
  if (actual == null) return NO_DATA;
  const d = metricDef(metric);
  if (d.unit === "pct") return `${n1(actual)} %`;
  if (d.unit === "money") return money(actual * 1e6, currency);
  return perShare(actual, currency);
}

export interface CriterionEval extends CriterionResult {
  metric: CriterionMetric;
  /** "Ausgelöst: Umsatzwachstum … ist 3,2 % (Bedingung: unter 5 %)" */
  text: string;
}

/** Each criterion against the newest quarter of `result`. */
export function evaluateCriteria(criteria: readonly Criterion[], result: AnalystResult): CriterionEval[] {
  const q = result.quarters[0];
  const c = result.comparisons[0];
  return criteria.map((cr): CriterionEval => {
    const cond = criterionText(cr);
    if (!q || !c) return { id: cr.id, metric: cr.metric, status: "unknown", actual: null, note: "keine Quartalszahlen in den Daten", text: `Keine Daten: ${cond}.` };
    const { value, why } = metricValue(cr.metric, q, c);
    if (value == null) return { id: cr.id, metric: cr.metric, status: "unknown", actual: null, ...(why ? { note: why } : {}), text: `Keine Daten für das Quartal bis ${dateDe(q.end)}: ${cond}.${why ? ` (${why})` : ""}` };
    const hit = holds(cr.op, value, cr.value);
    const status: CriterionStatus = hit ? "triggered" : "clear";
    return { id: cr.id, metric: cr.metric, status, actual: value, text: `${hit ? "Ausgelöst" : "Nicht ausgelöst"}: ${metricDef(cr.metric).label} ist ${actualText(cr.metric, value, result.currency)} (Bedingung: ${cond.slice(metricDef(cr.metric).label.length + 1)}), Quartal bis ${dateDe(q.end)}.` };
  });
}

/** The check state to store: results plus where and when the numbers are from. `previous` decides whether the quarter is new. */
export function checkThesis(thesis: Thesis, result: AnalystResult, now: number): CheckState {
  const q = result.quarters[0] ?? null;
  const evals = evaluateCriteria(thesis.criteria, result);
  const accn = q?.revenue?.accn ?? q?.netIncome?.accn ?? null;
  const prevEnd = thesis.check?.quarterEnd ?? null;
  return {
    at: now,
    quarterEnd: q?.end ?? null,
    filed: q?.revenue?.filed ?? q?.netIncome?.filed ?? null,
    url: accn && result.cik ? `${archiveFolder(result.cik, accn)}${accn}-index.htm` : null,
    source: result.stamp.source,
    sourceUrl: result.stamp.sourceUrl,
    fetchedAt: result.stamp.fetchedAt,
    results: evals.map(({ id, status, actual, note }) => ({ id, status, actual, ...(note ? { note } : {}) })),
    newQuarter: !!q && prevEnd != null && q.end > prevEnd,
    seen: false,
  };
}

/** Whether a stored check should be repeated: never checked, or the last one is older than `maxAgeMs`. */
export function checkDue(thesis: Pick<Thesis, "monitoring" | "ticker" | "criteria" | "check">, now: number, maxAgeMs = 24 * 3_600_000): boolean {
  if (!thesis.monitoring || !thesis.ticker || !thesis.criteria.length) return false;
  return !thesis.check || now - thesis.check.at >= maxAgeMs;
}
