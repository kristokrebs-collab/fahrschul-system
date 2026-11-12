/**
 * Best-practice examples of a strategy (P07, pure): the trades the trader picked (`examples`, in the picked order,
 * missing ids dropped) and suggestions for more – the strategy's best closed trades by R that also followed the plan
 * (conformity ≥ 80 or unknown) and preferably carry screenshots (P06). "Trade the best": the gallery shows only the
 * strongest.
 */
import type { EnrichedTrade } from "../types";
import type { TradeConformity } from "./conformity";
import { CONFORM_MIN } from "./conformity";
import type { SetupX } from "./types";

export interface ExampleSet {
  picked: EnrichedTrade[];
  suggested: EnrichedTrade[];
}

export const EXAMPLES_MAX = 6;

export function examplesOf(x: Pick<SetupX, "id" | "examples">, trades: readonly EnrichedTrade[], conformity?: readonly TradeConformity[], max = EXAMPLES_MAX): ExampleSet {
  const byId = new Map(trades.map((t) => [t.id, t]));
  const picked = x.examples.map((id) => byId.get(id)).filter((t): t is EnrichedTrade => !!t);
  const score = new Map((conformity ?? []).map((c) => [c.id, c.score]));
  const pickedIds = new Set(picked.map((t) => t.id));
  const suggested = trades
    .filter((t) => (t.setups || []).includes(x.id) && t.status === "closed" && !pickedIds.has(t.id) && (t.pnl ?? 0) > 0)
    .filter((t) => {
      const s = score.get(t.id);
      return s == null || s >= CONFORM_MIN;
    })
    .sort((a, b) => Number((b.screenshots?.length ?? 0) > 0) - Number((a.screenshots?.length ?? 0) > 0) || (b.r ?? -Infinity) - (a.r ?? -Infinity) || (b.pnl ?? 0) - (a.pnl ?? 0))
    .slice(0, Math.max(0, max - picked.length));
  return { picked: picked.slice(0, max), suggested };
}
