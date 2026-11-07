/**
 * From tagged XBRL values to single quarters. Pure, deterministic, no estimates.
 *
 * The oddities of SEC's company facts, and what is done about each:
 *  - **Repeats and restatements.** A later filing repeats earlier periods as comparatives; a restatement repeats a period with a
 *    NEW value. Rows are grouped by (start, end); the value of the NEWEST filing counts (restatements win) and the first value
 *    is kept in `revised` when it differs, so the card can say "ursprünglich … jetzt …".
 *  - **Fiscal year ≠ calendar year.** Quarters are found by their DATES, never by the `fy`/`fp` labels of the rows (those name
 *    the FILING's period, comparatives carry the label of the later filing). The company's own numbering comes from the first
 *    filing that reported the period, and only when that filing is the period's own report (filed within ~4 months).
 *  - **Cumulative values in 10-Qs.** Income statements carry 3-month values, cash flow statements only year-to-date values
 *    (3, 6, 9, 12 months from the fiscal year's start). A quarter without its own 3-month value is the difference of two
 *    cumulative values with the same start date ("ytd-diff"); Q4 is the year minus 9 months, or minus the three quarters.
 *  - **52/53-week years** are covered by tolerant length bands (a quarter is 80–100 days, a year 350–380).
 *  - A difference is only taken when the resulting piece is about one quarter long; otherwise it is left empty.
 */
import { addDays, daysBetween } from "@/market/sec/days";
import type { ConceptKey, FactRow } from "@/market/sec/wire";
import type { Cell, Derivation } from "./types";

export type PeriodClass = "q" | "h1" | "m9" | "fy";

export function classify(days: number): PeriodClass | null {
  if (days >= 80 && days <= 100) return "q";
  if (days >= 170 && days <= 200) return "h1";
  if (days >= 255 && days <= 290) return "m9";
  if (days >= 350 && days <= 380) return "fy";
  return null;
}

export interface PeriodEntry {
  start: string;
  end: string;
  days: number;
  cls: PeriodClass;
  /** value of the newest filing */
  val: number;
  latest: FactRow;
  first: FactRow;
  revised: { original: number; originalFiled: string } | null;
}

const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** One entry per (start, end): the newest filing's value, the first filing's value when it differs. Periods that are not 3, 6, 9 or 12 months long are dropped. */
export function periodEntries(rows: readonly FactRow[]): PeriodEntry[] {
  const groups = new Map<string, FactRow[]>();
  for (const r of rows) {
    if (!r.start) continue;
    const k = `${r.start}|${r.end}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: PeriodEntry[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn));
    const first = g[0]!;
    const latest = g[g.length - 1]!;
    const days = daysBetween(first.start!, first.end);
    const cls = classify(days);
    if (!cls) continue;
    out.push({ start: first.start!, end: first.end, days, cls, val: latest.val, latest, first, revised: sameValue(first.val, latest.val) ? null : { original: first.val, originalFiled: first.filed } });
  }
  return out.sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start));
}

const FP_TO_Q: Record<string, 1 | 2 | 3 | 4> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, FY: 4 };

/** The company's fiscal numbering from the period's own first filing; `null` when that filing is a later one that only repeats it. */
export function fiscalOf(e: PeriodEntry): { fiscalYear: number | null; fiscalQuarter: 1 | 2 | 3 | 4 | null } {
  const own = daysBetween(e.end, e.first.filed) <= 130;
  if (!own) return { fiscalYear: null, fiscalQuarter: null };
  const q = e.first.fp ? (FP_TO_Q[e.first.fp] ?? null) : null;
  return { fiscalYear: typeof e.first.fy === "number" ? e.first.fy : null, fiscalQuarter: q };
}

export interface QuarterRaw {
  cell: Cell;
  start: string;
  fiscalYear: number | null;
  fiscalQuarter: 1 | 2 | 3 | 4 | null;
}

function cellOf(e: PeriodEntry, concept: ConceptKey): Cell {
  return { value: e.val, derived: null, concept, accn: e.latest.accn, filed: e.latest.filed, revised: e.revised, approx: false, inputsRevised: false };
}

export interface FlowOptions {
  /** allow quarters from cumulative values / the year (false for values that are not additive, e.g. weighted share counts) */
  derive: boolean;
  /** derived values are only approximately right (EPS, averages) */
  approx: boolean;
}

/** Cumulative anchors share a start date; a day or two of drift between filings is tolerated. */
function chainStarts(entries: readonly PeriodEntry[]): string[] {
  const starts = [...new Set(entries.filter((e) => e.cls !== "q").map((e) => e.start))].sort();
  const out: string[] = [];
  for (const s of starts) {
    const last = out[out.length - 1];
    if (last === undefined || daysBetween(last, s) > 4) out.push(s);
  }
  return out;
}

interface Cum {
  val: number;
  source: "anchor" | "sum";
  cls: PeriodClass | "q";
  revised: boolean;
}

/** Single quarters of one concept, keyed by quarter end. */
export function flowQuarters(rows: readonly FactRow[], concept: ConceptKey, opts: FlowOptions): Map<string, QuarterRaw> {
  const entries = periodEntries(rows);
  const out = new Map<string, QuarterRaw>();
  const qs = entries.filter((e) => e.cls === "q");
  for (const e of qs) out.set(e.end, { cell: cellOf(e, concept), start: e.start, ...fiscalOf(e) });
  if (!opts.derive) return out;

  for (const S of chainStarts(entries)) {
    const windowEnd = addDays(S, 380);
    const anchors = new Map<string, PeriodEntry>();
    for (const e of entries) if (Math.abs(daysBetween(S, e.start)) <= 4 && e.end <= windowEnd) anchors.set(e.end, e);
    const discrete = new Map<string, PeriodEntry>();
    for (const e of qs) if (daysBetween(S, e.start) >= -4 && e.end <= windowEnd) discrete.set(e.end, e);
    const boundaries = [...new Set([...anchors.keys(), ...discrete.keys()])].sort();
    let prev: Cum | null = null;
    let prevEnd: string | null = null;
    for (const end of boundaries) {
      const a = anchors.get(end);
      const d = discrete.get(end);
      let cum: Cum | null = null;
      if (a) cum = { val: a.val, source: "anchor", cls: a.cls, revised: a.revised !== null };
      else if (d && prev && prevEnd && Math.abs(daysBetween(prevEnd, d.start) - 1) <= 3) cum = { val: prev.val + d.val, source: "sum", cls: "q", revised: d.revised !== null || prev.revised };
      if (cum && prev && prevEnd && !out.has(end)) {
        const len = daysBetween(prevEnd, end);
        if (len >= 80 && len <= 105 && a) {
          const how: Derivation = a.cls === "fy" ? (prev.source === "anchor" && prev.cls === "m9" ? "fy-minus-9m" : "fy-minus-quarters") : "ytd-diff";
          out.set(end, {
            cell: { value: cum.val - prev.val, derived: how, concept, accn: a.latest.accn, filed: a.latest.filed, revised: null, approx: opts.approx, inputsRevised: prev.revised || cum.revised },
            start: addDays(prevEnd, 1),
            ...fiscalOf(a),
          });
        }
      }
      prev = cum;
      prevEnd = end;
    }
  }
  return out;
}

export interface Instant {
  value: number;
  accn: string;
  filed: string;
  revised: { original: number; originalFiled: string } | null;
}

/** Balance-sheet values by day: the newest filing's value of each day. */
export function instantValues(rows: readonly FactRow[]): Map<string, Instant> {
  const groups = new Map<string, FactRow[]>();
  for (const r of rows) {
    if (r.start) continue;
    const g = groups.get(r.end);
    if (g) g.push(r);
    else groups.set(r.end, [r]);
  }
  const out = new Map<string, Instant>();
  for (const [end, g] of groups) {
    g.sort((a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn));
    const first = g[0]!;
    const latest = g[g.length - 1]!;
    out.set(end, { value: latest.val, accn: latest.accn, filed: latest.filed, revised: sameValue(first.val, latest.val) ? null : { original: first.val, originalFiled: first.filed } });
  }
  return out;
}
