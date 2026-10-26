/**
 * `settings.theses` – the versioned passthrough key of the Kaufthese: `{ v: 1, theses: [{ id, ticker, name, text, … versions }] }`.
 *
 * Like `settings.studio` / `settings.keyLevels` it survives `normalizeSettings`, the backup and the cloud / two-tab `merge3`:
 * theses and versions are arrays of objects with a string `id`, so two devices merge per thesis and per version. Reading is
 * lenient inside a thesis (a bad number becomes "not entered", a criterion this version cannot read is kept aside in
 * `criteriaExtra` and written back) and strict at its edge: a stored thesis without a readable id goes to `rejected` and is
 * written back untouched; unknown keys of the root and of a thesis survive. A version is an immutable snapshot. Pure.
 */
import {
  CRITERION_METRICS,
  CRITERION_OPS,
  ITEM_MAX,
  MAX_CRITERIA,
  MAX_LIST,
  MAX_THESES,
  MAX_VERSIONS,
  NAME_MAX,
  SCENARIO_KEYS,
  TEXT_MAX,
  THESES_VERSION,
  type CheckState,
  type Criterion,
  type CriterionResult,
  type PriceInput,
  type Scenario,
  type ScenarioKey,
  type Thesis,
  type ThesesCfg,
  type ThesisBase,
  type ThesisSnapshot,
  type ThesisVersion,
} from "./types";
import { isIsoDate } from "@/market/sec/days";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (fin(v) ? v : null);

// control characters (except tab and line break) never belong in a text
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(CTRL, " ").trim().slice(0, max) : "");
const ID = /^[\w-]{1,40}$/;

export const EMPTY_THESES: ThesesCfg = Object.freeze({ v: THESES_VERSION, theses: [], rejected: [] }) as ThesesCfg;

export const EMPTY_SCENARIO: Scenario = Object.freeze({ growthStart: null, growthEnd: null, marginEnd: null, reinvest: null, wacc: null, terminalGrowth: null, note: "" }) as Scenario;
export const EMPTY_BASE: ThesisBase = Object.freeze({ revenue: null, ebitMargin: null, taxRate: null, netDebt: null, shares: null, currency: "USD", sourceNote: "" }) as ThesisBase;

function listOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clean(x, ITEM_MAX))
    .filter(Boolean)
    .slice(0, MAX_LIST);
}

export function scenarioOf(raw: unknown): Scenario {
  const r = isObj(raw) ? raw : {};
  return { growthStart: num(r.growthStart), growthEnd: num(r.growthEnd), marginEnd: num(r.marginEnd), reinvest: num(r.reinvest), wacc: num(r.wacc), terminalGrowth: num(r.terminalGrowth), note: clean(r.note, ITEM_MAX) };
}

export function baseOf(raw: unknown): ThesisBase {
  const r = isObj(raw) ? raw : {};
  const cur = typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : "USD";
  return { revenue: num(r.revenue), ebitMargin: num(r.ebitMargin), taxRate: num(r.taxRate), netDebt: num(r.netDebt), shares: num(r.shares), currency: cur, sourceNote: clean(r.sourceNote, ITEM_MAX) };
}

function priceOf(raw: unknown): PriceInput | null {
  if (!isObj(raw) || !fin(raw.value) || !(raw.value > 0) || !isIsoDate(raw.date)) return null;
  return { value: raw.value, date: raw.date, source: clean(raw.source, ITEM_MAX) };
}

function zoneOf(raw: unknown): ThesisSnapshot["buyZone"] {
  if (!isObj(raw)) return null;
  const low = num(raw.low);
  const high = num(raw.high);
  return low == null && high == null ? null : { low, high };
}

export function criterionOf(raw: unknown): Criterion | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id) || !fin(raw.value)) return null;
  if (!(CRITERION_METRICS as readonly unknown[]).includes(raw.metric) || !(CRITERION_OPS as readonly unknown[]).includes(raw.op)) return null;
  return { id: raw.id, metric: raw.metric as Criterion["metric"], op: raw.op as Criterion["op"], value: raw.value, note: clean(raw.note, ITEM_MAX) };
}

function criteriaOf(raw: unknown): { criteria: Criterion[]; extra: unknown[] } {
  const criteria: Criterion[] = [];
  const extra: unknown[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw) ? raw : []) {
    const c = criterionOf(e);
    if (!c) extra.push(e);
    else if (!seen.has(c.id) && criteria.length < MAX_CRITERIA) {
      seen.add(c.id);
      criteria.push(c);
    }
  }
  return { criteria, extra };
}

function snapshotOf(raw: unknown): ThesisSnapshot & { criteriaExtra: unknown[] } {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.scenarios) ? r.scenarios : {};
  const { criteria, extra } = criteriaOf(r.criteria);
  const years = num(r.horizonYears);
  return {
    text: clean(r.text, TEXT_MAX),
    horizonYears: years != null && years >= 1 && years <= 15 ? Math.round(years) : 5,
    buyZone: zoneOf(r.buyZone),
    price: priceOf(r.price),
    base: baseOf(r.base),
    scenarios: { bear: scenarioOf(s.bear), base: scenarioOf(s.base), bull: scenarioOf(s.bull) },
    criteria,
    criteriaExtra: extra,
    catalysts: listOf(r.catalysts),
    risks: listOf(r.risks),
    counter: listOf(r.counter),
  };
}

function resultsOf(raw: unknown): CriterionResult[] {
  const out: CriterionResult[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!isObj(e) || typeof e.id !== "string" || !ID.test(e.id)) continue;
    if (e.status !== "triggered" && e.status !== "clear" && e.status !== "unknown") continue;
    out.push({ id: e.id, status: e.status, actual: num(e.actual), ...(typeof e.note === "string" ? { note: clean(e.note, ITEM_MAX) } : {}) });
  }
  return out.slice(0, MAX_CRITERIA);
}

export function checkOf(raw: unknown): CheckState | null {
  if (!isObj(raw) || !fin(raw.at)) return null;
  return {
    at: raw.at,
    quarterEnd: isIsoDate(raw.quarterEnd) ? raw.quarterEnd : null,
    filed: isIsoDate(raw.filed) ? raw.filed : null,
    url: typeof raw.url === "string" && /^https:\/\/www\.sec\.gov\//.test(raw.url) ? raw.url : null,
    source: clean(raw.source, 80),
    sourceUrl: typeof raw.sourceUrl === "string" && /^https:\/\/(www|data)\.sec\.gov\//.test(raw.sourceUrl) ? raw.sourceUrl : "",
    fetchedAt: fin(raw.fetchedAt) ? raw.fetchedAt : 0,
    results: resultsOf(raw.results),
    newQuarter: raw.newQuarter === true,
    seen: raw.seen === true,
  };
}

function versionOf(raw: unknown): ThesisVersion | null {
  if (!isObj(raw) || !fin(raw.n) || !Number.isInteger(raw.n) || raw.n < 1 || raw.n > 9999 || !isObj(raw.snapshot)) return null;
  const snap = snapshotOf(raw.snapshot);
  const { criteriaExtra, ...snapshot } = snap;
  void criteriaExtra;
  const c = isObj(raw.check) ? raw.check : null;
  return {
    id: typeof raw.id === "string" && ID.test(raw.id) ? raw.id : `v${raw.n}`,
    n: raw.n,
    at: fin(raw.at) ? raw.at : 0,
    note: clean(raw.note, ITEM_MAX),
    snapshot,
    check: c && fin(c.triggered) && fin(c.total) ? { quarterEnd: isIsoDate(c.quarterEnd) ? c.quarterEnd : null, triggered: Math.max(0, Math.round(c.triggered)), total: Math.max(0, Math.round(c.total)) } : null,
  };
}

const KNOWN = new Set(["id", "ticker", "name", "createdAt", "updatedAt", "text", "horizonYears", "buyZone", "price", "base", "scenarios", "criteria", "catalysts", "risks", "counter", "nextReport", "reviewAt", "monitoring", "check", "versions"]);

/** One stored thesis → `Thesis`, or `null` when it cannot be identified. */
export function thesisOf(raw: unknown): Thesis | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  const snap = snapshotOf(raw);
  const versions: ThesisVersion[] = [];
  const ids = new Set<string>();
  for (const v of (Array.isArray(raw.versions) ? raw.versions : []).slice(0, MAX_VERSIONS + 5)) {
    const x = versionOf(v);
    if (!x || ids.has(x.id)) continue;
    ids.add(x.id);
    versions.push(x);
  }
  versions.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  // the same number twice (two devices saved "version 3" apart): the later one gets the next free number
  const used = new Set<number>();
  let top = 0;
  for (const v of versions) {
    if (used.has(v.n)) v.n = top + 1;
    used.add(v.n);
    top = Math.max(top, v.n);
  }
  versions.sort((a, b) => a.n - b.n || a.at - b.at);
  const nr = isObj(raw.nextReport) && isIsoDate(raw.nextReport.date) ? { date: raw.nextReport.date, source: clean(raw.nextReport.source, ITEM_MAX) } : null;
  const extra: Raw = {};
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.has(k) && k !== "__proto__") extra[k] = v;
  const { criteriaExtra, ...snapshot } = snap;
  const ticker = typeof raw.ticker === "string" ? raw.ticker.trim().toUpperCase().slice(0, 10) : "";
  return {
    ...snapshot,
    id: raw.id,
    ticker: /^[A-Z0-9.-]*$/.test(ticker) ? ticker : "",
    name: clean(raw.name, NAME_MAX) || "Meine These",
    createdAt: fin(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: fin(raw.updatedAt) ? raw.updatedAt : 0,
    nextReport: nr,
    reviewAt: isIsoDate(raw.reviewAt) ? raw.reviewAt : null,
    monitoring: raw.monitoring === true,
    check: checkOf(raw.check),
    versions,
    criteriaExtra,
    extra,
  };
}

/** `settings.theses` (anything) → the theses. A duplicated id keeps the first entry. */
export function thesesCfgOf(raw: unknown): ThesesCfg {
  if (!isObj(raw)) return EMPTY_THESES;
  const theses: Thesis[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw.theses) ? raw.theses : []) {
    const t = thesisOf(e);
    if (!t) rejected.push(e);
    else if (!seen.has(t.id) && theses.length < MAX_THESES) {
      seen.add(t.id);
      theses.push(t);
    }
  }
  return { v: THESES_VERSION, theses, rejected };
}

export const thesesOfSettings = (s: { theses?: unknown } | null | undefined): ThesesCfg => thesesCfgOf(s?.theses);

/** A thesis as it is stored (unknown keys and unreadable criteria written back). */
export function storedForm(t: Thesis): Raw {
  return {
    ...t.extra,
    id: t.id,
    ticker: t.ticker,
    name: t.name,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    text: t.text,
    horizonYears: t.horizonYears,
    buyZone: t.buyZone,
    price: t.price,
    base: t.base,
    scenarios: t.scenarios,
    criteria: [...t.criteria, ...t.criteriaExtra],
    catalysts: t.catalysts,
    risks: t.risks,
    counter: t.counter,
    nextReport: t.nextReport,
    reviewAt: t.reviewAt,
    monitoring: t.monitoring,
    check: t.check,
    versions: t.versions,
  };
}

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/** `settings.theses` with the theses replaced – unknown root keys and `rejected` entries survive. The SAME object when nothing changes (the caller skips the save). */
export function withTheses(raw: unknown, theses: readonly Thesis[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = thesesCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: THESES_VERSION, theses: [...theses.map(storedForm), ...cur.rejected] };
  return isObj(raw) && canon(prev) === canon(next) ? (raw as Record<string, unknown>) : next;
}

/* ------------------------------------------------------------------------------------------ operations */

export interface NewThesisInput {
  id: string;
  ticker?: string;
  name?: string;
  currency?: string;
}

export function newThesis(input: NewThesisInput, now: number): Thesis {
  const ticker = (input.ticker ?? "").trim().toUpperCase();
  return {
    id: input.id,
    ticker: /^[A-Z0-9.-]{0,10}$/.test(ticker) ? ticker : "",
    name: clean(input.name, NAME_MAX) || (ticker ? `These ${ticker}` : "Neue These"),
    createdAt: now,
    updatedAt: now,
    text: "",
    horizonYears: 5,
    buyZone: null,
    price: null,
    base: { ...EMPTY_BASE, ...(input.currency && /^[A-Z]{3}$/.test(input.currency) ? { currency: input.currency } : {}) },
    scenarios: { bear: { ...EMPTY_SCENARIO }, base: { ...EMPTY_SCENARIO }, bull: { ...EMPTY_SCENARIO } },
    criteria: [],
    catalysts: [],
    risks: [],
    counter: [],
    nextReport: null,
    reviewAt: null,
    monitoring: false,
    check: null,
    versions: [],
    criteriaExtra: [],
    extra: {},
  };
}

/** The fields the person edits (everything else is set by the app). */
export type ThesisPatch = Partial<Pick<Thesis, "ticker" | "name" | "text" | "horizonYears" | "buyZone" | "price" | "base" | "scenarios" | "criteria" | "catalysts" | "risks" | "counter" | "nextReport" | "reviewAt" | "monitoring">>;

/** The patch applied through the same reading rules as a stored thesis (so a typed value is cleaned the same way). The SAME thesis when nothing differs. */
export function updateThesis(t: Thesis, patch: ThesisPatch, now: number): Thesis {
  const merged = thesisOf({ ...storedForm(t), ...patch, criteria: patch.criteria ? [...patch.criteria, ...t.criteriaExtra] : [...t.criteria, ...t.criteriaExtra] });
  if (!merged) return t;
  const next: Thesis = { ...merged, updatedAt: t.updatedAt, check: t.check, versions: t.versions };
  return canon(storedForm(next)) === canon(storedForm(t)) ? t : { ...next, updatedAt: now };
}

export function snapshotOfThesis(t: Thesis): ThesisSnapshot {
  return { text: t.text, horizonYears: t.horizonYears, buyZone: t.buyZone, price: t.price, base: t.base, scenarios: t.scenarios, criteria: t.criteria, catalysts: t.catalysts, risks: t.risks, counter: t.counter };
}

/**
 * Saves the current state as a new version. The SAME thesis when nothing changed since the newest version (unless `force`: a
 * version that documents a check result is worth keeping even when the text did not change). Oldest versions drop out past `MAX_VERSIONS`.
 */
export function saveVersion(t: Thesis, note: string, now: number, uid = Math.floor(now % 1e9).toString(36), force = false): Thesis {
  const snapshot = snapshotOfThesis(t);
  const last = t.versions[t.versions.length - 1];
  if (!force && last && canon(last.snapshot) === canon(snapshot)) return t;
  const n = t.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const triggered = t.check ? t.check.results.filter((r) => r.status === "triggered").length : 0;
  const v: ThesisVersion = {
    id: `v${n}-${uid.replace(/[^\w]/g, "").slice(0, 8) || "x"}`,
    n,
    at: now,
    note: clean(note, ITEM_MAX),
    snapshot,
    check: t.check ? { quarterEnd: t.check.quarterEnd, triggered, total: t.check.results.length } : null,
  };
  const versions = [...t.versions, v];
  return { ...t, versions: versions.length > MAX_VERSIONS ? versions.slice(versions.length - MAX_VERSIONS) : versions, updatedAt: now };
}

/** The scenario keys as a typed list for loops in the UI. */
export const SCENARIOS: readonly ScenarioKey[] = SCENARIO_KEYS;
