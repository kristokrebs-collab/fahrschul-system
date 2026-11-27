/**
 * Correlation (P05), pure: Pearson correlation of daily log returns between the traded pairs, the matrix, clusters of
 * strongly correlated pairs (union-find over |ρ| ≥ threshold) and the cluster warning ("three longs that are really one
 * trade"). The candles come from `src/market/multiDaily.ts` (one fetch per pair and UTC day).
 */
import type { Side } from "../types";

/** A daily close; `t` = open time of the UTC day (ms). */
export interface DailyClose {
  t: number;
  c: number;
}

/** Return days used per pair (the last N closes). */
export const CORR_WINDOW = 90;
/** Overlapping return days a pair needs before ρ is reported. */
export const CORR_MIN_N = 20;
/** |ρ| from which two pairs count as "one trade". */
export const CORR_CLUSTER = 0.7;

/** Daily log returns keyed by the day of the later close. */
export function logReturns(series: readonly DailyClose[]): Map<number, number> {
  const out = new Map<number, number>();
  const s = [...series].filter((x) => Number.isFinite(x.c) && x.c > 0).sort((a, b) => a.t - b.t);
  for (let i = 1; i < s.length; i++) out.set(s[i]!.t, Math.log(s[i]!.c / s[i - 1]!.c));
  return out;
}

/** Pearson ρ of two equally long samples; null below 3 values or without variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

export interface CorrMatrix {
  symbols: string[];
  /** ρ (null: too little overlap); the diagonal is 1 */
  rho: (number | null)[][];
  /** overlapping return days per pair */
  n: number[][];
  window: number;
}

/** Correlation matrix of the series (returns aligned by day, the last `window` closes per pair). */
export function correlationMatrix(series: Readonly<Record<string, readonly DailyClose[]>>, window = CORR_WINDOW, minN = CORR_MIN_N): CorrMatrix {
  const symbols = Object.keys(series).filter((s) => (series[s]?.length ?? 0) > 1);
  const rets = symbols.map((s) => logReturns([...(series[s] ?? [])].sort((a, b) => a.t - b.t).slice(-(window + 1))));
  const k = symbols.length;
  const rho: (number | null)[][] = Array.from({ length: k }, () => Array<number | null>(k).fill(null));
  const n: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    rho[i]![i] = 1;
    n[i]![i] = rets[i]!.size;
    for (let j = i + 1; j < k; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [t, x] of rets[i]!) {
        const y = rets[j]!.get(t);
        if (y !== undefined) {
          xs.push(x);
          ys.push(y);
        }
      }
      const r = xs.length >= minN ? pearson(xs, ys) : null;
      rho[i]![j] = rho[j]![i] = r;
      n[i]![j] = n[j]![i] = xs.length;
    }
  }
  return { symbols, rho, n, window };
}

export interface CorrCluster {
  symbols: string[];
  /** mean ρ over the cluster's pairs */
  avg: number;
}

/** Clusters of pairs linked by ρ ≥ `threshold` (positive correlation only: those add up), size ≥ 2, biggest first. */
export function correlationClusters(cm: CorrMatrix, threshold = CORR_CLUSTER): CorrCluster[] {
  const k = cm.symbols.length;
  const parent = Array.from({ length: k }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if ((cm.rho[i]![j] ?? -2) >= threshold) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < k; i++) {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  const out: CorrCluster[] = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    let sum = 0;
    let cnt = 0;
    for (let a = 0; a < idx.length; a++)
      for (let b = a + 1; b < idx.length; b++) {
        const r = cm.rho[idx[a]!]![idx[b]!];
        if (r != null) {
          sum += r;
          cnt++;
        }
      }
    out.push({ symbols: idx.map((i) => cm.symbols[i]!), avg: cnt ? sum / cnt : 0 });
  }
  return out.sort((a, b) => b.symbols.length - a.symbols.length || b.avg - a.avg);
}

export interface ClusterRisk {
  cluster: CorrCluster;
  side: Side;
  /** open positions of the cluster on that side */
  symbols: string[];
  notional: number;
}

/** Open legs on the SAME side inside one cluster (≥ 2 different symbols): effectively one bigger position. */
export function clusterRisks(clusters: readonly CorrCluster[], legs: readonly { symbol: string | null; side: Side; notional: number }[]): ClusterRisk[] {
  const out: ClusterRisk[] = [];
  for (const c of clusters) {
    for (const side of ["long", "short"] as const) {
      const inSide = legs.filter((l) => l.symbol && l.side === side && c.symbols.includes(l.symbol));
      const syms = [...new Set(inSide.map((l) => l.symbol!))];
      if (syms.length >= 2) out.push({ cluster: c, side, symbols: syms, notional: inSide.reduce((s, l) => s + l.notional, 0) });
    }
  }
  return out.sort((a, b) => b.notional - a.notional);
}
