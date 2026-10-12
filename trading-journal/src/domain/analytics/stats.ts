/**
 * Statistics core of the Pro-Analytics (P03): moments, percentiles, the t / normal distributions, intervals, tests,
 * a seeded bootstrap, Benjamini-Hochberg and sample-size estimates. Pure, deterministic, no I/O.
 *
 * Conventions shared by every analytics module:
 * - Intervals are 80 % by default (`CI_LEVEL`) – the level the Auswertung already uses for "klar" / "Tendenz"
 *   (`wilson`, `Z80` from `insights/shared`, re-exported here so there is one implementation).
 * - Anything random takes a seed (`rng`, mulberry32): the same input always gives the same numbers.
 * - Too little data → `null`, never a made-up number.
 */
import { mean as meanOf, wilson, Z80 } from "../insights/shared";

export { wilson, Z80 };

/** Two-sided level of every interval (80 %, like the Auswertung's Wilson intervals). */
export const CI_LEVEL = 0.8;
/** False-discovery rate of the breakdown tests (Benjamini-Hochberg). */
export const FDR_Q = 0.1;
/** A raw p below this (but not FDR-significant) is a "Tendenz". */
export const TENDENCY_P = 0.2;

export interface Interval {
  lo: number;
  hi: number;
}

/** Honest verdict of a test: significant after FDR, a tendency, open, or too few trades to say anything. */
export type Significance = "klar" | "tendenz" | "offen" | "wenig";

// ── PRNG ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** mulberry32: a fast seeded PRNG in [0, 1). */
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

/** Finite numbers of a list. */
export const finite = (xs: readonly (number | null | undefined)[]): number[] => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

// ── Moments ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Arithmetic mean, `null` for an empty list (the Auswertung's `mean`). */
export const mean = meanOf;

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Sample variance (n − 1), `null` below 2 values. */
export function variance(xs: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const m = sum(xs) / n;
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

/** Sample standard deviation (n − 1), `null` below 2 values. */
export function sd(xs: readonly number[]): number | null {
  const v = variance(xs);
  return v == null ? null : Math.sqrt(v);
}

/** Downside deviation below `target` over ALL n values (Sortino's denominator): √(Σ min(0, x − target)² / n). */
export function downsideDeviation(xs: readonly number[], target = 0): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) {
    const d = Math.min(0, x - target);
    s += d * d;
  }
  return Math.sqrt(s / xs.length);
}

function centralMoments(xs: readonly number[]): { m2: number; m3: number; m4: number } {
  const n = xs.length;
  const m = sum(xs) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  return { m2: m2 / n, m3: m3 / n, m4: m4 / n };
}

/** Sample skewness (adjusted Fisher-Pearson G1), `null` below 3 values or without spread. > 0 = long right tail. */
export function skewness(xs: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const { m2, m3 } = centralMoments(xs);
  if (!(m2 > 1e-12)) return null;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

/** Sample EXCESS kurtosis (G2, normal = 0), `null` below 4 values or without spread. > 0 = fat tails. */
export function kurtosis(xs: readonly number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const { m2, m4 } = centralMoments(xs);
  if (!(m2 > 1e-12)) return null;
  const g2 = m4 / (m2 * m2) - 3;
  return (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3));
}

// ── Percentiles ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Quantile `p` (0–1) of an ASCENDING sorted list, linear interpolation (Hyndman-Fan type 7, like Excel / NumPy). */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export const sortedAsc = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

/** Quantile of an unsorted list. */
export function quantile(xs: readonly number[], p: number): number | null {
  return quantileSorted(sortedAsc(xs), p);
}

/** Several quantiles of one list (sorted once). */
export function percentiles(xs: readonly number[], ps: readonly number[]): (number | null)[] {
  const s = sortedAsc(xs);
  return ps.map((p) => quantileSorted(s, p));
}

export const median = (xs: readonly number[]): number | null => quantile(xs, 0.5);

/** Median absolute deviation (raw; × 1.4826 estimates σ for normal data). */
export function mad(xs: readonly number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/** MAD → σ for normal data. */
export const MAD_SIGMA = 1.4826;

// ── Distributions ───────────────────────────────────────────────────────────────────────────────────────────────

/** Standard normal CDF (Hart / West 2005, double precision). */
export function normCdf(z: number): number {
  const x = Math.abs(z);
  let c: number;
  if (x > 37) c = 0;
  else {
    const e = Math.exp((-x * x) / 2);
    if (x < 7.07106781186547) {
      let b = 3.52624965998911e-2 * x + 0.700383064443688;
      b = b * x + 6.37396220353165;
      b = b * x + 33.912866078383;
      b = b * x + 112.079291497871;
      b = b * x + 221.213596169931;
      b = b * x + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * x + 1.75566716318264;
      b = b * x + 16.064177579207;
      b = b * x + 86.7807322029461;
      b = b * x + 296.564248779674;
      b = b * x + 637.333633378831;
      b = b * x + 793.826512519948;
      b = b * x + 440.413735824752;
      c /= b;
    } else {
      let b = x + 0.65;
      b = x + 4 / b;
      b = x + 3 / b;
      b = x + 2 / b;
      b = x + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return z > 0 ? 1 - c : c;
}

/** Standard normal quantile (Acklam, refined with one Halley step on `normCdf` → double precision). */
export function normQuantile(p: number): number {
  const x = acklam(p);
  if (!Number.isFinite(x)) return x;
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

function acklam(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** z of a two-sided interval at `level` (0.8 → 1.2816). */
export const zFor = (level: number = CI_LEVEL): number => (level === 0.8 ? Z80 : normQuantile(0.5 + level / 2));

/** ln Γ(x) (Lanczos, g = 7). */
export function lnGamma(x: number): number {
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const xx = x - 1;
  let a = g[0]!;
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += g[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete beta (Numerical Recipes `betacf`). */
function betaCf(x: number, a: number, b: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(x, a, b)) / a : 1 - (bt * betaCf(1 - x, b, a)) / b;
}

/** Student-t CDF with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (!(df > 0)) return NaN;
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Student-t quantile (bisection on `tCdf`, 1e-10). */
export function tQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (df > 1e6) return normQuantile(p);
  let lo = -1;
  let hi = 1;
  while (tCdf(lo, df) > p) lo *= 2;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Tests and intervals ─────────────────────────────────────────────────────────────────────────────────────────

export interface TTest {
  n: number;
  mean: number;
  sd: number;
  se: number;
  t: number;
  df: number;
  /** two-sided p of mean ≠ mu */
  p: number;
  /** one-sided p of mean > mu ("is there an edge?") */
  pGreater: number;
  /** `CI_LEVEL` t-interval of the mean */
  ci: Interval;
}

/** One-sample t-test against `mu` (default 0) with its t-interval; `null` below 2 values. Zero spread → p 0 or 1. */
export function tTest(xs: readonly number[], mu = 0, level = CI_LEVEL): TTest | null {
  const n = xs.length;
  if (n < 2) return null;
  const m = sum(xs) / n;
  const s = sd(xs)!;
  const df = n - 1;
  if (!(s > 1e-12)) {
    const p = m === mu ? 1 : 0;
    return { n, mean: m, sd: 0, se: 0, t: m === mu ? 0 : m > mu ? Infinity : -Infinity, df, p, pGreater: m > mu ? 0 : 1, ci: { lo: m, hi: m } };
  }
  const se = s / Math.sqrt(n);
  const t = (m - mu) / se;
  const half = tQuantile(0.5 + level / 2, df) * se;
  return { n, mean: m, sd: s, se, t, df, p: 2 * (1 - tCdf(Math.abs(t), df)), pGreater: 1 - tCdf(t, df), ci: { lo: m - half, hi: m + half } };
}

/** t-interval of the mean at `level`; `null` below 2 values. */
export function meanCI(xs: readonly number[], level = CI_LEVEL): Interval | null {
  return tTest(xs, 0, level)?.ci ?? null;
}

export interface TwoSample {
  /** a − b */
  diff: number;
  se: number;
  t: number;
  df: number;
  /** two-sided */
  p: number;
  ci: Interval;
}

/** Welch's t-test of mean(a) − mean(b); `null` unless both sides have ≥ 2 values. */
export function welch(a: readonly number[], b: readonly number[], level = CI_LEVEL): TwoSample | null {
  if (a.length < 2 || b.length < 2) return null;
  const va = variance(a)! / a.length;
  const vb = variance(b)! / b.length;
  const diff = sum(a) / a.length - sum(b) / b.length;
  const se = Math.sqrt(va + vb);
  if (!(se > 1e-12)) return { diff, se: 0, t: diff === 0 ? 0 : Math.sign(diff) * Infinity, df: a.length + b.length - 2, p: diff === 0 ? 1 : 0, ci: { lo: diff, hi: diff } };
  const df = (va + vb) ** 2 / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1));
  const t = diff / se;
  const half = tQuantile(0.5 + level / 2, df) * se;
  return { diff, se, t, df, p: 2 * (1 - tCdf(Math.abs(t), df)), ci: { lo: diff - half, hi: diff + half } };
}

export interface ProportionDiff {
  /** p1 − p2 */
  diff: number;
  /** two-sided p of the pooled z-test */
  p: number;
  /** Newcombe's hybrid score interval (from the two Wilson intervals) */
  ci: Interval;
}

/** Difference of two proportions k1/n1 − k2/n2; `null` when a side is empty. */
export function proportionDiff(k1: number, n1: number, k2: number, n2: number, level = CI_LEVEL): ProportionDiff | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const pool = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (p1 - p2) / se : 0;
  const zl = zFor(level);
  const w1 = wilson(k1, n1, zl);
  const w2 = wilson(k2, n2, zl);
  const diff = p1 - p2;
  const lo = diff - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2);
  const hi = diff + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2);
  return { diff, p: se > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1, ci: { lo: Math.max(-1, lo), hi: Math.min(1, hi) } };
}

/** Wilson interval of k / n at `level` (default 80 %). */
export const wilsonCI = (k: number, n: number, level = CI_LEVEL): Interval => wilson(k, n, zFor(level));

export interface BootstrapOptions {
  /** resamples (default 400) */
  runs?: number;
  seed?: number;
  level?: number;
}

/**
 * Percentile bootstrap interval of `stat` over resamples (with replacement) of `xs`. Deterministic for a seed;
 * resamples where `stat` is not finite are skipped; `null` below 2 values or with < 10 usable resamples.
 */
export function bootstrapCI(xs: readonly number[], stat: (sample: number[]) => number | null, opts: BootstrapOptions = {}): Interval | null {
  const n = xs.length;
  if (n < 2) return null;
  const runs = opts.runs ?? 400;
  const level = opts.level ?? CI_LEVEL;
  const rand = rng(opts.seed ?? 7);
  const out: number[] = [];
  const buf = new Array<number>(n);
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < n; i++) buf[i] = xs[Math.floor(rand() * n)]!;
    const v = stat(buf);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (out.length < 10) return null;
  const s = sortedAsc(out);
  return { lo: quantileSorted(s, (1 - level) / 2)!, hi: quantileSorted(s, 1 - (1 - level) / 2)! };
}

/** Resamples for a list of `n` items so one bootstrap stays ≈ 200k draws (100–400). */
export const bootRuns = (n: number): number => Math.max(100, Math.min(400, Math.floor(200_000 / Math.max(1, n))));

export interface FdrResult {
  /** BH-adjusted p ("q-value") per input, `null` where the input was `null` */
  q: (number | null)[];
  significant: boolean[];
}

/** Benjamini-Hochberg over the non-null p-values (step-up, monotone adjusted q-values). */
export function benjaminiHochberg(ps: readonly (number | null | undefined)[], alpha = FDR_Q): FdrResult {
  const idx = ps.map((p, i) => [p, i] as const).filter((x): x is readonly [number, number] => typeof x[0] === "number" && Number.isFinite(x[0]));
  const m = idx.length;
  const q: (number | null)[] = ps.map(() => null);
  const sorted = [...idx].sort((a, b) => a[0] - b[0]);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = sorted[k]!;
    const adj = Math.min(prev, (p * m) / (k + 1));
    prev = adj;
    q[i] = Math.min(1, adj);
  }
  return { q, significant: q.map((v) => v != null && v <= alpha) };
}

/** Verdict of a p (+ its FDR q) with the sample guard. */
export function significanceOf(p: number | null | undefined, q: number | null | undefined, n: number, minN: number): Significance {
  if (n < minN || p == null) return "wenig";
  if (q != null ? q <= FDR_Q : p <= FDR_Q) return "klar";
  if (p < TENDENCY_P) return "tendenz";
  return "offen";
}

/**
 * Trades needed so that a one-sided test of "mean > 0" passes at `level` with `power` (normal approximation):
 * n = ((z₁₋α + z_power) · sd / mean)². `null` without a positive mean or spread.
 */
export function tradesForEdge(meanValue: number | null, sdValue: number | null, level = CI_LEVEL, power = 0.8): number | null {
  if (meanValue == null || sdValue == null || !(meanValue > 0) || !(sdValue > 0)) return null;
  const alpha = (1 - level) / 2;
  const n = ((normQuantile(1 - alpha) + normQuantile(power)) * (sdValue / meanValue)) ** 2;
  return Math.ceil(Math.max(2, n));
}

/** Trades needed for a Wilson half-width ≤ `halfWidth` around a win rate `p` (default: worst case 50 %). */
export function tradesForWinRate(halfWidth: number, p = 0.5, level = CI_LEVEL): number {
  const z = zFor(level);
  return Math.ceil((z * z * p * (1 - p)) / (halfWidth * halfWidth));
}
