/**
 * The earnings analyst: reduced SEC facts (`SecFactsPayload`) → the last quarters with revenue, margins, profit, EPS, cash flow,
 * debt and share count, each against the quarter before and the year before, and the sentences "what changed".
 *
 * Deterministic and honest: a number that the company did not file (or that cannot be derived from filed numbers) is `null`
 * and shows as "keine Daten"; nothing is estimated, interpolated or carried over. There is NO consensus here (free data has
 * none): the result says "kein Konsens, nur gemeldete Zahlen" instead of leaving the question open.
 */
import { calendarQuarter, daysBetween } from "@/market/sec/days";
import { METRIC_CONCEPTS, METRIC_KIND, type FlowMetric, type Metric, type PointMetric } from "@/market/sec/concepts";
import { SEC_SOURCE_LABEL, type ConceptKey, type FactSeries, type SecFactsPayload, type SecFilingsPayload } from "@/market/sec/wire";
import { buildChanges, buildNotes } from "./changes";
import { instantValues, flowQuarters, type QuarterRaw } from "./periods";
import { CONSENSUS_TEXT } from "./texts";
import type { AnalystResult, Cell, Comparison, CompareMetric, DebtCell, DebtPart, Delta, QuarterRow, Ttm } from "./types";
import { COMPARE_METRICS } from "./types";

export const DEFAULT_QUARTERS = 8;

export interface AnalyseOptions {
  /** how many quarters the result lists (default 8; comparisons use all that exist) */
  quarters?: number;
  /** the filings list of the same company: matches each quarter to its earnings 8-K and detects lagging facts */
  filings?: SecFilingsPayload | null;
  /** epoch ms "now" (tests); default `Date.now()` */
  now?: number;
}

/** `cur` against `base`; a percentage only for a positive base (a base of zero or below would mislead). */
export function deltaOf(cur: number | null | undefined, base: number | null | undefined): Delta | null {
  if (cur == null || base == null || !Number.isFinite(cur) || !Number.isFinite(base)) return null;
  const abs = cur - base;
  if (base === 0) return { abs, pct: null, note: "base-zero" };
  if (base < 0) return { abs, pct: null, note: "base-negative" };
  return { abs, pct: abs / base };
}

const diff = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : a - b);
const ratio = (part: number | null | undefined, whole: number | null | undefined): number | null => (part == null || whole == null || !(whole > 0) ? null : part / whole);

const FLOW_OPTS: Record<FlowMetric, { derive: boolean; approx: boolean }> = {
  revenue: { derive: true, approx: false },
  costOfRevenue: { derive: true, approx: false },
  grossProfit: { derive: true, approx: false },
  operatingIncome: { derive: true, approx: false },
  pretaxIncome: { derive: true, approx: false },
  incomeTax: { derive: true, approx: false },
  netIncome: { derive: true, approx: false },
  epsDiluted: { derive: true, approx: true },
  // weighted averages are not additive: a Q4 average cannot be "year minus nine months"
  sharesDiluted: { derive: false, approx: false },
  operatingCashFlow: { derive: true, approx: false },
  capex: { derive: true, approx: false },
  depreciation: { derive: true, approx: false },
};

const FLOW_METRIC_LIST = Object.keys(FLOW_OPTS) as FlowMetric[];

interface Merged {
  byEnd: Map<string, QuarterRaw>;
  concepts: ConceptKey[];
}

/** The unit every amount must have: the currency of the first revenue-like series, else of any money series, else USD. */
function currencyOf(facts: Record<ConceptKey, FactSeries>): string {
  for (const metric of ["revenue", "netIncome", "operatingIncome", "operatingCashFlow"] as const) {
    for (const c of METRIC_CONCEPTS[metric]) {
      const u = facts[c]?.unit;
      if (u && /^[A-Z]{3}$/.test(u)) return u;
    }
  }
  return "USD";
}

const unitOk = (metric: Metric, unit: string, cur: string): boolean => {
  const kind = METRIC_KIND[metric];
  return kind === "money" ? unit === cur : kind === "perShare" ? unit === `${cur}/shares` : unit === "shares";
};

function mergeFlow(metric: FlowMetric, facts: Record<ConceptKey, FactSeries>, cur: string, skipped: string[]): Merged {
  const byEnd = new Map<string, QuarterRaw>();
  const concepts: ConceptKey[] = [];
  for (const concept of METRIC_CONCEPTS[metric]) {
    const s = facts[concept];
    if (!s) continue;
    if (!unitOk(metric, s.unit, cur)) {
      skipped.push(`${concept.replace(/^.*:/, "")} (${s.unit})`);
      continue;
    }
    const q = flowQuarters(s.rows, concept, FLOW_OPTS[metric]);
    let added = false;
    for (const [end, v] of q) {
      if (!byEnd.has(end)) {
        byEnd.set(end, v);
        added = true;
      }
    }
    if (added) concepts.push(concept);
  }
  return { byEnd, concepts };
}

interface PointVal {
  value: number;
  concept: ConceptKey;
}

function mergePoint(metric: PointMetric, facts: Record<ConceptKey, FactSeries>, cur: string): { byEnd: Map<string, PointVal>; concepts: ConceptKey[] } {
  const byEnd = new Map<string, PointVal>();
  const concepts: ConceptKey[] = [];
  for (const concept of METRIC_CONCEPTS[metric]) {
    const s = facts[concept];
    if (!s || !unitOk(metric, s.unit, cur)) continue;
    let added = false;
    for (const [end, v] of instantValues(s.rows)) {
      if (!byEnd.has(end)) {
        byEnd.set(end, { value: v.value, concept });
        added = true;
      }
    }
    if (added) concepts.push(concept);
  }
  return { byEnd, concepts };
}

const calcCell = (value: number, a: Cell, b: Cell): Cell => ({ value, derived: "calc", concept: null, accn: a.accn, filed: a.filed > b.filed ? a.filed : b.filed, revised: null, approx: a.approx || b.approx, inputsRevised: a.revised !== null || b.revised !== null || a.inputsRevised || b.inputsRevised });

/** Financial debt at a day from the debt items the company tagged: see `README.md` ("Verschuldung") for the rule. Leases are not included. */
export function debtAt(end: string, p: { total: Map<string, PointVal>; noncurrent: Map<string, PointVal>; current: Map<string, PointVal>; currentAlt: Map<string, PointVal>; shortTerm: Map<string, PointVal>; paper: Map<string, PointVal> }): DebtCell | null {
  const parts: DebtPart[] = [];
  const add = (label: string, m: Map<string, PointVal>): boolean => {
    const v = m.get(end);
    if (!v) return false;
    parts.push({ label, concept: v.concept, value: v.value });
    return true;
  };
  let complete = true;
  if (add("Langfristige Schulden inkl. kurzfristigem Teil", p.total)) {
    add("Commercial Paper", p.paper);
    add("Kurzfristige Kredite", p.shortTerm);
  } else if (add("Langfristige Schulden (ohne kurzfristigen Teil)", p.noncurrent)) {
    if (add("Kurzfristiger Teil langfristiger Schulden", p.current)) {
      add("Commercial Paper", p.paper);
      add("Kurzfristige Kredite", p.shortTerm);
    } else if (!add("Kurzfristige Schulden", p.currentAlt)) {
      // "DebtCurrent" already contains commercial paper and short-term borrowings, so they are only added when it is missing
      complete = false;
      add("Commercial Paper", p.paper);
      add("Kurzfristige Kredite", p.shortTerm);
    }
  } else {
    // no long-term debt item at all: better no number than a half one
    return null;
  }
  return { value: parts.reduce((s, x) => s + x.value, 0), parts, complete };
}

/** The row `days` before (±slack) closest to `target` days back, searched in a list sorted newest first. */
function nearest(rows: readonly { end: string }[], end: string, target: number, slack: number): string | null {
  let best: { gap: number; end: string } | null = null;
  for (const r of rows) {
    const back = daysBetween(r.end, end);
    const gap = Math.abs(back - target);
    if (back > 0 && gap <= slack && (!best || gap < best.gap)) best = { gap, end: r.end };
  }
  return best ? best.end : null;
}

function fillFiscalLabels(rows: QuarterRow[]): void {
  const asc = [...rows].sort((a, b) => a.end.localeCompare(b.end));
  const step = (from: QuarterRow, forward: boolean): { y: number; q: 1 | 2 | 3 | 4 } | null => {
    if (from.fiscalYear == null || from.fiscalQuarter == null) return null;
    if (forward) return from.fiscalQuarter === 4 ? { y: from.fiscalYear + 1, q: 1 } : { y: from.fiscalYear, q: (from.fiscalQuarter + 1) as 2 | 3 | 4 };
    return from.fiscalQuarter === 1 ? { y: from.fiscalYear - 1, q: 4 } : { y: from.fiscalYear, q: (from.fiscalQuarter - 1) as 1 | 2 | 3 };
  };
  for (const pass of [true, false]) {
    const list = pass ? asc : [...asc].reverse();
    for (let i = 1; i < list.length; i++) {
      const r = list[i]!;
      const p = list[i - 1]!;
      if (r.fiscalQuarter != null) continue;
      const gap = Math.abs(daysBetween(p.end, r.end));
      if (gap < 70 || gap > 115) continue;
      const s = step(p, pass);
      if (s) {
        r.fiscalYear = s.y;
        r.fiscalQuarter = s.q;
      }
    }
  }
}

/** The newest cover-page share count (the first concept that has one). */
function coverSharesOf(facts: Record<ConceptKey, FactSeries>): AnalystResult["coverShares"] {
  for (const c of METRIC_CONCEPTS.sharesOutstanding) {
    const s = facts[c];
    if (!s || s.unit !== "shares") continue;
    let best: FactSeries["rows"][number] | null = null;
    for (const r of s.rows) if (!best || r.end > best.end || (r.end === best.end && r.filed > best.filed)) best = r;
    if (best) return { value: best.val, asOf: best.end };
  }
  return null;
}

export function analyse(payload: SecFactsPayload, opts: AnalyseOptions = {}): AnalystResult {
  const facts = payload.facts;
  const cur = currencyOf(facts);
  const skippedUnits: string[] = [];
  const flows = {} as Record<FlowMetric, Merged>;
  for (const m of FLOW_METRIC_LIST) flows[m] = mergeFlow(m, facts, cur, skippedUnits);
  const points = {
    cash: mergePoint("cash", facts, cur),
    shortTermInvestments: mergePoint("shortTermInvestments", facts, cur),
    total: mergePoint("debtTotal", facts, cur),
    noncurrent: mergePoint("debtNoncurrent", facts, cur),
    current: mergePoint("debtCurrent", facts, cur),
    currentAlt: mergePoint("debtCurrentAlt", facts, cur),
    shortTerm: mergePoint("shortTermBorrowings", facts, cur),
    paper: mergePoint("commercialPaper", facts, cur),
  };
  const used: Partial<Record<Metric, ConceptKey[]>> = {};
  for (const m of FLOW_METRIC_LIST) if (flows[m].concepts.length) used[m] = flows[m].concepts;
  const pointMetric: Record<keyof typeof points, PointMetric> = { cash: "cash", shortTermInvestments: "shortTermInvestments", total: "debtTotal", noncurrent: "debtNoncurrent", current: "debtCurrent", currentAlt: "debtCurrentAlt", shortTerm: "shortTermBorrowings", paper: "commercialPaper" };
  for (const k of Object.keys(points) as (keyof typeof points)[]) if (points[k].concepts.length) used[pointMetric[k]] = points[k].concepts;

  const coverShares = coverSharesOf(facts);

  const ends = [...new Set([...flows.revenue.byEnd.keys(), ...flows.netIncome.byEnd.keys(), ...flows.epsDiluted.byEnd.keys()])].sort().reverse();
  const cell = (m: FlowMetric, end: string): Cell | null => flows[m].byEnd.get(end)?.cell ?? null;

  const rows: QuarterRow[] = ends.map((end) => {
    const base = flows.revenue.byEnd.get(end) ?? flows.netIncome.byEnd.get(end) ?? flows.epsDiluted.byEnd.get(end) ?? FLOW_METRIC_LIST.map((m) => flows[m].byEnd.get(end)).find(Boolean)!;
    const revenue = cell("revenue", end);
    const cost = cell("costOfRevenue", end);
    let grossProfit = cell("grossProfit", end);
    if (!grossProfit && revenue && cost) grossProfit = calcCell(revenue.value - cost.value, revenue, cost);
    const ocf = cell("operatingCashFlow", end);
    const capex = cell("capex", end);
    const fcf = ocf && capex ? calcCell(ocf.value - Math.abs(capex.value), ocf, capex) : null;
    const operatingIncome = cell("operatingIncome", end);
    const netIncome = cell("netIncome", end);
    const debt = debtAt(end, { total: points.total.byEnd, noncurrent: points.noncurrent.byEnd, current: points.current.byEnd, currentAlt: points.currentAlt.byEnd, shortTerm: points.shortTerm.byEnd, paper: points.paper.byEnd });
    const cash = points.cash.byEnd.get(end)?.value ?? null;
    const sti = points.shortTermInvestments.byEnd.get(end)?.value ?? null;
    const base2 = [revenue, cost, cell("grossProfit", end), operatingIncome, netIncome, cell("epsDiluted", end), ocf, capex];
    return {
      end,
      start: base.start,
      fiscalYear: base.fiscalYear,
      fiscalQuarter: base.fiscalQuarter,
      calendar: calendarQuarter(base.start, end),
      derived: base2.some((c) => c !== null && c.derived !== null && c.derived !== "calc"),
      revenue,
      costOfRevenue: cost,
      grossProfit,
      operatingIncome,
      netIncome,
      epsDiluted: cell("epsDiluted", end),
      sharesDiluted: cell("sharesDiluted", end),
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      depreciation: cell("depreciation", end),
      incomeTax: cell("incomeTax", end),
      pretaxIncome: cell("pretaxIncome", end),
      cash,
      shortTermInvestments: sti,
      debt,
      netDebt: debt && cash != null ? debt.value - cash - (sti ?? 0) : null,
      grossMargin: ratio(grossProfit?.value, revenue?.value),
      operatingMargin: ratio(operatingIncome?.value, revenue?.value),
      netMargin: ratio(netIncome?.value, revenue?.value),
      fcfMargin: ratio(fcf?.value, revenue?.value),
      prevEnd: null,
      yearAgoEnd: null,
      earnings8k: null,
    };
  });
  fillFiscalLabels(rows);

  // neighbours by DATE (a 52/53-week year shifts the dates by a few days)
  const byEnd = new Map(rows.map((r) => [r.end, r]));
  for (const r of rows) {
    r.prevEnd = nearest(rows, r.end, 91, 21);
    // same fiscal position a year earlier when the numbering is known, else the date a year back
    const sameFiscal = r.fiscalYear != null && r.fiscalQuarter != null ? rows.find((x) => x.fiscalYear === r.fiscalYear! - 1 && x.fiscalQuarter === r.fiscalQuarter && Math.abs(daysBetween(x.end, r.end) - 364) <= 20) : undefined;
    r.yearAgoEnd = sameFiscal ? sameFiscal.end : nearest(rows, r.end, 364, 16);
  }

  // the earnings 8-K that belongs to a quarter: the first one filed within 100 days after it ends (a match by date, nothing more)
  const history = [...(opts.filings?.earningsHistory ?? [])].sort((a, b) => a.filed.localeCompare(b.filed));
  for (const r of rows) {
    const hit = history.find((f) => {
      const d = daysBetween(r.end, f.filed);
      return d > 0 && d <= 100;
    });
    r.earnings8k = hit ?? null;
  }

  const comparisons: Comparison[] = rows.map((r) => {
    const p = r.prevEnd ? byEnd.get(r.prevEnd) ?? null : null;
    const y = r.yearAgoEnd ? byEnd.get(r.yearAgoEnd) ?? null : null;
    const val = (row: QuarterRow | null, m: CompareMetric): number | null => (row ? row[m]?.value ?? null : null);
    const qoq: Comparison["qoq"] = {};
    const yoy: Comparison["yoy"] = {};
    for (const m of COMPARE_METRICS) {
      const a = deltaOf(val(r, m), val(p, m));
      const b = deltaOf(val(r, m), val(y, m));
      if (a) qoq[m] = a;
      if (b) yoy[m] = b;
    }
    const margins = (o: QuarterRow | null): Comparison["marginQoq"] => ({ gross: diff(r.grossMargin, o?.grossMargin ?? null), operating: diff(r.operatingMargin, o?.operatingMargin ?? null), net: diff(r.netMargin, o?.netMargin ?? null), fcf: diff(r.fcfMargin, o?.fcfMargin ?? null) });
    return {
      qoq,
      yoy,
      marginQoq: margins(p),
      marginYoy: margins(y),
      debtQoq: deltaOf(r.debt?.value, p?.debt?.value),
      debtYoy: deltaOf(r.debt?.value, y?.debt?.value),
      netDebtQoq: deltaOf(r.netDebt, p?.netDebt),
      netDebtYoy: deltaOf(r.netDebt, y?.netDebt),
    };
  });

  const ttm = ttmOf(rows, byEnd);
  const limit = opts.quarters ?? DEFAULT_QUARTERS;
  const result: AnalystResult = {
    ticker: payload.ticker,
    cik: payload.cik,
    entity: payload.entity,
    currency: cur,
    quarters: rows.slice(0, limit),
    comparisons: comparisons.slice(0, limit),
    ttm,
    changes: [],
    notes: [],
    concepts: used,
    coverShares,
    consensus: { available: false, text: CONSENSUS_TEXT },
    stamp: { source: SEC_SOURCE_LABEL, sourceUrl: payload.sourceUrl, asOf: payload.asOf, fetchedAt: payload.fetchedAt, stale: payload.stale === true },
  };
  result.notes = buildNotes(result, { skippedUnits, filings: opts.filings ?? null, now: opts.now ?? Date.now(), allRows: rows });
  result.changes = buildChanges(result);
  return result;
}

/** Sum of the last four consecutive quarters, per figure only when all four exist. EPS is a sum of quarterly EPS: close, not exact. */
function ttmOf(rows: readonly QuarterRow[], byEnd: ReadonlyMap<string, QuarterRow>): Ttm | null {
  const first = rows[0];
  if (!first) return null;
  const four: QuarterRow[] = [first];
  while (four.length < 4) {
    const last = four[four.length - 1]!;
    const p = last.prevEnd ? byEnd.get(last.prevEnd) : undefined;
    if (!p) break;
    four.push(p);
  }
  if (four.length < 4) return null;
  const sum = (pick: (r: QuarterRow) => number | null | undefined): number | null => {
    let t = 0;
    for (const r of four) {
      const v = pick(r);
      if (v == null) return null;
      t += v;
    }
    return t;
  };
  return {
    end: first.end,
    revenue: sum((r) => r.revenue?.value),
    grossProfit: sum((r) => r.grossProfit?.value),
    operatingIncome: sum((r) => r.operatingIncome?.value),
    netIncome: sum((r) => r.netIncome?.value),
    epsDiluted: sum((r) => r.epsDiluted?.value),
    operatingCashFlow: sum((r) => r.operatingCashFlow?.value),
    capex: sum((r) => (r.capex ? Math.abs(r.capex.value) : null)),
    freeCashFlow: sum((r) => r.freeCashFlow?.value),
    depreciation: sum((r) => r.depreciation?.value),
    incomeTax: sum((r) => r.incomeTax?.value),
    pretaxIncome: sum((r) => r.pretaxIncome?.value),
  };
}

