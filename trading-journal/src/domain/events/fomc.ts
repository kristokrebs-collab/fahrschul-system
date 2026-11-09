/**
 * FOMC meetings (F43): the list of `data/fomc.json`, copied on 25.10.2026 from the public calendar of the Federal Reserve
 * (`federalreserve.gov/monetarypolicy/fomccalendars.htm`, page updated 07.10.2026). Source and fetch date travel with every
 * event. The page gives dates, no times – so an FOMC entry is an ALL-DAY entry on the New York calendar day of the decision
 * (the second meeting day) and never carries a clock time. Years the list does not cover (before 2021, after 2027) are
 * "keine Daten", not "no meeting" (`fomcCovered`).
 */
import data from "./data/fomc.json";
import { US_ZONE } from "./usMarket";
import type { CalendarEvent, EventSource } from "./types";
import { addDays, wallToUtc } from "./zone";

export interface FomcMeeting {
  from: string;
  to: string;
  /** a meeting with a Summary of Economic Projections (marked * on the page) */
  sep: boolean;
}

export const FOMC_MEETINGS: readonly FomcMeeting[] = data.meetings;

/** `2026-10-25` → `25.10.2026` */
const de = (iso: string): string => iso.split("-").reverse().join(".");

export const FOMC_SOURCE: EventSource = {
  label: data.source.label,
  rule: `Termin laut Liste der Fed, abgerufen am ${de(data.source.fetchedAt)} (Seitenstand ${de(data.source.pageUpdated)}); ohne Uhrzeit, die Seite nennt keine.`,
  url: data.source.url,
  checkedAt: data.source.fetchedAt,
};

export const FOMC_NOTE: string = data.note;

const DECISION_DAYS: ReadonlySet<string> = new Set(FOMC_MEETINGS.map((m) => m.to));

/** First and last year the list covers. */
export const FOMC_YEARS: { from: number; to: number } = {
  from: Math.min(...FOMC_MEETINGS.map((m) => +m.from.slice(0, 4))),
  to: Math.max(...FOMC_MEETINGS.map((m) => +m.to.slice(0, 4))),
};

/** The list covers the New York day `key` (`YYYY-MM-DD`). */
export const fomcCovered = (key: string): boolean => +key.slice(0, 4) >= FOMC_YEARS.from && +key.slice(0, 4) <= FOMC_YEARS.to;

/** Is `key` (New York day) the decision day of an FOMC meeting? `null` when the list does not cover that year. */
export function isFomcDecisionDay(key: string): boolean | null {
  return fomcCovered(key) ? DECISION_DAYS.has(key) : null;
}

const day = (key: string): [number, number, number] => {
  const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
  return [y, m, d];
};

const dm = (key: string): string => `${key.slice(8, 10)}.${key.slice(5, 7)}.`;

/** FOMC decision days in `[from, to)` as all-day entries (New York day). */
export function fomcEvents(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const m of FOMC_MEETINGS) {
    const [y, mo, d] = day(m.to);
    const [ny, nmo, nd] = day(addDays(m.to, 1));
    const at = wallToUtc({ y, m: mo, d, h: 0, min: 0 }, US_ZONE);
    const next = wallToUtc({ y: ny, m: nmo, d: nd, h: 0, min: 0 }, US_ZONE);
    if (next <= from || at >= to) continue;
    out.push({
      id: `fomc:${m.to}`,
      kind: "fomc",
      title: m.sep ? "FOMC-Entscheidung (mit Projektionen)" : "FOMC-Entscheidung",
      at,
      end: next,
      allDay: true,
      dayKey: m.to,
      dayZone: US_ZONE,
      importance: "hoch",
      detail: `Sitzung ${dm(m.from)}–${dm(m.to)}, Entscheidung am zweiten Tag, Uhrzeit nicht in der Quelle`,
      source: FOMC_SOURCE,
    });
  }
  return out;
}
