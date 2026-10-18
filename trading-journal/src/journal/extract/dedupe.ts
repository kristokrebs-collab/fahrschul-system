/**
 * Duplicate check against the trades already in the journal (F29 / F30 "Dublettenprüfung") – pure.
 *
 * "Wahrscheinlich schon vorhanden": same market, same side, entry price within ±0.05 % and entry time within ±10
 * minutes. The check needs the entry time – a planned order or a reading without a time cannot be judged and says so
 * (`unjudged`), it is never reported as "no duplicate".
 */
import { fillStats } from "@/domain/fills";
import type { Trade } from "@/domain/types";
import { averagePrice, firstAt, pairKey, type Candidate } from "./candidate";
import { minutesBetween } from "./time";

export const DUP_PRICE = 0.0005;
export const DUP_MINUTES = 10;

export interface DuplicateMatch {
  trade: Trade;
  /** Relative entry price difference. */
  priceDiff: number;
  /** Minutes between the entry times. */
  minutes: number;
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

/** Why a candidate cannot be checked (`null` = it can). */
export function unjudged(c: Candidate): string | null {
  if (c.status === "planned" || !c.entries.length) return "Geplante Order – keine Ausführung zum Vergleichen.";
  if (!firstAt(c.entries)) return "Ohne Einstiegszeit lässt sich die Dublette nicht prüfen.";
  return null;
}

/** The stored trade this candidate most likely duplicates, or `null`. */
export function findDuplicate(c: Candidate, trades: readonly Trade[]): DuplicateMatch | null {
  if (unjudged(c)) return null;
  const key = pairKey(c.pair.value);
  const side = c.side.value;
  const entry = averagePrice(c.entries);
  const at = firstAt(c.entries);
  if (!key || !side || entry == null || !at) return null;
  let best: DuplicateMatch | null = null;
  for (const t of trades) {
    if (pairKey(t.pair) !== key || t.side !== side) continue;
    const e = storedEntry(t);
    if (e == null || e <= 0) continue;
    const priceDiff = Math.abs(e - entry) / e;
    if (priceDiff > DUP_PRICE) continue;
    const minutes = Math.min(...storedTimes(t).map((s) => Math.abs(minutesBetween(s, at))).filter((m) => Number.isFinite(m)));
    if (!Number.isFinite(minutes) || minutes > DUP_MINUTES) continue;
    if (!best || minutes < best.minutes) best = { trade: t, priceDiff, minutes };
  }
  return best;
}
