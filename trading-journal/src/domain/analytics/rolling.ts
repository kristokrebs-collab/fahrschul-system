/**
 * Rolling windows (P03): win rate, profit factor, expectancy (money and R) and Sharpe per trade over the last N trades
 * at every trade, the equity curve in R, and the current "form" – the last window's win rate against the 80 % Wilson
 * interval (heiß / kalt / normal). Every window goes through `aggregate()`.
 */
import type { EnrichedTrade } from "../types";
import { aggregate } from "../agg";
import { tradeTime } from "@/lib/dates";
import { tradeReturns, sharpeOf } from "./ratios";
import { finite, wilsonCI, type Interval } from "./stats";

export const ROLLING_WINDOWS = [10, 20, 50] as const;
export const ROLLING_DEFAULT = 20;

export interface RollingPoint {
  /** trades so far (1-based index of the window's last trade) */
  i: number;
  id: string;
  /** entry time (ms) of the window's last trade */
  at: number;
  winRate: number | null;
  pf: number | null;
  exp: number | null;
  expR: number | null;
  sharpe: number | null;
}

export interface RollingForm {
  current: RollingPoint;
  overall: number | null;
  /** 80 % Wilson interval of the window's win rate */
  ci: Interval;
  /** "heiss": the overall win rate is below the window's interval, "kalt": above it */
  verdict: "heiss" | "kalt" | "normal";
}

export interface RollingReport {
  window: number;
  points: RollingPoint[];
  /** cumulative R over the trades with a stop (index = trade count) */
  equityR: number[];
  form: RollingForm | null;
}

/** Rolling stats over the closed trades (time order) with window `window` (points start at the window's size). */
export function rollingStats(closed: readonly EnrichedTrade[], start: number, window: number = ROLLING_DEFAULT): RollingReport {
  const w = Math.max(2, Math.floor(window));
  const rets = tradeReturns(closed, start);
  const points: RollingPoint[] = [];
  for (let end = w; end <= closed.length; end++) {
    const slice = closed.slice(end - w, end);
    const g = aggregate(slice);
    const t = slice[slice.length - 1]!;
    points.push({
      i: end,
      id: t.id,
      at: +tradeTime(t),
      winRate: g.winRate,
      pf: g.pf,
      exp: g.exp,
      expR: g.avgR,
      sharpe: sharpeOf(rets.slice(Math.max(0, end - w), end)),
    });
  }
  const equityR: number[] = [0];
  let cum = 0;
  for (const r of finite(closed.map((t) => t.r))) equityR.push((cum += r));
  const all = aggregate(closed);
  const last = points[points.length - 1];
  let form: RollingForm | null = null;
  if (last && last.winRate != null) {
    const wins = Math.round(last.winRate * w);
    const ci = wilsonCI(wins, w);
    const overall = all.winRate;
    const verdict = overall == null ? "normal" : overall < ci.lo ? "heiss" : overall > ci.hi ? "kalt" : "normal";
    form = { current: last, overall, ci, verdict };
  }
  return { window: w, points, equityR, form };
}
