/**
 * "Ergebnis nach Signal-Stärke" + the effect of each entry condition, from the entry-check snapshot stored on the
 * trade (`trade.signal`, the other journal's `SignalSnap` or ours – read with `parseSignalSnapshot`).
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { mtfAutoChecks, parseSignalSnapshot, STRENGTH_LABEL, type MtfItem, type SignalSnapshot } from "../signals";

const cache = new WeakMap<object, SignalSnapshot | null>();

/** Parsed `trade.signal` (memoised per stored value), `null` when the trade has no (valid) snapshot. */
export function snapOf(t: Pick<EnrichedTrade, "signal">): SignalSnapshot | null {
  const raw = t.signal;
  if (raw == null || typeof raw !== "object") return null;
  if (cache.has(raw)) return cache.get(raw) ?? null;
  const s = parseSignalSnapshot(raw);
  cache.set(raw, s);
  return s;
}

export type StrengthKey = 4 | 3 | 2 | 1 | 0 | "none";
export const STRENGTH_ORDER: readonly StrengthKey[] = [4, 3, 2, 1, 0, "none"];
export const NO_CHECK_LABEL = "Ohne Check";

export interface StrengthRow {
  key: StrengthKey;
  label: string;
  g: Agg;
  trades: EnrichedTrade[];
}

export interface StrengthResult {
  /** non-empty rows, strongest first, "Ohne Check" last */
  rows: StrengthRow[];
  /** closed trades with a snapshot */
  withCheck: number;
}

/** Closed trades grouped by the stored strength (0…4) or "Ohne Check". */
export function strengthRows(closed: readonly EnrichedTrade[]): StrengthResult {
  const by = new Map<StrengthKey, EnrichedTrade[]>();
  let withCheck = 0;
  for (const t of closed) {
    const s = snapOf(t);
    const k: StrengthKey = s ? (s.strength as 0 | 1 | 2 | 3 | 4) : "none";
    if (s) withCheck++;
    const arr = by.get(k);
    if (arr) arr.push(t);
    else by.set(k, [t]);
  }
  const rows = STRENGTH_ORDER.filter((k) => by.has(k)).map((k) => {
    const trades = by.get(k)!;
    return { key: k, label: k === "none" ? NO_CHECK_LABEL : (STRENGTH_LABEL[k] ?? String(k)), g: aggregate(trades), trades };
  });
  return { rows, withCheck };
}

export const CONDITION_LABELS: Readonly<Record<MtfItem, string>> = {
  mtf_base: "Signal auf der Basis-Timeframe",
  mtf_next: "Nächst höhere Timeframe bestätigt",
  mtf_third: "Dritte Timeframe bestätigt",
  mtf_rsi: "RSI nahe Extrem",
  mtf_zone: "Zone passt (Discount / Premium)",
};
export const CONDITION_ORDER: readonly MtfItem[] = ["mtf_base", "mtf_next", "mtf_third", "mtf_rsi", "mtf_zone"];

export interface ConditionEffect {
  key: MtfItem;
  label: string;
  /** trades (with a snapshot) where the condition held */
  met: Agg;
  /** … where it did not */
  missed: Agg;
  /** win-rate difference met − missed (fraction), `null` when one side is empty */
  dWin: number | null;
  /** Ø R difference met − missed, `null` when one side has no R */
  dR: number | null;
  /** Ø P&L difference met − missed, `null` when one side is empty */
  dExp: number | null;
}

/** Effect of each entry condition among the closed trades that carry a snapshot (same maths as the checklist item delta). */
export function conditionEffects(closed: readonly EnrichedTrade[]): ConditionEffect[] {
  const withSnap = closed.map((t) => ({ t, s: snapOf(t) })).filter((x): x is { t: EnrichedTrade; s: SignalSnapshot } => x.s !== null);
  if (!withSnap.length) return [];
  const checks = withSnap.map((x) => ({ t: x.t, c: mtfAutoChecks(x.s) }));
  return CONDITION_ORDER.map((key) => {
    const met = aggregate(checks.filter((x) => x.c[key]).map((x) => x.t));
    const missed = aggregate(checks.filter((x) => !x.c[key]).map((x) => x.t));
    const both = met.n > 0 && missed.n > 0;
    return {
      key,
      label: CONDITION_LABELS[key],
      met,
      missed,
      dWin: both ? (met.winRate ?? 0) - (missed.winRate ?? 0) : null,
      dR: met.avgR != null && missed.avgR != null ? met.avgR - missed.avgR : null,
      dExp: both ? (met.exp ?? 0) - (missed.exp ?? 0) : null,
    };
  });
}
