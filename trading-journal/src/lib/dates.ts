/**
 * Date helpers – bundle `tt`, `Cg`, `BG`, `YM` plus week/month bucketing (local time, ISO week starting Monday).
 */

/** Bundle `BG`: short German month names, index = `getMonth()`. */
export const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;
/** Bundle `YM`: German weekday names, index = `getDay()` (0 = Sonntag). */
export const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;

export interface HasTradeTime {
  date?: string | null;
  createdAt?: string | null;
}

/** Bundle `tt`: canonical trade timestamp — `new Date(date || createdAt || 0)`; "YYYY-MM-DDTHH:mm" parses as local time. */
export function tradeTime(t: HasTradeTime): Date {
  return new Date(t.date || t.createdAt || 0);
}

/** Bundle `Cg`: now as `<input type="datetime-local">` value "YYYY-MM-DDTHH:mm" (local wall clock). */
export function nowLocalInput(now: Date = new Date()): string {
  const e = new Date(now.getTime());
  e.setMinutes(e.getMinutes() - e.getTimezoneOffset());
  return e.toISOString().slice(0, 16);
}

/** Local date → "YYYY-MM-DD". */
export function localDateKey(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Bundle month bucket key: "YYYY-MM" (local getters). */
export function monthKey(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/** Bundle month label: `BG[m] + " " + YY`, e.g. "Sep 26". */
export function monthLabel(key: string): string {
  const [y = "", m = "1"] = key.split("-");
  return (MONTHS_SHORT[+m - 1] ?? "") + " " + y.slice(2);
}

/** Monday 00:00 (local) of the ISO week containing `d`. */
export function weekStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (s.getDay() + 6) % 7; // Monday = 0
  s.setDate(s.getDate() - day);
  return s;
}

/** ISO-8601 week number and its year (Monday-based). */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 864e5 + 1) / 7) };
}

/** Week bucket key "YYYY-Www" (ISO week, Monday start, local time). */
export function weekKey(d: Date): string {
  const { year, week } = isoWeek(d);
  return year + "-W" + String(week).padStart(2, "0");
}

/** Week label "KW 39", as used for weekly bucket captions. */
export function weekLabel(key: string): string {
  const w = key.split("-W")[1] ?? "";
  return "KW " + String(+w);
}

/** Settings `startDate` ("YYYY-MM-DD") → local midnight. */
export function startOfLocalDay(dateKey: string): Date {
  return new Date(dateKey + "T00:00");
}

/** Weekday name for a date (bundle `YM[tt(t).getDay()]`). */
export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()] ?? "";
}

/** Fractional days between two instants. */
export function daysBetween(a: Date | number, b: Date | number): number {
  return (+b - +a) / 864e5;
}

/** Generic bucketing helper (insertion order preserved, like the bundle's Map). */
export function bucketBy<T>(list: readonly T[], keyOf: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = keyOf(t);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  return m;
}

// Bundle aliases
export const tt = tradeTime;
export const Cg = nowLocalInput;
export const BG = MONTHS_SHORT;
export const YM = WEEKDAYS;
