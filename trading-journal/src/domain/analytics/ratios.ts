/**
 * Risk-adjusted ratios (P03): Sharpe and Sortino per trade and per day (√365, crypto trades every day), Calmar / MAR,
 * SQN, Kelly and half-Kelly, gain-to-pain, Omega, Ulcer index, tail ratio and the edge test (one-sample t-test of the
 * mean R). Every number carries its sample size and an 80 % interval (t-interval or a seeded bootstrap).
 *
 * Consistency: Kelly reads `aggregate()`'s win rate and payoff, the edge test its Ø R, Calmar `accountView()`'s
 * compound projection (`proj.comp`) and max drawdown – the same numbers as the Hero and its explainers.
 */
import type { EnrichedTrade } from "../types";
import type { AccountView } from "../account";
import { aggregate } from "../agg";
import { localDateKey, tradeTime } from "@/lib/dates";
import { bootRuns, bootstrapCI, downsideDeviation, finite, mean, quantileSorted, sd, sortedAsc, sum, tradesForEdge, tTest, type Interval, type TTest } from "./stats";

export type RatioKey = "sharpe" | "sharpeTrade" | "sortino" | "sortinoTrade" | "calmar" | "sqn" | "kelly" | "halfKelly" | "gainToPain" | "omega" | "ulcer" | "tailRatio" | "edge";

export interface Metric {
  key: RatioKey;
  /** `null` = not computable with this sample; may be `Infinity` (gain-to-pain / Omega without a loss) */
  value: number | null;
  /** sample size behind the number (trades, days or months – see `unit`) */
  n: number;
  unit: "trades" | "days" | "months";
  ci: Interval | null;
  /** p of the one-sided test "edge > 0" where one exists (edge, SQN) */
  p?: number | null;
}

/** Minimum sample per metric before a value is shown at all. */
export const RATIO_MIN: Readonly<Record<RatioKey, number>> = {
  sharpe: 10,
  sharpeTrade: 5,
  sortino: 10,
  sortinoTrade: 5,
  calmar: 5,
  sqn: 5,
  kelly: 5,
  halfKelly: 5,
  gainToPain: 2,
  omega: 10,
  ulcer: 3,
  tailRatio: 20,
  edge: 3,
};
/** SQN's n is capped (Van Tharp) so a large sample does not inflate it. */
export const SQN_CAP = 100;
export const DAYS_PER_YEAR = 365;

export interface DayReturn {
  /** local day `YYYY-MM-DD` */
  key: string;
  net: number;
  /** net ÷ balance at the start of the day */
  ret: number;
}

/** Per-trade return: P&L ÷ balance before the trade (start capital + every earlier P&L). Balance ≤ 0 → skipped. */
export function tradeReturns(closed: readonly EnrichedTrade[], start: number): number[] {
  const out: number[] = [];
  let bal = start;
  for (const t of closed) {
    const p = t.pnl || 0;
    if (bal > 0) out.push(p / bal);
    bal += p;
  }
  return out;
}

/**
 * Daily returns over EVERY calendar day from the first to the last trade day (days without trades count as 0 – the
 * honest base of an annualised ratio), each relative to the balance at the start of that day.
 */
export function dailyReturns(closed: readonly EnrichedTrade[], start: number): DayReturn[] {
  if (!closed.length) return [];
  const byDay = new Map<string, number>();
  for (const t of closed) {
    const k = localDateKey(tradeTime(t));
    byDay.set(k, (byDay.get(k) ?? 0) + (t.pnl || 0));
  }
  const keys = [...byDay.keys()].sort();
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const out: DayReturn[] = [];
  let bal = start;
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d, 12); // noon: DST never skips a day
  for (let guard = 0; guard < 20_000; guard++) {
    const k = localDateKey(day);
    const net = byDay.get(k) ?? 0;
    out.push({ key: k, net, ret: bal > 0 ? net / bal : 0 });
    bal += net;
    if (k >= last) break;
    day.setDate(day.getDate() + 1);
  }
  return out;
}

/** Net P&L per calendar month (`YYYY-MM`, every month with a trade). */
export function monthlyNets(closed: readonly EnrichedTrade[]): { key: string; net: number }[] {
  const m = new Map<string, number>();
  for (const t of closed) {
    const k = localDateKey(tradeTime(t)).slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + (t.pnl || 0));
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, net]) => ({ key, net }));
}

/** mean ÷ sd (sample); `null` without spread. */
export function sharpeOf(xs: readonly number[]): number | null {
  const m = mean(xs);
  const s = sd(xs);
  return m == null || s == null || !(s > 1e-12) ? null : m / s;
}

/** mean ÷ downside deviation (target 0); `null` without downside. */
export function sortinoOf(xs: readonly number[]): number | null {
  const m = mean(xs);
  const dd = downsideDeviation(xs);
  return m == null || dd == null || !(dd > 1e-12) ? null : m / dd;
}

/** Σ gains ÷ Σ |losses| (threshold 0); Infinity without a loss, `null` empty / flat. */
export function omegaOf(xs: readonly number[]): number | null {
  let up = 0;
  let dn = 0;
  for (const x of xs) {
    if (x > 0) up += x;
    else dn -= x;
  }
  if (dn > 0) return up / dn;
  return up > 0 ? Infinity : null;
}

/** Schwager's gain-to-pain: Σ periods ÷ |Σ losing periods|; Infinity without a losing period. */
export function gainToPainOf(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const total = sum(xs);
  let pain = 0;
  for (const x of xs) if (x < 0) pain -= x;
  if (pain > 0) return total / pain;
  return total > 0 ? Infinity : null;
}

/** Ulcer index of an equity path in PERCENT: √(mean of squared % drawdowns from the running peak). */
export function ulcerOf(equity: readonly number[]): number | null {
  if (equity.length < 2) return null;
  let peak = equity[0]!;
  let s = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? ((v - peak) / peak) * 100 : 0;
    s += dd * dd;
  }
  return Math.sqrt(s / equity.length);
}

/** p95 ÷ |p5| of per-trade results; `null` without a negative 5th percentile. */
export function tailRatioOf(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const s = sortedAsc(xs);
  const p95 = quantileSorted(s, 0.95)!;
  const p5 = quantileSorted(s, 0.05)!;
  return p5 < 0 ? p95 / -p5 : null;
}

/** Kelly fraction W − (1 − W) ÷ payoff from trade P&Ls (aggregate()'s definitions); `null` without wins AND losses. */
export function kellyOf(pnls: readonly number[]): number | null {
  let wins = 0;
  let losses = 0;
  let gw = 0;
  let gl = 0;
  for (const p of pnls) {
    if (p > 0) {
      wins++;
      gw += p;
    } else if (p < 0) {
      losses++;
      gl -= p;
    }
  }
  const n = pnls.length;
  if (!n || !wins || !losses) return null;
  const w = wins / n;
  const payoff = gw / wins / (gl / losses);
  return w - (1 - w) / payoff;
}

/** Max drawdown fraction of a P&L sequence on top of `start` (accountView's algorithm). */
export function maxDDOf(pnls: readonly number[], start: number): number {
  let bal = start;
  let peak = start;
  let dd = 0;
  for (const p of pnls) {
    bal += p;
    if (bal > peak) peak = bal;
    const d = peak > 0 ? (bal - peak) / peak : 0;
    if (d < dd) dd = d;
  }
  return dd;
}

/** Compound annual growth of `net` on `start` over `days` (accountView's `proj.comp`). */
export function cagrOf(net: number, start: number, days: number): number | null {
  if (!(start > 0) || !(days > 0)) return null;
  const r = net / start;
  return 1 + r > 0 ? Math.pow(1 + r, DAYS_PER_YEAR / days) - 1 : -1;
}

/** Calmar / MAR = CAGR ÷ |max DD|; `null` without a drawdown. */
export function calmarOf(cagr: number | null, maxDD: number): number | null {
  return cagr == null || !(maxDD < 0) ? null : cagr / -maxDD;
}

export interface RatioOptions {
  seed?: number;
  /** bootstrap resamples (default adaptive 100–400 by sample size) */
  runs?: number;
}

export interface RatioReport {
  metrics: Record<RatioKey, Metric>;
  /** trade returns (P&L ÷ balance before), daily returns (calendar days), R multiples (trades with a stop) */
  tradeRets: number[];
  days: DayReturn[];
  rs: number[];
  /** the unit of the edge test: R when ≥ 60 % of the trades (and ≥ 5) carry one, else money per trade */
  edgeUnit: "R" | "money";
  edgeTest: TTest | null;
  /** trades needed until "Ø > 0" holds at 80 % with 80 % power (null without a positive mean) */
  tradesNeeded: number | null;
  /** compound annual growth (accountView's `proj.comp`) */
  cagr: number | null;
  maxDD: number;
}

const metric = (key: RatioKey, value: number | null, n: number, unit: Metric["unit"], ci: Interval | null, p?: number | null): Metric => {
  const ok = n >= RATIO_MIN[key];
  return { key, value: ok ? value : null, n, unit, ci: ok ? ci : null, ...(p !== undefined ? { p: ok ? p : null } : {}) };
};

/** Every ratio of the closed trades of an account view (time order). Memoise per `view.closed`. */
export function ratioReport(closed: readonly EnrichedTrade[], view: Pick<AccountView, "start" | "proj" | "maxDD" | "equity">, opts: RatioOptions = {}): RatioReport {
  const seed = opts.seed ?? 7;
  const start = view.start;
  const pnls = closed.map((t) => t.pnl || 0);
  const n = pnls.length;
  const g = aggregate(closed);
  const tradeRets = tradeReturns(closed, start);
  const days = dailyReturns(closed, start);
  const dayRets = days.map((d) => d.ret);
  const rs = finite(closed.map((t) => t.r));
  const months = monthlyNets(closed).map((m) => m.net);
  const ann = Math.sqrt(DAYS_PER_YEAR);
  const runs = (k: number) => opts.runs ?? bootRuns(k);
  const boot = (xs: readonly number[], stat: (s: number[]) => number | null, salt: number) => bootstrapCI(xs, stat, { seed: seed + salt, runs: runs(xs.length) });

  // Sharpe / Sortino
  const sharpeT = sharpeOf(tradeRets);
  const sharpeD = sharpeOf(dayRets);
  const sortinoT = sortinoOf(tradeRets);
  const sortinoD = sortinoOf(dayRets);
  const scale = (ci: Interval | null, k: number): Interval | null => (ci ? { lo: ci.lo * k, hi: ci.hi * k } : null);

  // SQN on R (n capped at 100) with the t-test of the mean R
  const sqnN = Math.min(rs.length, SQN_CAP);
  const sharpeR = sharpeOf(rs);
  const sqn = sharpeR == null ? null : Math.sqrt(sqnN) * sharpeR;
  const rTest = tTest(rs);

  // edge: Ø R when most trades carry one, else money per trade
  const useR = rs.length >= 5 && rs.length >= 0.6 * n;
  const edgeSample = useR ? rs : pnls;
  const edgeTest = tTest(edgeSample);

  // Kelly (aggregate()'s win rate and payoff)
  const kelly = g.winRate != null && g.payoff != null && g.payoff > 0 ? g.winRate - (1 - g.winRate) / g.payoff : null;
  const kellyCI = boot(pnls, kellyOf, 11);

  // Calmar / MAR: CAGR from the account view, max DD of the same path
  const cagr = view.proj ? view.proj.comp : null;
  const projDays = view.proj?.days ?? null;
  const calmar = calmarOf(cagr, view.maxDD);
  const calmarCI = projDays
    ? boot(pnls, (s) => calmarOf(cagrOf(sum(s), start, projDays), maxDDOf(s, start)), 13)
    : null;

  // Ulcer on the account view's equity points
  const equity = view.equity.map((p) => p.v);
  const ulcer = ulcerOf(equity);
  const ulcerCI = boot(pnls, (s) => {
    const path: number[] = [start];
    let b = start;
    for (const p of s) path.push((b += p));
    return ulcerOf(path);
  }, 17);

  const metrics: Record<RatioKey, Metric> = {
    sharpe: metric("sharpe", sharpeD == null ? null : sharpeD * ann, dayRets.length, "days", scale(boot(dayRets, sharpeOf, 1), ann)),
    sharpeTrade: metric("sharpeTrade", sharpeT, tradeRets.length, "trades", boot(tradeRets, sharpeOf, 2)),
    sortino: metric("sortino", sortinoD == null ? null : sortinoD * ann, dayRets.length, "days", scale(boot(dayRets, sortinoOf, 3), ann)),
    sortinoTrade: metric("sortinoTrade", sortinoT, tradeRets.length, "trades", boot(tradeRets, sortinoOf, 4)),
    calmar: metric("calmar", calmar, n, "trades", calmarCI),
    sqn: metric("sqn", sqn, rs.length, "trades", scale(boot(rs, sharpeOf, 5), Math.sqrt(sqnN)), rTest?.pGreater ?? null),
    kelly: metric("kelly", kelly, n, "trades", kellyCI),
    halfKelly: metric("halfKelly", kelly == null ? null : kelly / 2, n, "trades", kellyCI ? { lo: kellyCI.lo / 2, hi: kellyCI.hi / 2 } : null),
    gainToPain: metric("gainToPain", gainToPainOf(months), months.length, "months", months.length >= 3 ? boot(months, gainToPainOf, 6) : null),
    omega: metric("omega", omegaOf(dayRets), dayRets.length, "days", boot(dayRets, omegaOf, 7)),
    ulcer: metric("ulcer", ulcer, n, "trades", ulcerCI),
    tailRatio: metric("tailRatio", tailRatioOf(pnls), n, "trades", boot(pnls, tailRatioOf, 8)),
    edge: metric("edge", edgeTest?.mean ?? null, edgeSample.length, "trades", edgeTest?.ci ?? null, edgeTest?.pGreater ?? null),
  };

  return {
    metrics,
    tradeRets,
    days,
    rs,
    edgeUnit: useR ? "R" : "money",
    edgeTest,
    tradesNeeded: edgeTest ? tradesForEdge(edgeTest.mean, edgeTest.sd) : null,
    cagr,
    maxDD: view.maxDD,
  };
}
