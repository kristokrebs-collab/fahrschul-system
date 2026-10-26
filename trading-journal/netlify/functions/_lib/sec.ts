/**
 * SEC EDGAR access for the earnings analyst (F68), the DCF and the thesis monitor (F69). Server only: SEC wants a contact in
 * the `User-Agent` (`SEC_USER_AGENT`), has no CORS for `data.sec.gov` and limits clients to 10 requests per second.
 *
 * - **No User-Agent, no call.** Without a usable `SEC_USER_AGENT` every entry point throws the typed 503 `sec_setup_required`
 *   ("Einrichtung nötig") BEFORE any network access. The value is never logged and never sent to the client.
 * - **10 requests per second.** Every upstream request first takes a slot of the account-wide window (`rate_hit`, 8 per second)
 *   and is spaced ≥ 125 ms from the previous one in this instance. A cache hit makes no request at all.
 * - **Cache.** In memory per function instance: the ticker list 12 h, company facts and submissions 20 min, a filing folder
 *   listing 24 h. Concurrent identical loads share one request. When SEC cannot be read and an older copy (≤ 24 h) exists, that copy
 *   is served marked `stale` with its original read time – the app says so; nothing is invented.
 * - **Reduced answers.** Company facts are cut down by `src/market/sec/reduce.ts` (known concepts, recent years); submissions by
 *   `pickFilings`. The original 3 – 20 MB never leave this module.
 * - **Typed errors** (`error.code`): `sec_setup_required` 503, `sec_unknown_ticker` 404, `sec_no_facts` 404, `sec_busy` 429,
 *   `sec_timeout` 504, `sec_upstream` 502, `sec_invalid` 502.
 */
import { archiveFolder, archiveIndexJson, exhibitName, factsUrl, namesOfIndex, pickFilings, submissionsUrl, TICKERS_URL, type PickedFilings } from "../../../src/market/sec/filings";
import { reduceCompanyFacts, type ReducedFacts } from "../../../src/market/sec/reduce";
import { buildTickerIndex, findTicker, normalizeCik, normalizeTicker, type TickerEntry } from "../../../src/market/sec/tickers";
import { SEC_SOURCE, type SecEarnings8k, type SecFactsPayload, type SecFilingsPayload } from "../../../src/market/sec/wire";
import { envOptional } from "./env";
import { HttpError } from "./http";
import { rateKey, rateLimit } from "./rateLimit";

export const SEC_SETUP_MESSAGE = "Einrichtung nötig: Die SEC verlangt einen Kontakt im User-Agent. Der Betreiber trägt in Netlify (Environment variables, Scope Functions) SEC_USER_AGENT ein, zum Beispiel „Firmenname kontakt@deine-domain.de“.";
export const SEC_BUSY_MESSAGE = "Die SEC bremst gerade (zu viele Anfragen). Bitte in einigen Minuten noch einmal versuchen.";

const PLACEHOLDER = /you@example\.com|example\.(com|org)/i;

/** The contact the operator set, or the typed 503 – nothing is sent to SEC without it. */
export function secUserAgent(): string {
  const ua = envOptional("SEC_USER_AGENT")?.trim() ?? "";
  if (ua.length < 8 || !ua.includes("@") || PLACEHOLDER.test(ua) || /[\r\n]/.test(ua)) throw new HttpError(503, "sec_setup_required", SEC_SETUP_MESSAGE);
  return ua;
}

/* ------------------------------------------------------------------------------------------ pacing */

/** Spacing between two upstream requests of one instance (ms). Tests set 0. */
let gapMs = 125;
let waitCapMs = 1_100;
let nextSlot = 0;
let fetchOverride: typeof fetch | null = null;
/** Fixed window of the account-wide limit: SEC allows 10 per second, we use 8. */
const GLOBAL_PER_SECOND = 8;
const TIMEOUT_MS = 9_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pace(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await sleep(at - now);
}

/** A slot in the account-wide window (all instances share `rate_hit`); waits for the next window once, then gives up. */
async function globalSlot(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const r = await rateLimit(rateKey("sec-upstream"), GLOBAL_PER_SECOND, 1);
    if (r.ok) return;
    await sleep(Math.min(waitCapMs, Math.max(Math.min(40, waitCapMs), r.resetAt - Date.now())));
  }
  throw new HttpError(429, "sec_busy", SEC_BUSY_MESSAGE, undefined, { "retry-after": "5" });
}

/** Tests: inject `fetch`, spacing and a clean cache (`null` restores the real ones). */
export function setSecForTests(opts: { fetch?: typeof fetch | null; gapMs?: number; waitCapMs?: number } | null): void {
  fetchOverride = opts?.fetch ?? null;
  gapMs = opts?.gapMs ?? 125;
  waitCapMs = opts?.waitCapMs ?? 1_100;
  nextSlot = 0;
  cache.clear();
  inflight.clear();
}

type What = "tickers" | "facts" | "submissions" | "index";

async function secJson(url: string, what: What): Promise<unknown> {
  const ua = secUserAgent();
  await globalSlot();
  await pace();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await (fetchOverride ?? fetch)(url, { headers: { "user-agent": ua, accept: "application/json" }, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw new HttpError(504, "sec_timeout", "Die SEC antwortet nicht rechtzeitig. Bitte gleich noch einmal versuchen.");
    console.error("[fn] sec network", e instanceof Error ? e.name : typeof e);
    throw new HttpError(502, "sec_upstream", "Die SEC ist gerade nicht erreichbar.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new HttpError(404, what === "facts" ? "sec_no_facts" : what === "index" ? "sec_upstream" : "sec_unknown_ticker", what === "facts" ? NO_FACTS_MESSAGE : "Bei der SEC gibt es dazu nichts.");
  if (res.status === 429) throw new HttpError(429, "sec_busy", SEC_BUSY_MESSAGE, undefined, { "retry-after": "60" });
  if (res.status === 403) {
    console.error("[fn] sec 403");
    throw new HttpError(429, "sec_busy", "Die SEC hat die Anfrage abgelehnt (403). Entweder bremst sie gerade, oder der Kontakt in SEC_USER_AGENT wird nicht akzeptiert.");
  }
  if (!res.ok) {
    console.error("[fn] sec status", res.status);
    throw new HttpError(502, "sec_upstream", `Die SEC antwortete mit einem Fehler (${res.status}).`);
  }
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, "sec_invalid", "Die Antwort der SEC ist kein lesbares JSON.");
  }
}

export const NO_FACTS_MESSAGE = "Die SEC hat für dieses Unternehmen keine XBRL-Zahlen (zum Beispiel Fonds und ETFs, oder Firmen, die nicht nach US-GAAP berichten).";

/* ------------------------------------------------------------------------------------------ cache */

interface Entry {
  at: number;
  value: unknown;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const MAX_ENTRIES = 48;
const TICKERS_TTL = 12 * 3_600_000;
const DOC_TTL = 20 * 60_000;
const INDEX_TTL = 24 * 3_600_000;
const STALE_MAX = 24 * 3_600_000;

interface Loaded<T> {
  value: T;
  /** ms the data was read from SEC */
  at: number;
  cached: boolean;
  stale: boolean;
}

const retryable = (e: unknown): boolean => e instanceof HttpError && (e.status >= 500 || e.code === "sec_busy");

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Loaded<T>> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return { value: hit.value as T, at: hit.at, cached: true, stale: false };
  let p = inflight.get(key);
  const mine = !p;
  if (!p) {
    p = (async (): Promise<Entry> => ({ at: Date.now(), value: await load() }))();
    inflight.set(key, p);
  }
  try {
    const e = await p;
    if (mine) {
      cache.set(key, e);
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    }
    return { value: e.value as T, at: e.at, cached: !mine, stale: false };
  } catch (err) {
    // SEC cannot be read: an older copy is better than nothing – and says so
    if (hit && retryable(err) && now - hit.at < STALE_MAX) return { value: hit.value as T, at: hit.at, cached: true, stale: true };
    throw err;
  } finally {
    if (mine) inflight.delete(key);
  }
}

/* ------------------------------------------------------------------------------------------ company */

export interface CompanyRef {
  ticker: string;
  cik: string;
  title: string;
}

async function tickerIndex(): Promise<Map<string, TickerEntry>> {
  return (await cached("tickers", TICKERS_TTL, async () => buildTickerIndex(await secJson(TICKERS_URL, "tickers")))).value;
}

/** Ticker or CIK → the company; the typed 404 `sec_unknown_ticker` when SEC does not list the ticker. */
export async function resolveCompany(q: { ticker?: string | null; cik?: string | null }): Promise<CompanyRef> {
  secUserAgent();
  const cik = normalizeCik(q.cik);
  const ticker = normalizeTicker(q.ticker);
  if (ticker) {
    const hit = findTicker(await tickerIndex(), ticker);
    if (!hit) throw new HttpError(404, "sec_unknown_ticker", `Die SEC kennt das Kürzel „${ticker}“ nicht. Es gilt nur für US-Börsenkürzel; bei Klassen-Aktien meist mit Bindestrich (BRK-B).`);
    return { ticker: hit.ticker, cik: hit.cik, title: hit.title };
  }
  if (cik) return { ticker: "", cik, title: "" };
  throw new HttpError(422, "invalid_query", "Bitte ein Börsenkürzel angeben, zum Beispiel AAPL.");
}

/** `GET /sec/facts`: the reduced company facts. */
export async function loadFacts(q: { ticker?: string | null; cik?: string | null }): Promise<SecFactsPayload> {
  const co = await resolveCompany(q);
  const r = await cached<ReducedFacts>(`facts:${co.cik}`, DOC_TTL, async () => {
    const reduced = reduceCompanyFacts(await secJson(factsUrl(co.cik), "facts"));
    if (!Object.keys(reduced.facts).length) throw new HttpError(404, "sec_no_facts", NO_FACTS_MESSAGE);
    return reduced;
  });
  return {
    source: SEC_SOURCE,
    ticker: co.ticker,
    cik: co.cik,
    entity: r.value.entity || co.title,
    sourceUrl: factsUrl(co.cik),
    fetchedAt: r.at,
    asOf: r.value.asOf,
    cached: r.cached,
    ...(r.stale ? { stale: true } : {}),
    facts: r.value.facts,
  };
}

interface Submissions extends PickedFilings {
  name: string;
}

/** `GET /sec/filings`: the newest 10-Q / 10-K / 8-K and the press release of the newest earnings 8-K. */
export async function loadFilings(q: { ticker?: string | null; cik?: string | null }): Promise<SecFilingsPayload> {
  const co = await resolveCompany(q);
  const r = await cached<Submissions>(`sub:${co.cik}`, DOC_TTL, async () => {
    const raw = await secJson(submissionsUrl(co.cik), "submissions");
    const name = typeof raw === "object" && raw !== null && typeof (raw as { name?: unknown }).name === "string" ? (raw as { name: string }).name : "";
    return { ...pickFilings(raw, co.cik), name };
  });
  const p = r.value;
  let earnings8k: SecEarnings8k | null = null;
  let stale = r.stale;
  if (p.earnings8k) {
    const e = p.earnings8k;
    let exhibitUrl: string | null = null;
    try {
      const idx = await cached<string[]>(`idx:${co.cik}:${e.accession}`, INDEX_TTL, async () => namesOfIndex(await secJson(archiveIndexJson(co.cik, e.accession), "index")));
      const primary = e.url.split("/").pop();
      const name = exhibitName(idx.value, primary);
      exhibitUrl = name ? archiveFolder(co.cik, e.accession) + name : null;
      stale = stale || idx.stale;
    } catch (err) {
      // the press release link is a bonus: a failed lookup leaves it out, but a missing set-up must still be reported
      if (err instanceof HttpError && err.code === "sec_setup_required") throw err;
    }
    earnings8k = { ...e, exhibitUrl };
  }
  return {
    source: SEC_SOURCE,
    ticker: co.ticker,
    cik: co.cik,
    entity: p.name || co.title,
    sourceUrl: submissionsUrl(co.cik),
    fetchedAt: r.at,
    cached: r.cached,
    ...(stale ? { stale: true } : {}),
    filings: p.filings,
    report: p.report,
    earnings8k,
    earningsHistory: p.earningsHistory,
  };
}
