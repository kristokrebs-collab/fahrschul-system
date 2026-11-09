/**
 * "R-Verteilung" (Tradezella Risk report) and "Drawdown" (underwater curve + recovery). Realised R and the
 * drawdown are the numbers of `aggregate()` / `accountView()`; planned R is the editor's `rr` (target ÷ stop
 * distance), so nothing new has to be typed in.
 */
import type { EquityPoint, Drawdown } from "../account";
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { tradeTime } from "@/lib/dates";
import { isFin } from "@/lib/format";
import { mean } from "./shared";

export interface RBin {
  key: string;
  label: string;
  /** inclusive lower bound (−∞ for the first bin) */
  lo: number;
  /** exclusive upper bound (+∞ for the last), except the first bin which includes −2 */
  hi: number;
  n: number;
  net: number;
}

/** (−∞, −2] · (−2, −1] · (−1, 0) · [0, 1) · [1, 2) · [2, 3) · [3, ∞) */
export const R_BIN_DEFS: readonly Omit<RBin, "n" | "net">[] = [
  { key: "lt-2", label: "≤ −2", lo: -Infinity, hi: -2 },
  { key: "-2", label: "−2…−1", lo: -2, hi: -1 },
  { key: "-1", label: "−1…0", lo: -1, hi: 0 },
  { key: "0", label: "0…1", lo: 0, hi: 1 },
  { key: "1", label: "1…2", lo: 1, hi: 2 },
  { key: "2", label: "2…3", lo: 2, hi: 3 },
  { key: "3", label: "≥ 3", lo: 3, hi: Infinity },
];

/** Index of the bin of an R value. */
export function rBinIndex(r: number): number {
  if (r <= -2) return 0;
  if (r <= -1) return 1;
  if (r < 0) return 2;
  if (r < 1) return 3;
  if (r < 2) return 4;
  if (r < 3) return 5;
  return 6;
}

/** A loss beyond this R counts as "größer als 1R" (stop moved or slippage). */
export const BIG_LOSS_R = -1.1;

export interface RDistribution {
  bins: RBin[];
  /** trades with an R value */
  rN: number;
  /** = `aggregate().avgR` */
  avgR: number | null;
  /** Ø planned R (`rr`) of the closed trades that had stop and target */
  planned: number | null;
  plannedN: number;
  /** share of trades with R ≥ 2 among trades with R (`r2 / rN`) */
  share2R: number | null;
  /** trades with R < −1,1 */
  bigLosses: EnrichedTrade[];
  /** winners with planned R: Ø realised R ÷ Ø planned R */
  efficiency: number | null;
  efficiencyN: number;
  g: Agg;
}

export function rDistribution(closed: readonly EnrichedTrade[]): RDistribution {
  const g = aggregate(closed);
  const bins: RBin[] = R_BIN_DEFS.map((d) => ({ ...d, n: 0, net: 0 }));
  for (const t of closed) {
    if (!isFin(t.r)) continue;
    const b = bins[rBinIndex(t.r)]!;
    b.n++;
    b.net += t.pnl || 0;
  }
  const plannedList = closed.filter((t) => isFin(t.rr)).map((t) => t.rr as number);
  const winners = closed.filter((t) => (t.pnl || 0) > 0 && isFin(t.rr) && isFin(t.r));
  const wr = mean(winners.map((t) => t.r as number));
  const wp = mean(winners.map((t) => t.rr as number));
  return {
    bins,
    rN: g.rN,
    avgR: g.avgR,
    planned: mean(plannedList),
    plannedN: plannedList.length,
    share2R: g.rN ? g.r2 / g.rN : null,
    bigLosses: closed.filter((t) => isFin(t.r) && t.r < BIG_LOSS_R),
    efficiency: wr != null && wp != null && wp > 0 ? wr / wp : null,
    efficiencyN: winners.length,
    g,
  };
}

export interface UnderwaterPoint {
  /** equity index (0 = start) */
  i: number;
  /** ≤ 0 fraction below the running peak */
  dd: number;
  t: EnrichedTrade | null;
}

export interface UnderwaterPhase {
  /** equity index of the peak the phase started from */
  from: number;
  /** equity index of the recovery (new peak), `null` while still under water */
  to: number | null;
  trades: number;
  /** calendar days from the peak trade to the recovery trade (or `now`) */
  days: number;
}

export interface DrawdownReport {
  points: UnderwaterPoint[];
  /** = `accountView().maxDD` */
  maxDD: number;
  /** money lost in that drawdown (`dd.peak − dd.trough`) */
  maxDDAbs: number;
  /** date of the trough trade */
  troughAt: Date | null;
  /** = `accountView().curDD` */
  current: number;
  /** mean of the under-water points (dd < 0) */
  avgDD: number | null;
  /** net ÷ max. drawdown in money; `null` without a drawdown */
  recovery: number | null;
  /** gain still needed to get back to the peak: `1 / (1 + curDD) − 1` */
  needed: number;
  longest: UnderwaterPhase | null;
}

export interface DrawdownInput {
  equity: readonly EquityPoint[];
  maxDD: number;
  curDD: number;
  dd: Drawdown;
  net: number;
}

export function drawdownReport({ equity, maxDD, curDD, dd, net }: DrawdownInput, now = Date.now()): DrawdownReport {
  const points: UnderwaterPoint[] = [];
  const under: number[] = [];
  const phases: UnderwaterPhase[] = [];
  // the start point (index 0) has no trade: it is dated with the first trade
  const timeOf = (i: number): number => {
    const t = equity[i]?.t ?? equity[1]?.t;
    return t ? +tradeTime(t) : now;
  };
  let peak = equity[0]?.v ?? 0;
  let peakI = 0;
  let open = false;
  for (const p of equity) {
    if (p.v >= peak) {
      // back at (or above) the peak: an under-water phase ends here
      if (open) phases.push({ from: peakI, to: p.i, trades: p.i - peakI, days: Math.max(0, (timeOf(p.i) - timeOf(peakI)) / 864e5) });
      open = false;
      peak = p.v;
      peakI = p.i;
    }
    const d = peak > 0 ? Math.min(0, (p.v - peak) / peak) : 0;
    if (d < 0) {
      open = true;
      under.push(d);
    }
    points.push({ i: p.i, dd: d, t: p.t });
  }
  const lastI = equity[equity.length - 1]?.i ?? 0;
  if (open) phases.push({ from: peakI, to: null, trades: lastI - peakI, days: Math.max(0, (now - timeOf(peakI)) / 864e5) });
  let longest: UnderwaterPhase | null = null;
  for (const ph of phases) if (!longest || ph.trades > longest.trades || (ph.trades === longest.trades && ph.days > longest.days)) longest = ph;
  const maxDDAbs = Math.abs(dd.peak - dd.trough);
  const troughT = equity[dd.troughI]?.t ?? null;
  return {
    points,
    maxDD,
    maxDDAbs,
    troughAt: maxDD < 0 && troughT ? tradeTime(troughT) : null,
    current: curDD,
    avgDD: mean(under),
    recovery: maxDDAbs > 0 ? net / maxDDAbs : null,
    needed: curDD < 0 && curDD > -1 ? 1 / (1 + curDD) - 1 : 0,
    longest,
  };
}
