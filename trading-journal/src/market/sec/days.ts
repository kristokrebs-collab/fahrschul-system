/** Small date helpers on `YYYY-MM-DD` strings (UTC, no time zones – SEC dates are calendar dates). Pure, alias-free. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  return new Date(t).toISOString().slice(0, 10) === s;
}

/** Days since 1970-01-01 (NaN for anything that is not a date). */
export function dayNumber(s: string): number {
  const m = ISO.exec(s);
  return m ? Math.round(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / 86_400_000) : NaN;
}

/** `b − a` in days. */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

export function addDays(s: string, n: number): string {
  return new Date((dayNumber(s) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of an epoch ms (UTC). */
export const isoOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Epoch ms (UTC midnight) of a `YYYY-MM-DD`, `null` when invalid. */
export const msOfIso = (s: string | null | undefined): number | null => (s && isIsoDate(s) ? dayNumber(s) * 86_400_000 : null);

/** The midpoint day of a period (used to assign a fiscal quarter to a calendar quarter). */
export function midpoint(start: string, end: string): string {
  return addDays(start, Math.floor(daysBetween(start, end) / 2));
}

/** Calendar quarter of a period, by its midpoint (a fiscal quarter ending 2023-04-01 is calendar Q1). */
export function calendarQuarter(start: string | undefined, end: string): { year: number; q: 1 | 2 | 3 | 4 } {
  const mid = start ? midpoint(start, end) : end;
  const year = +mid.slice(0, 4);
  const month = +mid.slice(5, 7);
  return { year, q: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}
