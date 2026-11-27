/**
 * Result distribution (P03): histogram in money or R with "nice" bin edges, mean / median / skew / excess kurtosis,
 * outliers by the Hampel rule (|x − median| > 3 · 1,4826 · MAD), the key numbers WITHOUT the best 1 / 3 / 5 trades
 * and without the outliers (all through `aggregate()`), and the profit concentration (share of the gross profit from
 * the top 1 / 3 / 5 winners and the top 10 % of trades).
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { MAD_SIGMA, finite, kurtosis, mad, mean, median, sd, skewness } from "./stats";

/** Hampel threshold in robust σ. */
export const HAMPEL_K = 3;
export const DIST_MIN_N = 5;

export interface HistBin {
  lo: number;
  hi: number;
  n: number;
  /** Σ of the values in the bin */
  sum: number;
}

/** A "nice" step (1, 2, 2.5, 5 × 10^k) for about `target` bins over `span`. */
export function niceStep(span: number, target = 12): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Histogram with nice, zero-aligned edges (zero is always a bin edge, so wins and losses never share a bin). */
export function histogram(values: readonly number[], target = 12): HistBin[] {
  const xs = finite(values);
  if (!xs.length) return [];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  const step = niceStep(hi - lo, target);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step === hi ? hi + step : Math.ceil(hi / step) * step;
  const count = Math.max(1, Math.round((end - start) / step));
  const bins: HistBin[] = Array.from({ length: count }, (_, i) => ({ lo: start + i * step, hi: start + (i + 1) * step, n: 0, sum: 0 }));
  for (const x of xs) {
    const i = Math.min(count - 1, Math.max(0, Math.floor((x - start) / step + 1e-9)));
    bins[i]!.n++;
    bins[i]!.sum += x;
  }
  return bins;
}

export interface Outlier {
  trade: EnrichedTrade;
  value: number;
  /** distance from the median in robust σ */
  z: number;
}

export interface DistributionReport {
  unit: "money" | "R";
  values: { id: string; v: number }[];
  bins: HistBin[];
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  skew: number | null;
  kurt: number | null;
  outliers: Outlier[];
  /** aggregate() without the best k trades (by P&L) */
  withoutTop: { k: number; g: Agg }[];
  withoutOutliers: Agg | null;
  /** share of the gross profit from the top 1 / 3 / 5 winners and the top 10 % of trades (0–1, null without profit) */
  concentration: { top1: number | null; top3: number | null; top5: number | null; top10pct: number | null };
}

const valueOf = (t: EnrichedTrade, unit: "money" | "R"): number | null => (unit === "R" ? (typeof t.r === "number" && Number.isFinite(t.r) ? t.r : null) : (t.pnl ?? 0));

/** Hampel outliers of `(trade, value)` pairs. */
export function hampelOutliers(pairs: readonly { trade: EnrichedTrade; value: number }[], k = HAMPEL_K): Outlier[] {
  const xs = pairs.map((p) => p.value);
  const med = median(xs);
  const m = mad(xs);
  if (med == null || m == null || !(m > 0)) return [];
  const sigma = MAD_SIGMA * m;
  return pairs
    .map((p) => ({ trade: p.trade, value: p.value, z: (p.value - med) / sigma }))
    .filter((o) => Math.abs(o.z) > k)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

export function distributionReport(closed: readonly EnrichedTrade[], unit: "money" | "R" = "money"): DistributionReport {
  const pairs = closed.map((t) => ({ trade: t, value: valueOf(t, unit) })).filter((p): p is { trade: EnrichedTrade; value: number } => p.value != null);
  const xs = pairs.map((p) => p.value);
  const n = xs.length;
  const outliers = n >= DIST_MIN_N ? hampelOutliers(pairs) : [];
  const byPnl = [...closed].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
  const withoutTop = [1, 3, 5].filter((k) => closed.length > k).map((k) => ({ k, g: aggregate(byPnl.slice(k)) }));
  const outSet = new Set(outliers.map((o) => o.trade));
  const gw = closed.reduce((s, t) => s + Math.max(0, t.pnl || 0), 0);
  const winners = byPnl.filter((t) => (t.pnl || 0) > 0);
  const share = (list: readonly EnrichedTrade[]) => (gw > 0 ? list.reduce((s, t) => s + Math.max(0, t.pnl || 0), 0) / gw : null);
  return {
    unit,
    values: pairs.map((p) => ({ id: p.trade.id, v: p.value })),
    bins: histogram(xs),
    n,
    mean: mean(xs),
    median: median(xs),
    sd: sd(xs),
    skew: skewness(xs),
    kurt: kurtosis(xs),
    outliers,
    withoutTop,
    withoutOutliers: outliers.length ? aggregate(closed.filter((t) => !outSet.has(t))) : null,
    concentration: {
      top1: winners.length >= 1 ? share(winners.slice(0, 1)) : null,
      top3: winners.length >= 3 ? share(winners.slice(0, 3)) : null,
      top5: winners.length >= 5 ? share(winners.slice(0, 5)) : null,
      top10pct: closed.length >= 10 ? share(byPnl.slice(0, Math.max(1, Math.round(closed.length * 0.1))).filter((t) => (t.pnl || 0) > 0)) : null,
    },
  };
}
