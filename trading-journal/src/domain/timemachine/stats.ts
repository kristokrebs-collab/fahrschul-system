/**
 * Small statistics of the Zeitmaschine (pure): Wilson intervals for shares, mean ± t-interval, quantiles, quartiles and the
 * histogram of R outcomes. Everything works on plain arrays so the worker needs nothing else. Too little data gives `null`,
 * never a made-up number.
 */
import type { Hist, HistBin, Mean, Prob, Quart } from "./types";

const Z95 = 1.959964;

/** mulberry32: a fast seeded PRNG in [0, 1) (the same generator as `analytics/stats`, kept here so the worker stays small). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `k` of `n` with the 95 % Wilson interval (n = 0 → p 0 and the whole 0…1 range). */
export function prob(k: number, n: number): Prob {
  if (!(n > 0)) return { k, n: 0, p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = Z95 * Z95;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { k, n, p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Two-sided 95 % critical value of Student's t (exact table to 30 degrees of freedom, then the usual steps). */
const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export function tCrit95(df: number): number {
  if (!(df >= 1)) return NaN;
  if (df <= 30) return T95[Math.floor(df)]!;
  if (df <= 40) return 2.021;
  if (df <= 60) return 2.0;
  if (df <= 120) return 1.98;
  return 1.96;
}

/** Mean, sample sd and the 95 % interval of the mean (`null` below 2 values). */
export function meanOf(xs: ArrayLike<number>, n = xs.length): Mean | null {
  if (n < 2) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i]!;
  const m = s / n;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m;
    q += d * d;
  }
  const sd = Math.sqrt(q / (n - 1));
  const half = tCrit95(n - 1) * (sd / Math.sqrt(n));
  return { n, mean: m, sd, lo: m - half, hi: m + half };
}

/** Quantile `p` (0–1) of an ASCENDING list, linear interpolation (type 7). */
export function quantile(sorted: ArrayLike<number>, p: number, n = sorted.length): number {
  if (n <= 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Quartiles of a list of counts, `null` when empty. */
export function quart(xs: readonly number[]): Quart | null {
  if (!xs.length) return null;
  const s = Float64Array.from(xs).sort();
  return { n: xs.length, p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75) };
}

/**
 * Histogram of R outcomes in bins that sit on multiples of a "nice" width, so −1 R and the target's R fall on bin edges.
 * Width 0,25 R (0,5 / 1 R when the range is wide), at most `maxBins` bins; the range is the data's own, widened to hold
 * the stop and the target.
 */
export function histogram(values: ArrayLike<number>, n: number, keep: readonly number[], maxBins = 44): Hist {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (const k of keep) {
    lo = Math.min(lo, k);
    hi = Math.max(hi, k);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { bins: [], width: 0.25 };
  let width = 0.25;
  for (const w of [0.25, 0.5, 1, 2, 5, 10]) {
    width = w;
    if (Math.ceil(hi / w) - Math.floor(lo / w) <= maxBins) break;
  }
  const first = Math.floor(lo / width + 1e-9);
  const last = Math.max(first + 1, Math.ceil(hi / width - 1e-9));
  const bins: HistBin[] = [];
  for (let b = first; b < last; b++) bins.push({ lo: b * width, hi: (b + 1) * width, n: 0 });
  for (let i = 0; i < n; i++) {
    const idx = Math.min(bins.length - 1, Math.max(0, Math.floor(values[i]! / width + 1e-9) - first));
    bins[idx]!.n++;
  }
  return { bins, width };
}
