/**
 * Handelssitzungen des Handelsplans: wann beginnt die Sitzung, wann endet sie, ist heute überhaupt Handelstag.
 *
 * Krypto handelt rund um die Uhr; "Sitzung" heißt hier nur: ab welcher Ortszeit zählt die Opening-Range (Tagesbeginn UTC,
 * Tokio 9:00, London 8:00, New York 9:30). Aktien handeln nur zur Börsenzeit: die US-Börse öffnet um 9:30 New Yorker
 * Zeit – im Winter und Sommer derselbe Beginn der Ortszeit, aber ein anderer Zeitpunkt in UTC und, in den Wochen
 * zwischen den Zeitumstellungen (Mitte/Ende März, Ende Oktober/Anfang November), auch in Berlin eine andere Uhrzeit
 * (14:30 statt 15:30). Die Handelskalender-Daten (Feiertage, 13-Uhr-Schluss) stammen aus der Liste der NYSE für 2026 und 2027
 * (nyse.com/markets/hours-calendars, gelesen 2026-10-13, übernommen aus dem Skill trader-alerts); für andere Jahre kennt
 * die App nur Wochenenden und sagt das.
 */
import { addDays, BERLIN, clockIn, dayKeyIn, dayKeyLabel, MIN, parseDayKey, parseHHMM, weekdayOf, zonedToUtc, zoneLabel } from "./time";

export type SessionId = "utc" | "asia" | "london" | "newyork" | "usstocks";
export type MarketKind = "crypto" | "stocks";

export interface SessionDef {
  id: SessionId;
  /** the choice as the trader reads it */
  label: string;
  /** short name for sentences ("New York") */
  short: string;
  /** IANA zone the open is defined in */
  tz: string;
  /** `HH:MM` local open */
  open: string;
  /** regular end, minutes after the open (crypto: a nominal end, only the default for "flat by") */
  closeMin: number;
  market: MarketKind;
  /** default last entry, minutes after the open */
  cutoffMin: number;
  calendar: "none" | "nyse";
  /** one sentence: what this session is */
  about: string;
}

/** Crypto has no close: signals count for this long after the open unless the trader picks another time. */
export const CRYPTO_CUTOFF_MIN = 240;

export const SESSIONS: readonly SessionDef[] = [
  { id: "utc", label: "Tagesbeginn UTC (0:00)", short: "UTC-Tag", tz: "UTC", open: "00:00", closeMin: 1440, market: "crypto", cutoffMin: CRYPTO_CUTOFF_MIN, calendar: "none", about: "Der Tag der Tageskerze: Beginn 0:00 UTC, das ganze Jahr." },
  { id: "asia", label: "Asien (Tokio 9:00)", short: "Tokio", tz: "Asia/Tokyo", open: "09:00", closeMin: 360, market: "crypto", cutoffMin: CRYPTO_CUTOFF_MIN, calendar: "none", about: "Börsenbeginn in Tokio, 9:00 Ortszeit (ohne Sommerzeit, also 0:00 UTC)." },
  { id: "london", label: "London (8:00)", short: "London", tz: "Europe/London", open: "08:00", closeMin: 510, market: "crypto", cutoffMin: CRYPTO_CUTOFF_MIN, calendar: "none", about: "Börsenbeginn in London, 8:00 Ortszeit – mit der britischen Sommerzeit." },
  { id: "newyork", label: "New York (9:30)", short: "New York", tz: "America/New_York", open: "09:30", closeMin: 390, market: "crypto", cutoffMin: CRYPTO_CUTOFF_MIN, calendar: "none", about: "Börsenbeginn der US-Aktien, 9:30 New Yorker Zeit – mit der US-Sommerzeit – auch für Krypto ein Taktgeber." },
  { id: "usstocks", label: "US-Börse (9:30 New York)", short: "US-Börse", tz: "America/New_York", open: "09:30", closeMin: 390, market: "stocks", cutoffMin: 360, calendar: "nyse", about: "Reguläre Handelszeit der US-Aktien, 9:30 bis 16:00 New Yorker Zeit; Wochenenden und Feiertage sind geschlossen." },
];

export const SESSION_IDS: readonly SessionId[] = SESSIONS.map((s) => s.id);
export const isSessionId = (v: unknown): v is SessionId => typeof v === "string" && (SESSION_IDS as readonly string[]).includes(v);

export function sessionDef(id: SessionId): SessionDef {
  return SESSIONS.find((s) => s.id === id)!;
}

// ------------------------------------------------------------------------------------------------ NYSE calendar

/** Full-day closures of the NYSE (nyse.com/markets/hours-calendars, read 2026-10-13). */
export const NYSE_HOLIDAYS: Readonly<Record<string, string>> = {
  "2026-01-01": "Neujahr",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Presidents’ Day",
  "2026-04-03": "Karfreitag",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (nachgeholt)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Weihnachten",
  "2027-01-01": "Neujahr",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Presidents’ Day",
  "2027-03-26": "Karfreitag",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (nachgeholt)",
  "2027-07-05": "Independence Day (nachgeholt)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving",
  "2027-12-24": "Weihnachten (nachgeholt)",
};

/** Days the NYSE closes at 13:00 New York time. */
export const NYSE_EARLY_CLOSE: Readonly<Record<string, string>> = {
  "2026-11-27": "Tag nach Thanksgiving",
  "2026-12-24": "Heiligabend",
  "2027-11-26": "Tag nach Thanksgiving",
};

export const NYSE_EARLY_CLOSE_MIN = 210;
export const NYSE_CALENDAR_YEARS: readonly number[] = [2026, 2027];
export const NYSE_CALENDAR_SOURCE = "NYSE-Kalender (nyse.com), Stand 13.10.2026";

export interface DayStatus {
  tradingDay: boolean;
  /** why not (German), `null` on a trading day */
  reason: string | null;
  earlyClose: boolean;
  earlyReason: string | null;
  /** the calendar lists this year – otherwise only weekends are recognised */
  calendarKnown: boolean;
}

/** Is `key` a day the NYSE trades? */
export function nyseDay(key: string): DayStatus {
  const p = parseDayKey(key);
  if (!p) return { tradingDay: false, reason: "kein gültiges Datum", earlyClose: false, earlyReason: null, calendarKnown: false };
  const known = NYSE_CALENDAR_YEARS.includes(p.y);
  const wd = weekdayOf(key);
  if (wd === 0 || wd === 6) return { tradingDay: false, reason: "Wochenende", earlyClose: false, earlyReason: null, calendarKnown: known };
  const holiday = NYSE_HOLIDAYS[key];
  if (holiday) return { tradingDay: false, reason: `Feiertag der US-Börse (${holiday})`, earlyClose: false, earlyReason: null, calendarKnown: known };
  const early = NYSE_EARLY_CLOSE[key];
  return { tradingDay: true, reason: null, earlyClose: !!early, earlyReason: early ?? null, calendarKnown: known };
}

// ------------------------------------------------------------------------------------------------ session days

export interface SessionDay {
  id: SessionId;
  /** local calendar day of the open */
  dayKey: string;
  tz: string;
  market: MarketKind;
  openMs: number;
  /** regular end of the session (13:00 on an early-close day) */
  closeMs: number;
  /** default last entry */
  cutoffMs: number;
  earlyClose: boolean;
  /** a day the session exists (stocks: not a weekend or holiday; crypto: always) */
  tradingDay: boolean;
  closedReason: string | null;
  calendarKnown: boolean;
  /** "Mo 19.10. · New York 9:30 (UTC−4)" */
  label: string;
  /** clock of the open in Berlin ("15:30") */
  openBerlin: string;
  /** zone offset on that day ("UTC−4") */
  zone: string;
  /** minutes the regular session lasts */
  closeMin: number;
}

/** A minute count after the open, moved up with an early close (a 15:30 cutoff before a 16:00 close becomes 12:30 before 13:00). */
export function adjustForEarlyClose(minAfterOpen: number, normalCloseMin: number, actualCloseMin: number): number {
  if (actualCloseMin >= normalCloseMin || minAfterOpen < actualCloseMin) return minAfterOpen;
  const moved = minAfterOpen - (normalCloseMin - actualCloseMin);
  return moved > 0 ? moved : actualCloseMin;
}

/** The session `id` on the local calendar day `dayKey` (`cutoffMin`: the trader's own last-entry time). */
export function sessionDay(id: SessionId, dayKey: string, cutoffMin?: number | null): SessionDay {
  const def = sessionDef(id);
  const p = parseDayKey(dayKey);
  const [hh, mm] = def.open.split(":").map(Number) as [number, number];
  const y = p?.y ?? 1970;
  const mo = p?.mo ?? 1;
  const d = p?.d ?? 1;
  const openMs = zonedToUtc({ y, mo, d, h: hh, mi: mm }, def.tz);
  const status: DayStatus =
    def.calendar === "nyse" ? nyseDay(dayKey) : { tradingDay: !!p, reason: p ? null : "kein gültiges Datum", earlyClose: false, earlyReason: null, calendarKnown: true };
  const closeMin = status.earlyClose ? NYSE_EARLY_CLOSE_MIN : def.closeMin;
  const wanted = cutoffMin != null && cutoffMin > 0 ? cutoffMin : def.cutoffMin;
  const cut = Math.min(adjustForEarlyClose(wanted, def.closeMin, closeMin), closeMin);
  return {
    id,
    dayKey,
    tz: def.tz,
    market: def.market,
    openMs,
    closeMs: openMs + closeMin * MIN,
    cutoffMs: openMs + cut * MIN,
    earlyClose: status.earlyClose,
    tradingDay: status.tradingDay,
    closedReason: status.reason,
    calendarKnown: status.calendarKnown,
    label: `${dayKeyLabel(dayKey)} · ${def.short} ${def.open.replace(/^0/, "")} (${zoneLabel(openMs, def.tz)})`,
    openBerlin: clockIn(openMs, BERLIN),
    zone: zoneLabel(openMs, def.tz),
    closeMin,
  };
}

/** The newest session of `id` that has begun at `now` (stocks: skips weekends and holidays). */
export function latestSession(id: SessionId, now: number, cutoffMin?: number | null): SessionDay {
  const def = sessionDef(id);
  let key = dayKeyIn(now, def.tz);
  for (let i = 0; i < 14; i++) {
    const day = sessionDay(id, key, cutoffMin);
    if (day.tradingDay && day.openMs <= now) return day;
    key = addDays(key, -1);
  }
  return sessionDay(id, dayKeyIn(now, def.tz), cutoffMin);
}

/**
 * The instant of the "flat by" time on a session day. `hhmm` is a clock time in the session's zone; `null` = five minutes
 * before the regular end (15:55 for the US stocks, 12:55 on an early-close day). A time before the open is not valid
 * (`null` result, the caller keeps the default). On an early-close day a time after the close moves up with it.
 */
export function flatByMs(day: SessionDay, hhmm: string | null): number | null {
  const fallback = day.closeMs - 5 * MIN;
  if (hhmm == null || hhmm === "") return fallback;
  const mins = parseHHMM(hhmm);
  const p = parseDayKey(day.dayKey);
  if (mins == null || !p) return null;
  const at = zonedToUtc({ y: p.y, mo: p.mo, d: p.d, h: Math.floor(mins / 60), mi: mins % 60 }, day.tz);
  if (at <= day.openMs) return null;
  const def = sessionDef(day.id);
  const after = Math.round((at - day.openMs) / MIN);
  return day.openMs + adjustForEarlyClose(after, def.closeMin, day.closeMin) * MIN;
}
