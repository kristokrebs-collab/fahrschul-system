/**
 * Questions to the function register (pure): search, group, "Für dich", "Zuletzt benutzt" and "Empfohlen / Neu". Shared by the
 * page `Funktionen`, the global search, the command navigation and the assistant's "Wo finde ich …?" – one scorer, one order.
 *
 * The scorer is built for people who say what they want to DO, not what a function is called: a query is cut into words,
 * filler words ("ich", "wie", "mein") are dropped, and every remaining word is looked up in the function's name, its
 * `intents` (synonyms and whole phrases), its keywords, its one-sentence task, its group / page and its benefit – with a
 * weight per field and tolerance for typos, umlauts written as "ae", plural / compound endings ("Wochenbericht" finds
 * "Wochen- & Monatsberichte"). Every word that matches counts; a query that matches only half of its words ranks below one
 * that matches all of them, and a phrase that stands in an intent word for word gets a bonus.
 *
 * Nothing here learns or stores anything: "Für dich" reads the counters the assistant already keeps in
 * `settings.assistant.interests` (`memory.ts`), "Zuletzt benutzt" reads the ids the search already remembers
 * (`searchStore.recent`, `feature:<id>`). Both are given in; without data the answer is empty, never a guess.
 */
import { editDistance } from "@/assistant/fuzzy";
import { PAGE_LABELS } from "@/app/Dock";
import { fold, matchFolded, mergeRanges, normalize, type FieldMatch, type Folded, type MatchRange } from "@/search/fuzzy";
import { FEATURE_GROUPS, FEATURE_REGISTRY, featureById, type FeatureEntry, type FeatureGroup } from "./features";

/** The search id of a register entry (`searchStore.recent`, search index) – the prefix is what "Zuletzt benutzt" reads. */
export const FEATURE_ID_PREFIX = "feature:";
export const featureSearchId = (id: string): string => `${FEATURE_ID_PREFIX}${id}`;

/** The group an entry belongs to. */
export const groupOf = (f: FeatureEntry): FeatureGroup => FEATURE_GROUPS.find((g) => g.id === f.group) ?? FEATURE_GROUPS[0]!;

/** "Markt › Tagesplan": the page and – when the entry says it – the section on the page; an action without a page of its own says "Überall". */
export function placeText(f: FeatureEntry): string {
  const page = PAGE_LABELS[f.page] ?? f.page;
  return f.place ? `${page} › ${f.place}` : page;
}

/* ------------------------------------------------------------------------------------------------ words + scoring */

/** Words that make a question a question, not a name ("Wo finde ich den Belastungstest?" → "belastungstest"). */
const FILLER = new Set(
  ("wo wie wann was welche welcher welches finde finden find findet ich du mir mich wir man kann kannst koennte könnte muss soll sehe sehen seh steht stehen ist sind gibt gibts es gibt da dort hier " +
    "der die das den dem des ein eine einen einem einer eines zu zum zur im in am an auf von mit fuer für bei oeffne öffne zeig zeige zeigt mal bitte noch eigentlich genau " +
    "komme komm komme gehe geh gehen suche suchen suche funktion funktionen seite stelle bereich app")
    .split(" ")
    .map(normalize),
);

/** Filler of a spoken request that carries no meaning for the lookup ("ich will meine Strategie testen"). */
const STOP = new Set([
  ...FILLER,
  ...("will möchte moechte mein meine meinen meinem meiner meines dein deine und oder aber auch nur noch nicht kein keine keinen als ob dass wieso weshalb wer wem wen dich sich uns aus nach vor ueber über unter durch dann denn doch schon sehr mehr kurz einfach bin bist war wird werden habe hab hast hat haben gerade gleich")
    .split(" ")
    .map(normalize),
]);

/** The words of a folded text (punctuation separates, one letter is no word). */
const words =(folded: string): string[] => folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/** Field weights: how much a hit in this field says about what the person wants. */
const W = { name: 1, intents: 0.95, keywords: 0.85, task: 0.7, where: 0.5, benefit: 0.4, misc: 0.3 } as const;
/** A word counts as found from this weighted score on. */
const FOUND = 0.3;

type PhraseKind = "name" | "intent" | "task" | "keyword";

interface Prepared {
  /** every word of the entry's text → its best field weight */
  words: Map<string, number>;
  name: Folded;
  /** the entry's names, intents, task and keywords as folded words without filler – a whole query can equal or stand in them */
  phrases: { key: string; kind: PhraseKind }[];
}

const PREPARED = new WeakMap<FeatureEntry, Prepared>();

/** The meaningful words of a text, joined ("warum verliere ich" → "warum verliere"). */
const keyOf = (text: string): string => words(normalize(text)).filter((w) => !STOP.has(w)).join(" ");

function prepare(f: FeatureEntry): Prepared {
  const cached = PREPARED.get(f);
  if (cached) return cached;
  const map = new Map<string, number>();
  const add = (text: string | undefined, w: number): void => {
    if (!text) return;
    for (const word of words(normalize(text))) if ((map.get(word) ?? 0) < w) map.set(word, w);
  };
  add(f.name, W.name);
  for (const t of f.intents ?? []) add(t, W.intents);
  for (const t of f.keywords) add(t, W.keywords);
  add(f.task, W.task);
  add(groupOf(f).name, W.where);
  add(f.sub, W.where);
  add(f.place, W.where);
  add(PAGE_LABELS[f.page] ?? f.page, W.where);
  add(f.benefit, W.benefit);
  for (const id of f.fids) add(id, W.misc);
  const phrases: Prepared["phrases"] = [
    { key: keyOf(f.name), kind: "name" as PhraseKind },
    ...(f.intents ?? []).map((t) => ({ key: keyOf(t), kind: "intent" as PhraseKind })),
    ...(f.task ? [{ key: keyOf(f.task), kind: "task" as PhraseKind }] : []),
    ...f.keywords.map((t) => ({ key: keyOf(t), kind: "keyword" as PhraseKind })),
  ].filter((x) => x.key);
  const p: Prepared = { words: map, name: fold(f.name), phrases };
  PREPARED.set(f, p);
  return p;
}

const commonPrefix = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** How well the typed word `t` reads as the text word `w` (0 … 1). */
function wordScore(t: string, w: string): number {
  if (t === w) return 1;
  if (t.length >= 2 && w.startsWith(t)) return 0.88 + 0.07 * (t.length / w.length);
  // the typed word continues the text word ("Positionsrechner" → "Position", "Verlusten" → "Verlust"): a short ending or a long stem – not "bestellen" → "beste"
  if (w.length >= 4 && t.startsWith(w) && (t.length - w.length <= 3 || w.length >= 6)) return 0.8;
  if (t.length >= 4 && w.includes(t)) return 0.62;
  const n = Math.min(t.length, w.length);
  const cp = commonPrefix(t, w);
  // a shared stem with different endings ("Verlustserie" ~ "Verlustserien"); a whole shorter word at the start is the prefix rule above
  if (n >= 5 && cp < n && cp >= Math.max(5, Math.ceil(0.75 * Math.max(t.length, w.length)))) return 0.72;
  // a slip inside the word, not in its first letter ("Positonsrechner"; "bestellen" is not "einstellen")
  if (t.length >= 5 && t[0] === w[0] && Math.abs(t.length - w.length) <= 2) {
    const tol = t.length >= 9 ? 2 : 1;
    if (editDistance(t, w, tol) <= tol) return 0.66;
    // a typed beginning with one slip ("Wochenbrich" → "Wochenbericht"); from six letters on, so "danke" is not "dunkel"
    if (t.length >= 6 && w.length > t.length && editDistance(t, w.slice(0, t.length), 1) <= 1) return 0.58;
  }
  return 0;
}

/** The umlaut typed as a digraph ("waere" → "ware", "ueben" → "uben"), like the search folds it. */
const digraph = (t: string): string | null => {
  const alt = t.replace(/([aou])e/g, "$1");
  return alt !== t && alt.length >= 2 ? alt : null;
};

function tokenScore(t: string, p: Prepared): number {
  let best = 0;
  const alt = digraph(t);
  for (const [w, weight] of p.words) {
    // a word can only reach `weight`: skip what cannot beat the best so far
    if (weight <= best) continue;
    let s = wordScore(t, w);
    if (alt && s < 1) s = Math.max(s, wordScore(alt, w) * 0.98);
    if (s * weight > best) best = s * weight;
  }
  return best;
}

/** A query ready to be scored against many entries (parsed once). */
export interface FeatureQuery {
  raw: string;
  /** the words that carry the question: no filler, and each is found somewhere in the register (a word that appears nowhere – "wissen" in "ich will wissen, ob …" – does not count against an entry) */
  tokens: string[];
  /** the tokens joined, for the whole-phrase bonus */
  phrase: string;
}

let lastQuery: { raw: string; list: readonly FeatureEntry[]; q: FeatureQuery | null } | null = null;

/** Cuts a query into its meaningful words (`null` when nothing in it is found in the register at all). */
export function parseFeatureQuery(raw: string, list: readonly FeatureEntry[] = FEATURE_REGISTRY): FeatureQuery | null {
  if (lastQuery && lastQuery.raw === raw && lastQuery.list === list) return lastQuery.q;
  const all = normalize(raw)
    .split(/[\s,;:/|·?!.()„“"”'’+&–—-]+/)
    .filter((t) => t.length >= 2);
  const kept = all.filter((t) => !STOP.has(t));
  const candidates = (kept.length ? kept : all).slice(0, 8);
  // a word that no function says anything about is no reason to rank a function down
  const tokens = candidates.filter((t) => list.some((f) => tokenScore(t, prepare(f)) >= FOUND));
  const q: FeatureQuery | null = tokens.length ? { raw, tokens, phrase: tokens.join(" ") } : null;
  lastQuery = { raw, list, q };
  return q;
}

/** Raw score (1 = every word found exactly in the name) → the search's scale (an exact name hit ≈ 166 with the bonus for a name that holds the word, 200 when the whole query is an intent as well). */
const SCALE = 200 / 1.5;
/** From this score on a hit is a real answer; below it the hit is a guess ("Vielleicht …"). */
export const STRONG_HIT = 60;

/**
 * Score 0 … 200 of `f` for the query, with highlight ranges in the name; `null` when the query does not fit. The score is
 * the mean of what each word reaches (a missing word counts 0), lowered when words are missing, plus a bonus when the whole
 * query equals or stands in a name / intent ("strategie testen").
 */
export function scoreFeature(f: FeatureEntry, q: FeatureQuery | null): FieldMatch | null {
  if (!q) return null;
  const p = prepare(f);
  let sum = 0;
  let found = 0;
  for (const t of q.tokens) {
    const s = tokenScore(t, p);
    if (s >= FOUND) {
      sum += s;
      found++;
    }
  }
  if (!found) return null;
  const total = q.tokens.length;
  const coverage = found / total;
  if (total >= 2 && coverage < 0.5) return null;
  let raw = (sum / total) * (0.55 + 0.45 * coverage);
  let bonus = 0;
  const padded = ` ${q.phrase} `;
  for (const ph of p.phrases) {
    const strong = ph.kind === "name" || ph.kind === "intent";
    if (ph.key === q.phrase) bonus = Math.max(bonus, strong ? 0.5 : 0.2);
    // the whole query stands in the phrase as whole words ("box" in "box chart", "strategie testen" in "strategie testen")
    else if (` ${ph.key} `.includes(padded)) bonus = Math.max(bonus, strong ? 0.25 : total >= 2 ? 0.08 : 0);
  }
  raw += bonus;
  const ranges: MatchRange[] = [];
  for (const t of q.tokens) {
    const m = matchFolded(t, p.name);
    if (m && m.score >= 55) ranges.push(...m.ranges);
  }
  return { score: Math.min(200, raw * SCALE), title: mergeRanges(ranges) };
}

export interface FeatureHit {
  entry: FeatureEntry;
  score: number;
  /** highlight ranges inside the name */
  ranges: MatchRange[];
}

/** Scored entries for `query` (best first; ties keep the register order). Empty query → `[]`. */
export function searchFeatures(query: string, list: readonly FeatureEntry[] = FEATURE_REGISTRY): FeatureHit[] {
  const q = parseFeatureQuery(query, list);
  if (!q) return [];
  const hits: (FeatureHit & { i: number })[] = [];
  list.forEach((entry, i) => {
    const m = scoreFeature(entry, q);
    if (m) hits.push({ entry, score: m.score, ranges: m.title, i });
  });
  return hits.sort((a, b) => b.score - a.score || a.i - b.i).map(({ i: _i, ...h }) => h);
}

/* ------------------------------------------------------------------------------------------------------- group */

export interface SubGroup {
  /** heading inside the group (absent: entries without one) */
  sub?: string;
  items: FeatureEntry[];
}

export interface GroupedFeatures {
  group: FeatureGroup;
  items: FeatureEntry[];
}

/** `entries` split into the groups, in group order; a group without entries is left out. The entries keep their order. */
export function groupFeatures(entries: readonly FeatureEntry[]): GroupedFeatures[] {
  return FEATURE_GROUPS.map((group) => ({ group, items: entries.filter((e) => e.group === group.id) })).filter((g) => g.items.length > 0);
}

/** The entries of one group under their sub headings, in the order the headings first appear. */
export function subGroups(entries: readonly FeatureEntry[]): SubGroup[] {
  const out: SubGroup[] = [];
  for (const e of entries) {
    let g = out.find((x) => x.sub === e.sub);
    if (!g) {
      g = { sub: e.sub, items: [] };
      out.push(g);
    }
    g.items.push(e);
  }
  return out;
}

/** What a group tile says: how many functions, how many are not complete yet. */
export function groupStats(entries: readonly FeatureEntry[]): { total: number; partial: number } {
  return { total: entries.length, partial: entries.filter((e) => e.status === "teilweise").length };
}

/** The "Siehe auch" entries of `f` (known ids only, never itself). */
export function seeAlso(f: FeatureEntry): FeatureEntry[] {
  return (f.see ?? []).map((id) => featureById(id)).filter((e): e is FeatureEntry => !!e && e.id !== f.id);
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

/** "Neu" is shown this long after the first day of the month a function came with (ms). */
export const NEW_WINDOW_MS = 62 * 86_400_000;

/** Did the function come with a release of the last two months? Pure: `now` is given. */
export function isNewFeature(f: FeatureEntry, now: number): boolean {
  if (!f.since) return false;
  const start = Date.parse(`${f.since}-01T00:00:00Z`);
  return Number.isFinite(start) && now >= start && now - start <= NEW_WINDOW_MS;
}

export type PickReason = "fuer-dich" | "neu" | "tipp";

export interface Pick {
  entry: FeatureEntry;
  reason: PickReason;
}

/**
 * "Empfohlen / Neu": what the assistant's counters point at first, then the functions of the last release, then the few
 * starting points – each at most once, none that is among `skip` (the recent list shows those), at most `k`. Without any
 * counter or release the starting points still stand there, so the block is never empty.
 */
export function suggestFeatures(opts: { interests: Readonly<Record<string, number>>; now: number; skip?: readonly string[]; k?: number }, list: readonly FeatureEntry[] = FEATURE_REGISTRY): Pick[] {
  const { interests, now, skip = [], k = 4 } = opts;
  const out: Pick[] = [];
  const take = (entry: FeatureEntry, reason: PickReason): void => {
    if (out.length >= k || skip.includes(entry.id) || out.some((p) => p.entry.id === entry.id)) return;
    out.push({ entry, reason });
  };
  for (const m of forYou(interests, k, list)) take(m.entry, "fuer-dich");
  // the newest release first: a function with several lines in the register is one pick
  for (const f of list) if (f.star !== true && isNewFeature(f, now)) take(f, "neu");
  for (const f of list) if (f.star) take(f, "tipp");
  return out;
}

/* ------------------------------------------------------------------------------------------------ "Wo finde ich …?" */

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
  // clear: the first hit leads by a real margin (a fifth of its score … or alone)
  return { hits, clear: !!first && (!second || first.score >= second.score * 1.12 + 6) };
}
