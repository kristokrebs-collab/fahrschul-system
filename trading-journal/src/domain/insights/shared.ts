/**
 * Shared helpers of the "Auswertung" metrics: one day-key function (every card buckets days the same way, so the
 * calendar, the discipline tracker, the recap and the edge score always agree), interpolation, intervals and the
 * compact number format of the calendar cells. Pure, no React.
 */
import type { AccountId, EnrichedTrade } from "../types";
import { localDateKey, tradeTime } from "@/lib/dates";
import { isFin, MINUS } from "@/lib/format";

/** Local calendar day of a trade, `YYYY-MM-DD` (entry time – trades carry no exit time). */
export function dayKeyOf(t: { date?: string | null; createdAt?: string | null }): string {
  return localDateKey(tradeTime(t));
}

/** `YYYY-MM-DD` → local midnight. */
export function dayFromKey(key: string): Date {
  const [y = "1970", m = "1", d = "1"] = key.split("-");
  return new Date(+y, +m - 1, +d);
}

/** Trades grouped by local day, insertion order = first appearance in `list`. */
export function groupByDay<T extends { date?: string | null; createdAt?: string | null }>(list: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = dayKeyOf(t);
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  return m;
}

/** Account of a trade (legacy records without `account` count as Scalp, like everywhere else). */
export const accountOf = (t: { account?: AccountId }): AccountId => t.account ?? "scalp";

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Piecewise-linear interpolation through `anchors` (`[x, y]`, ascending x). Below the first / above the last anchor
 * the end values hold. Continuous by construction – no cliffs between bands.
 */
export function piecewise(x: number, anchors: readonly (readonly [number, number])[]): number {
  if (!anchors.length) return 0;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (!(x > first[0])) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]!;
    const [x0, y0] = anchors[i - 1]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

export function mean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** z of a two-sided 80 % interval. */
export const Z80 = 1.2815515655446004;

/** Wilson score interval of a proportion `k / n` (default 80 %). `n = 0` → `[0, 1]`. */
export function wilson(k: number, n: number, z = Z80): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const fK1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fK0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/**
 * Compact amount for narrow cells: `|v| < 1000` → integer, `< 10k` → one decimal + `k` (`1,2k`), `< 1 Mio` → `12k`,
 * else `1,2M`. `signed` prefixes `+`; negatives use U+2212. Never longer than 6 characters (`+999k`, `−1,2M`).
 */
export function compact(v: number | null | undefined, signed = true): string {
  if (!isFin(v)) return "–";
  const a = Math.abs(v);
  let body: string;
  if (a < 999.5) body = fK0.format(a);
  else if (a < 9950) body = fK1.format(a / 1000) + "k";
  else if (a < 999_500) body = fK0.format(a / 1000) + "k";
  else body = fK1.format(a / 1e6) + "M";
  if (body === "0") return "0";
  return (v < 0 ? MINUS : signed && v > 0 ? "+" : "") + body;
}

/** Most frequent string of a list (ties → first seen), or `null`. */
export function mode(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Sort helper: closed trades by trade time ascending (stable for equal times). */
export function byTime<T extends { date?: string | null; createdAt?: string | null }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => +tradeTime(a) - +tradeTime(b));
}

export type ClosedTrades = readonly EnrichedTrade[];
