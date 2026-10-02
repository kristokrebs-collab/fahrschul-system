/**
 * Enrichment – bundle `Uw` (checklist items) and `FG` (trade + derive + checklist).
 * Derived `pnl`/`r` override whatever was persisted.
 */
import type { ChecklistEntry, EnrichedTrade, Settings, Trade } from "./types";
import { deriveTrade } from "./derive";

/** Bundle `Uw`: rules first (`g:{ruleId}`), then each selected setup's items in settings order (`{setupId}:{itemId}`). */
export function checklistItemsFor(setupIds: readonly string[], s: Pick<Settings, "rules" | "setups">): ChecklistEntry[] {
  const items: ChecklistEntry[] = s.rules.map((r) => ({ id: "g:" + r.id, text: r.text }));
  for (const setup of s.setups) {
    if (!setupIds.includes(setup.id)) continue;
    for (const it of setup.checklist ?? []) items.push({ id: setup.id + ":" + it.id, text: it.text });
  }
  return items;
}

/** Bundle `FG`. */
export function enrichTrade(t: Trade, s: Pick<Settings, "rules" | "setups">): EnrichedTrade {
  const items = checklistItemsFor(t.setups || [], s);
  const checked = items.filter((i) => t.checks?.[i.id]).length;
  return {
    ...t,
    ...deriveTrade(t),
    items,
    checked,
    complete: items.length ? checked === items.length : null,
  };
}

export function enrichTrades(trades: readonly Trade[], s: Pick<Settings, "rules" | "setups">): EnrichedTrade[] {
  return trades.map((t) => enrichTrade(t, s));
}

/** Save-path helper: keep only truthy checks whose id exists in the current item list. */
export function pruneChecks(checks: Record<string, boolean> | undefined, items: readonly ChecklistEntry[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const it of items) if (checks?.[it.id]) out[it.id] = true;
  return out;
}

export const Uw = checklistItemsFor;
export const FG = enrichTrade;
