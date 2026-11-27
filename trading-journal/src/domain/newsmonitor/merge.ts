/**
 * News monitor (F68, the news part): rating, duplicate merging, the "new since your last visit" mark and ordering of
 * headlines. Pure – the sources and the network are `src/market/stocks/news.ts`.
 *
 *  - `rateHeadline`: keyword hint (`rules.ts`) – a level (`high` / `medium` / `low`), the tags and the words that matched.
 *  - `mergeNews`: the same story from several tickers or sources becomes ONE line that lists all of them; two items are
 *    the same story when their link is the same (host + path, no tracking) or their titles are the same words.
 *  - `markNew`: newer than the last visit; no last visit = nothing is marked (it is not "new" to someone who never looked).
 *  - `orderNews`: by importance, then newest first – or newest first.
 */
import { NEWS_RULES, type NewsTag } from "./rules";

export type Importance = "high" | "medium" | "low";

export interface Rating {
  level: Importance;
  /** 0 (no keyword) … 3 */
  score: number;
  tags: NewsTag[];
  /** the words in the title that caused the rating, as written there */
  matched: string[];
}

export function rateHeadline(title: string): Rating {
  const tags: NewsTag[] = [];
  const matched: string[] = [];
  let score = 0;
  for (const rule of NEWS_RULES) {
    const m = rule.re.exec(title);
    if (!m) continue;
    score = Math.max(score, rule.weight);
    if (!tags.includes(rule.tag)) tags.push(rule.tag);
    const word = m[0].trim();
    if (word && !matched.some((x) => x.toLowerCase() === word.toLowerCase())) matched.push(word);
  }
  // several independent kinds of news in one headline (a takeover during a lawsuit) weigh a little more
  if (tags.length >= 3) score = Math.min(3, score + 1);
  return { level: score >= 3 ? "high" : score === 2 ? "medium" : "low", score, tags, matched };
}

export interface SourceItem {
  id: string;
  symbol: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: number;
  summary: string | null;
  /** source id (`yahoo-rss`, `sec-edgar` …) */
  origin: string;
}

export interface MonitorItem {
  /** stable key of the merged story */
  key: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: number;
  summary: string | null;
  /** every ticker the story was found for, in the order they were asked */
  symbols: string[];
  /** every source that delivered it */
  origins: string[];
  rating: Rating;
  /** published after the last visit */
  isNew: boolean;
}

const TRACKING = /^(utm_|\.?tsrc$|guccounter$|guce_)/i;

/** Same link = same story: host without `www.`, path without a trailing slash, no tracking parameters, no fragment. */
export function urlKey(url: string): string | null {
  try {
    const u = new URL(url);
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const q = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${q}`;
  } catch {
    return null;
  }
}

/** The title's words only (lower case, no punctuation) – syndicated copies of one story compare equal. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mergeNews(items: readonly SourceItem[], order: readonly string[] = []): MonitorItem[] {
  const out: MonitorItem[] = [];
  const byUrl = new Map<string, MonitorItem>();
  const byTitle = new Map<string, MonitorItem>();
  const rank = new Map(order.map((s, i) => [s, i]));
  for (const it of items) {
    const uk = urlKey(it.url);
    const tk = titleKey(it.title);
    const hit = (uk ? byUrl.get(uk) : undefined) ?? (tk.length >= 12 ? byTitle.get(tk) : undefined);
    if (hit) {
      if (!hit.symbols.includes(it.symbol)) hit.symbols.push(it.symbol);
      if (!hit.origins.includes(it.origin)) hit.origins.push(it.origin);
      if (uk && !byUrl.has(uk)) byUrl.set(uk, hit);
      continue;
    }
    const m: MonitorItem = {
      key: uk ?? `t:${tk}`,
      title: it.title,
      url: it.url,
      publisher: it.publisher,
      publishedAt: it.publishedAt,
      summary: it.summary,
      symbols: [it.symbol],
      origins: [it.origin],
      rating: rateHeadline(it.title),
      isNew: false,
    };
    out.push(m);
    if (uk) byUrl.set(uk, m);
    if (tk.length >= 12) byTitle.set(tk, m);
  }
  for (const m of out) m.symbols.sort((a, b) => (rank.get(a) ?? 1e6) - (rank.get(b) ?? 1e6) || (a < b ? -1 : 1));
  return out;
}

/** Marks the stories published after `lastVisit` (ms); `null` = no earlier visit → nothing is new. */
export function markNew(items: readonly MonitorItem[], lastVisit: number | null): MonitorItem[] {
  return items.map((m) => ({ ...m, isNew: lastVisit != null && m.publishedAt > lastVisit }));
}

export type NewsOrder = "importance" | "newest";

export function orderNews(items: readonly MonitorItem[], by: NewsOrder): MonitorItem[] {
  const copy = [...items];
  copy.sort((a, b) => (by === "importance" ? b.rating.score - a.rating.score : 0) || b.publishedAt - a.publishedAt || (a.key < b.key ? -1 : 1));
  return copy;
}

/** Stories published within the last `windowMs` of `now`; `Infinity` keeps all. */
export function withinWindow(items: readonly MonitorItem[], now: number, windowMs: number): MonitorItem[] {
  return Number.isFinite(windowMs) ? items.filter((m) => now - m.publishedAt <= windowMs) : [...items];
}
