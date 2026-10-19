/**
 * Ranking of the global search (P13): scored hits grouped by kind, groups ordered by their best hit, a few hits per
 * group (trades get more room). An empty query shows suggestions instead – "Trade the best": the strongest setup and
 * the best trades lead, then what was opened recently, the pages and the core commands.
 */
import { scoreFields, tokenize, type MatchRange } from "./fuzzy";
import { setupStats, type SearchItem, type SearchKind } from "./sources";
import type { EnrichedTrade, Settings } from "@/domain/types";

export interface SearchHit {
  item: SearchItem;
  score: number;
  /** highlight ranges in `item.title` */
  ranges: MatchRange[];
}

export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
}

const PER_GROUP: Partial<Record<SearchKind, number>> = { trade: 7, command: 5, page: 6, feature: 6, setup: 5, day: 4, setting: 5, report: 4 };
/** small kind bias for ties: navigation targets before records */
const KIND_BIAS: Partial<Record<SearchKind, number>> = { page: 6, feature: 5, command: 4, setting: 2, setup: 3, trade: 0, day: 0, report: 1 };

export function searchIndex(items: readonly SearchItem[], query: string): SearchGroup[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const byKind = new Map<SearchKind, SearchHit[]>();
  for (const item of items) {
    const m = scoreFields(tokens, item.hay);
    if (!m) continue;
    const score = m.score + item.boost + (KIND_BIAS[item.kind] ?? 0);
    const list = byKind.get(item.kind) ?? [];
    list.push({ item, score, ranges: m.title });
    byKind.set(item.kind, list);
  }
  const groups: SearchGroup[] = [];
  for (const [kind, hits] of byKind) {
    hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "de"));
    groups.push({ kind, hits: hits.slice(0, PER_GROUP[kind] ?? 5) });
  }
  return groups.sort((a, b) => b.hits[0]!.score - a.hits[0]!.score);
}

/** Flat keyboard order of the groups. */
export const flatHits = (groups: readonly SearchGroup[]): SearchHit[] => groups.flatMap((g) => g.hits);

export interface SuggestionInput {
  items: readonly SearchItem[];
  trades: readonly EnrichedTrade[];
  settings: Settings;
  /** recently opened item ids, newest first */
  recent: readonly string[];
}

const SUGGESTED_COMMANDS = ["command:new-trade", "command:filter-top", "command:theme-toggle", "command:shortcuts"];

/**
 * Empty query: "Stärkste zuerst" (the setup with the best expectancy over ≥ 3 closed trades, if it earns money, and
 * the two best closed trades by R), then recent items, pages, core commands. Nothing weak is promoted: no losing
 * setup or trade ever lands in the first group.
 */
export function suggestions({ items, trades, settings, recent }: SuggestionInput): SearchGroup[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const hit = (item: SearchItem | undefined): SearchHit[] => (item ? [{ item, score: 0, ranges: [] }] : []);
  const best: SearchHit[] = [];
  const top = setupStats(trades, settings).find((s) => s.n >= 3 && s.exp > 0 && s.net > 0);
  if (top) best.push(...hit(byId.get(`setup:${top.id}`)));
  const topTrades = trades
    .filter((t) => t.result === "win" && typeof t.r === "number" && t.r > 0)
    .sort((a, b) => (b.r ?? 0) - (a.r ?? 0))
    .slice(0, 2);
  for (const t of topTrades) best.push(...hit(byId.get(`trade:${t.id}`)));

  const used = new Set(best.map((h) => h.item.id));
  const recentHits = recent
    .map((id) => byId.get(id))
    .filter((i): i is SearchItem => !!i && !used.has(i.id))
    .slice(0, 4)
    .map((item) => ({ item, score: 0, ranges: [] }));
  for (const h of recentHits) used.add(h.item.id);

  const pages = items.filter((i) => i.kind === "page" && !used.has(i.id)).slice(0, 6).map((item) => ({ item, score: 0, ranges: [] }));
  const commands = SUGGESTED_COMMANDS.flatMap((id) => (used.has(id) ? [] : hit(byId.get(id))));

  const groups: SearchGroup[] = [];
  if (best.length) groups.push({ kind: "best", hits: best });
  if (recentHits.length) groups.push({ kind: "recent", hits: recentHits });
  if (pages.length) groups.push({ kind: "page", hits: pages });
  if (commands.length) groups.push({ kind: "command", hits: commands });
  return groups;
}
