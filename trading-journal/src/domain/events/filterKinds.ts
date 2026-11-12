/**
 * The vocabulary of the Labor's event filter (F43), kept free of imports so the filter types (`@/domain/lab/filters/types`)
 * can use it without a cycle with the mask code (`filterMask.ts`).
 */
export type EventFilterKind = "funding" | "expiry" | "usOpen";
export const EVENT_FILTER_KINDS: readonly EventFilterKind[] = ["funding", "expiry", "usOpen"];

export const EVENT_FILTER_LABEL: Readonly<Record<EventFilterKind, string>> = {
  funding: "Funding",
  expiry: "Verfall",
  usOpen: "US-Börsenöffnung",
};

/** What the lab shows for the kinds it cannot offer. */
export const EVENT_FILTER_REASON =
  "Nur Termine, die sich nach einer Regel für jede Kerze berechnen lassen. FOMC-Termine liegen nur für 2021–2027 vor und eigene Termine nur ab dem Eintrag – ein Filter über einen längeren Zeitraum würde nur einen Teil der Historie filtern.";

/** Minutes before AND after an appointment during which no entry is taken. */
export const EVENT_MINUTES = { min: 15, max: 240, step: 15, def: 60 } as const;

export const DEFAULT_EVENT_KINDS: readonly EventFilterKind[] = ["funding", "expiry", "usOpen"];

export const isEventFilterKind = (v: unknown): v is EventFilterKind => typeof v === "string" && (EVENT_FILTER_KINDS as readonly string[]).includes(v);

/** Any stored value → minutes in range, rounded to the step; `null` when it is not a number. */
export function eventMinutesOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const { min, max, step } = EVENT_MINUTES;
  return Math.max(min, Math.min(max, Math.round(v / step) * step));
}

/** Any stored value → the valid kinds in the fixed order; `null` when nothing valid is left. */
export function eventKindsOf(v: unknown): EventFilterKind[] | null {
  if (!Array.isArray(v)) return null;
  const kinds = EVENT_FILTER_KINDS.filter((k) => v.includes(k));
  return kinds.length ? kinds : null;
}
