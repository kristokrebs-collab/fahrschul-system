/**
 * Ereigniskalender (F43): the appointments that count for trading, and where each one comes from. Only three kinds of
 * source exist, and every event says which one it is:
 *   1. a RULE that computes the time exactly (Funding grid, Deribit expiry, NYSE hours and holidays, the weekend),
 *   2. a PUBLIC list with source and fetch date (FOMC meetings of federalreserve.gov),
 *   3. what the trader enters himself (name, time, importance).
 * Nothing is estimated, no time is guessed: an appointment without a verified time is an all-day entry or not there.
 */

export type EventKind = "funding" | "expiry" | "usOpen" | "usClose" | "usHoliday" | "weekend" | "fomc" | "own";
export const EVENT_KINDS: readonly EventKind[] = ["funding", "expiry", "usOpen", "usClose", "usHoliday", "weekend", "fomc", "own"];

export type Importance = "hoch" | "mittel" | "niedrig";
export const IMPORTANCES: readonly Importance[] = ["hoch", "mittel", "niedrig"];
export const IMPORTANCE_RANK: Readonly<Record<Importance, number>> = { hoch: 3, mittel: 2, niedrig: 1 };

/** Where an event comes from: the rule or list, a link, and when the source was checked / fetched. */
export interface EventSource {
  /** "Deribit – Verfallstermine", "federalreserve.gov – FOMC-Kalender", "Eigener Eintrag" */
  label: string;
  /** how the time is obtained, in one sentence ("letzter Freitag des Monats, 08:00 UTC") */
  rule: string;
  url?: string;
  /** `YYYY-MM-DD` the rule or list was checked against its source; absent for an own entry */
  checkedAt?: string;
}

export interface CalendarEvent {
  /** stable: `<kind>:<time or day>` ("funding:2026-10-26T08:00Z", "fomc:2026-10-28") */
  id: string;
  kind: EventKind;
  title: string;
  /** start, ms UTC. All-day entries start at the beginning of their day in `dayZone` */
  at: number;
  /** end, ms UTC (all-day entries and the weekend) */
  end?: number;
  allDay?: boolean;
  /** all-day entries: the calendar day (`YYYY-MM-DD`) in `dayZone` */
  dayKey?: string;
  dayZone?: string;
  importance: Importance;
  /** one short line of context ("Quartalsverfall", "frühe Schließung 13:00 ET") */
  detail?: string;
  source: EventSource;
}

/** What the trader types in. `at` is an instant (ms UTC); the editor shows it in the chosen zone. */
export interface OwnEvent {
  id: string;
  title: string;
  at: number;
  importance: Importance;
  note: string;
}

export const KIND_LABEL: Readonly<Record<EventKind, string>> = {
  funding: "Funding",
  expiry: "Verfall",
  usOpen: "US-Börse öffnet",
  usClose: "US-Börse schließt",
  usHoliday: "US-Feiertag",
  weekend: "Wochenende",
  fomc: "FOMC",
  own: "Eigene Termine",
};

/** The chips of the calendar: several kinds share one chip ("US-Börse" = open, close, holiday). */
export interface KindGroup {
  id: "funding" | "expiry" | "us" | "fomc" | "weekend" | "own";
  label: string;
  kinds: readonly EventKind[];
}

export const KIND_GROUPS: readonly KindGroup[] = [
  { id: "expiry", label: "Verfall", kinds: ["expiry"] },
  { id: "fomc", label: "FOMC", kinds: ["fomc"] },
  { id: "us", label: "US-Börse", kinds: ["usOpen", "usClose", "usHoliday"] },
  { id: "funding", label: "Funding", kinds: ["funding"] },
  { id: "weekend", label: "Wochenende", kinds: ["weekend"] },
  { id: "own", label: "Eigene", kinds: ["own"] },
];

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 86_400_000;
