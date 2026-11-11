/**
 * Streaks (P03, Wave-0 contract kept 1:1): longest winning / losing streak, the run-length histograms, the current
 * run, P(win | previous win) and P(win | previous loss), plus the EXPECTED longest losing streak for a win rate –
 * used by P05 (streak risk) – and a report for the Analyse page (vs. the expectation, dependence test).
 */
import type { EnrichedTrade, TradeResult } from "../types";
import { aggregate } from "../agg";
import { proportionDiff, type ProportionDiff } from "./stats";

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

// ── Report for the Analyse page ─────────────────────────────────────────────────────────────────────────────────

/** Trades needed before the streak report judges anything. */
export const STREAK_MIN_N = 10;

export interface StreakBar {
  length: number;
  wins: number;
  losses: number;
}

export interface StreakReport extends StreakStats {
  /** win rate of the counted results (aggregate(): wins / n) */
  winRate: number | null;
  /** expected longest losing / winning streak for this win rate and n */
  expectedLoss: number;
  expectedWin: number;
  /** "normal" | "länger" (longest loss above the expectation + 2) | "kürzer" */
  lossVsExpected: "normal" | "laenger" | "kuerzer" | null;
  /** run lengths 1 … max with both counts (bars of the distribution) */
  bars: StreakBar[];
  /** P(win | loss) − P(win | win) with its interval and test (a positive / negative dependence after losses) */
  dependence: ProportionDiff | null;
  /** pair counts behind the two conditional rates */
  afterWin: number;
  afterLoss: number;
}

/** Streak report of the closed trades (time order). */
export function streakReport(closed: readonly EnrichedTrade[]): StreakReport {
  const s = streaks(closed.map((t) => t.result));
  const g = aggregate(closed.filter((t) => t.result !== "open"));
  const wr = g.winRate;
  const expectedLoss = wr == null ? 0 : expectedLongestLosingStreak(wr, s.n);
  const expectedWin = wr == null ? 0 : expectedLongestLosingStreak(1 - wr, s.n);
  const max = Math.max(s.longestWin, s.longestLoss);
  const bars: StreakBar[] = [];
  for (let k = 1; k <= max; k++) bars.push({ length: k, wins: s.winRuns[k] ?? 0, losses: s.lossRuns[k] ?? 0 });
  // pair counts (same walk as `streaks`)
  const seq = closed.map((t) => t.result).filter((r) => r !== "open");
  let afterWin = 0;
  let wAW = 0;
  let afterLoss = 0;
  let wAL = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1] === "win") {
      afterWin++;
      if (seq[i] === "win") wAW++;
    } else if (seq[i - 1] === "loss") {
      afterLoss++;
      if (seq[i] === "win") wAL++;
    }
  }
  const dependence = afterWin >= 3 && afterLoss >= 3 ? proportionDiff(wAL, afterLoss, wAW, afterWin) : null;
  const lossVsExpected = s.n < STREAK_MIN_N || wr == null ? null : s.longestLoss > expectedLoss + 2 ? "laenger" : s.longestLoss < expectedLoss - 2 ? "kuerzer" : "normal";
  return { ...s, winRate: wr, expectedLoss, expectedWin, lossVsExpected, bars, dependence, afterWin, afterLoss };
}
