/**
 * Questions to the function register (pure): search, filter, group, "Für dich" and "Zuletzt benutzt". Shared by the page
 * `Funktionen`, the global search and the assistant's "Wo finde ich …?" – one scorer (`src/search/fuzzy.ts`, tolerant to
 * typos and umlauts), one order.
 *
 * Nothing here learns or stores anything: "Für dich" reads the counters the assistant already keeps in
 * `settings.assistant.interests` (`memory.ts`), "Zuletzt benutzt" reads the ids the search already remembers
 * (`searchStore.recent`, `feature:<id>`). Both are given in; without data the answer is empty, never a guess.
 */
import { haystack, normalize, scoreFields, tokenize, type Haystack, type MatchRange } from "@/search/fuzzy";
import {
  FEATURE_GROUPS,
  FEATURE_REGISTRY,
  PLAN_TIER_LABEL,
  tierOf,
  type FeatureEntry,
  type FeatureGroup,
  type FeatureStatus,
  type PlanTier,
} from "./features";

/** The search id of a register entry (`searchStore.recent`, search index) – the prefix is what "Zuletzt benutzt" reads. */
export const FEATURE_ID_PREFIX = "feature:";
export const featureSearchId = (id: string): string => `${FEATURE_ID_PREFIX}${id}`;

const HAY = new WeakMap<FeatureEntry, Haystack>();

/** Everything a person might type for an entry: its name, keywords, benefit, group, page, F-IDs and plan. */
export function featureHaystack(f: FeatureEntry, pageLabel?: string): Haystack {
  const cached = HAY.get(f);
  if (cached && !pageLabel) return cached;
  const group = FEATURE_GROUPS.find((g) => g.id === f.group)?.name ?? "";
  const h = haystack(f.name, [...f.keywords, f.benefit, group, pageLabel ?? f.page, ...f.fids, PLAN_TIER_LABEL[tierOf(f.gate)], f.path ?? ""]);
  if (!pageLabel) HAY.set(f, h);
  return h;
}

export interface FeatureHit {
  entry: FeatureEntry;
  score: number;
  /** highlight ranges inside the name */
  ranges: MatchRange[];
}

/** Scored entries for `query` (best first; ties keep the register order). Empty query → `[]`. */
export function searchFeatures(query: string, list: readonly FeatureEntry[] = FEATURE_REGISTRY): FeatureHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const hits: (FeatureHit & { i: number })[] = [];
  list.forEach((entry, i) => {
    const m = scoreFields(tokens, featureHaystack(entry));
    if (m) hits.push({ entry, score: m.score, ranges: m.title, i });
  });
  return hits.sort((a, b) => b.score - a.score || a.i - b.i).map(({ i: _i, ...h }) => h);
}

/* ------------------------------------------------------------------------------------------------- filter + group */

export type StatusFilter = "alle" | FeatureStatus;
export type TierFilter = "alle" | PlanTier;

export interface FeatureFilter {
  q: string;
  status: StatusFilter;
  tier: TierFilter;
}

export const NO_FILTER: FeatureFilter = { q: "", status: "alle", tier: "alle" };
export const isFiltered = (f: FeatureFilter): boolean => f.q.trim() !== "" || f.status !== "alle" || f.tier !== "alle";

/** The entries that pass `f`: with a query in score order, else in register order. */
export function filterFeatures(f: FeatureFilter, list: readonly FeatureEntry[] = FEATURE_REGISTRY): FeatureEntry[] {
  const pass = (e: FeatureEntry): boolean => (f.status === "alle" || e.status === f.status) && (f.tier === "alle" || tierOf(e.gate) === f.tier);
  const scoped = list.filter(pass);
  return f.q.trim() ? searchFeatures(f.q, scoped).map((h) => h.entry) : [...scoped];
}

export interface GroupedFeatures {
  group: FeatureGroup;
  items: FeatureEntry[];
}

/** `entries` split into the groups, in group order; a group without entries is left out. The entries keep their order. */
export function groupFeatures(entries: readonly FeatureEntry[]): GroupedFeatures[] {
  return FEATURE_GROUPS.map((group) => ({ group, items: entries.filter((e) => e.group === group.id) })).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------------------------------------ für dich / recent */

/** How strongly the assistant's interest counters point at `f` (0 = not at all). `topics` entries ending in `*` are prefixes. */
export function interestScore(f: FeatureEntry, interests: Readonly<Record<string, number>>): number {
  let sum = 0;
  for (const t of f.topics ?? []) {
    if (t.endsWith("*")) {
      const prefix = t.slice(0, -1);
      for (const [k, n] of Object.entries(interests)) if (k.startsWith(prefix)) sum += n;
    } else sum += interests[t] ?? 0;
  }
  return sum;
}

export interface ForYou {
  entry: FeatureEntry;
  score: number;
}

/** The features the assistant's counters point at, strongest first (at most `k`); nothing asked yet → `[]`. */
export function forYou(interests: Readonly<Record<string, number>>, k = 4, list: readonly FeatureEntry[] = FEATURE_REGISTRY): ForYou[] {
  return list
    .map((entry, i) => ({ entry, score: interestScore(entry, interests), i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map(({ entry, score }) => ({ entry, score }));
}

/** The register entries among the search's recently opened ids (newest first, at most `k`). */
export function recentFeatures(recentIds: readonly string[], k = 4, list: readonly FeatureEntry[] = FEATURE_REGISTRY): FeatureEntry[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  const out: FeatureEntry[] = [];
  for (const id of recentIds) {
    if (!id.startsWith(FEATURE_ID_PREFIX)) continue;
    const e = byId.get(id.slice(FEATURE_ID_PREFIX.length));
    if (e && !out.includes(e)) out.push(e);
    if (out.length >= k) break;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ "Wo finde ich …?" */

/** Words that make a question a question, not a name ("Wo finde ich den Belastungstest?" → "belastungstest"). */
const FILLER = new Set(
  ("wo wie wann was welche welcher welches finde finden find findet ich du mir mich wir man kann kannst koennte könnte muss soll sehe sehen seh steht stehen ist sind gibt gibts es gibt da dort hier " +
    "der die das den dem des ein eine einen einem einer eines zu zum zur im in am an auf von mit fuer für bei oeffne öffne zeig zeige zeigt mal bitte noch eigentlich genau " +
    "komme komm komme gehe geh gehen suche suchen suche funktion funktionen seite stelle bereich")
    .split(" ")
    .map(normalize),
);

/** What is left of a "Wo finde ich …?" question once the question words are gone (may be empty). */
export function featureQueryOf(question: string): string {
  return normalize(question)
    .split(/[\s,;:/|·?!.]+/)
    .filter((t) => t && !FILLER.has(t))
    .slice(0, 6)
    .join(" ");
}

/** The best entries for a question, with the verdict whether the first one is clear enough to open without asking. */
export interface WhereAnswer {
  hits: FeatureHit[];
  /** `hits[0]` beats the rest clearly (or is alone) */
  clear: boolean;
}

export function whereIs(question: string, k = 3, list: readonly FeatureEntry[] = FEATURE_REGISTRY): WhereAnswer {
  const q = featureQueryOf(question);
  const hits = q ? searchFeatures(q, list).slice(0, k) : [];
  const first = hits[0];
  const second = hits[1];
  return { hits, clear: !!first && (!second || first.score >= second.score * 1.25) };
}
