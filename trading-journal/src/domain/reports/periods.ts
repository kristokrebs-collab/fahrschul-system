/**
 * Report periods (P04): day, ISO week (Monday–Sunday), month, quarter and year in LOCAL time, with a stable key
 * (`2026-10-12`, `2026-W41`, `2026-10`, `2026-Q4`, `2026`) that round-trips through the router (`#berichte?p=<key>`)
 * and the seen markers. Pure.
 */
import { isoWeek, localDateKey, weekStart } from "@/lib/dates";

export type ReportKind = "day" | "week" | "month" | "quarter" | "year";
export const REPORT_KINDS: readonly ReportKind[] = ["day", "week", "month", "quarter", "year"];
export const KIND_LABEL: Readonly<Record<ReportKind, string>> = { day: "Tag", week: "Woche", month: "Monat", quarter: "Quartal", year: "Jahr" };
/** Adjective for titles ("Wochenbericht"). */
export const KIND_REPORT: Readonly<Record<ReportKind, string>> = { day: "Tagesbericht", week: "Wochenbericht", month: "Monatsbericht", quarter: "Quartalsbericht", year: "Jahresbericht" };

const MONTH_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;
const MONTH_SHORT = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"] as const;
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

export interface ReportPeriod {
  kind: ReportKind;
  key: string;
  /** epoch ms, inclusive (local midnight) */
  from: number;
  /** epoch ms, exclusive */
  to: number;
  /** "Oktober 2026", "KW 41 · 2026", "Q4 2026", "Mo, 12. Oktober 2026" */
  label: string;
  /** compact flap label ("KW 41", "OKT 26", "Q4 26", "2026", "12.10.") */
  short: string;
  /** "05.10. – 11.10.2026" */
  range: string;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const dm = (d: Date) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`;

function build(kind: ReportKind, from: Date, to: Date): ReportPeriod {
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1);
  const y = from.getFullYear();
  const range = kind === "day" ? `${dm(from)}${y}` : `${dm(from)} – ${dm(last)}${last.getFullYear()}`;
  switch (kind) {
    case "day":
      return { kind, key: localDateKey(from), from: +from, to: +to, label: `${WEEKDAY_SHORT[from.getDay()]}, ${from.getDate()}. ${MONTH_LONG[from.getMonth()]} ${y}`, short: dm(from), range };
    case "week": {
      const w = isoWeek(from);
      return { kind, key: `${w.year}-W${p2(w.week)}`, from: +from, to: +to, label: `KW ${w.week} · ${w.year}`, short: `KW ${w.week}`, range };
    }
    case "month":
      return { kind, key: `${y}-${p2(from.getMonth() + 1)}`, from: +from, to: +to, label: `${MONTH_LONG[from.getMonth()]} ${y}`, short: `${MONTH_SHORT[from.getMonth()]} ${String(y).slice(2)}`, range };
    case "quarter": {
      const q = Math.floor(from.getMonth() / 3) + 1;
      return { kind, key: `${y}-Q${q}`, from: +from, to: +to, label: `Q${q} ${y}`, short: `Q${q} ${String(y).slice(2)}`, range };
    }
    case "year":
      return { kind, key: `${y}`, from: +from, to: +to, label: `${y}`, short: `${y}`, range };
  }
}

/** The period of `kind` that contains `date` (local time). */
export function periodOf(kind: ReportKind, date: Date | number): ReportPeriod {
  const d = new Date(date);
  switch (kind) {
    case "day": {
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return build(kind, from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1));
    }
    case "week": {
      const from = weekStart(d);
      return build(kind, from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7));
    }
    case "month":
      return build(kind, new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1));
    case "quarter": {
      const m = Math.floor(d.getMonth() / 3) * 3;
      return build(kind, new Date(d.getFullYear(), m, 1), new Date(d.getFullYear(), m + 3, 1));
    }
    case "year":
      return build(kind, new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1));
  }
}

/** The period `n` steps away (−1 = the previous one). */
export function shiftPeriod(p: ReportPeriod, n: number): ReportPeriod {
  const f = new Date(p.from);
  switch (p.kind) {
    case "day":
      return periodOf("day", new Date(f.getFullYear(), f.getMonth(), f.getDate() + n));
    case "week":
      return periodOf("week", new Date(f.getFullYear(), f.getMonth(), f.getDate() + 7 * n));
    case "month":
      return periodOf("month", new Date(f.getFullYear(), f.getMonth() + n, 1));
    case "quarter":
      return periodOf("quarter", new Date(f.getFullYear(), f.getMonth() + 3 * n, 1));
    case "year":
      return periodOf("year", new Date(f.getFullYear() + n, 0, 1));
  }
}

/** Monday of ISO week `w` of ISO year `y` (local). */
function isoWeekMonday(y: number, w: number): Date {
  const jan4 = new Date(y, 0, 4);
  const mon = weekStart(jan4);
  return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + (w - 1) * 7);
}

/** Period of a key (`2026-10-12`, `2026-W41`, `2026-10`, `2026-Q4`, `2026`); `null` for anything else. */
export function periodFromKey(key: string | null | undefined): ReportPeriod | null {
  const k = (key ?? "").trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k))) {
    const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
    return d.getMonth() === +m[2]! - 1 && d.getDate() === +m[3]! ? periodOf("day", d) : null;
  }
  if ((m = /^(\d{4})-W(\d{2})$/.exec(k))) {
    const w = +m[2]!;
    if (w < 1 || w > 53) return null;
    const p = periodOf("week", isoWeekMonday(+m[1]!, w));
    return p.key === k ? p : null;
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(k))) return +m[2]! >= 1 && +m[2]! <= 12 ? periodOf("month", new Date(+m[1]!, +m[2]! - 1, 1)) : null;
  if ((m = /^(\d{4})-Q([1-4])$/.exec(k))) return periodOf("quarter", new Date(+m[1]!, (+m[2]! - 1) * 3, 1));
  if ((m = /^(\d{4})$/.exec(k))) return +m[1]! >= 1970 && +m[1]! <= 2999 ? periodOf("year", new Date(+m[1]!, 0, 1)) : null;
  return null;
}

/** The period has ended at `now`. */
export const isComplete = (p: Pick<ReportPeriod, "to">, now: number): boolean => p.to <= now;

/** The period contains `ms`. */
export const contains = (p: Pick<ReportPeriod, "from" | "to">, ms: number): boolean => ms >= p.from && ms < p.to;

/** The last completed period of `kind` at `now` (yesterday, last week, …). */
export const lastComplete = (kind: ReportKind, now: number): ReportPeriod => shiftPeriod(periodOf(kind, now), -1);
