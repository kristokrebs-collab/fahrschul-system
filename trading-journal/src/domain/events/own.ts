/**
 * `settings.events` – the versioned passthrough key of the trader's OWN appointments (F43): `{ v: 1, items: [{ id, title,
 * at, importance, note }] }`, `at` = instant in ms UTC. Everything else of the calendar is computed or comes from a
 * source with a date; this is the one place the trader types a time himself (a CPI release he looked up, a token unlock, a
 * court date), and the calendar says so ("Eigener Eintrag").
 *
 * Like `settings.keyLevels` the key survives `normalizeSettings`, the backup and the cloud / two-tab merge (`items` is an
 * array of objects with a string `id`, so two devices merge per appointment). Reading is strict per entry: an entry this
 * version cannot read goes to `rejected` and is written back untouched, never repaired; unknown keys of the root survive.
 */
import type { CalendarEvent, Importance, OwnEvent } from "./types";
import { IMPORTANCES } from "./types";

export const EVENTS_VERSION = 1 as const;
export const MAX_OWN_EVENTS = 200;
export const MAX_TITLE = 80;
export const MAX_NOTE = 200;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export const OWN_SOURCE = { label: "Eigener Eintrag", rule: "Von dir eingetragen – Name, Zeit und Wichtigkeit sind deine Angaben." } as const;

export interface ParsedOwnEvents {
  v: typeof EVENTS_VERSION;
  items: OwnEvent[];
  /** stored entries this version could not read – written back untouched */
  rejected: unknown[];
}

export const EMPTY_OWN: ParsedOwnEvents = Object.freeze({ v: EVENTS_VERSION, items: [], rejected: [] }) as ParsedOwnEvents;

/** One stored entry → `OwnEvent`, or `null` when it cannot be read. */
export function normalizeOwnEvent(raw: unknown): OwnEvent | null {
  if (!isObj(raw)) return null;
  const at = typeof raw.at === "number" ? raw.at : NaN;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE) : "";
  if (typeof raw.id !== "string" || !raw.id || !Number.isFinite(at) || at < 0 || !title) return null;
  const importance: Importance = (IMPORTANCES as readonly unknown[]).includes(raw.importance) ? (raw.importance as Importance) : "mittel";
  return { id: raw.id, title, at: Math.round(at), importance, note: typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE) : "" };
}

/** `settings.events` (anything) → the appointments, newest id wins on a duplicate. */
export function ownEventsOf(raw: unknown): ParsedOwnEvents {
  if (!isObj(raw)) return EMPTY_OWN;
  const items: OwnEvent[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const e = normalizeOwnEvent(entry);
    if (!e) rejected.push(entry);
    else if (!seen.has(e.id) && items.length < MAX_OWN_EVENTS) {
      seen.add(e.id);
      items.push(e);
    }
  }
  return { v: EVENTS_VERSION, items, rejected };
}

/** The appointments of a settings object. */
export const ownEventsOfSettings = (s: { events?: unknown } | null | undefined): ParsedOwnEvents => ownEventsOf(s?.events);

/** JSON with every object's keys sorted – two writes of the same data compare equal whatever the key order. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/**
 * `settings.events` with `items` replaced – unknown keys of the root and the `rejected` entries survive. Returns the SAME
 * object when nothing changes (the caller skips the save).
 */
export function withOwnEvents(raw: unknown, items: readonly OwnEvent[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = ownEventsOf(raw);
  const next: Record<string, unknown> = { ...prev, v: EVENTS_VERSION, items: [...items.slice(0, MAX_OWN_EVENTS), ...cur.rejected] };
  const same = isObj(raw) && canon(prev) === canon(next);
  return same ? (raw as Record<string, unknown>) : next;
}

/** The appointment list with `e` added or replaced (by id). */
export function upsertOwn(items: readonly OwnEvent[], e: OwnEvent): OwnEvent[] {
  return items.some((x) => x.id === e.id) ? items.map((x) => (x.id === e.id ? e : x)) : [...items, e];
}

/** Own appointments in `[from, to)` as calendar events. */
export function ownCalendarEvents(items: readonly OwnEvent[], from: number, to: number): CalendarEvent[] {
  return items
    .filter((e) => e.at >= from && e.at < to)
    .map((e) => ({
      id: `own:${e.id}`,
      kind: "own" as const,
      title: e.title,
      at: e.at,
      importance: e.importance,
      ...(e.note ? { detail: e.note } : {}),
      source: { ...OWN_SOURCE },
    }));
}
