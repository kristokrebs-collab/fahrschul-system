/**
 * New York trading calendar for US stocks – pure, no imports (the server functions import this file by relative path).
 *
 * - `nyParts` / `nyToUtc`: New York wall time without `Intl` or the machine's time zone (US daylight-saving rule since
 *   2007: second Sunday of March 2:00 to first Sunday of November 2:00).
 * - `sessionOf(date)`: regular session 9:30 to 16:00 (13:00 on an early close), or `null` on a weekend / NYSE holiday.
 *   Holidays and early closes are listed for 2026 and 2027 only (nyse.com, read 2026-10-13); for any other year
 *   `calendarKnown` is false and only weekends count as closed – callers say so instead of pretending.
 * - `regularOnly`: drops pre-market, after-hours and the 16:00 closing print from intraday candles.
 * - `isClosedBar`: a candle counts as complete only once its interval (or, for a daily bar, its session) is over.
 */
import type { StockInterval } from "./types";
import { STOCK_INTERVAL_MS } from "./types";

export interface NyParts {
  /** `YYYY-MM-DD` in New York */
  date: string;
  year: number;
  month: number;
  day: number;
  /** minutes since local midnight */
  minutes: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export const NYSE_HOLIDAYS: Readonly<Record<string, string>> = {
  "2026-01-01": "Neujahr",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Presidents’ Day",
  "2026-04-03": "Karfreitag",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Unabhängigkeitstag (Ersatztag)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Weihnachten",
  "2027-01-01": "Neujahr",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Presidents’ Day",
  "2027-03-26": "Karfreitag",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (Ersatztag)",
  "2027-07-05": "Unabhängigkeitstag (Ersatztag)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving",
  "2027-12-24": "Weihnachten (Ersatztag)",
};

/** Sessions that end at 13:00. */
export const NYSE_EARLY_CLOSE: Readonly<Record<string, string>> = {
  "2026-11-27": "Tag nach Thanksgiving",
  "2026-12-24": "Heiligabend",
  "2027-11-26": "Tag nach Thanksgiving",
};

export const CALENDAR_YEARS: readonly number[] = [2026, 2027];
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_MIN = 13 * 60;

/** Day of month of the `n`-th Sunday of a month (month 1–12). */
function nthSunday(year: number, month: number, n: number): number {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - dow) % 7) + 7 * (n - 1);
}

/** New York's offset from UTC in minutes at an instant: −240 in daylight time, −300 otherwise. */
export function nyOffsetMin(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 3, 2), 7, 0); // 2:00 EST = 07:00 UTC
  const end = Date.UTC(y, 10, nthSunday(y, 11, 1), 6, 0); // 2:00 EDT = 06:00 UTC
  return utcMs >= start && utcMs < end ? -240 : -300;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

export function nyParts(utcMs: number): NyParts {
  const d = new Date(utcMs + nyOffsetMin(utcMs) * MIN_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return { date: `${year}-${p2(month)}-${p2(day)}`, year, month, day, minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** UTC ms of a New York wall time (`date` = `YYYY-MM-DD`, minutes since midnight). */
export function nyToUtc(date: string, minutes: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  for (const off of [-240, -300]) {
    const utc = naive - off * MIN_MS;
    if (nyOffsetMin(utc) === off) return utc;
  }
  return naive + 300 * MIN_MS;
}

export const isWeekend = (date: string): boolean => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
};

/** The holiday / early-close tables cover this date's year. */
export function calendarKnown(date: string): boolean {
  return CALENDAR_YEARS.includes(Number(date.slice(0, 4)));
}

export interface Session {
  date: string;
  openMs: number;
  closeMs: number;
  /** ends at 13:00 */
  early: boolean;
}

/** Regular session of a New York date, `null` when the exchange is closed all day (weekend, holiday). */
export function sessionOf(date: string): Session | null {
  if (isWeekend(date) || NYSE_HOLIDAYS[date]) return null;
  const early = date in NYSE_EARLY_CLOSE;
  return { date, openMs: nyToUtc(date, OPEN_MIN), closeMs: nyToUtc(date, early ? EARLY_MIN : CLOSE_MIN), early };
}

/** Why `date` is no trading day (German), or `null` when it is one. */
export function closedReason(date: string): string | null {
  if (isWeekend(date)) return "Wochenende";
  return NYSE_HOLIDAYS[date] ? `Feiertag (${NYSE_HOLIDAYS[date]})` : null;
}

/** The New York date `n` days after (`n` < 0: before) `date`. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** The trading day the market is "at": today once the session has opened, else the last session before. */
export function currentTradingDay(utcMs: number): Session {
  let date = nyParts(utcMs).date;
  for (let i = 0; i < 12; i++) {
    const s = sessionOf(date);
    if (s && s.openMs <= utcMs) return s;
    date = addDays(date, -1);
  }
  // a 12-day gap does not exist; fall back to a plain weekday session so callers never get `null`
  const fallback = nyParts(utcMs).date;
  return { date: fallback, openMs: nyToUtc(fallback, OPEN_MIN), closeMs: nyToUtc(fallback, CLOSE_MIN), early: false };
}

/** Is the regular session of `utcMs`'s New York date running at that instant? */
export function isSessionOpen(utcMs: number): boolean {
  const s = sessionOf(nyParts(utcMs).date);
  return !!s && utcMs >= s.openMs && utcMs < s.closeMs;
}

/** Candle with a start time in ms – the only field the session helpers read. */
interface Timed {
  time: number;
}

/** Intraday candles inside the regular session of their New York day (drops pre/post market and the 16:00 closing print). */
export function regularOnly<T extends Timed>(candles: readonly T[]): T[] {
  const out: T[] = [];
  let cachedDate = "";
  let cached: Session | null = null;
  for (const c of candles) {
    const date = nyParts(c.time).date;
    if (date !== cachedDate) {
      cachedDate = date;
      cached = sessionOf(date);
    }
    if (cached && c.time >= cached.openMs && c.time < cached.closeMs) out.push(c);
  }
  return out;
}

/**
 * A candle is complete when its interval is over; a daily bar (Yahoo stamps it with the session open) when the session
 * of its New York day has closed.
 */
export function isClosedBar(interval: StockInterval, timeMs: number, nowMs: number): boolean {
  if (interval === "1d") {
    const s = sessionOf(nyParts(timeMs).date);
    return nowMs >= (s ? s.closeMs : timeMs + 24 * HOUR_MS);
  }
  return timeMs + STOCK_INTERVAL_MS[interval] <= nowMs;
}
