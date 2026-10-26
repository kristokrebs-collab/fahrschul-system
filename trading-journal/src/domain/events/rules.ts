/**
 * Appointments that follow an exact rule (F43): the Funding grid of the perpetuals, the monthly / quarterly expiry of
 * options and futures, the weekend. Each rule names its source and the day it was checked; nothing is estimated.
 *
 * Funding: the standard interval is 8 hours at 00:00, 08:00 and 16:00 UTC. Checked 25.10.2026 against the help page of OKX
 * ("every 8 hours (00:00, 08:00, and 16:00 UTC) by default, unless specified otherwise (i.e. every 1, 2 or 4 hours)") and
 * the public API of Bitunix (`fundingInterval` 8, `nextFundingTime` 00:00 UTC). Binance and Bybit state the same standard
 * grid in their documentation; their servers were not reachable from here, so they are NOT named as checked. Single
 * contracts with a 1 / 2 / 4-hour interval are not on this grid – the calendar says so.
 *
 * Expiry: options and futures of Deribit expire on Fridays at 08:00 UTC; the monthly expiry is the LAST Friday of the
 * month, the quarterly expiry the last Friday of March, June, September and December. Checked 25.10.2026 against the
 * instrument list of the public Deribit API (`public/get_instruments`, `expiration_timestamp`): 30.10.2026, 27.11.2026,
 * 25.12.2026, 26.03.2027, 25.06.2027 and 24.09.2027, every one a Friday 08:00 UTC. Daily and weekly expiries exist too and
 * are not listed here.
 */
import { DAY, HOUR, type CalendarEvent, type EventSource } from "./types";

export const FUNDING_INTERVAL = 8 * HOUR;

export const FUNDING_SOURCE: EventSource = {
  label: "OKX-Hilfe und Bitunix-API (Standardraster)",
  rule: "Alle 8 Stunden um 00:00, 08:00 und 16:00 UTC; einzelne Verträge mit 1-, 2- oder 4-Stunden-Intervall weichen ab.",
  url: "https://www.okx.com/help/iv-introduction-to-perpetual-swap-funding-fee",
  checkedAt: "2026-10-25",
};

export const EXPIRY_SOURCE: EventSource = {
  label: "Deribit – Verfallstermine (öffentliche API)",
  rule: "Optionen und Futures verfallen freitags um 08:00 UTC; Monatsverfall = letzter Freitag des Monats, Quartalsverfall = letzter Freitag von März, Juni, September, Dezember.",
  url: "https://www.deribit.com/api/v2/public/get_instruments",
  checkedAt: "2026-10-25",
};

export const WEEKEND_SOURCE: EventSource = {
  label: "Kalender (UTC)",
  rule: "Samstag und Sonntag nach UTC; die US-Börsen sind geschlossen, Krypto handelt durchgehend.",
};

const isoZ = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + "Z";

/** Funding settlements in `[from, to)`, one every 8 hours from 00:00 UTC. */
export function fundingEvents(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (let t = Math.ceil(from / FUNDING_INTERVAL) * FUNDING_INTERVAL; t < to; t += FUNDING_INTERVAL) {
    out.push({ id: `funding:${isoZ(t)}`, kind: "funding", title: "Funding-Abrechnung", at: t, importance: "niedrig", detail: "Standardraster 8 h", source: FUNDING_SOURCE });
  }
  return out;
}

/** Day of the month of the last Friday. */
export function lastFridayOf(y: number, m: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dow = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
  return last - ((dow - 5 + 7) % 7);
}

/** The expiry of the month (last Friday 08:00 UTC), as an instant. */
export function expiryAt(y: number, m: number): number {
  return Date.UTC(y, m - 1, lastFridayOf(y, m), 8, 0, 0);
}

/** Quarter months (March, June, September, December). */
export const isQuarterMonth = (m: number): boolean => m % 3 === 0;

/** Monthly and quarterly expiries in `[from, to)`. */
export function expiryEvents(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const a = new Date(from);
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth() + 1;
  for (;;) {
    const at = expiryAt(y, m);
    if (at >= to) break;
    if (at >= from) {
      const quarter = isQuarterMonth(m);
      out.push({
        id: `expiry:${isoZ(at)}`,
        kind: "expiry",
        title: quarter ? "Quartalsverfall (Optionen und Futures)" : "Monatsverfall (Optionen und Futures)",
        at,
        importance: quarter ? "hoch" : "mittel",
        detail: "Letzter Freitag des Monats, 08:00 UTC",
        source: EXPIRY_SOURCE,
      });
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Saturday 00:00 to Monday 00:00 UTC, for every weekend that overlaps `[from, to)`. */
export function weekendEvents(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  // from the day before the first day: a weekend that has begun on Saturday is still running on Sunday
  for (let day = Math.floor(from / DAY) * DAY - DAY; day < to; day += DAY) {
    if (new Date(day).getUTCDay() !== 6) continue;
    const end = day + 2 * DAY;
    if (end <= from) continue;
    const key = new Date(day).toISOString().slice(0, 10);
    out.push({ id: `weekend:${key}`, kind: "weekend", title: "Wochenende (UTC)", at: day, end, allDay: true, dayKey: key, dayZone: "UTC", importance: "niedrig", detail: "US-Börsen geschlossen", source: WEEKEND_SOURCE });
  }
  return out;
}

/** True when the UTC day of `ms` is a Saturday or Sunday. */
export function isWeekendUtc(ms: number): boolean {
  const d = new Date(ms).getUTCDay();
  return d === 0 || d === 6;
}

/** True when the UTC day of `ms` is the day of a monthly / quarterly expiry. */
export function isExpiryDayUtc(ms: number): boolean {
  const d = new Date(ms);
  return d.getUTCDate() === lastFridayOf(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
