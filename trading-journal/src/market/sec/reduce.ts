/**
 * SEC "company facts" (`data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, 3 – 20 MB) → the REDUCED copy the app reads
 * (`SecFactsPayload.facts`). Pure and alias-free; the server calls it, tests call it with fixtures in SEC's real format.
 *
 * What it does – and nothing else: keep the concepts of `concepts.ts`, only the periodic reports (10-Q / 10-K and amendments),
 * only about six years back from the newest period, one unit per concept (the currency, not a second currency's copy), and
 * drop rows it cannot read. It never changes a value and never adds one. All repeated rows (a later filing repeats earlier
 * periods as comparatives, a restatement repeats a period with a new value) are KEPT: the analyst decides which one counts and
 * says so.
 */
import { daysBetween, isIsoDate } from "./days";
import { KEPT_CONCEPTS, REPORT_FORMS, type ConceptKind } from "./concepts";
import type { ConceptKey, FactRow, FactSeries } from "./wire";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Years of history kept (the analyst needs a year back for growth and one more for the Q4 derivation). */
export const KEEP_YEARS = 6;
/** Rows kept per concept (a 6-year, restated quarter series has far fewer). */
export const MAX_ROWS_PER_CONCEPT = 600;

export interface ReducedFacts {
  entity: string;
  cik: string;
  asOf: string | null;
  facts: Record<ConceptKey, FactSeries>;
}

/** `"APPLE INC /DE/"` → `"APPLE INC"`. */
export function cleanEntityName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s*\/[A-Z]{2,5}\/?\s*$/, "").trim() : "";
}

/** The unit this concept is kept in: USD (or USD/shares) when the company has it, else its most used currency. */
export function pickUnit(units: Raw, kind: ConceptKind): string | null {
  const names = Object.keys(units).filter((u) => Array.isArray(units[u]));
  if (!names.length) return null;
  const count = (u: string): number => (units[u] as unknown[]).length;
  const best = (list: string[]): string | null => list.sort((a, b) => count(b) - count(a) || a.localeCompare(b))[0] ?? null;
  if (kind === "shares") return names.includes("shares") ? "shares" : null;
  if (kind === "perShare") return names.includes("USD/shares") ? "USD/shares" : best(names.filter((u) => /^[A-Z]{3}\/shares$/.test(u)));
  return names.includes("USD") ? "USD" : best(names.filter((u) => /^[A-Z]{3}$/.test(u)));
}

function rowOf(x: unknown, instant: boolean): FactRow | null {
  if (!isObj(x)) return null;
  const { start, end, val, accn, fy, fp, form, filed } = x;
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  if (!isIsoDate(end) || !isIsoDate(filed) || typeof form !== "string" || !REPORT_FORMS.has(form) || typeof accn !== "string" || !accn) return null;
  if (!instant) {
    if (!isIsoDate(start) || daysBetween(start, end) < 0) return null;
  }
  const row: FactRow = { end, val, form, filed, accn };
  if (isIsoDate(start)) row.start = start;
  if (typeof fy === "number" && Number.isFinite(fy)) row.fy = fy;
  if (typeof fp === "string" && fp) row.fp = fp;
  return row;
}

export function reduceCompanyFacts(raw: unknown, opts: { years?: number } = {}): ReducedFacts {
  const root = isObj(raw) ? raw : {};
  const all = isObj(root.facts) ? root.facts : {};
  const cik = typeof root.cik === "number" || typeof root.cik === "string" ? String(root.cik).replace(/\D/g, "").padStart(10, "0") : "";
  const kept: Record<ConceptKey, FactSeries> = {};
  let newest: string | null = null;
  for (const [key, kind] of KEPT_CONCEPTS) {
    const sep = key.indexOf(":");
    const ns = all[key.slice(0, sep)];
    const node = isObj(ns) ? ns[key.slice(sep + 1)] : undefined;
    const units = isObj(node) && isObj(node.units) ? node.units : null;
    if (!units) continue;
    const unit = pickUnit(units, kind);
    if (!unit) continue;
    const rows: FactRow[] = [];
    for (const x of units[unit] as unknown[]) {
      // balance-sheet and cover-page values are instants; income statement and cash flow have a start
      const r = rowOf(x, isObj(x) && x.start === undefined);
      if (r) rows.push(r);
    }
    if (!rows.length) continue;
    kept[key] = { unit, rows };
    if (key.startsWith("us-gaap:")) for (const r of rows) if (newest === null || r.end > newest) newest = r.end;
  }
  const years = opts.years ?? KEEP_YEARS;
  const cutoff = newest ? new Date(Date.parse(`${newest}T00:00:00Z`) - years * 365.25 * 86_400_000).toISOString().slice(0, 10) : "";
  const facts: Record<ConceptKey, FactSeries> = {};
  for (const [key, s] of Object.entries(kept)) {
    const rows = s.rows
      .filter((r) => !cutoff || r.end >= cutoff)
      .sort((a, b) => a.end.localeCompare(b.end) || (a.start ?? "").localeCompare(b.start ?? "") || a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn));
    if (rows.length) facts[key] = { unit: s.unit, rows: rows.length > MAX_ROWS_PER_CONCEPT ? rows.slice(rows.length - MAX_ROWS_PER_CONCEPT) : rows };
  }
  return { entity: cleanEntityName(root.entityName), cik, asOf: newest, facts };
}
