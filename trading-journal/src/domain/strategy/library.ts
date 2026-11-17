/**
 * The setup library's filter (P07, pure): free text (name, rules, criteria, tags), tags, market, timeframe and "only
 * with trades". The filter only hides cards – stats, sort and the existing account switch stay as they are.
 */
import type { Setup } from "../types";
import { marketKey, strategyOf, type SetupX } from "./types";

export interface LibraryFilter {
  q: string;
  tags: readonly string[];
  market: string | null;
  tf: string | null;
  withTrades: boolean;
}

export const EMPTY_LIBRARY_FILTER: Readonly<LibraryFilter> = Object.freeze({ q: "", tags: [], market: null, tf: null, withTrades: false });

export const isFilterActive = (f: LibraryFilter): boolean => !!f.q.trim() || f.tags.length > 0 || f.market != null || f.tf != null || f.withTrades;

const norm = (s: string) => s.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Does `setup` pass `f`? `trades` = its trade count (for "only with trades"). */
export function matchesLibrary(setup: Setup | SetupX, f: LibraryFilter, trades = 0): boolean {
  const x = "entryCriteria" in setup ? setup : strategyOf(setup);
  if (f.withTrades && trades <= 0) return false;
  if (f.tags.length && !f.tags.every((t) => x.tags.includes(t))) return false;
  if (f.market && !x.markets.includes(marketKey(f.market))) return false;
  if (f.tf && !x.tf.includes(f.tf)) return false;
  const q = norm(f.q.trim());
  if (q) {
    const hay = norm([x.name, x.desc, ...x.checklist.map((c) => c.text), ...x.entryCriteria.map((c) => c.text), ...x.exitCriteria.map((c) => c.text), ...x.tags, ...x.markets].join(" "));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Tags, markets and timeframes used across the library (for the filter chips), most frequent first. */
export function libraryFacets(setups: readonly Setup[]): { tags: string[]; markets: string[]; tfs: string[] } {
  const count = (vals: string[][]) => {
    const m = new Map<string, number>();
    for (const list of vals) for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  };
  const xs = setups.map(strategyOf);
  return { tags: count(xs.map((x) => x.tags)), markets: count(xs.map((x) => x.markets)), tfs: count(xs.map((x) => x.tf)) };
}
