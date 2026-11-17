/**
 * Duplicate check against the trades already in the journal (F29 / F30 "Dublettenprüfung") – pure.
 *
 * "Wahrscheinlich schon vorhanden": same market, same side, entry price within ±0.05 % and entry time within ±10
 * minutes. A closing order whose opening order is not in the screenshot is compared by its EXIT (price and time of
 * the stored trade's exit) instead. The check needs the entry (or that exit) time – a planned order or a reading without a time cannot be judged and says so
 * (`unjudged`), it is never reported as "no duplicate".
 */
import { fillStats } from "@/domain/fills";
import type { Trade } from "@/domain/types";
import { averagePrice, firstAt, lastAt, pairKey, type Candidate } from "./candidate";
import { minutesBetween } from "./time";

export const DUP_PRICE = 0.0005;
export const DUP_MINUTES = 10;

export interface DuplicateMatch {
  trade: Trade;
  /** Relative entry price difference. */
  priceDiff: number;
  /** Minutes between the entry times (the exit times for `by: "exit"`). */
  minutes: number;
  /** What was compared: the entry (default), or the exit when the screenshot shows no opening order. */
  by?: "entry" | "exit";
}

/** Ø entry price of a stored trade (fills win, as in the derivation). */
export function storedEntry(t: Pick<Trade, "entry" | "fills" | "side">): number | null {
  if (t.fills?.length) {
    const s = fillStats(t.fills, t.side);
    if (s.avgEntry != null) return s.avgEntry;
  }
  return t.entry ?? null;
}

/** Entry times of a stored trade: its `date` and the first opening fill. */
function storedTimes(t: Pick<Trade, "date" | "fills">): string[] {
  const out: string[] = [];
  if (t.date) out.push(t.date);
  const first = t.fills?.filter((f) => f.side === "open" && f.at).map((f) => f.at).sort()[0];
  if (first) out.push(first);
  return out;
}

/** Ø exit price of a stored trade (fills win when the position is flat). */
export function storedExit(t: Pick<Trade, "exit" | "fills" | "side">): number | null {
  if (t.fills?.length) {
    const s = fillStats(t.fills, t.side);
    if (s.avgExit != null) return s.avgExit;
  }
  return t.exit ?? null;
}

/** Exit times of a stored trade: its `exitDate` and the last closing fill. */
function storedExitTimes(t: Pick<Trade, "exitDate" | "fills">): string[] {
  const out: string[] = [];
  if (t.exitDate) out.push(t.exitDate);
  const last = t.fills?.filter((f) => f.side === "close" && f.at).map((f) => f.at).sort().at(-1);
  if (last) out.push(last);
  return out;
}

/** A closing order without its opening order (or with an entry only computed from its result) is compared by its exit instead. */
const byExit = (c: Candidate): boolean => c.status !== "planned" && (!c.entries.length || !!c.entryAssumed) && c.exits.length > 0;

/** Why a candidate cannot be checked (`null` = it can). */
export function unjudged(c: Candidate): string | null {
  if (c.status === "planned") return "Geplante Order – keine Ausführung zum Vergleichen.";
  if (byExit(c)) return lastAt(c.exits) ? null : "Ohne Ausstiegszeit lässt sich die Dublette nicht prüfen.";
  if (!c.entries.length) return "Geplante Order – keine Ausführung zum Vergleichen.";
  if (!firstAt(c.entries)) return "Ohne Einstiegszeit lässt sich die Dublette nicht prüfen.";
  return null;
}

/** The stored trade this candidate most likely duplicates, or `null`. */
export function findDuplicate(c: Candidate, trades: readonly Trade[]): DuplicateMatch | null {
  if (unjudged(c)) return null;
  const key = pairKey(c.pair.value);
  const side = c.side.value;
  if (!key || !side) return null;
  const exitMode = byExit(c);
  const price = exitMode ? averagePrice(c.exits) : averagePrice(c.entries);
  const at = exitMode ? lastAt(c.exits) : firstAt(c.entries);
  if (price == null || !at) return null;
  let best: DuplicateMatch | null = null;
  for (const t of trades) {
    if (pairKey(t.pair) !== key || t.side !== side) continue;
    const e = exitMode ? storedExit(t) : storedEntry(t);
    if (e == null || e <= 0) continue;
    const priceDiff = Math.abs(e - price) / e;
    if (priceDiff > DUP_PRICE) continue;
    const times = exitMode ? storedExitTimes(t) : storedTimes(t);
    const minutes = Math.min(...times.map((s) => Math.abs(minutesBetween(s, at))).filter((m) => Number.isFinite(m)));
    if (!Number.isFinite(minutes) || minutes > DUP_MINUTES) continue;
    if (!best || minutes < best.minutes) best = { trade: t, priceDiff, minutes, ...(exitMode ? { by: "exit" as const } : {}) };
  }
  return best;
}
