/**
 * The calendar (F43): every appointment in a time range, from the rules, the public list and the trader's own entries,
 * sorted by time. Pure and deterministic – the same range always gives the same list; `now` only enters where the page
 * asks "what is next" or "what is about to start".
 */
import { fomcEvents } from "./fomc";
import { ownCalendarEvents } from "./own";
import { expiryEvents, fundingEvents, weekendEvents } from "./rules";
import { usEvents } from "./usEvents";
import { DAY, MINUTE, type CalendarEvent, type EventKind, type OwnEvent } from "./types";
import { addDays, dayKeyIn, wallToUtc, weekdayOfKey } from "./zone";

export interface EventQuery {
  from: number;
  to: number;
  /** the kinds to include; default all */
  kinds?: readonly EventKind[];
  own?: readonly OwnEvent[];
}

const KIND_ORDER: Readonly<Record<EventKind, number>> = { fomc: 0, expiry: 1, usHoliday: 2, usOpen: 3, usClose: 4, funding: 5, own: 6, weekend: 7 };

/** Every appointment in `[from, to)`, by time (all-day entries first within their day, then by kind). */
export function eventsBetween(q: EventQuery): CalendarEvent[] {
  const want = (k: EventKind): boolean => !q.kinds || q.kinds.includes(k);
  const out: CalendarEvent[] = [];
  if (want("funding")) out.push(...fundingEvents(q.from, q.to));
  if (want("expiry")) out.push(...expiryEvents(q.from, q.to));
  if (want("weekend")) out.push(...weekendEvents(q.from, q.to));
  if (want("fomc")) out.push(...fomcEvents(q.from, q.to));
  if (want("usOpen") || want("usClose") || want("usHoliday")) out.push(...usEvents(q.from, q.to).filter((e) => want(e.kind)));
  if (want("own") && q.own?.length) out.push(...ownCalendarEvents(q.own, q.from, q.to));
  return out.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : 1));
}

/** The next `n` appointments at or after `now` (all-day entries count from their start; a running one is included). */
export function nextEvents(now: number, n: number, opts: { kinds?: readonly EventKind[]; own?: readonly OwnEvent[]; horizonDays?: number } = {}): CalendarEvent[] {
  const horizon = (opts.horizonDays ?? 45) * DAY;
  const list = eventsBetween({ from: now - DAY, to: now + horizon, ...(opts.kinds ? { kinds: opts.kinds } : {}), ...(opts.own ? { own: opts.own } : {}) });
  return list.filter((e) => (e.end ?? e.at) > now).slice(0, n);
}

/** Within `windowMin` minutes ahead (default 60) and not yet started: "gleich". All-day entries are never "gleich". */
export function isSoon(e: Pick<CalendarEvent, "at" | "allDay">, now: number, windowMin = 60): boolean {
  return !e.allDay && e.at >= now && e.at - now <= windowMin * MINUTE;
}

/** The entry is running right now (all-day entries and ranges). */
export const isRunning = (e: Pick<CalendarEvent, "at" | "end">, now: number): boolean => e.end != null && e.at <= now && now < e.end;

/** German "in 2 h 14 min" / "in 35 min" / "in 3 Tagen" until `at`. */
export function untilText(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return "jetzt";
  const min = Math.round(ms / MINUTE);
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `in ${h} h ${min % 60} min` : `in ${h} h`;
  const days = Math.round(ms / DAY);
  return days === 1 ? "in 1 Tag" : `in ${days} Tagen`;
}

/** Calendar day key (`YYYY-MM-DD`) in `tz` of an event's start (all-day entries keep their own day). */
export function dayOfEvent(e: CalendarEvent, tz: string): string {
  return e.allDay && e.dayKey && e.dayZone === tz ? e.dayKey : dayKeyIn(e.at, tz);
}

/** Events grouped by calendar day of `tz`, days in order. A multi-day range (weekend) appears on every day it covers. */
export function groupByDay(events: readonly CalendarEvent[], tz: string): { day: string; events: CalendarEvent[] }[] {
  const by = new Map<string, CalendarEvent[]>();
  const put = (k: string, e: CalendarEvent): void => {
    const l = by.get(k);
    if (l) l.push(e);
    else by.set(k, [e]);
  };
  for (const e of events) {
    const first = dayOfEvent(e, tz);
    put(first, e);
    if (e.end != null && e.allDay && e.kind === "weekend") {
      for (let k = addDays(first, 1); wallToUtc({ y: +k.slice(0, 4), m: +k.slice(5, 7), d: +k.slice(8, 10), h: 0, min: 0 }, tz) < e.end; k = addDays(k, 1)) put(k, e);
    }
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, list]) => ({ day, events: list }));
}

export interface MonthCell {
  key: string;
  /** day of month */
  d: number;
  inMonth: boolean;
}

/** The weeks (Monday first) of a month as day keys – the grid of the month view. */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const firstKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lead = (weekdayOfKey(firstKey) + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < total; i++) {
    const key = addDays(firstKey, i - lead);
    cells.push({ key, d: +key.slice(8, 10), inMonth: +key.slice(5, 7) === month });
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
