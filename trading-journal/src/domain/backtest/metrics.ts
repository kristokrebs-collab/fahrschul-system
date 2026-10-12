/**
 * Key numbers of a backtest run (P07, pure). Uncertainty is part of every headline number, like on the Analyse page
 * (P03): win rate with its 80 % Wilson interval, Ø R with its t-interval, a one-sided t-test "is there an edge?".
 * Moves (`moveWin` / `moveLoss` / `moveExp`) are leverage-free price moves entry → exit in the trade's direction –
 * exactly what the overview's backtest comparison (`BacktestCompare`) compares, so a run can become its reference.
 */
import { CI_LEVEL, kurtosis, sd, skewness, tTest, wilsonCI, type Interval } from "../analytics/stats";
import type { BtTrade, EquityPoint, RunResult } from "./types";

export interface RunStats {
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winRateCI: Interval | null;
  /** Ø R, its interval and the one-sided p of "Ø R > 0" */
  avgR: number | null;
  rCI: Interval | null;
  pEdge: number | null;
  sdR: number | null;
  sumR: number;
  /** Σ wins ÷ |Σ losses| in money; ∞ without losses, null without trades */
  pf: number | null;
  net: number;
  netPct: number;
  /** largest drop from a running peak of the marked-to-market equity (fraction) and in money */
  maxDD: number;
  maxDDAbs: number;
  /** compound annual growth over the run's time span (null under 30 days) */
  cagr: number | null;
  /** per-trade Sharpe of R (mean ÷ sd) and the annualised Sharpe of daily equity returns (√365) */
  sharpeTrade: number | null;
  sharpeAnnual: number | null;
  skewR: number | null;
  kurtR: number | null;
  /** share of bars with an open position */
  exposure: number;
  avgBars: number | null;
  fees: number;
  funding: number;
  slippage: number;
  longestLosing: number;
  /** leverage-free moves (fractions) – the backtest-reference numbers */
  moveWin: number | null;
  moveLoss: number | null;
  moveExp: number | null;
  /** first / last ms of the run */
  from: number;
  to: number;
  days: number;
}

const DAY = 86_400_000;

/** Max drawdown (fraction of the running peak) and its money amount. */
export function maxDrawdown(points: readonly { equity: number }[]): { dd: number; abs: number } {
  let peak = -Infinity;
  let dd = 0;
  let abs = 0;
  for (const p of points) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const d = (peak - p.equity) / peak;
      if (d > dd) dd = d;
      if (peak - p.equity > abs) abs = peak - p.equity;
    }
  }
  return { dd, abs };
}

/** Daily returns of a marked-to-market equity curve (last value per UTC day). */
export function dailyReturns(points: readonly EquityPoint[]): number[] {
  const byDay = new Map<number, number>();
  for (const p of points) byDay.set(Math.floor((p.t - 1) / DAY), p.equity);
  const vals = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const out: number[] = [];
  for (let i = 1; i < vals.length; i++) if (vals[i - 1]! > 0) out.push(vals[i]! / vals[i - 1]! - 1);
  return out;
}

/** Per-trade Sharpe of R (mean ÷ sd), null below 2 trades or without spread. */
export function sharpeOf(rs: readonly number[]): number | null {
  if (rs.length < 2) return null;
  const s = sd(rs);
  if (s == null || !(s > 1e-12)) return null;
  return rs.reduce((a, b) => a + b, 0) / rs.length / s;
}

function longestRun(trades: readonly BtTrade[]): number {
  let best = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.pnl < 0) best = Math.max(best, ++cur);
    else cur = 0;
  }
  return best;
}

export function runStats(run: RunResult): RunStats {
  const ts = run.trades;
  const n = ts.length;
  const rs = ts.map((t) => t.r);
  let wins = 0;
  let losses = 0;
  let gw = 0;
  let gl = 0;
  let fees = 0;
  let funding = 0;
  let slippage = 0;
  let barsSum = 0;
  let mvWin = 0;
  let mvWinN = 0;
  let mvLoss = 0;
  let mvLossN = 0;
  let mvSum = 0;
  for (const t of ts) {
    if (t.pnl > 0) {
      wins++;
      gw += t.pnl;
      mvWin += t.move;
      mvWinN++;
    } else if (t.pnl < 0) {
      losses++;
      gl += t.pnl;
      mvLoss += t.move;
      mvLossN++;
    }
    mvSum += t.move;
    fees += t.fees;
    funding += t.funding;
    slippage += t.slippage;
    barsSum += t.bars;
  }
  const net = gw + gl;
  const tt = tTest(rs, 0, CI_LEVEL);
  const dd = maxDrawdown(run.equity.length ? run.equity : [{ equity: run.capital }, ...cumulative(run)]);
  const days = Math.max(0, (run.to - run.from) / DAY);
  const endEq = run.capital + net;
  const cagr = days >= 30 && run.capital > 0 && endEq > 0 ? Math.pow(endEq / run.capital, 365 / days) - 1 : null;
  const dr = dailyReturns(run.equity);
  const sdD = sd(dr);
  const sharpeAnnual = dr.length >= 10 && sdD != null && sdD > 1e-12 ? (dr.reduce((a, b) => a + b, 0) / dr.length / sdD) * Math.sqrt(365) : null;
  let inMarket = 0;
  if (run.equity.length) {
    const barsTotal = run.equity.length;
    inMarket = Math.min(1, barsSum / barsTotal);
  }
  return {
    n,
    wins,
    losses,
    winRate: n ? wins / n : null,
    winRateCI: n ? wilsonCI(wins, n) : null,
    avgR: n ? rs.reduce((a, b) => a + b, 0) / n : null,
    rCI: tt?.ci ?? null,
    pEdge: tt?.pGreater ?? null,
    sdR: sd(rs),
    sumR: rs.reduce((a, b) => a + b, 0),
    pf: gl < 0 ? gw / -gl : gw > 0 ? Infinity : null,
    net,
    netPct: run.capital > 0 ? net / run.capital : 0,
    maxDD: dd.dd,
    maxDDAbs: dd.abs,
    cagr,
    sharpeTrade: sharpeOf(rs),
    sharpeAnnual,
    skewR: skewness(rs),
    kurtR: kurtosis(rs),
    exposure: inMarket,
    avgBars: n ? barsSum / n : null,
    fees,
    funding,
    slippage,
    longestLosing: longestRun(ts),
    moveWin: mvWinN ? mvWin / mvWinN : null,
    moveLoss: mvLossN ? mvLoss / mvLossN : null,
    moveExp: n ? mvSum / n : null,
    from: run.from,
    to: run.to,
    days,
  };
}

/** Equity after each trade (when the run carries no per-bar curve). */
function cumulative(run: RunResult): { equity: number }[] {
  let e = run.capital;
  return run.trades.map((t) => ({ equity: (e += t.pnl) }));
}

/**
 * At most `max` points of a curve for drawing (min / max kept per bucket so a drawdown never disappears).
 */
export function downsample<T extends { equity: number }>(points: readonly T[], max = 320): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  const bucket = points.length / (max / 2);
  for (let b = 0; b * bucket < points.length; b++) {
    const s = Math.floor(b * bucket);
    const e = Math.min(points.length, Math.floor((b + 1) * bucket));
    let lo = s;
    let hi = s;
    for (let i = s; i < e; i++) {
      if (points[i]!.equity < points[lo]!.equity) lo = i;
      if (points[i]!.equity > points[hi]!.equity) hi = i;
    }
    if (lo === hi) out.push(points[lo]!);
    else if (lo < hi) out.push(points[lo]!, points[hi]!);
    else out.push(points[hi]!, points[lo]!);
  }
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
