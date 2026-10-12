/**
 * Pro-Analytics contract (Wave 0 – owner P03, consumers P05 streak risk / P04 coach / P13 cockpit widgets).
 * Pure. Signatures are final. `streaks` and `expectedLongestLosingStreak` are real; `monteCarlo` and `riskOfRuin`
 * are STUBS returning an empty / null result until P03 lands (P03 turns this file into the barrel of its modules
 * and keeps these names and shapes).
 */
import type { TradeResult } from "../types";

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

/**
 * Monte Carlo over a per-trade sample (R multiples or money). Deterministic for a given seed.
 * STUB until P03: returns an empty result (no bands, `final: null`).
 */
export function monteCarlo(sample: readonly number[], opts: MonteCarloOptions = {}): MonteCarloResult {
  void sample;
  return {
    runs: 0,
    horizon: opts.horizon ?? 0,
    seed: opts.seed ?? 1,
    method: opts.method ?? "bootstrap",
    bands: [],
    final: null,
    maxDD: [],
    ddProb: (opts.ddThresholds ?? []).map((x) => ({ x, p: 0 })),
    ruin: null,
    longestLoss: null,
    paths: [],
  };
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
}

export interface RiskOfRuinResult {
  /** Closed-form approximation 0–1, null when not computable (no edge data). */
  analytic: number | null;
  /** Simulated probability 0–1 (seeded), null when not simulated. */
  simulated: number | null;
  /** Expectancy per trade in R: winRate × payoff − (1 − winRate). */
  edgeR: number;
}

/** Risk of ruin. STUB until P03: `edgeR` is real, both probabilities are null. */
export function riskOfRuin(input: RiskOfRuinInput, opts: { runs?: number; trades?: number; seed?: number } = {}): RiskOfRuinResult {
  void opts;
  return { analytic: null, simulated: null, edgeR: input.winRate * input.payoff - (1 - input.winRate) };
}

// ── Streaks ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StreakStats {
  /** Results counted (open trades are skipped). */
  n: number;
  longestWin: number;
  longestLoss: number;
  /** Streak at the end of the sequence (a break-even ends a streak, like the account view's streak tile). */
  current: { kind: "win" | "loss" | null; length: number };
  /** Run-length histograms: `winRuns[3] = 2` → two winning streaks of exactly 3. */
  winRuns: Record<number, number>;
  lossRuns: Record<number, number>;
  /** P(next is a win | previous was a win / a loss); null without such a pair. */
  pWinAfterWin: number | null;
  pWinAfterLoss: number | null;
}

/** Streak statistics of results in time order (oldest first). "open" is skipped, "be" breaks a streak. */
export function streaks(results: readonly TradeResult[]): StreakStats {
  const seq = results.filter((r) => r !== "open");
  const winRuns: Record<number, number> = {};
  const lossRuns: Record<number, number> = {};
  let longestWin = 0;
  let longestLoss = 0;
  let kind: "win" | "loss" | null = null;
  let len = 0;
  const close = (): void => {
    if (kind === "win") {
      winRuns[len] = (winRuns[len] ?? 0) + 1;
      longestWin = Math.max(longestWin, len);
    } else if (kind === "loss") {
      lossRuns[len] = (lossRuns[len] ?? 0) + 1;
      longestLoss = Math.max(longestLoss, len);
    }
  };
  let afterWin = 0;
  let winAfterWin = 0;
  let afterLoss = 0;
  let winAfterLoss = 0;
  seq.forEach((r, i) => {
    const prev = i > 0 ? seq[i - 1] : undefined;
    if (prev === "win") {
      afterWin++;
      if (r === "win") winAfterWin++;
    } else if (prev === "loss") {
      afterLoss++;
      if (r === "win") winAfterLoss++;
    }
    const k = r === "win" || r === "loss" ? r : null;
    if (k !== null && k === kind) len++;
    else {
      close();
      kind = k;
      len = k ? 1 : 0;
    }
  });
  close();
  return {
    n: seq.length,
    longestWin,
    longestLoss,
    current: { kind, length: kind ? len : 0 },
    winRuns,
    lossRuns,
    pWinAfterWin: afterWin ? winAfterWin / afterWin : null,
    pWinAfterLoss: afterLoss ? winAfterLoss / afterLoss : null,
  };
}

const EULER_GAMMA = 0.5772156649;

/**
 * Expected longest losing streak in `n` independent trades with the given win rate (Schilling's approximation
 * log_{1/q}(n·p) + γ/ln(1/q) − ½ with q = 1 − winRate), clamped to [0, n].
 */
export function expectedLongestLosingStreak(winRate: number, n: number): number {
  if (!(n > 0)) return 0;
  const p = Math.min(1, Math.max(0, winRate));
  const q = 1 - p;
  if (q <= 0) return 0;
  if (p <= 0) return n;
  const lnInvQ = -Math.log(q);
  const e = Math.log(n * p) / lnInvQ + EULER_GAMMA / lnInvQ - 0.5;
  return Math.min(n, Math.max(0, e));
}
