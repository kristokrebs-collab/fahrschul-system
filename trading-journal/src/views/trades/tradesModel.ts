/**
 * Pure filter/sort model of the Trades page – 1:1 port of the bundle `H$` `useMemo` (Plan 6.2).
 * No React, no store access: `TradesView` feeds it `useEnriched()` + `uiStore.tradeFilter/tradeSort`.
 */
import type { EnrichedTrade, Setup, TradeFilter } from "@/domain/types";
import type { TradeSort } from "@/store/uiStore";
import { tradeTime } from "@/lib/dates";

/** Sentinel of the `Entscheidungsgrundlage` select: trades without any known setup. */
export const NO_SETUP = "__none";

/** First setup (settings order) referenced by the trade, or `"~"` for unassigned trades (bundle `f`; note ICU sorts `~` before letters). */
export function setupNameOf(t: Pick<EnrichedTrade, "setups">, setups: readonly Setup[]): string {
  return setups.find((s) => (t.setups || []).includes(s.id))?.name || "~";
}

/** Bundle filter: account (`missing → scalp`), setup / `__none`, result, side (`short` else `long`), free text over pair/reason/notes/emotion/timeframe. */
export function filterTrades(all: readonly EnrichedTrade[], f: TradeFilter, setups: readonly Setup[]): EnrichedTrade[] {
  const known = new Set(setups.map((s) => s.id));
  const q = f.q.trim().toLowerCase();
  return all.filter((h) => {
    if (f.acc !== "all" && (h.account || "scalp") !== f.acc) return false;
    if (f.setup === NO_SETUP) {
      if ((h.setups || []).some((id) => known.has(id))) return false;
    } else if (f.setup !== "all" && !(h.setups || []).includes(f.setup)) return false;
    if (f.result !== "all" && h.result !== f.result) return false;
    if (f.side !== "all" && (h.side === "short" ? "short" : "long") !== f.side) return false;
    if (q && ![h.pair, h.reason, h.notes, h.emotion, h.timeframe].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

type SortValue = number | string;

function sortValue(t: EnrichedTrade, k: TradeSort["k"], setups: readonly Setup[]): SortValue {
  switch (k) {
    case "date":
      return +tradeTime(t);
    case "pnl":
      return t.pnl ?? -Infinity;
    case "r":
      return t.r ?? -Infinity;
    case "setup":
      return setupNameOf(t, setups);
  }
}

/** Stable sort copy; strings via `localeCompare(…, "de")`, numbers numerically, `dir` flips. */
export function sortTrades(list: readonly EnrichedTrade[], sort: TradeSort, setups: readonly Setup[]): EnrichedTrade[] {
  return [...list].sort((a, b) => {
    const x = sortValue(a, sort.k, setups);
    const y = sortValue(b, sort.k, setups);
    const cmp = typeof x === "string" ? x.localeCompare(String(y), "de") : x - (y as number);
    return cmp * sort.dir;
  });
}

/** `layoutDependency` key of the rows: changes whenever the visible order or set can change. */
export function listKey(f: TradeFilter, sort: TradeSort): string {
  return [f.acc, f.setup, f.result, f.side, f.q.trim().toLowerCase(), sort.k, sort.dir].join("|");
}

/** `{n} Trade(s)` (bundle count pill). */
export function countLabel(n: number): string {
  return `${n} Trade${n === 1 ? "" : "s"}`;
}
