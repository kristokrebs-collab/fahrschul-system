/**
 * Monte Carlo and risk of ruin (P03, Wave-0 contract kept: `monteCarlo`, `riskOfRuin` and their types).
 *
 * - `monteCarlo(sample, opts)`: bootstrap (draw with replacement) or reshuffle (permutation) of a per-trade sample
 *   (R multiples or money) → p5 / p25 / p50 / p75 / p95 equity bands per step, the final distribution, the max
 *   drawdown of every path, P(DD ≥ x), the ruin share and the longest losing run. Seeded (mulberry32): the same input
 *   gives the same result. `createMonteCarlo` is the same engine in steps, so a runner can spread it over idle
 *   periods (`mcRunner.ts`) or a worker (`mc.worker.ts`).
 * - `riskOfRuin(input, opts)`: fixed-fractional risk per trade; analytic (Cramér-Lundberg on log equity: infinite
 *   horizon) and simulated (seeded, over `trades` trades; from the trader's own R multiples when `sample` is given).
 */
import { quantileSorted, rng } from "./stats";

// ── Monte Carlo ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface MonteCarloOptions {
  /** Simulated paths (default 2000). */
  runs?: number;
  /** Trades per path (default: sample length). */
  horizon?: number;
  /** PRNG seed – same seed, same result (default 1). */
  seed?: number;
  /** "bootstrap" draws with replacement, "reshuffle" permutes the sample (default "bootstrap"). */
  method?: "bootstrap" | "reshuffle";
  /** Start equity in sample units (default 0 → the paths are cumulative R / money). */
  start?: number;
  /** Drawdown (sample units, positive) counted as ruin; omit → `ruin` is null. */
  ruinAt?: number;
  /** Drawdown thresholds (sample units, positive) for `ddProb`. */
  ddThresholds?: readonly number[];
  /** How many raw paths to return for drawing (default 0, P03's fan draws 120). */
  keepPaths?: number;
}

/** Equity percentile per step; `values.length === horizon + 1` (index 0 = start). */
export interface MonteCarloBand {
  p: 5 | 25 | 50 | 75 | 95;
  values: number[];
}

export interface Percentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
}

export interface MonteCarloResult {
  runs: number;
  horizon: number;
  seed: number;
  method: "bootstrap" | "reshuffle";
  /** p5 / p25 / p50 / p75 / p95 bands (empty when the sample is empty). */
  bands: MonteCarloBand[];
  /** Final equity distribution, `null` when nothing was simulated. */
  final: Percentiles | null;
  /** Max drawdown per path (positive, sample units), sorted ascending. */
  maxDD: number[];
  /** P(max drawdown ≥ x) for each requested threshold. */
  ddProb: { x: number; p: number }[];
  /** Share of paths that hit `ruinAt`; null without `ruinAt`. */
  ruin: number | null;
  /** Longest losing streak per path: median and p95. */
  longestLoss: { p50: number; p95: number } | null;
  /** First `keepPaths` equity paths. */
  paths: number[][];
}

export const BAND_PS = [5, 25, 50, 75, 95] as const;
/** Default runs of the contract. */
export const MC_RUNS = 2000;
/**
 * Stored equity cells for the bands (paths × steps). Above it only the first `max(200, CAP / steps)` paths feed the
 * bands (finals, drawdowns, ruin and streaks always use every path) – keeps a 5000-trade horizon at ≈ 32 MB max.
 */
export const MC_CELL_CAP = 4_000_000;

export interface MonteCarloEngine {
  readonly runs: number;
  readonly horizon: number;
  /** paths simulated so far */
  readonly done: number;
  /** Simulates up to `maxRuns` more paths; true once all are done. */
  step(maxRuns: number): boolean;
  /** The result (bands etc. are computed once all runs are done; before that over the finished paths). */
  result(): MonteCarloResult;
}

/** The Monte Carlo engine in steps (see `monteCarlo`). */
export function createMonteCarlo(sample: readonly number[], opts: MonteCarloOptions = {}): MonteCarloEngine {
  const xs = sample.filter((v) => Number.isFinite(v));
  const n = xs.length;
  const method = opts.method ?? "bootstrap";
  const seed = opts.seed ?? 1;
  const runs = n ? Math.max(1, Math.floor(opts.runs ?? MC_RUNS)) : 0;
  const horizon = Math.max(0, Math.floor(opts.horizon ?? n));
  const start = opts.start ?? 0;
  const keep = Math.min(runs, Math.max(0, Math.floor(opts.keepPaths ?? 0)));
  const ruinAt = opts.ruinAt != null && opts.ruinAt > 0 ? opts.ruinAt : null;
  const stride = horizon + 1;
  const bandRuns = Math.min(runs, Math.max(200, Math.floor(MC_CELL_CAP / stride)));
  const eq = new Float64Array(bandRuns * stride);
  const finals = new Float64Array(runs);
  const maxDD = new Float64Array(runs);
  const longest = new Float64Array(runs);
  let ruined = 0;
  let done = 0;
  const rand = rng(seed);
  const perm = method === "reshuffle" ? xs.slice() : [];
  let permPos = perm.length;

  const draw = (): number => {
    if (method === "bootstrap") return xs[Math.floor(rand() * n)]!;
    // reshuffle: walk a fresh Fisher-Yates permutation; a horizon longer than the sample continues with a new one
    if (permPos >= perm.length) {
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = perm[i]!;
        perm[i] = perm[j]!;
        perm[j] = t;
      }
      permPos = 0;
    }
    return perm[permPos++]!;
  };

  const step = (maxRuns: number): boolean => {
    const until = Math.min(runs, done + Math.max(0, Math.floor(maxRuns === Infinity ? runs : maxRuns)));
    for (let r = done; r < until; r++) {
      permPos = perm.length; // every reshuffled path is its own permutation
      const store = r < bandRuns;
      const base = r * stride;
      let v = start;
      let peak = start;
      let dd = 0;
      let run = 0;
      let longestRun = 0;
      let hit = false;
      if (store) eq[base] = v;
      for (let s = 1; s <= horizon; s++) {
        const x = draw();
        v += x;
        if (store) eq[base + s] = v;
        if (v > peak) peak = v;
        const d = peak - v;
        if (d > dd) dd = d;
        if (ruinAt != null && d >= ruinAt) hit = true;
        if (x < 0) {
          run++;
          if (run > longestRun) longestRun = run;
        } else run = 0;
      }
      finals[r] = v;
      maxDD[r] = dd;
      longest[r] = longestRun;
      if (hit) ruined++;
    }
    done = until;
    return done >= runs;
  };

  const result = (): MonteCarloResult => {
    const m = done;
    const ddSorted = Array.from(maxDD.subarray(0, m)).sort((a, b) => a - b);
    const thresholds = opts.ddThresholds ?? [];
    const ddProb = thresholds.map((x) => ({ x, p: m ? ddSorted.filter((d) => d >= x - 1e-12).length / m : 0 }));
    if (!m) {
      return { runs: 0, horizon, seed, method, bands: [], final: null, maxDD: [], ddProb, ruin: null, longestLoss: null, paths: [] };
    }
    const mb = Math.min(m, bandRuns);
    const colB = new Float64Array(mb);
    const bands: MonteCarloBand[] = BAND_PS.map((p) => ({ p, values: new Array<number>(stride) }));
    for (let s = 0; s < stride; s++) {
      for (let r = 0; r < mb; r++) colB[r] = eq[r * stride + s]!;
      colB.sort();
      for (const b of bands) b.values[s] = quantileSorted(colB, b.p / 100)!;
    }
    const col = finals.slice(0, m).sort();
    let total = 0;
    for (let r = 0; r < m; r++) total += col[r]!;
    const final: Percentiles = {
      p5: quantileSorted(col, 0.05)!,
      p25: quantileSorted(col, 0.25)!,
      p50: quantileSorted(col, 0.5)!,
      p75: quantileSorted(col, 0.75)!,
      p95: quantileSorted(col, 0.95)!,
      mean: total / m,
    };
    const ll = Array.from(longest.subarray(0, m)).sort((a, b) => a - b);
    const paths: number[][] = [];
    for (let r = 0; r < Math.min(keep, mb); r++) paths.push(Array.from(eq.subarray(r * stride, r * stride + stride)));
    return {
      runs: m,
      horizon,
      seed,
      method,
      bands,
      final,
      maxDD: ddSorted,
      ddProb,
      ruin: ruinAt == null ? null : ruined / m,
      longestLoss: { p50: quantileSorted(ll, 0.5)!, p95: quantileSorted(ll, 0.95)! },
      paths,
    };
  };

  return {
    runs,
    horizon,
    get done() {
      return done;
    },
    step,
    result,
  };
}

/**
 * Monte Carlo over a per-trade sample (R multiples or money). Deterministic for a given seed. An empty sample gives
 * an empty result (no bands, `final: null`).
 */
export function monteCarlo(sample: readonly number[], opts: MonteCarloOptions = {}): MonteCarloResult {
  const e = createMonteCarlo(sample, opts);
  e.step(Infinity);
  return e.result();
}

/** P(max drawdown ≥ x) from a result's sorted `maxDD` (for thresholds not requested up front). */
export function ddProbability(res: Pick<MonteCarloResult, "maxDD">, x: number): number {
  const n = res.maxDD.length;
  if (!n) return 0;
  // first index with dd ≥ x (sorted ascending)
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (res.maxDD[mid]! >= x - 1e-12) hi = mid;
    else lo = mid + 1;
  }
  return (n - lo) / n;
}

/** Quantile of the max-drawdown distribution (e.g. 0.95 → "in 95 % der Läufe nicht tiefer als …"). */
export function ddQuantile(res: Pick<MonteCarloResult, "maxDD">, p: number): number | null {
  return quantileSorted(res.maxDD, p);
}

// ── Risk of ruin ────────────────────────────────────────────────────────────────────────────────────────────────

export interface RiskOfRuinInput {
  /** Win rate 0–1 (decisive trades). */
  winRate: number;
  /** Average win ÷ |average loss| (> 0). */
  payoff: number;
  /** Fraction of equity risked per trade, e.g. 0.01 for 1 %. */
  riskPerTrade: number;
  /** Drawdown fraction counted as ruin (default 0.5 = half the account). */
  ruinAt?: number;
  /**
   * P03 (additive): the trader's own R multiples. When given, the simulation draws them (bootstrap) instead of the
   * win / loss model: equity × (1 + riskPerTrade · R) per trade.
   */
  sample?: readonly number[];
}

export interface RiskOfRuinResult {
  /** Closed-form approximation 0–1, null when not computable (no edge data). */
  analytic: number | null;
  /** Simulated probability 0–1 (seeded), null when not simulated. */
  simulated: number | null;
  /** Expectancy per trade in R: winRate × payoff − (1 − winRate). */
  edgeR: number;
}

export const ROR_DEFAULT_RUIN = 0.5;
export const ROR_TRADES = 500;

/**
 * Analytic risk of ruin for fixed-fractional risk `f` (infinite horizon): in log equity a win adds u = ln(1 + f·b),
 * a loss subtracts d = −ln(1 − f); with drift p·u − q·d > 0 the ruin probability is e^(−λ·L) with λ > 0 solving
 * p·e^(−λu) + q·e^(λd) = 1 (Cramér-Lundberg) and L = −ln(1 − ruinAt). Drift ≤ 0 → 1 (ruin is certain in the long
 * run, also with a positive expectancy in R when the risk per trade is too large). `null` for invalid input.
 */
export function ruinAnalytic(winRate: number, payoff: number, f: number, ruinAt = ROR_DEFAULT_RUIN): number | null {
  if (!(winRate >= 0 && winRate <= 1) || !(payoff > 0) || !(f > 0 && f < 1) || !(ruinAt > 0 && ruinAt < 1)) return null;
  const p = winRate;
  const q = 1 - p;
  if (q === 0) return 0;
  const u = Math.log(1 + f * payoff);
  const d = -Math.log(1 - f);
  const drift = p * u - q * d;
  if (!(drift > 0)) return 1;
  const g = (l: number) => p * Math.exp(-l * u) + q * Math.exp(l * d) - 1;
  let hi = 1;
  while (g(hi) <= 0 && hi < 1e6) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    // g < 0 between 0 and the root
    if (g(mid) < 0) lo = mid;
    else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  const L = -Math.log(1 - ruinAt);
  return Math.min(1, Math.max(0, Math.exp(-lambda * L)));
}

/** Simulated ruin share over `trades` trades (seeded). */
export function ruinSimulated(input: RiskOfRuinInput, opts: { runs?: number; trades?: number; seed?: number } = {}): number | null {
  const f = input.riskPerTrade;
  const ruinAt = input.ruinAt ?? ROR_DEFAULT_RUIN;
  if (!(f > 0 && f < 1) || !(ruinAt > 0 && ruinAt < 1)) return null;
  const sample = input.sample ? input.sample.filter((v) => Number.isFinite(v)) : null;
  if (!sample?.length && !(input.payoff > 0 && input.winRate >= 0 && input.winRate <= 1)) return null;
  const runs = Math.max(1, opts.runs ?? MC_RUNS);
  const trades = Math.max(1, opts.trades ?? ROR_TRADES);
  const rand = rng(opts.seed ?? 1);
  const floor = 1 - ruinAt;
  const up = 1 + f * input.payoff;
  const down = 1 - f;
  let ruined = 0;
  for (let r = 0; r < runs; r++) {
    let eq = 1;
    for (let i = 0; i < trades; i++) {
      if (sample?.length) eq *= Math.max(0, 1 + f * sample[Math.floor(rand() * sample.length)]!);
      else eq *= rand() < input.winRate ? up : down;
      if (eq <= floor) {
        ruined++;
        break;
      }
    }
  }
  return ruined / runs;
}

/** Risk of ruin: analytic (infinite horizon) and simulated (`trades`, default 500; `runs: 0` skips it). */
export function riskOfRuin(input: RiskOfRuinInput, opts: { runs?: number; trades?: number; seed?: number } = {}): RiskOfRuinResult {
  const edgeR = input.winRate * input.payoff - (1 - input.winRate);
  const analytic = ruinAnalytic(input.winRate, input.payoff, input.riskPerTrade, input.ruinAt ?? ROR_DEFAULT_RUIN);
  const simulated = opts.runs === 0 ? null : ruinSimulated(input, opts);
  return { analytic, simulated, edgeR };
}
