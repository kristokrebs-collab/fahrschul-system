/**
 * Verpasste Gewinner gegen verpasste Verlierer (F32): which recurring traits the missed signals that reached their target
 * first have, set against the missed signals that hit the stop first. Pure, deterministic.
 *
 * Honesty rules:
 * - Only from `TRAIT_MIN_DECIDED` (20) missed signals with a decided outcome on – below that the result says how many are
 *   missing and shows nothing else. Both groups need at least `TRAIT_MIN_GROUP` (3) signals.
 * - A trait value is listed from `TRAIT_MIN_VALUE` (5) signals on. Its hit rate comes with the 80 % Wilson interval and the
 *   hit rate of ALL decided missed signals next to it; it is `auffällig` only when the whole interval lies on one side of that
 *   overall rate. With this many traits some will stand out by chance – the card says so.
 * - Counterexamples are always returned: for a trait value that looks good, the signals WITH that trait that lost (and the
 *   other way round). A trait is an observation about these signals, never a cause.
 */
import { wilson } from "../analytics/stats";
import type { SignalEvent } from "./archive";
import { SOURCE_LABEL } from "./archive";
import { isDecided, type OutcomeMap } from "./outcome";

export const TRAIT_MIN_DECIDED = 20;
export const TRAIT_MIN_GROUP = 3;
export const TRAIT_MIN_VALUE = 5;
export const TRAIT_COUNTER_MAX = 3;
export const TRAIT_ROWS_MAX = 10;

export type TraitDim = "side" | "type" | "tf" | "time" | "strength" | "symbol";
export const TRAIT_DIM_LABEL: Readonly<Record<TraitDim, string>> = { side: "Richtung", type: "Art", tf: "Zeiteinheit", time: "Tageszeit", strength: "Stärke", symbol: "Markt" };

const TYPE_LABEL = (e: SignalEvent): string => (e.source === "box" ? (e.kind === "scan" ? "Box-Scanner" : "Box-Setup") : e.source === "key" ? "Schlüsselmarke" : SOURCE_LABEL.entry);
const TIME_LABEL = (ms: number): string => {
  const h = new Date(ms).getHours();
  return h < 6 ? "Nacht (0–6 Uhr)" : h < 12 ? "Vormittag (6–12 Uhr)" : h < 18 ? "Nachmittag (12–18 Uhr)" : "Abend (18–24 Uhr)";
};

/** The trait values of one event, per dimension (`null` = the event has none). */
export function traitsOf(e: SignalEvent): Record<TraitDim, string | null> {
  return {
    side: e.side === "long" ? "Long" : e.side === "short" ? "Short" : null,
    type: TYPE_LABEL(e),
    tf: e.tf,
    time: TIME_LABEL(e.at),
    strength: e.strength != null ? `Stärke ${e.strength}` : null,
    symbol: e.symbol || null,
  };
}

export interface TraitRow {
  dim: TraitDim;
  value: string;
  winners: number;
  losers: number;
  /** winners ÷ (winners + losers) */
  rate: number;
  /** 80 % Wilson interval of `rate` */
  lo: number;
  hi: number;
  /** the interval lies fully above / below the overall rate */
  stands: "higher" | "lower" | null;
  /** up to `TRAIT_COUNTER_MAX` signals WITH this trait that went the other way round (newest first): losers for a high rate, winners otherwise */
  counter: SignalEvent[];
}

export interface TraitReport {
  /** missed signals with a decided outcome */
  decided: number;
  winners: number;
  losers: number;
  /** hit rate of all decided missed signals */
  overall: number | null;
  /** enough signals for a comparison */
  enough: boolean;
  /** why not (German), `null` when it is enough */
  blocked: string | null;
  rows: TraitRow[];
}

/** Compares the decided MISSED signals (`missed` = events nobody traded) by their traits. */
export function compareTraits(missed: readonly SignalEvent[], outcomes: OutcomeMap): TraitReport {
  const decided = missed.filter((e) => isDecided(outcomes.get(e.id)));
  const isWin = (e: SignalEvent): boolean => outcomes.get(e.id)!.kind === "target";
  const winners = decided.filter(isWin).length;
  const losers = decided.length - winners;
  const overall = decided.length ? winners / decided.length : null;
  const base = { decided: decided.length, winners, losers, overall };
  if (decided.length < TRAIT_MIN_DECIDED) return { ...base, enough: false, blocked: `Ein Vergleich beginnt bei ${TRAIT_MIN_DECIDED} verpassten Signalen mit Ausgang – bisher ${decided.length}.`, rows: [] };
  if (winners < TRAIT_MIN_GROUP || losers < TRAIT_MIN_GROUP) {
    return { ...base, enough: false, blocked: `Beide Gruppen brauchen mindestens ${TRAIT_MIN_GROUP} Signale – bisher ${winners} Gewinner und ${losers} Verlierer.`, rows: [] };
  }
  const groups = new Map<string, { dim: TraitDim; value: string; events: SignalEvent[] }>();
  for (const e of decided) {
    const t = traitsOf(e);
    for (const dim of Object.keys(t) as TraitDim[]) {
      const value = t[dim];
      if (!value) continue;
      const k = `${dim}|${value}`;
      const g = groups.get(k);
      if (g) g.events.push(e);
      else groups.set(k, { dim, value, events: [e] });
    }
  }
  const rows: TraitRow[] = [];
  for (const g of groups.values()) {
    if (g.events.length < TRAIT_MIN_VALUE) continue;
    const w = g.events.filter(isWin).length;
    const l = g.events.length - w;
    const rate = w / g.events.length;
    const ci = wilson(w, g.events.length);
    const stands = ci.lo > overall! ? "higher" : ci.hi < overall! ? "lower" : null;
    const wantLoser = rate >= overall!;
    const counter = g.events
      .filter((e) => isWin(e) !== wantLoser)
      .sort((a, b) => b.at - a.at)
      .slice(0, TRAIT_COUNTER_MAX);
    rows.push({ dim: g.dim, value: g.value, winners: w, losers: l, rate, lo: ci.lo, hi: ci.hi, stands, counter });
  }
  rows.sort((a, b) => Math.abs(b.rate - overall!) - Math.abs(a.rate - overall!) || b.winners + b.losers - (a.winners + a.losers) || a.value.localeCompare(b.value));
  return { ...base, enough: true, blocked: null, rows: rows.slice(0, TRAIT_ROWS_MAX) };
}
