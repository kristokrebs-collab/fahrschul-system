/**
 * Comparison of 2–3 Entscheidungsgrundlagen (P07, pure) with honest uncertainty (P03 statistics): per setup the key
 * numbers with their 80 % intervals – win rate (Wilson), Ø R and Ø P&L (t) –, profit factor, conformity and exit
 * fidelity; pairwise the differences against the leader (`compareSets`: Newcombe / Welch). "Trade the best": the
 * leader is the setup with the highest LOWER bound of Ø R (≥ 5 trades with R) – a lucky small sample does not lead.
 */
import { aggregate } from "../agg";
import { compareSets, type Comparison } from "../analytics/compare";
import { finite, meanCI, wilsonCI, type Interval } from "../analytics/stats";
import type { EnrichedTrade, Settings, Setup } from "../types";
import { strategyConformity } from "./conformity";
import { strategyOf, type SetupX } from "./types";

export const COMPARE_MIN = 5;

export interface StrategyRow {
  id: string;
  name: string;
  color: string;
  n: number;
  winRate: number | null;
  wrCI: Interval | null;
  avgR: number | null;
  rCI: Interval | null;
  rN: number;
  exp: number | null;
  expCI: Interval | null;
  pf: number | null;
  net: number;
  conformity: number | null;
  exitFidelity: number | null;
  /** the leader of the comparison */
  best: boolean;
  /** too few trades for an interval */
  thin: boolean;
}

export interface StrategyComparison {
  rows: StrategyRow[];
  bestId: string | null;
  /** each other setup against the leader (or the first) */
  pairs: Comparison[];
  /** German one-liner */
  verdict: string;
}

export function compareStrategies(setups: readonly Setup[], closed: readonly EnrichedTrade[], settings: Pick<Settings, "capital">): StrategyComparison {
  const xs: SetupX[] = setups.map(strategyOf);
  const lists = xs.map((x) => closed.filter((t) => (t.setups || []).includes(x.id)));
  const rows: StrategyRow[] = xs.map((x, i) => {
    const list = lists[i]!;
    const g = aggregate(list);
    const rs = finite(list.map((t) => t.r));
    const pnl = list.map((t) => t.pnl ?? 0);
    const c = strategyConformity(x, list, settings);
    return {
      id: x.id,
      name: x.name,
      color: x.color,
      n: g.n,
      winRate: g.winRate,
      wrCI: g.n >= COMPARE_MIN ? wilsonCI(g.wins, g.n) : null,
      avgR: g.avgR,
      rCI: rs.length >= COMPARE_MIN ? meanCI(rs) : null,
      rN: rs.length,
      exp: g.exp,
      expCI: g.n >= COMPARE_MIN ? meanCI(pnl) : null,
      pf: g.pf,
      net: g.net,
      conformity: c.score,
      exitFidelity: c.exit.rate,
      best: false,
      thin: g.n < COMPARE_MIN,
    };
  });
  let best: StrategyRow | null = null;
  for (const r of rows) if (r.rCI && (!best || r.rCI.lo > best.rCI!.lo)) best = r;
  if (best) best.best = true;
  const leadIdx = best ? rows.indexOf(best) : 0;
  const pairs: Comparison[] = [];
  rows.forEach((r, i) => {
    if (i === leadIdx) return;
    pairs.push(compareSets(lists[leadIdx]!, lists[i]!, [rows[leadIdx]!.name, r.name]));
  });
  const verdict = !best
    ? rows.some((r) => r.n > 0)
      ? `Noch zu wenig Trades für einen fairen Vergleich (je mindestens ${COMPARE_MIN} mit R).`
      : "Keine abgeschlossenen Trades mit diesen Grundlagen."
    : best.rCI!.lo > 0
      ? `${best.name} führt: Ø R bleibt auch im ungünstigen Fall positiv. Trade the best.`
      : `${best.name} liegt vorn, aber der Vorsprung ist noch nicht sicher.`;
  return { rows, bestId: best?.id ?? null, pairs, verdict };
}
