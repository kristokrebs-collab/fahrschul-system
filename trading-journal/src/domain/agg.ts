/**
 * Aggregate statistics – 1:1 port of bundle `wn` (21280–21349). Callers pass closed trades only.
 */
import type { EnrichedTrade } from "./types";
import { isFin } from "@/lib/format";

export interface Agg {
  n: number;
  wins: number;
  losses: number;
  be: number;
  net: number;
  gw: number;
  /** negative */
  gl: number;
  fees: number;
  winRate: number | null;
  /** may be Infinity (gains, no losses) */
  pf: number | null;
  avgWin: number | null;
  /** negative */
  avgLoss: number | null;
  beWinRate: number | null;
  payoff: number | null;
  avgR: number | null;
  /** trades with an R value ("Trades mit Stop") */
  rN: number;
  /** trades with R ≥ 2 */
  r2: number;
  bestR: number | null;
  worstR: number | null;
  /** net / n */
  exp: number | null;
  best: EnrichedTrade | null;
  worst: EnrichedTrade | null;
  moveWin: number | null;
  moveLoss: number | null;
  moveExp: number | null;
  moveN: number;
}

export type Stats = Agg;

export function aggregate(list: readonly EnrichedTrade[]): Agg {
  const n = list.length;
  let wins = 0,
    losses = 0,
    net = 0,
    gw = 0,
    gl = 0,
    fees = 0;
  let rSum = 0,
    rN = 0,
    r2 = 0;
  let bestR: number | null = null,
    worstR: number | null = null;
  let mvSum = 0,
    mvN = 0,
    mvWinSum = 0,
    mvWinN = 0,
    mvLossSum = 0,
    mvLossN = 0;
  let best: EnrichedTrade | null = null,
    worst: EnrichedTrade | null = null;

  for (const t of list) {
    const p = t.pnl || 0;
    net += p;
    fees += t.fees || 0;
    if (p > 0) {
      wins++;
      gw += p;
    } else if (p < 0) {
      losses++;
      gl += p;
    }
    if (!best || p > (best.pnl || 0)) best = t;
    if (!worst || p < (worst.pnl || 0)) worst = t;
    if (isFin(t.r)) {
      rSum += t.r;
      rN++;
      if (t.r >= 2) r2++;
      bestR = bestR == null ? t.r : Math.max(bestR, t.r);
      worstR = worstR == null ? t.r : Math.min(worstR, t.r);
    }
    if (isFin(t.move)) {
      mvSum += t.move;
      mvN++;
      if (p > 0) {
        mvWinSum += t.move;
        mvWinN++;
      } else if (p < 0) {
        mvLossSum += t.move;
        mvLossN++;
      }
    }
  }
  const avgWin = wins ? gw / wins : null;
  const avgLoss = losses ? gl / losses : null;
  return {
    n,
    wins,
    losses,
    be: n - wins - losses,
    net,
    gw,
    gl,
    fees,
    winRate: n ? wins / n : null,
    pf: gl < 0 ? gw / -gl : gw > 0 ? Infinity : null,
    avgWin,
    avgLoss,
    beWinRate: avgWin != null && avgLoss != null ? -avgLoss / (avgWin - avgLoss) : null,
    payoff: avgWin != null && avgLoss != null ? avgWin / -avgLoss : null,
    avgR: rN ? rSum / rN : null,
    rN,
    r2,
    bestR,
    worstR,
    exp: n ? net / n : null,
    best: n ? best : null,
    worst: n ? worst : null,
    moveWin: mvWinN ? mvWinSum / mvWinN : null,
    moveLoss: mvLossN ? mvLossSum / mvLossN : null,
    moveExp: mvN ? mvSum / mvN : null,
    moveN: mvN,
  };
}

export const EMPTY_AGG: Readonly<Agg> = Object.freeze(aggregate([]));
export const wn = aggregate;
