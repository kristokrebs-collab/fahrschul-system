/**
 * Shared helpers of the coach (P04): time order, entry / close instants, the "usual" risk of a trader and a stable
 * string hash for seeds. Pure, deterministic, no I/O.
 *
 * Close time: `exitDate` when the trade has one (Journal v3), else its entry time – the same rule P05's limits use
 * (`closeAt` without guard marks), so a loss "closes" at its entry for old records and the revenge window stays the
 * Auswertung's (`findings.ts`: ≤ 60 min after a losing trade's entry).
 */
import type { AccountId, EnrichedTrade } from "../types";
import { closeAt, parseLocal } from "../risk/limits";
import { tradeTime } from "@/lib/dates";

export { closeAt, parseLocal };

/** Account of a trade (legacy records without one are Scalp, like everywhere else). */
export const accountOf = (t: { account?: AccountId }): AccountId => t.account ?? "scalp";

export const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Entry instant (epoch ms). */
export const entryMs = (t: Pick<EnrichedTrade, "date" | "createdAt">): number => +tradeTime(t);

/** Close instant (epoch ms): `exitDate`, else the entry time. */
export const closeMs = (t: Pick<EnrichedTrade, "id" | "date" | "createdAt"> & { exitDate?: string }): number => closeAt(t);

/** Trades in entry-time order (stable for equal times: id). */
export function byEntry<T extends Pick<EnrichedTrade, "id" | "date" | "createdAt">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => entryMs(a) - entryMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Size measure of a trade for "sized up" checks: the risk to the stop when the trade has one, else the notional.
 * `kind` tells which, so only like is compared with like.
 */
export function sizeOf(t: Pick<EnrichedTrade, "risk" | "size">): { kind: "risk" | "size"; v: number } | null {
  if (fin(t.risk) && t.risk > 0) return { kind: "risk", v: t.risk };
  if (fin(t.size) && t.size > 0) return { kind: "size", v: t.size };
  return null;
}

/** Median of a list (`null` when empty). */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Size of `t` relative to the median of the same measure over the previous `window` trades of the same account
 * (`null` with fewer than 5 comparable trades): 1.8 = 80 % more than usual.
 */
export function sizeRatio(t: EnrichedTrade, earlier: readonly EnrichedTrade[], window = 20): number | null {
  const me = sizeOf(t);
  if (!me) return null;
  const acc = accountOf(t);
  const xs: number[] = [];
  for (let i = earlier.length - 1; i >= 0 && xs.length < window; i--) {
    const e = earlier[i]!;
    if (e.id === t.id || accountOf(e) !== acc) continue;
    const s = sizeOf(e);
    if (s && s.kind === me.kind) xs.push(s.v);
  }
  if (xs.length < 5) return null;
  const m = median(xs);
  return m && m > 0 ? me.v / m : null;
}

/** FNV-1a 32-bit hash – a stable seed per candidate id (bootstrap intervals stay identical for the same journal). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

/** Whole minutes between two instants. */
export const minutesBetween = (a: number, b: number): number => Math.round(Math.abs(b - a) / 60_000);

/** "45 Min", "2 Std 10 Min" for a minute count. */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} Std ${m} Min` : `${h} Std`;
}

/** Decimal with a German comma ("1,8"). */
export const dec1 = (v: number): string => (Math.round(v * 10) / 10).toString().replace(".", ",").replace("-", "−");

/** Manual mistake tags of a trade (trimmed). */
export function manualTags(t: Pick<EnrichedTrade, "mistakes">): string[] {
  return Array.isArray(t.mistakes) ? t.mistakes.filter((m): m is string => typeof m === "string").map((m) => m.trim()) : [];
}

/** Behaviour flags the trader set on the trade (`psych.flags`, P06 editor). */
export function psychFlags(t: Pick<EnrichedTrade, "psych">): string[] {
  const f = t.psych?.flags;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}
