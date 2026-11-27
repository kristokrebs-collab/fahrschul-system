/**
 * "Edge-Score" – the Zella Score 2.0 idea with Tradezella's weights (Profit-Faktor 25 %, Ø Gewinn/Ø Verlust 20 %,
 * Drawdown 20 %, Win-Rate 15 %, Erholung 10 %, Konstanz 10 %), but every axis is continuous (no cliffs like
 * Tradezella's PF 1,79 → 20 / 1,80 → 50), the drawdown is relative to the account (Tradezella's "DD ÷ profit before
 * the drop" explodes early), and consistency is the best-day share (independent of history length).
 * Input numbers come from `aggregate()` / `accountView()`, so the axes show the same PF, payoff, win rate and max.
 * drawdown as the Hero and the explainers.
 */
import type { EnrichedTrade } from "../types";
import type { Drawdown } from "../account";
import { aggregate, type Agg } from "../agg";
import { monthKey, tradeTime } from "@/lib/dates";
import { INFINITY_SIGN, n2, pct, pct0 } from "@/lib/format";
import { clamp, dayKeyOf, piecewise } from "./shared";

export type EdgeAxisKey = "pf" | "payoff" | "dd" | "winRate" | "recovery" | "consistency";

export const EDGE_WEIGHTS: Readonly<Record<EdgeAxisKey, number>> = { pf: 0.25, payoff: 0.2, dd: 0.2, winRate: 0.15, recovery: 0.1, consistency: 0.1 };
export const EDGE_ORDER: readonly EdgeAxisKey[] = ["pf", "payoff", "dd", "winRate", "recovery", "consistency"];
/** The score is reliable from this many closed trades on. */
export const EDGE_MIN_TRADES = 20;
/** Win rate that earns full points (Tradezella: 60 %). */
export const EDGE_WIN_TARGET = 0.6;

/** Profit factor / payoff → points: Tradezella's band starts, joined linearly (1 → 20, 1,8 → 50 … 2,6 → 100). */
export const PF_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 20],
  [1.8, 50],
  [1.9, 60],
  [2, 70],
  [2.2, 80],
  [2.4, 90],
  [2.6, 100],
];
/** Recovery factor → points: Tradezella's band starts (1 → 1, 1,5 → 30 … 3,5 → 100), joined linearly. */
export const RF_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [1.5, 30],
  [2, 50],
  [2.5, 60],
  [3, 70],
  [3.5, 100],
];

/** PF → 0…100; `∞` (wins, no losses) → 100; `null` → 0. */
export function scorePF(pf: number | null | undefined): number {
  if (pf == null || Number.isNaN(pf)) return 0;
  if (pf === Infinity) return 100;
  return piecewise(pf, PF_ANCHORS);
}

/** Ø Gewinn / Ø Verlust → points on the PF scale; wins without any loss → 100, no wins → 0. */
export function scorePayoff(g: Pick<Agg, "payoff" | "wins" | "losses">): number {
  if (g.payoff != null) return piecewise(g.payoff, PF_ANCHORS);
  return g.wins > 0 && g.losses === 0 ? 100 : 0;
}

/** Max. drawdown (≤ 0 fraction of the peak balance) → `100 + 500 · dd`, clamped: 0 % → 100, −10 % → 50, −20 % → 0. */
export const scoreDrawdown = (maxDD: number): number => clamp(100 + 500 * maxDD, 0, 100);

/** Win rate → `win / 60 % · 100`, capped at 100. */
export const scoreWinRate = (winRate: number | null | undefined): number => clamp(((winRate ?? 0) / EDGE_WIN_TARGET) * 100, 0, 100);

/** Net profit ÷ max. drawdown in money (`dd.peak − dd.trough`); `null` without a drawdown. */
export function recoveryFactor(net: number, dd: Pick<Drawdown, "peak" | "trough">): number | null {
  const abs = Math.abs(dd.peak - dd.trough);
  return abs > 0 ? net / abs : null;
}

/** Recovery → points: net ≤ 0 → 0; profit without any drawdown → 100. */
export function scoreRecovery(net: number, rf: number | null): number {
  if (!(net > 0)) return 0;
  if (rf == null) return 100;
  return piecewise(rf, RF_ANCHORS);
}

/** Share of the best day in the total net profit (prop-firm consistency rule); `null` unless total net > 0. */
export function bestDayShare(dayNets: readonly number[]): number | null {
  let total = 0;
  let best = -Infinity;
  for (const v of dayNets) {
    total += v;
    if (v > best) best = v;
  }
  return total > 0 ? best / total : null;
}

/** Consistency → `(1 − share) / 0,7 · 100`, clamped: best day ≤ 30 % of the profit → 100, ≥ 100 % → 0; no profit → 0. */
export function scoreConsistency(dayNets: readonly number[]): number {
  const share = bestDayShare(dayNets);
  return share == null ? 0 : clamp(((1 - share) / 0.7) * 100, 0, 100);
}

/** Daily net P&L (local day of `trade.date`) of closed trades. */
export function dailyNets(closed: readonly EnrichedTrade[]): number[] {
  const m = new Map<string, number>();
  for (const t of closed) {
    const k = dayKeyOf(t);
    m.set(k, (m.get(k) ?? 0) + (t.pnl || 0));
  }
  return [...m.values()];
}

/**
 * Max. drawdown of a closed-trade list on top of `start` – the exact algorithm of `accountView` (fraction of the
 * running peak, the drop with the largest fraction wins). `closed` must be in trade-time order.
 */
export function equityDrawdown(closed: readonly EnrichedTrade[], start: number): { maxDD: number; dd: Drawdown; balance: number } {
  let bal = start;
  let peak = start;
  let peakI = 0;
  let maxDD = 0;
  const dd: Drawdown = { peak: start, trough: start, peakI: 0, troughI: 0 };
  closed.forEach((t, idx) => {
    bal += t.pnl || 0;
    if (bal > peak) {
      peak = bal;
      peakI = idx + 1;
    }
    const d = peak > 0 ? (bal - peak) / peak : 0;
    if (d < maxDD) {
      maxDD = d;
      Object.assign(dd, { peak, trough: bal, peakI, troughI: idx + 1 });
    }
  });
  return { maxDD, dd, balance: bal };
}

export interface EdgeAxis {
  key: EdgeAxisKey;
  label: string;
  /** label for narrow layouts (radar on a phone) */
  short: string;
  /** 0…100 */
  value: number;
  weight: number;
  /** raw figure as shown ("1,45", "−8,2 %", "58 %", "4 Tage") */
  raw: string;
  rawValue: number | null;
}

export interface EdgeResult {
  /** rounded Σ weight · value, `null` without closed trades */
  score: number | null;
  /** unrounded Σ weight · value */
  exact: number;
  axes: EdgeAxis[];
  n: number;
  reliable: boolean;
  /** the axis with the most weighted points left on the table */
  weakest: EdgeAxis | null;
}

export interface EdgeInput {
  closed: readonly EnrichedTrade[];
  g: Agg;
  maxDD: number;
  dd: Pick<Drawdown, "peak" | "trough">;
}

export const EDGE_LABELS: Readonly<Record<EdgeAxisKey, { label: string; short: string }>> = {
  pf: { label: "Profit-Faktor", short: "PF" },
  payoff: { label: "Gewinn/Verlust", short: "G/V" },
  dd: { label: "Drawdown", short: "DD" },
  winRate: { label: "Win-Rate", short: "Win" },
  recovery: { label: "Erholung", short: "Erh." },
  consistency: { label: "Konstanz", short: "Konst." },
};

/** Edge-Score of an account view (`accountView` supplies `closed`, `g`, `maxDD`, `dd`). */
export function edgeScore({ closed, g, maxDD, dd }: EdgeInput): EdgeResult {
  const rf = recoveryFactor(g.net, dd);
  const days = dailyNets(closed);
  const share = bestDayShare(days);
  const values: Record<EdgeAxisKey, { value: number; raw: string; rawValue: number | null }> = {
    pf: { value: scorePF(g.pf), raw: g.pf === Infinity ? INFINITY_SIGN : n2(g.pf), rawValue: g.pf },
    payoff: { value: scorePayoff(g), raw: g.payoff == null && g.wins > 0 && !g.losses ? INFINITY_SIGN : n2(g.payoff), rawValue: g.payoff },
    dd: { value: scoreDrawdown(maxDD), raw: pct(maxDD), rawValue: maxDD },
    winRate: { value: scoreWinRate(g.winRate), raw: pct0(g.winRate), rawValue: g.winRate },
    recovery: { value: scoreRecovery(g.net, rf), raw: rf == null ? (g.net > 0 ? "kein DD" : "–") : n2(rf), rawValue: rf },
    consistency: { value: scoreConsistency(days), raw: share == null ? "–" : `${pct0(share)} am besten Tag`, rawValue: share },
  };
  const axes: EdgeAxis[] = EDGE_ORDER.map((key) => ({ key, ...EDGE_LABELS[key], weight: EDGE_WEIGHTS[key], ...values[key] }));
  const exact = axes.reduce((s, a) => s + a.value * a.weight, 0);
  let weakest: EdgeAxis | null = null;
  for (const a of axes) if (!weakest || (100 - a.value) * a.weight > (100 - weakest.value) * weakest.weight) weakest = a;
  return {
    score: g.n ? Math.round(exact) : null,
    exact,
    axes,
    n: g.n,
    reliable: g.n >= EDGE_MIN_TRADES,
    weakest: g.n && weakest && weakest.value < 100 ? weakest : null,
  };
}

/** Edge-Score of the closed trades up to (excluding) `before`, with the account's start capital. */
export function edgeScoreUntil(closed: readonly EnrichedTrade[], start: number, before: number): EdgeResult {
  const sub = closed.filter((t) => +tradeTime(t) < before);
  const { maxDD, dd } = equityDrawdown(sub, start);
  return edgeScore({ closed: sub, g: aggregate(sub), maxDD, dd });
}

export interface EdgePoint {
  /** "YYYY-MM" */
  key: string;
  score: number;
}

/** Cumulative score at the end of each month that had trades (last `limit` months) – the trend line. */
export function edgeTimeline(closed: readonly EnrichedTrade[], start: number, limit = 12): EdgePoint[] {
  const out: EdgePoint[] = [];
  const sorted = [...closed].sort((a, b) => +tradeTime(a) - +tradeTime(b));
  let i = 0;
  while (i < sorted.length) {
    const key = monthKey(tradeTime(sorted[i]!));
    while (i < sorted.length && monthKey(tradeTime(sorted[i]!)) === key) i++;
    const sub = sorted.slice(0, i);
    const { maxDD, dd } = equityDrawdown(sub, start);
    const r = edgeScore({ closed: sub, g: aggregate(sub), maxDD, dd });
    if (r.score != null) out.push({ key, score: r.score });
  }
  return out.slice(-limit);
}
