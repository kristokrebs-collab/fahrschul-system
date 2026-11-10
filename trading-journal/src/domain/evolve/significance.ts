/**
 * "Wie wahrscheinlich ist das nur Zufall?" – the multiple-testing correction of the optimiser (pure, seeded).
 *
 * The problem: whoever tries 400 variants and shows the best one will always find something that looks good – the maximum of
 * many noisy numbers is large even when every variant is worthless. A single t-test of the winner ignores that it won a
 * contest. Two honest answers are built in:
 *
 * 1. White's Reality Check (White 2000; stationary bootstrap of Politis & Romano 1994). For every tested variant k we have the
 *    result per time block (Σ R of the trades that closed in the block) and the DIFFERENCE d_k to the current version – the
 *    thing the user cares about: "is variant k better than what I have?". The statistic of k is studentised,
 *    z_k = mean(d_k) ÷ (sd(d_k) ÷ √T); the test asks how large the MAXIMUM z over ALL variants gets when the true advantage is
 *    zero. That null distribution comes from resampling the blocks (stationary bootstrap, mean block 3, so neighbouring
 *    blocks stay together) with every variant's own mean subtracted. p_k = share of resamples whose maximum reaches z_k. This is
 *    the "single-step" adjusted p-value of Romano & Wolf: it is valid for the winner AND for every other variant in the list.
 *    The number of variants is in it automatically: more variants → a higher maximum under the null → a higher p.
 *
 * 2. Earlier trials. Variants tried in earlier runs on (mostly) the same candles are not in the matrix, but they were also
 *    looked at. They are accounted for with the Šidák-style inflation p' = 1 − (1 − p)^((N_run + N_prior) ÷ N_run): as if the
 *    earlier variants were as many additional independent comparisons. This is a deliberate approximation on the strict side.
 *
 * The result is called "Überanpassungs-Wahrscheinlichkeit" in the app and is explained there as: the chance that a result at
 * least this good appears by luck alone after all the variants that were tried. It is a p-value, not a probability that the
 * variant is useless – the text says so.
 *
 * Small-sample note: with ~24 blocks the bootstrap is coarse; the standard deviation of a block is floored (`RC_SD_FLOOR`) so a
 * variant that differs from the current one by a single tiny trade cannot get a huge z.
 */
import { normCdf, rng } from "../analytics/stats";

export const RC_SD_FLOOR = 0.15;
export const RC_BOOT = 400;
export const RC_MEAN_BLOCK = 3;

export interface RcOptions {
  seed: number;
  boot?: number;
  meanBlock?: number;
}

export interface RcResult {
  /** studentised advantage of every variant */
  z: number[];
  /** adjusted p-value of every variant (chance that the best of all variants reaches at least this z by luck) */
  p: number[];
  boot: number;
}

/**
 * Reality Check over `d` (one array of block differences per variant, all the same length).
 * Deterministic for a seed; empty input gives empty output.
 */
export function realityCheck(d: readonly ArrayLike<number>[], o: RcOptions): RcResult {
  const N = d.length;
  const B = o.boot ?? RC_BOOT;
  if (!N) return { z: [], p: [], boot: B };
  const T = d[0]!.length;
  if (T < 2) return { z: d.map(() => 0), p: d.map(() => 1), boot: B };
  const mean = new Float64Array(N);
  const se = new Float64Array(N);
  const z = new Array<number>(N).fill(0);
  for (let k = 0; k < N; k++) {
    const row = d[k]!;
    let s = 0;
    for (let t = 0; t < T; t++) s += row[t]!;
    const m = s / T;
    let v = 0;
    for (let t = 0; t < T; t++) v += (row[t]! - m) * (row[t]! - m);
    const sd = Math.sqrt(v / (T - 1));
    mean[k] = m;
    se[k] = Math.max(sd, RC_SD_FLOOR) / Math.sqrt(T);
    z[k] = m / se[k]!;
  }
  const rand = rng(o.seed);
  const q = 1 / (o.meanBlock ?? RC_MEAN_BLOCK);
  const idx = new Int32Array(T);
  const maxima = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    idx[0] = Math.floor(rand() * T);
    for (let t = 1; t < T; t++) idx[t] = rand() < q ? Math.floor(rand() * T) : (idx[t - 1]! + 1) % T;
    let best = -Infinity;
    for (let k = 0; k < N; k++) {
      const row = d[k]!;
      let s1 = 0;
      let s2 = 0;
      for (let t = 0; t < T; t++) {
        const v = row[idx[t]!]!;
        s1 += v;
        s2 += v * v;
      }
      const m = s1 / T;
      // studentised again inside every resample (the sample's own spread, floored): this keeps the heavy tails of a t-statistic on
      // ~24 blocks instead of treating the spread as known
      const sd = Math.sqrt(Math.max(0, (s2 - T * m * m) / (T - 1)));
      const stat = (m - mean[k]!) / (Math.max(sd, RC_SD_FLOOR) / Math.sqrt(T));
      if (stat > best) best = stat;
    }
    maxima[b] = best;
  }
  const p = z.map((zk) => {
    let c = 0;
    for (let b = 0; b < B; b++) if (maxima[b]! >= zk) c++;
    return (1 + c) / (B + 1);
  });
  return { z, p, boot: B };
}

/** Earlier trials raise the bar: p' = 1 − (1 − p)^((N_run + N_prior) ÷ N_run). */
export function inflateForPrior(p: number, nRun: number, nPrior: number): number {
  if (!(nRun > 0) || !(nPrior > 0)) return p;
  const q = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), (nRun + nPrior) / nRun);
  return Math.min(1, Math.max(0, q));
}

/** The one-sided p-value of a single test of this variant, without any correction (for contrast only). */
export const naiveP = (z: number): number => 1 - normCdf(z);

/** Words for a p-value as the cards show them. */
export function overfitLevel(p: number): "low" | "mid" | "high" {
  return p < 0.2 ? "low" : p < 0.5 ? "mid" : "high";
}

/** Fewest confirmation-window trades before a failure there raises the probability (fewer trades say nothing either way). */
export const HOLDOUT_MIN_TRADES = 5;

/**
 * The confirmation window is data no search ever used for a choice. A proposal that FAILS there cannot be called "unlikely to be
 * luck": negative Ø R → at least 50 %, worse than the current version → at least 20 %. (A pass proves nothing; it only leaves the
 * probability as it is.)
 */
export function holdoutFloor(cand: { n: number; avgR: number | null } | null, base: { avgR: number | null } | null): number | null {
  if (!cand || cand.n < HOLDOUT_MIN_TRADES || cand.avgR == null) return null;
  if (cand.avgR < 0) return 0.5;
  if (base?.avgR != null && cand.avgR < base.avgR) return 0.2;
  return null;
}
