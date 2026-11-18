/**
 * Account view – 1:1 port of bundle `Hw` (21350–21439): equity curve, drawdown, streak, monthly buckets,
 * year projection and per-setup stats for "all" | "makro" | "scalp".
 */
import type { AccountId, EnrichedTrade, Settings, Setup, TradeResult } from "./types";
import { aggregate, type Agg } from "./agg";
import { tradeTime, monthKey, monthLabel } from "@/lib/dates";

export type AccountScope = "all" | AccountId;

export interface EquityPoint {
  /** 0 = start */
  i: number;
  v: number;
  t: EnrichedTrade | null;
}

export interface Drawdown {
  peak: number;
  trough: number;
  peakI: number;
  troughI: number;
}

export interface Projection {
  days: number;
  r: number;
  linear: number;
  comp: number;
  monthly: number;
  perWeek: number;
  endLin: number;
  weak: boolean;
}

export interface MonthBucket extends Agg {
  /** "YYYY-MM" */
  key: string;
  /** "Sep 26" */
  label: string;
}

export interface SetupStats extends Agg {
  setup: Setup;
}

export interface AccountView {
  start: number;
  list: EnrichedTrade[];
  /** closed trades sorted by trade time ascending */
  closed: EnrichedTrade[];
  open: EnrichedTrade[];
  g: Agg;
  equity: EquityPoint[];
  balance: number;
  /** ≤ 0 fraction */
  maxDD: number;
  dd: Drawdown;
  curDD: number;
  peak: number;
  streak: number;
  streakType: TradeResult | null;
  months: MonthBucket[];
  proj: Projection | null;
  setups: SetupStats[];
  /** closed trades without any known setup */
  none: Agg;
}

export interface AccountViewOptions {
  /** injectable clock for deterministic tests (defaults to Date.now) */
  now?: () => number;
}

export function accountView(
  all: readonly EnrichedTrade[],
  s: Settings,
  acc: AccountScope = "all",
  opts: AccountViewOptions = {},
): AccountView {
  const now = opts.now ?? Date.now;
  const start = acc === "all" ? s.capital.makro + s.capital.scalp : s.capital[acc];
  const list = acc === "all" ? [...all] : all.filter((t) => (t.account || "scalp") === acc);
  const closed = list.filter((t) => t.result !== "open").sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const open = list.filter((t) => t.result === "open");
  const g = aggregate(closed);

  const equity: EquityPoint[] = [{ i: 0, v: start, t: null }];
  let bal = start,
    peak = start,
    peakI = 0,
    maxDD = 0;
  const dd: Drawdown = { peak: start, trough: start, peakI: 0, troughI: 0 };
  closed.forEach((t, idx) => {
    bal += t.pnl || 0;
    equity.push({ i: idx + 1, v: bal, t });
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
  const curDD = peak > 0 ? (bal - peak) / peak : 0;

  let streak = 0;
  let streakType: TradeResult | null = null;
  for (let k = closed.length - 1; k >= 0; k--) {
    const res = closed[k]!.result;
    if (!streakType) streakType = res;
    if (res !== streakType) break;
    streak++;
  }

  const byMonth = new Map<string, EnrichedTrade[]>();
  for (const t of closed) {
    const key = monthKey(tradeTime(t));
    const arr = byMonth.get(key);
    if (arr) arr.push(t);
    else byMonth.set(key, [t]);
  }
  const months: MonthBucket[] = [...byMonth.keys()]
    .sort()
    .slice(-12)
    .map((key) => ({ key, label: monthLabel(key), ...aggregate(byMonth.get(key)!) }));

  let proj: Projection | null = null;
  if (closed.length && start > 0) {
    const startD = s.startDate ? new Date(s.startDate + "T00:00") : tradeTime(closed[0]!);
    const endMs = Math.max(now(), +tradeTime(closed[closed.length - 1]!));
    const days = Math.max(1, (endMs - +startD) / 864e5);
    const r = g.net / start;
    const linear = (r * 365) / days;
    proj = {
      days,
      r,
      linear,
      comp: 1 + r > 0 ? Math.pow(1 + r, 365 / days) - 1 : -1,
      monthly: (r * 30.44) / days,
      perWeek: closed.length / (days / 7),
      endLin: start * (1 + linear),
      weak: closed.length < 10 || days < 30,
    };
  }

  const known = new Set(s.setups.map((x) => x.id));
  const setups: SetupStats[] = s.setups.map((setup) => ({
    setup,
    ...aggregate(closed.filter((t) => (t.setups || []).includes(setup.id))),
  }));
  const none = aggregate(closed.filter((t) => !(t.setups || []).some((id) => known.has(id))));

  return { start, list, closed, open, g, equity, balance: bal, maxDD, dd, curDD, peak, streak, streakType, months, proj, setups, none };
}

/** Projection card cell "Mit Zinseszins". */
export function compoundLabel(comp: number, pct: (v: number) => string): string {
  return Math.abs(comp) > 99 ? (comp > 0 ? "> +9.900 %" : "−100 %") : pct(comp);
}

/** Win-rate card / streak tile: "3× Gewinn" etc. */
export function streakLabel(streak: number, type: TradeResult | null): string | null {
  if (!streak) return null;
  return `${streak}× ${type === "win" ? "Gewinn" : type === "loss" ? "Verlust" : "Break-even"}`;
}

export const Hw = accountView;
