/**
 * Varianten- und Filtervergleich (F17): the optional filters, their parameters and which of them the data of a run can
 * actually support. A filter is a yes / no on a signal AT the close of its candle (same information the strategy had);
 * it never invents a signal and never sees the next candle. Filters the data cannot support stay in the list, switched
 * off WITH the reason – never silently dropped.
 */
import type { LabStrategyId } from "../../backtest/job";
import type { HistInterval } from "../../backtest/types";
import { HIST_MS } from "../../backtest/types";
import { sanitizePatternSpec, type PatternFilterSpec } from "../../discovery/spec";
import { DEFAULT_EVENT_KINDS, EVENT_FILTER_LABEL, EVENT_MINUTES, eventKindsOf, eventMinutesOf, type EventFilterKind } from "../../events/filterKinds";

export const FILTER_VERSION = 1 as const;

export type FilterId = "rsi" | "trend" | "retest" | "topTrader" | "pattern" | "event";
export const FILTER_IDS: readonly FilterId[] = ["rsi", "trend", "retest", "topTrader", "pattern", "event"];

/** The user's choice (persisted by the Labor page; versioned like the other lab settings). */
export interface FilterSelection {
  v: typeof FILTER_VERSION;
  on: FilterId[];
  /** RSI zone: a long needs RSI(14) at or below this level, a short at or above 100 − level ("not overheated") */
  rsiLimit: number;
  /** trend: the higher timeframe's close against its EMA of this length (long above, short below) */
  trendLen: number;
  /** pattern: a confirmed finding of the Muster-Entdecker, chosen by the user ("Mit diesem Filter testen"); absent = none chosen */
  pattern?: PatternFilterSpec;
  /** event (F43): no entry this many minutes before / after an appointment of the chosen kinds; absent = 60 minutes, funding · expiry · US open */
  eventMinutes?: number;
  eventKinds?: EventFilterKind[];
}

export const FILTER_LIMITS = { rsiLimit: { min: 55, max: 90, step: 5 }, trendLen: { min: 5, max: 100, step: 5 } } as const;

export const DEFAULT_FILTERS: FilterSelection = { v: FILTER_VERSION, on: [], rsiLimit: 70, trendLen: 20 };

const clampInt = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

/** Any stored value → a valid selection (unknown versions and broken values fall back to the defaults). */
export function sanitizeFilters(raw: unknown): FilterSelection {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FilterSelection>;
  if (r.v !== undefined && r.v !== FILTER_VERSION) return DEFAULT_FILTERS;
  const on = Array.isArray(r.on) ? FILTER_IDS.filter((id) => (r.on as unknown[]).includes(id)) : [];
  const pattern = sanitizePatternSpec(r.pattern);
  const eventMinutes = eventMinutesOf(r.eventMinutes);
  const eventKinds = eventKindsOf(r.eventKinds);
  return {
    v: FILTER_VERSION,
    on,
    rsiLimit: clampInt(r.rsiLimit, FILTER_LIMITS.rsiLimit.min, FILTER_LIMITS.rsiLimit.max, DEFAULT_FILTERS.rsiLimit),
    trendLen: clampInt(r.trendLen, FILTER_LIMITS.trendLen.min, FILTER_LIMITS.trendLen.max, DEFAULT_FILTERS.trendLen),
    ...(pattern ? { pattern } : {}),
    ...(eventMinutes !== null ? { eventMinutes } : {}),
    ...(eventKinds ? { eventKinds } : {}),
  };
}

export interface FilterInfo {
  id: FilterId;
  label: string;
  /** what it asks, in one sentence (with the parameter when `sel` is given) */
  sub: string;
  available: boolean;
  /** why it is locked (null when available) */
  reason: string | null;
}

/** Higher timeframe the trend filter reads: the first of 1h / 4h / 1D / 1W that is at least four execution candles long. */
export function trendTimeframe(interval: HistInterval): { sec: number; label: string } {
  const exec = HIST_MS[interval] / 1000;
  const steps: readonly [number, string][] = [
    [3600, "1h"],
    [14_400, "4h"],
    [86_400, "1D"],
    [604_800, "1W"],
  ];
  const hit = steps.find(([sec]) => sec >= exec * 4) ?? steps[steps.length - 1]!;
  return { sec: hit[0], label: hit[1] };
}

const de = (v: number): string => String(v).replace(".", ",");

/** The filters with their availability for a strategy on an execution interval. */
export function filterInfos(strategy: LabStrategyId, interval: HistInterval, sel: FilterSelection = DEFAULT_FILTERS): FilterInfo[] {
  const tf = trendTimeframe(interval);
  const list: FilterInfo[] = [
    { id: "rsi", label: "RSI-Zone", sub: `Long nur bei RSI(14) bis ${de(sel.rsiLimit)}, Short nur ab ${de(100 - sel.rsiLimit)} – kein Einstieg in eine überhitzte Bewegung.`, available: true, reason: null },
    { id: "trend", label: "Höherer Trend", sub: `Long nur, wenn die ${tf.label}-Kerze über ihrem EMA ${sel.trendLen} schließt, Short nur darunter. Es zählen nur geschlossene ${tf.label}-Kerzen.`, available: true, reason: null },
    {
      id: "retest",
      label: "Retest",
      sub: "Nur Einstiege, die ein Retest des Ausbruchsniveaus sind.",
      available: strategy === "box",
      reason: strategy === "box" ? null : "Ein Retest braucht ein Ausbruchsniveau. Das liefert nur Box-zu-Box (Setup-Art „Retest“); die anderen Strategien kennen kein solches Niveau.",
    },
    {
      id: "topTrader",
      label: "Top-Trader-Quote",
      sub: "Nur Einstiege in Richtung der Top-Trader-Positionen.",
      available: false,
      reason: "Binance hält die Top-Trader-Quote nur für etwa die letzten 30 Tage vor. Für Zeiträume von Monaten gäbe es keine echten Werte, und erfundene Werte zählen nicht.",
    },
  ];
  // the pattern of the Muster-Entdecker is listed only once the user has chosen one there ("Mit diesem Filter testen")
  if (sel.pattern) {
    list.push({ id: "pattern", label: "Muster aus dem Muster-Entdecker", sub: `Nur Einstiege, bei denen gilt: ${sel.pattern.label}. Gerechnet aus den geschlossenen Kerzen vor dem Einstieg.`, available: true, reason: null });
  }
  // F43: the event filter is listed once the user has switched it on (the Labor card shows its own row for it, with the minutes and kinds)
  if (sel.on.includes("event")) {
    const minutes = sel.eventMinutes ?? EVENT_MINUTES.def;
    const kinds = (sel.eventKinds ?? DEFAULT_EVENT_KINDS).map((k) => EVENT_FILTER_LABEL[k]).join(", ");
    list.push({ id: "event", label: "Keine Einstiege rund um Termine", sub: `Kein Einstieg ${minutes} Minuten vor oder nach einem Termin (${kinds}). Es zählt der Zeitpunkt des Einstiegs: die Eröffnung der Kerze nach dem Signal.`, available: true, reason: null });
  }
  return list;
}

/** Filters that are chosen AND possible for this strategy, in the fixed order. */
export function activeFilters(sel: FilterSelection, strategy: LabStrategyId, interval: HistInterval): FilterId[] {
  const ok = new Set(filterInfos(strategy, interval, sel).filter((f) => f.available).map((f) => f.id));
  return FILTER_IDS.filter((id) => sel.on.includes(id) && ok.has(id));
}
