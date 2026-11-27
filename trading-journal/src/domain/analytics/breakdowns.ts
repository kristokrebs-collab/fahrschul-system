/**
 * Breakdowns with honest uncertainty (P03): one row per bucket of a dimension (`dimensions.ts`) with `aggregate()`,
 * the 80 % Wilson interval of the win rate, Ø R (or Ø P&L) with its t-interval, and a Welch test of the bucket
 * against the REST of the trades – Benjamini-Hochberg over the rows of one breakdown (q = 10 %), so ten buckets do
 * not produce a "significant" one by chance. "Trade the best": `best` is the bucket with the highest LOWER bound
 * (robustly good, not just lucky), `worst` the one with the lowest upper bound.
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { DIMENSIONS, NONE_KEY, bucketLabel, groupByDimension, type DimensionCtx, type DimensionKey } from "./dimensions";
import { benjaminiHochberg, finite, mean, significanceOf, tTest, welch, wilsonCI, type Interval, type Significance } from "./stats";

/** Trades a bucket needs before it gets an interval, a test or the best / worst pick. */
export const BREAKDOWN_MIN_N = 5;

export interface MeanCI {
  mean: number | null;
  ci: Interval | null;
  n: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  /** the dimension's "ohne" bucket */
  none: boolean;
  trades: EnrichedTrade[];
  g: Agg;
  /** share of the breakdown's trades */
  share: number;
  /** 80 % Wilson interval of the win rate (null below `BREAKDOWN_MIN_N`) */
  wrCI: Interval | null;
  /** Ø R of the trades with a stop, with its 80 % t-interval */
  expR: MeanCI;
  /** Ø P&L per trade (money) with its 80 % t-interval */
  exp: MeanCI;
  /** bucket vs. rest in the breakdown's unit */
  test: {
    /** Ø bucket − Ø rest */
    diff: number | null;
    p: number | null;
    /** Benjamini-Hochberg adjusted p over the rows */
    q: number | null;
    verdict: Significance;
    /** win-rate difference bucket − rest (fraction) */
    dWin: number | null;
  };
}

export interface Breakdown {
  dim: DimensionKey;
  label: string;
  /** "R" when ≥ 60 % of the trades carry an R (and ≥ 5), else money per trade */
  unit: "R" | "money";
  rows: BreakdownRow[];
  best: BreakdownRow | null;
  worst: BreakdownRow | null;
  /** distinct trades */
  total: number;
}

const meanCI = (xs: readonly number[]): MeanCI => {
  const t = xs.length >= BREAKDOWN_MIN_N ? tTest(xs) : null;
  return { mean: mean(xs), ci: t?.ci ?? null, n: xs.length };
};

/** Value of a trade in the breakdown unit (`null` = the trade has none, e.g. no stop in R). */
export const unitValue = (t: EnrichedTrade, unit: "R" | "money"): number | null => (unit === "R" ? (typeof t.r === "number" && Number.isFinite(t.r) ? t.r : null) : (t.pnl ?? 0));

/** Chooses R when it covers ≥ 60 % of the trades (and ≥ 5 of them). */
export function breakdownUnit(closed: readonly EnrichedTrade[]): "R" | "money" {
  const rN = closed.filter((t) => typeof t.r === "number" && Number.isFinite(t.r)).length;
  return rN >= 5 && rN >= 0.6 * closed.length ? "R" : "money";
}

/** The breakdown of the closed trades by one dimension. */
export function breakdown(closed: readonly EnrichedTrade[], dimKey: DimensionKey, ctx: DimensionCtx, opts: { minN?: number } = {}): Breakdown {
  const dim = DIMENSIONS[dimKey];
  const minN = opts.minN ?? BREAKDOWN_MIN_N;
  const unit = breakdownUnit(closed);
  const groups = groupByDimension(closed, dim, ctx);
  const total = closed.length;

  const rows: BreakdownRow[] = [...groups.entries()].map(([key, trades]) => {
    const g = aggregate(trades);
    const inSet = new Set(trades);
    const rest = closed.filter((t) => !inSet.has(t));
    const a = finite(trades.map((t) => unitValue(t, unit)));
    const b = finite(rest.map((t) => unitValue(t, unit)));
    const w = a.length >= minN && b.length >= minN ? welch(a, b) : null;
    const restWins = rest.filter((t) => (t.pnl || 0) > 0).length;
    const dWin = g.n && rest.length ? g.wins / g.n - restWins / rest.length : null;
    return {
      key,
      label: bucketLabel(dim, key, ctx),
      none: key === NONE_KEY,
      trades,
      g,
      share: total ? trades.length / total : 0,
      wrCI: g.n >= minN ? wilsonCI(g.wins, g.n) : null,
      expR: meanCI(finite(trades.map((t) => t.r))),
      exp: meanCI(trades.map((t) => t.pnl ?? 0)),
      test: { diff: w?.diff ?? null, p: w?.p ?? null, q: null, verdict: "wenig" as Significance, dWin },
    };
  });

  const fdr = benjaminiHochberg(rows.map((r) => r.test.p));
  rows.forEach((r, i) => {
    r.test.q = fdr.q[i] ?? null;
    r.test.verdict = significanceOf(r.test.p, r.test.q, r.g.n, minN);
  });

  const meanOf = (r: BreakdownRow) => (unit === "R" ? r.expR : r.exp);
  if (dim.order) {
    const idx = new Map(dim.order.map((k, i) => [k, i]));
    rows.sort((x, y) => (x.none ? 1 : 0) - (y.none ? 1 : 0) || (idx.get(x.key) ?? 999) - (idx.get(y.key) ?? 999) || (x.key < y.key ? -1 : 1));
  } else {
    rows.sort((x, y) => (x.none ? 1 : 0) - (y.none ? 1 : 0) || (meanOf(y).mean ?? -Infinity) - (meanOf(x).mean ?? -Infinity) || y.g.n - x.g.n);
  }

  const eligible = rows.filter((r) => !r.none && r.g.n >= minN && meanOf(r).ci);
  let best: BreakdownRow | null = null;
  let worst: BreakdownRow | null = null;
  for (const r of eligible) {
    const m = meanOf(r);
    if (m.mean != null && m.mean > 0 && (!best || m.ci!.lo > meanOf(best).ci!.lo)) best = r;
    if (m.mean != null && m.mean < 0 && (!worst || m.ci!.hi < meanOf(worst).ci!.hi)) worst = r;
  }
  return { dim: dimKey, label: dim.label, unit, rows, best, worst, total };
}

/** Mean of a row in the breakdown unit. */
export const rowMean = (b: Pick<Breakdown, "unit">, r: BreakdownRow): MeanCI => (b.unit === "R" ? r.expR : r.exp);
