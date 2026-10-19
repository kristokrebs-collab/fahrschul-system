/**
 * Streak risk (P05), pure: how long a losing streak the trader must expect with his win rate (Schilling's expected
 * longest run, P03 `expectedLongestLosingStreak`) and from his own R multiples (P03 `monteCarlo`, seeded), the current
 * streak against that expectation, and what the streak costs at the chosen risk per trade (compounded:
 * 1 − (1 − risk)^k). "Akut" when the current losing streak already reaches the expected longest one.
 */
import { monteCarlo } from "../analytics/montecarlo";
import { expectedLongestLosingStreak, streaks } from "../analytics/streaks";
import type { TradeResult } from "../types";

/** Trades needed before the streak risk is judged (P03's streak verdict minimum). */
export const STREAK_RISK_MIN_N = 10;
/** Look-ahead of the expectation. */
export const STREAK_HORIZON = 100;

export interface StreakRiskInput {
  /** results in time order (open ones are skipped) */
  results: readonly TradeResult[];
  /** R multiples (or P&L) for the Monte Carlo; empty → only the analytic expectation */
  sample: readonly number[];
  /** risk per trade (fraction) for the drawdown of a streak */
  riskPct: number;
  horizon?: number;
  runs?: number;
  seed?: number;
}

export interface StreakRisk {
  n: number;
  winRate: number | null;
  current: { kind: "win" | "loss" | null; length: number };
  longestLoss: number;
  /** expected longest losing streak over `horizon` trades (analytic) */
  expected: number;
  /** Monte Carlo of the own results over `horizon` trades: median and 95 % of the longest losing streak */
  mc: { p50: number; p95: number } | null;
  horizon: number;
  /** drawdown of a streak of `expected` / of the MC p95 losses at `riskPct` (compounded) */
  ddExpected: number;
  ddP95: number | null;
  /** "zu wenig" below the minimum, "akut" when the current losing streak reaches the expectation */
  status: "zu wenig" | "normal" | "erhöht" | "akut";
}

/** Drawdown of `k` full losses in a row at `risk` per trade (compounded). */
export const streakDrawdown = (k: number, risk: number): number => (k > 0 && risk > 0 ? 1 - Math.pow(1 - Math.min(0.99, risk), k) : 0);

export function streakRisk(input: StreakRiskInput): StreakRisk {
  const horizon = Math.max(10, Math.round(input.horizon ?? STREAK_HORIZON));
  const st = streaks(input.results);
  const decisive = input.results.filter((r) => r === "win" || r === "loss");
  const wins = decisive.filter((r) => r === "win").length;
  const winRate = decisive.length ? wins / decisive.length : null;
  const expected = winRate == null ? 0 : expectedLongestLosingStreak(winRate, horizon);
  const sample = input.sample.filter((v) => Number.isFinite(v));
  let mc: StreakRisk["mc"] = null;
  if (st.n >= STREAK_RISK_MIN_N && sample.length >= STREAK_RISK_MIN_N) {
    const res = monteCarlo(sample, { runs: input.runs ?? 1000, horizon, seed: input.seed ?? 7, keepPaths: 0 });
    mc = res.longestLoss;
  }
  const risk = input.riskPct > 0 ? input.riskPct : 0;
  let status: StreakRisk["status"] = "zu wenig";
  if (st.n >= STREAK_RISK_MIN_N) {
    const curLoss = st.current.kind === "loss" ? st.current.length : 0;
    const ref = Math.max(1, Math.round(mc?.p50 ?? expected));
    status = curLoss >= ref ? "akut" : curLoss >= Math.max(2, Math.ceil(ref / 2)) ? "erhöht" : "normal";
  }
  return {
    n: st.n,
    winRate,
    current: st.current,
    longestLoss: st.longestLoss,
    expected,
    mc,
    horizon,
    ddExpected: streakDrawdown(Math.round(expected), risk),
    ddP95: mc ? streakDrawdown(mc.p95, risk) : null,
    status,
  };
}
