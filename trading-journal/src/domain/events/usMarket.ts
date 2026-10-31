/**
 * US stock market hours and holidays by the NYSE rule (F43). Computed, not listed: the holidays follow the fixed
 * weekday / date rules of the NYSE (`nyse.com/markets/hours-calendars`), the clock times are 09:30 and 16:00 on the wall
 * clock of New York, so the summer / winter time of the US is right in every week – also in the weeks in which the US and
 * Europe switch on different dates. The tests compare the result with the table the NYSE publishes for 2025 – 2027.
 *
 * Rules (as published by the NYSE):
 *   – a holiday on a Sunday is observed on the Monday; on a Saturday on the Friday before – except New Year's Day (there
 *     is no day off on 31 December),
 *   – Good Friday is the Friday before Easter Sunday (Gregorian Easter),
 *   – Juneteenth is a market holiday since 2022,
 *   – early close 13:00: the day after Thanksgiving, 24 December and 3 July when they are trading days Monday – Thursday.
 * Not computable and therefore not in here: extra closures (national days of mourning, storms).
 */
import { addDays, dayKeyIn, keyOf, wallToUtc, weekdayOfKey } from "./zone";

export const US_ZONE = "America/New_York";
export const US_OPEN_CLOCK = { h: 9, min: 30 } as const;
export const US_CLOSE_CLOCK = { h: 16, min: 0 } as const;
export const US_EARLY_CLOSE_CLOCK = { h: 13, min: 0 } as const;

/** Gregorian Easter Sunday of `y` (Meeus / Jones / Butcher). */
export function easterSunday(y: number): { m: number; d: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

/** Day of month of the `n`-th `weekday` (0 = Sunday) of the month. */
export function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Day of month of the last `weekday` (0 = Sunday) of the month. */
export function lastWeekday(y: number, m: number, weekday: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
  return last - ((dow - weekday + 7) % 7);
}

export interface UsHoliday {
  /** the day the market is closed (`YYYY-MM-DD`, New York) */
  key: string;
  /** German name */
  name: string;
  /** the calendar date of the holiday when it is observed on another day ("04.07.") */
  observedFor?: string;
}

/** The day a fixed-date holiday is observed on: Sunday → Monday, Saturday → Friday (or no day off at all). */
function observed(y: number, m: number, d: number, saturday: "friday" | "none"): { key: string; shifted: boolean } | null {
  const key = keyOf(y, m, d);
  const dow = weekdayOfKey(key);
  if (dow === 6) return saturday === "friday" ? { key: addDays(key, -1), shifted: true } : null;
  if (dow === 0) return { key: addDays(key, 1), shifted: true };
  return { key, shifted: false };
}

const p2 = (n: number): string => String(n).padStart(2, "0");

const byYear = new Map<number, UsHoliday[]>();

/** The NYSE holidays whose closing day lies in the calendar year `y`. */
export function usHolidays(y: number): UsHoliday[] {
  const hit = byYear.get(y);
  if (hit) return hit;
  const out: UsHoliday[] = [];
  const fixed = (name: string, m: number, d: number, saturday: "friday" | "none"): void => {
    const o = observed(y, m, d, saturday);
    // New Year's Day on a Saturday has no day off (the Friday is 31 December of the year before, a trading day)
    if (o && o.key.startsWith(`${y}-`)) out.push({ key: o.key, name, ...(o.shifted ? { observedFor: `${p2(d)}.${p2(m)}.` } : {}) });
  };
  fixed("Neujahr", 1, 1, "none");
  out.push({ key: keyOf(y, 1, nthWeekday(y, 1, 1, 3)), name: "Martin-Luther-King-Tag" });
  out.push({ key: keyOf(y, 2, nthWeekday(y, 2, 1, 3)), name: "Washington’s Birthday (Presidents’ Day)" });
  const easter = easterSunday(y);
  out.push({ key: addDays(keyOf(y, easter.m, easter.d), -2), name: "Karfreitag" });
  out.push({ key: keyOf(y, 5, lastWeekday(y, 5, 1)), name: "Memorial Day" });
  if (y >= 2022) fixed("Juneteenth", 6, 19, "friday");
  fixed("Independence Day", 7, 4, "friday");
  out.push({ key: keyOf(y, 9, nthWeekday(y, 9, 1, 1)), name: "Labor Day" });
  out.push({ key: keyOf(y, 11, nthWeekday(y, 11, 4, 4)), name: "Thanksgiving" });
  fixed("Weihnachten", 12, 25, "friday");
  out.sort((a, b) => (a.key < b.key ? -1 : 1));
  byYear.set(y, out);
  return out;
}

/** The holiday the NYSE is closed for on `key` (`YYYY-MM-DD`), or `null`. */
export function usHolidayOn(key: string): UsHoliday | null {
  const y = +key.slice(0, 4);
  return usHolidays(y).find((h) => h.key === key) ?? null;
}

/** Monday – Friday that is no NYSE holiday. */
export function isUsTradingDay(key: string): boolean {
  const dow = weekdayOfKey(key);
  return dow >= 1 && dow <= 5 && !usHolidayOn(key);
}

/** The reason for a 13:00 close on a trading day, `null` for a normal day. */
export function usEarlyCloseReason(key: string): string | null {
  if (!isUsTradingDay(key)) return null;
  const y = +key.slice(0, 4);
  if (key === addDays(keyOf(y, 11, nthWeekday(y, 11, 4, 4)), 1)) return "Tag nach Thanksgiving";
  const dow = weekdayOfKey(key);
  if (dow >= 1 && dow <= 4) {
    if (key === keyOf(y, 12, 24)) return "Heiligabend";
    if (key === keyOf(y, 7, 3)) return "Tag vor dem 4. Juli";
  }
  return null;
}

export interface UsSession {
  /** New York calendar day */
  key: string;
  /** ms UTC */
  open: number;
  close: number;
  early: boolean;
  earlyReason?: string;
}

/** The regular session of the New York day `key`; `null` on weekends and holidays. */
export function usSession(key: string): UsSession | null {
  if (!isUsTradingDay(key)) return null;
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  const reason = usEarlyCloseReason(key);
  const closeClock = reason ? US_EARLY_CLOSE_CLOCK : US_CLOSE_CLOCK;
  return {
    key,
    open: wallToUtc({ y, m, d, ...US_OPEN_CLOCK }, US_ZONE),
    close: wallToUtc({ y, m, d, ...closeClock }, US_ZONE),
    early: !!reason,
    ...(reason ? { earlyReason: reason } : {}),
  };
}

/** The New York calendar day of an instant. */
export const usDayKey = (ms: number): string => dayKeyIn(ms, US_ZONE);
