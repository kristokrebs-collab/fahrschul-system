/**
 * Yahoo Finance headlines per ticker: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=<T>&region=US&lang=en-US`
 * (public RSS, no key; the trader-news skill reads the same feed). A small tolerant reader instead of an XML library:
 * the feed is flat (`<item>` with title, link, guid, pubDate, description).
 *
 * What the reader refuses: an item without title, link or a readable date; a link that is not http(s). The tracking
 * parameter `.tsrc=rss` is removed from links so the same story from two tickers is one story. A headline is a lead, not a
 * fact – the app says so wherever it shows one.
 */
import { UpstreamError, YAHOO_USER_AGENT } from "./yahoo";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface RssItem {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: number;
  summary: string | null;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `&amp;`, `&#39;`, `&#x2019;` … → text. Unknown entities stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m) return null;
  const raw = m[1]!;
  const cd = CDATA.exec(raw);
  return decodeEntities(cd ? cd[1]! : raw).trim();
}

/** Small stable hash for items without a `guid` (not cryptographic). */
export function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return `h${h.toString(36)}`;
}

/** The link without Yahoo's `.tsrc` tracking parameter (other query parts stay). */
export function cleanLink(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.searchParams.delete(".tsrc");
  u.hash = "";
  return u.toString();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export function parseRss(xml: string, max = 25): RssItem[] {
  const out: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]!;
    const title = tag(block, "title");
    const link = tag(block, "link");
    const when = Date.parse(tag(block, "pubDate") ?? "");
    const url = link ? cleanLink(link) : null;
    if (!title || !url || !Number.isFinite(when)) continue;
    const desc = tag(block, "description");
    const summary = desc ? stripTags(desc).slice(0, 280) : "";
    const publisher = hostOf(url);
    out.push({ id: tag(block, "guid") || hashId(url), title: stripTags(title), url, publisher, publishedAt: when, summary: summary || null });
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out.slice(0, max);
}

export interface RssDeps {
  fetch?: FetchFn;
  timeoutMs?: number;
}

export async function fetchHeadlines(symbol: string, deps: RssDeps = {}): Promise<RssItem[]> {
  const f: FetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 6000);
  try {
    const s = encodeURIComponent(symbol.toUpperCase().replace(/\./g, "-"));
    const res = await f(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${s}&region=US&lang=en-US`, { headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/rss+xml,application/xml,text/xml,*/*" }, signal: ctrl.signal });
    if (res.status === 429) throw new UpstreamError("rate-limited", "Yahoo Finance begrenzt die Abrufe der Schlagzeilen gerade (HTTP 429).", 429);
    if (res.status === 401 || res.status === 403) throw new UpstreamError("blocked", `Yahoo Finance verweigert die Schlagzeilen (HTTP ${res.status}).`, res.status);
    if (res.status === 404) throw new UpstreamError("bad-symbol", "Für dieses Kürzel gibt es keinen Schlagzeilen-Feed.", 404);
    if (!res.ok) throw new UpstreamError("upstream", `Yahoo Finance meldet einen Fehler bei den Schlagzeilen (HTTP ${res.status}).`, res.status);
    const text = await res.text();
    if (!/<rss\b/i.test(text)) throw new UpstreamError("bad-response", "Yahoo Finance hat statt des Schlagzeilen-Feeds etwas anderes geschickt.");
    return parseRss(text);
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    const aborted = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
    throw new UpstreamError(aborted ? "timeout" : "upstream", aborted ? "Yahoo Finance antwortet nicht rechtzeitig." : "Yahoo Finance ist gerade nicht erreichbar.");
  } finally {
    clearTimeout(timer);
  }
}
