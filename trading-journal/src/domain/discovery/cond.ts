/**
 * Classes and conditions: how a feature is cut into the classes that are tested (halves, terciles, quintiles for numbers, the
 * values for categories) and how a class becomes a condition that can be read back on any trade. The cut points always come
 * from the DISCOVERY part only; the confirmation part and the backtest filter apply the very same numbers.
 */
import { quantileSorted } from "../analytics/stats";
import { FEATURES } from "./features";
import type { Cond, FeatureId, FeatureValue } from "./types";

/** A feature cut into classes. Number: class c holds `cuts[c − 1] ≤ x < cuts[c]` (open ends at both sides). Category: class c is `levels[c]`. */
export interface Binning {
  f: FeatureId;
  kind: "num" | "cat";
  cuts: number[];
  levels: string[];
  /** number of classes */
  size: number;
}

export type BinMode = "half" | "tercile" | "quintile";
const PROBS: Readonly<Record<BinMode, readonly number[]>> = { half: [0.5], tercile: [1 / 3, 2 / 3], quintile: [0.2, 0.4, 0.6, 0.8] };

/** Sorted, de-duplicated cut points at the given probabilities of the (non-empty) values. */
export function quantileCuts(values: readonly number[], mode: BinMode): number[] {
  if (values.length === 0) return [];
  const sorted = Float64Array.from(values).sort();
  const out: number[] = [];
  for (const p of PROBS[mode]) {
    const q = quantileSorted(sorted, p);
    if (q != null && Number.isFinite(q) && (out.length === 0 || q > out[out.length - 1]!)) out.push(q);
  }
  return out;
}

export function numBinning(f: FeatureId, values: readonly number[], mode: BinMode): Binning {
  const cuts = quantileCuts(values, mode);
  return { f, kind: "num", cuts, levels: [], size: cuts.length + 1 };
}

/** Categories: the values with at least `minCount` trades, most frequent first (ties alphabetical), at most `max`. */
export function catBinning(f: FeatureId, values: readonly (string | null)[], minCount: number, max = 12): Binning {
  const count = new Map<string, number>();
  for (const v of values) if (v != null) count.set(v, (count.get(v) ?? 0) + 1);
  const levels = [...count.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([v]) => v);
  return { f, kind: "cat", cuts: [], levels, size: levels.length };
}

/** Class of a value in a binning; −1 for a missing value or a category that is not a class. */
export function classOf(b: Binning, v: FeatureValue | undefined): number {
  if (v == null) return -1;
  if (b.kind === "cat") return typeof v === "string" ? b.levels.indexOf(v) : -1;
  if (typeof v !== "number" || !Number.isFinite(v)) return -1;
  let c = 0;
  while (c < b.cuts.length && v >= b.cuts[c]!) c++;
  return c;
}

/** The condition of class `c`. */
export function condOf(b: Binning, c: number): Cond {
  if (b.kind === "cat") return { f: b.f, k: "cat", v: b.levels[c]! };
  return { f: b.f, k: "num", lo: c > 0 ? b.cuts[c - 1]! : null, hi: c < b.cuts.length ? b.cuts[c]! : null };
}

/** Does the value satisfy the condition? A missing value never does. */
export function condHolds(c: Cond, v: FeatureValue | undefined): boolean {
  if (v == null) return false;
  if (c.k === "cat") return v === c.v;
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return (c.lo == null || v >= c.lo) && (c.hi == null || v < c.hi);
}

/** Canonical id of a set of conditions (feature order fixed, full-precision numbers). */
export function condsKey(conds: readonly Cond[]): string {
  return [...conds]
    .sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0))
    .map((c) => (c.k === "cat" ? `${c.f}=${c.v}` : `${c.f}[${c.lo ?? "-"},${c.hi ?? "-"})`))
    .join(" & ");
}

/** Does the conditions' feature set include one that is known only after the trade? */
export const isPostEntry = (conds: readonly Cond[]): boolean => conds.some((c) => FEATURES[c.f].phase === "after");

/** 32-bit FNV-1a hash of a string (stable seeds per finding). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
