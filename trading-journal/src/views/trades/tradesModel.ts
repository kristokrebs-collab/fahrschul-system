/**
 * Pure filter/sort model of the Trades page – 1:1 port of the bundle `H$` `useMemo` (Plan 6.2).
 * No React, no store access: `TradesView` feeds it `useEnriched()` + `uiStore.tradeFilter/tradeSort`.
 */
import type { EnrichedTrade, Setup, TradeFilter } from "@/domain/types";
import { parseSignalSnapshot, STRENGTH_LABEL, type SignalSnapshot } from "@/domain/signals";
import type { TradeExtraFilter, TradeSort } from "@/store/uiStore";
import { localDateKey, tradeTime } from "@/lib/dates";
import { holdMs } from "@/domain/excursion";
import { pairKey } from "@/domain/grouping";

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
export function listKey(f: TradeFilter, sort: TradeSort, extra?: TradeExtraFilter): string {
  const base = [f.acc, f.setup, f.result, f.side, f.q.trim().toLowerCase(), sort.k, sort.dir];
  if (extra && (extra.mistake !== "all" || extra.strength !== "all")) base.push(`m:${extra.mistake}`, `s:${extra.strength}`);
  // Journal v3: only active keys join the key (the bundle key is unchanged without them)
  if (extra && journalFilterCount(extra) > 0) base.push(`j:${journalFilterKey(extra)}`);
  if (extra?.group) base.push("g");
  return base.join("|");
}

/* ------------------------------------------------- mistakes / signal strength (additive filters) */

/** Sentinels of the `Fehler` filter: trades without any tag / with at least one. */
export const NO_MISTAKE = "__none";
export const ANY_MISTAKE = "__any";

const signalCache = new WeakMap<object, SignalSnapshot | null>();
/** The stored `trade.signal` (either app's format), parsed once per trade object. */
export function signalOf(t: { signal?: unknown }): SignalSnapshot | null {
  if (typeof t !== "object" || t === null) return null;
  if (signalCache.has(t)) return signalCache.get(t) ?? null;
  const s = parseSignalSnapshot(t.signal);
  signalCache.set(t, s);
  return s;
}

/** Valid mistake tags of a trade (strings, trimmed, non-empty). */
export function mistakesOf(t: { mistakes?: unknown }): string[] {
  return Array.isArray(t.mistakes) ? t.mistakes.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim()) : [];
}

/** Strength key of a trade for the filter: `none` without a stored check, else `0` … `4`. */
export function strengthKey(t: { signal?: unknown }): TradeExtraFilter["strength"] {
  const s = signalOf(t);
  return s ? (String(Math.max(0, Math.min(4, s.strength))) as TradeExtraFilter["strength"]) : "none";
}

/** Mistake tag / signal strength filter (plus the Journal-v3 ranges, `matchJournal`) on top of `filterTrades`. */
export function filterExtra<T extends { mistakes?: unknown; signal?: unknown } & Partial<JournalFilterable>>(rows: readonly T[], extra: TradeExtraFilter): T[] {
  const journal = journalFilterCount(extra) > 0;
  if (extra.mistake === "all" && extra.strength === "all" && !journal) return rows as T[];
  return rows.filter((t) => {
    if (extra.mistake !== "all") {
      const tags = mistakesOf(t);
      if (extra.mistake === NO_MISTAKE ? tags.length > 0 : extra.mistake === ANY_MISTAKE ? tags.length === 0 : !tags.includes(extra.mistake)) return false;
    }
    if (extra.strength !== "all" && strengthKey(t) !== extra.strength) return false;
    if (journal && !matchJournal(t, extra)) return false;
    return true;
  });
}

/* ------------------------------------------------------------ Journal v3 filters (P06) */

/** What the v3 filters read of a trade. */
export interface JournalFilterable {
  date: string;
  createdAt: string;
  exitDate?: string;
  pair: string;
  exchange?: string;
  exchangeAccount?: string;
  market?: "perp" | "spot";
  tags?: string[];
  rating?: number | null;
  pnl: number | null;
  r: number | null;
  leverage: number | null;
}

const RANGE_KEYS = ["pnlMin", "pnlMax", "rMin", "rMax", "holdMin", "holdMax", "levMin", "levMax", "ratingMin"] as const;

/** Number of active v3 filters (the `Mehr Filter` badge). */
export function journalFilterCount(e: TradeExtraFilter): number {
  let n = 0;
  if (e.from || e.to) n += 1;
  if (e.pair) n += 1;
  if (e.exchange) n += 1;
  if (e.exchangeAccount) n += 1;
  if (e.market) n += 1;
  if (e.tags?.length) n += 1;
  if (e.pnlMin != null || e.pnlMax != null) n += 1;
  if (e.rMin != null || e.rMax != null) n += 1;
  if (e.holdMin != null || e.holdMax != null) n += 1;
  if (e.levMin != null || e.levMax != null) n += 1;
  if (e.ratingMin != null) n += 1;
  return n;
}

function journalFilterKey(e: TradeExtraFilter): string {
  const parts = [e.from ?? "", e.to ?? "", e.pair ?? "", e.exchange ?? "", e.exchangeAccount ?? "", e.market ?? "", (e.tags ?? []).join(",")];
  for (const k of RANGE_KEYS) parts.push(e[k] == null ? "" : String(e[k]));
  return parts.join("/");
}

const inRange = (v: number | null | undefined, lo: number | null | undefined, hi: number | null | undefined): boolean => {
  if (lo == null && hi == null) return true;
  if (v == null || !Number.isFinite(v)) return false;
  return (lo == null || v >= lo) && (hi == null || v <= hi);
};

/** True when `t` passes every active v3 filter (period = local entry day, inclusive). */
export function matchJournal(t: Partial<JournalFilterable>, e: TradeExtraFilter): boolean {
  if (e.from || e.to) {
    const day = localDateKey(tradeTime({ date: t.date, createdAt: t.createdAt }));
    if (e.from && day < e.from) return false;
    if (e.to && day > e.to) return false;
  }
  if (e.pair && pairKey(t.pair ?? "") !== pairKey(e.pair)) return false;
  if (e.exchange && (t.exchange ?? "").toLowerCase() !== e.exchange.toLowerCase()) return false;
  if (e.exchangeAccount && (t.exchangeAccount ?? "").trim().toLowerCase() !== e.exchangeAccount.trim().toLowerCase()) return false;
  if (e.market && (t.market ?? "perp") !== e.market) return false;
  if (e.tags?.length) {
    const own = new Set((t.tags ?? []).map((x) => x.toLowerCase()));
    if (!e.tags.every((x) => own.has(x.toLowerCase()))) return false;
  }
  if (!inRange(t.pnl, e.pnlMin, e.pnlMax)) return false;
  if (!inRange(t.r, e.rMin, e.rMax)) return false;
  if (e.holdMin != null || e.holdMax != null) {
    const ms = t.date ? holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt }) : null;
    if (!inRange(ms == null ? null : ms / 60_000, e.holdMin, e.holdMax)) return false;
  }
  if (!inRange(t.leverage, e.levMin, e.levMax)) return false;
  if (e.ratingMin != null && !((t.rating ?? 0) >= e.ratingMin)) return false;
  return true;
}

/** Values the v3 filters offer (only those the journal has). */
export interface JournalFilterOptions {
  pairs: string[];
  exchanges: string[];
  /** Exchange account labels of the journal (review F15). */
  exchangeAccounts: string[];
  tags: string[];
  /** The journal has spot trades (the Perp / Spot switch shows only then). */
  spot: boolean;
  /** Any exit time (holding-time filter) / leverage / rating in the journal. */
  hold: boolean;
  leverage: boolean;
  rating: boolean;
}

export function journalFilterOptions(trades: readonly Partial<JournalFilterable>[]): JournalFilterOptions {
  const pairs = new Map<string, string>();
  const exchanges = new Map<string, string>();
  const accounts = new Map<string, string>();
  const tags = new Map<string, number>();
  let spot = false;
  let hold = false;
  let leverage = false;
  let rating = false;
  for (const t of trades) {
    const pk = pairKey(t.pair ?? "");
    if (pk && !pairs.has(pk)) pairs.set(pk, pk);
    if (t.exchange) exchanges.set(t.exchange.toLowerCase(), t.exchange);
    const acc = t.exchangeAccount?.trim();
    if (acc && !accounts.has(acc.toLowerCase())) accounts.set(acc.toLowerCase(), acc);
    for (const g of t.tags ?? []) tags.set(g, (tags.get(g) ?? 0) + 1);
    if (t.market === "spot") spot = true;
    if (t.exitDate) hold = true;
    if (t.leverage != null) leverage = true;
    if (t.rating != null) rating = true;
  }
  return {
    pairs: [...pairs.values()].sort(),
    exchanges: [...exchanges.values()].sort((a, b) => a.localeCompare(b, "de")),
    exchangeAccounts: [...accounts.values()].sort((a, b) => a.localeCompare(b, "de")),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([g]) => g),
    spot,
    hold,
    leverage,
    rating,
  };
}

/** The v3 part of the extra filter cleared (mistake / strength / grouping stay). */
export function clearJournalFilters(e: TradeExtraFilter): TradeExtraFilter {
  return { mistake: e.mistake, strength: e.strength, ...(e.group ? { group: true } : null) };
}

/** Tags offered by the `Fehler` filter: those used in the journal (most used first), then the rest of the settings list. */
export function mistakeFilterTags(trades: readonly { mistakes?: unknown }[], settingsTags: readonly string[] = []): string[] {
  const count = new Map<string, number>();
  for (const t of trades) for (const m of mistakesOf(t)) count.set(m, (count.get(m) ?? 0) + 1);
  const used = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([m]) => m);
  return [...used, ...settingsTags.filter((m) => !count.has(m))];
}

/** `Signal-Stärke` filter options (labels from the engine's strength names). */
export const STRENGTH_OPTIONS: readonly { value: TradeExtraFilter["strength"]; label: string }[] = [
  { value: "all", label: "Alle Signal-Stärken" },
  { value: "none", label: "Ohne Einstiegs-Check" },
  ...[0, 1, 2, 3, 4].map((n) => ({ value: String(n) as TradeExtraFilter["strength"], label: `Stärke ${n} · ${STRENGTH_LABEL[n]}` })),
];

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
