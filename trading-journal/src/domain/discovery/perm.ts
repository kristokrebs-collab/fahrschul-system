/**
 * Permutation statistics of the search. All of it is deterministic for a seed.
 *
 * The statistic of a pattern (a "cell") is the standardised difference of the mean R inside it against the mean R of its
 * population (all trades the pattern's features are defined for):
 *
 *     z = (mean_in − μ) ÷ (σ · √((N − n) ÷ (n · (N − 1))))
 *
 * μ and σ (divisor N) belong to the population's R values, n is the size of the pattern, N the size of the population. That is
 * EXACTLY the mean and spread of `mean_in` when n trades are drawn at random without replacement (= when the R labels are
 * shuffled), so z has mean 0 and variance 1 under "the pattern has nothing to do with R" – for every n, with no assumption on
 * the shape of R.
 *
 * p-values: shuffling the labels `B` times gives `B` values of z for EVERY pattern. A single pattern's p-value from its own `B`
 * values could never be smaller than 1/(B+1) – too coarse for a correction over thousands of tests. So the null values of all
 * patterns of similar size are pooled (strata by n) and a pattern's p is read against that pool; beyond the pool's range a
 * normal tail, widened by what the pool shows about its own tail, takes over. The widening is never below 1, so the p-value is
 * never smaller than the plain normal one. The README states this approximation; `tests/unit/discovery.mine.test.ts` checks the
 * outcome on pure noise over many seeds.
 */
import { normCdf, normQuantile } from "../analytics/stats";
import { LIMITS } from "./types";

/** Fisher-Yates, in place. */
export function shuffle(a: Float64Array, rand: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
}

/** Mean and spread (divisor N) of a label set. */
export function momentsOf(a: ArrayLike<number>): { mu: number; sigma: number } {
  const N = a.length;
  if (N === 0) return { mu: 0, sigma: 0 };
  let s = 0;
  for (let i = 0; i < N; i++) s += a[i]!;
  const mu = s / N;
  let v = 0;
  for (let i = 0; i < N; i++) v += (a[i]! - mu) ** 2;
  return { mu, sigma: Math.sqrt(v / N) };
}

/** 1 ÷ (σ · √((N − n) ÷ (n · (N − 1)))); 0 where the statistic is undefined. */
export function zScale(N: number, n: number, sigma: number): number {
  if (!(sigma > 0) || N < 2 || n < 1 || n >= N) return 0;
  return 1 / (sigma * Math.sqrt((N - n) / (n * (N - 1))));
}

/**
 * Stability over time: the trades (in time order) are cut into `LIMITS.blocks` equal blocks; in each block the pattern's mean R is
 * set against the block's mean R. +1 = same sign as `dir` (the sign of the pattern's effect), −1 = the other sign, 0 = the block
 * has fewer than `LIMITS.blockMin` trades inside or outside the pattern (or no difference at all).
 */
export function blockSigns(r: ArrayLike<number>, inside: (i: number) => boolean, dir: 1 | -1, blocks: number = LIMITS.blocks, minN: number = LIMITS.blockMin): (1 | -1 | 0)[] {
  const N = r.length;
  const a = Array.from({ length: blocks }, () => ({ nIn: 0, sIn: 0, nAll: 0, sAll: 0 }));
  for (let i = 0; i < N; i++) {
    const bl = a[Math.min(blocks - 1, Math.floor((i * blocks) / N))]!;
    bl.nAll++;
    bl.sAll += r[i]!;
    if (inside(i)) {
      bl.nIn++;
      bl.sIn += r[i]!;
    }
  }
  return a.map((bl) => {
    if (bl.nIn < minN || bl.nAll - bl.nIn < minN) return 0;
    const d = bl.sIn / bl.nIn - bl.sAll / bl.nAll;
    return d === 0 ? 0 : (d > 0 ? 1 : -1) === dir ? 1 : -1;
  });
}

/** Size strata of the pooled null: boundaries on n. */
const BOUNDS = [15, 25, 40, 70, 120, 250, 500];
const MIN_POOL = 3000;

/** The null values of all patterns, pooled by size. */
export class PooledNull {
  private readonly raw: number[][];
  private readonly map: number[] = [];
  private pools: Float64Array[] = [];
  private tail: number[] = [];

  /** `sizes`: the n of every tested pattern (to merge strata so that each pool holds at least ~3 000 null values), `perms`: shuffles */
  constructor(sizes: readonly number[], perms: number) {
    const per = BOUNDS.map(() => 0);
    const raw = (n: number): number => {
      let s = 0;
      while (s < BOUNDS.length - 1 && n >= BOUNDS[s + 1]!) s++;
      return s;
    };
    for (const n of sizes) per[raw(n)]! += perms;
    // merge small strata into the next larger one (the last into the previous)
    const target: number[] = [];
    let acc = 0;
    let cur = 0;
    for (let s = 0; s < BOUNDS.length; s++) {
      target[s] = cur;
      acc += per[s]!;
      if (acc >= MIN_POOL && s < BOUNDS.length - 1) {
        cur++;
        acc = 0;
      }
    }
    // a too-small last pool joins the one before it
    if (cur > 0 && acc < MIN_POOL) for (let s = 0; s < BOUNDS.length; s++) if (target[s] === cur) target[s] = cur - 1;
    const poolCount = Math.max(...target) + 1;
    this.map = BOUNDS.map((_, s) => target[s]!);
    this.raw = Array.from({ length: poolCount }, () => []);
    this.stratumOf = (n: number): number => this.map[raw(n)]!;
  }

  readonly stratumOf: (n: number) => number;

  add(stratum: number, absZ: number): void {
    this.raw[stratum]!.push(absZ);
  }

  /** Sorts the pools; call once after all shuffles. */
  finish(): void {
    this.pools = this.raw.map((r) => Float64Array.from(r).sort());
    this.tail = this.pools.map((p) => {
      const T = p.length;
      if (T < 200) return 1.15;
      const level = Math.min(0.999, 1 - 5 / T);
      const q = p[Math.min(T - 1, Math.floor(level * T))]!;
      const ref = normQuantile(1 - (1 - level) / 2);
      return Math.max(1, q / ref);
    });
  }

  /** Two-sided p of |z| in a stratum. */
  p(stratum: number, absZ: number): number {
    const pool = this.pools[stratum]!;
    const T = pool.length;
    const ext = 2 * (1 - normCdf(absZ / this.tail[stratum]!));
    if (T === 0) return Math.min(1, Math.max(1e-300, ext));
    // number of pool values ≥ absZ (binary search for the first index with value ≥ absZ)
    let lo = 0;
    let hi = T;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pool[mid]! < absZ) lo = mid + 1;
      else hi = mid;
    }
    const exceed = T - lo;
    if (exceed === 0) return Math.min(1, Math.max(1e-300, ext));
    return Math.min(1, Math.max((1 + exceed) / (1 + T), ext));
  }

  /** Total null values (diagnostics). */
  size(): number {
    return this.pools.reduce((s, p) => s + p.length, 0);
  }
}
