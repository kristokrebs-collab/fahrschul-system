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

/**
 * `layoutDependency` of the rendered rows: `listKey` plus the count and an FNV-1a hash of the visible ids in order,
 * so a set or order change that keeps filter and sort (a trade deleted from the detail, added from the FAB, or
 * re-sorted by an edit) still lets the remaining rows glide instead of snapping. Short on purpose: every row
 * compares it on every table render.
 */
export function rowsKey(key: string, rows: readonly Pick<EnrichedTrade, "id">[]): string {
  let h = 0x811c9dc5;
  for (const t of rows) {
    for (let i = 0; i < t.id.length; i++) h = Math.imul(h ^ t.id.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x2c, 0x01000193); // id separator, so ["ab","c"] ≠ ["a","bc"]
  }
  return `${key}#${rows.length}:${(h >>> 0).toString(36)}`;
}

/** Sort direction as text (kept in the header for screen readers and the `Datum ↓` / `P&L ↑` selectors). */
export function sortArrow(dir: TradeSort["dir"]): " ↑" | " ↓" {
  return dir === 1 ? " ↑" : " ↓";
}

/** `{n} Trade(s)` (bundle count pill). */
export function countLabel(n: number): string {
  return `${n} Trade${n === 1 ? "" : "s"}`;
}

/* ----------------------------------------------------------- search suggestions */

/** One trades-search suggestion; `kind` decides what choosing it does (filter shortcut or search text). */
export interface SearchSuggestion {
  value: string;
  label: string;
  group: string;
  kind: "setup" | "side" | "emotion" | "word";
  /** Setup id / side for the filter shortcuts. */
  target?: string;
}

export const SUGGESTION_GROUPS = { setup: "Grundlagen", side: "Richtung", emotion: "Gefühl", word: "Begriffe" } as const;

/** Function words that never make a useful search term (German + the odd English one in notes). */
const STOPWORDS = new Set(
  "aber alle allem allen aller alles also auch auf aus bei beim bin bis bist dann darum dass dein deine dem den denn der des die dies diese diesem diesen dieser doch dort durch eine einem einen einer eines etwas euch für gegen hab habe haben hatte hier hinter ich ihr ihre immer jetzt kann kein keine man mehr mein meine mich mit muss nach nicht noch nur oder ohne schon sehr sein seine sich sind soll über unter vom von vor war waren warum was weil wenn wer wie wieder wir wird zum zur zwischen with that this from have the and"
    .split(" "),
);

/**
 * Frequent words of the trades' `reason` + `notes` (≥ 4 letters, no stop words, seen in ≥ 2 trades – or the top
 * ones when the journal is small), most frequent first; the most common spelling of each word is kept.
 */
export function frequentWords(trades: readonly Pick<EnrichedTrade, "reason" | "notes">[], max = 12): string[] {
  const count = new Map<string, { n: number; forms: Map<string, number> }>();
  for (const t of trades) {
    const seen = new Set<string>();
    for (const raw of `${t.reason ?? ""} ${t.notes ?? ""}`.match(/[\p{L}][\p{L}\p{N}-]*[\p{L}\p{N}]/gu) ?? []) {
      const key = raw.toLowerCase();
      if (key.length < 4 || STOPWORDS.has(key) || seen.has(key)) continue;
      seen.add(key);
      const e = count.get(key) ?? { n: 0, forms: new Map<string, number>() };
      e.n += 1;
      e.forms.set(raw, (e.forms.get(raw) ?? 0) + 1);
      count.set(key, e);
    }
  }
  const ranked = [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], "de"));
  const frequent = ranked.filter(([, e]) => e.n >= 2);
  return (frequent.length >= 3 ? frequent : ranked)
    .slice(0, max)
    .map(([, e]) => [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
}

/**
 * Grouped suggestions of the trades search: setups and sides are filter shortcuts (the search field cannot match
 * them – it searches pair / reason / notes / emotion / timeframe), emotions and frequent note words become the text.
 */
export function searchSuggestions(trades: readonly EnrichedTrade[], setups: readonly Pick<Setup, "id" | "name">[], emotions: readonly string[]): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  for (const s of setups) out.push({ value: `setup:${s.id}`, label: s.name, group: SUGGESTION_GROUPS.setup, kind: "setup", target: s.id });
  out.push({ value: "side:long", label: "Long", group: SUGGESTION_GROUPS.side, kind: "side", target: "long" });
  out.push({ value: "side:short", label: "Short", group: SUGGESTION_GROUPS.side, kind: "side", target: "short" });
  for (const e of emotions) out.push({ value: `emotion:${e}`, label: e, group: SUGGESTION_GROUPS.emotion, kind: "emotion" });
  const taken = new Set(out.map((o) => o.label.toLowerCase()));
  for (const w of frequentWords(trades)) if (!taken.has(w.toLowerCase())) out.push({ value: `word:${w.toLowerCase()}`, label: w, group: SUGGESTION_GROUPS.word, kind: "word" });
  return out;
}
