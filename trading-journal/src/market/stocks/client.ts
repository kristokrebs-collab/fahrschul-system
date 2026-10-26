/**
 * The stock data contract implemented against our own functions (`/api/v1/stocks/*`, `netlify/functions/stock-*.mts`).
 * Everything that can go wrong is a typed result (`ok | stale | unavailable(reason)`), never a thrown error:
 *   - cache first (`cache.ts`: memory + IndexedDB, a `ttl` per kind), then one request per batch through the throttle;
 *   - a failed refresh with a cached answer inside `maxStale` is `stale` (the old data, its own stamp, the reason);
 *   - without such an answer it is `unavailable` with the reason in German (no server here, not signed in, plan, limit,
 *     blocked by the source, source down, unknown ticker, nothing to show);
 *   - the answers are validated (`wire.ts`); a shape the app does not know is `bad-response`, not partial data.
 * Only a ticker, an interval and a range leave the device.
 */
import { ApiError, apiFetch, FUNCTIONS_MISSING, type ApiFetchInit } from "@/cloud/api";
import type { KVStore } from "../cache";
import { BARS_AGES, barsKey, createStockCache, NEWS_AGES, newsKey, QUOTE_AGES, quoteKey, SYMBOLS_AGES, SYMBOLS_KEY, type Ages, type CacheEntry, type StockCache } from "./cache";
import { REASON_TEXT, ok, stale, unavailable } from "./result";
import { isClosedBar } from "./session";
import { createLimiter, type Limiter } from "./throttle";
import {
  DEFAULT_RANGE,
  STOCK_LIMITS,
  type BarsOptions,
  type NewsItem,
  type Stamp,
  type StockBars,
  type StockCandle,
  type StockDataContract,
  type StockInterval,
  type StockQuote,
  type StockResult,
  type SymbolDirectory,
  type UnavailableReason,
} from "./types";
import { BarsResponse, NewsResponse, QuoteResponse, SymbolsResponse } from "./wire";

type Api = <T>(path: string, init?: ApiFetchInit) => Promise<T>;

export interface StockDataDeps {
  api?: Api;
  now?: () => number;
  /** `undefined` = IndexedDB, `null` = memory only */
  kv?: KVStore | null;
  cache?: StockCache;
  limiter?: Limiter;
  online?: () => boolean;
}

interface Fail {
  reason: UnavailableReason;
  message: string;
}

/** Pause after a limit (the server pauses Yahoo for 30 s after a 429). */
export const RATE_BACKOFF_MS = 30_000;

const unique = (symbols: readonly string[]): string[] => [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
const chunks = <T>(list: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

const isAbort = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

export function failFrom(e: unknown, online: () => boolean = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false)): Fail {
  if (isAbort(e)) return { reason: "aborted", message: REASON_TEXT.aborted };
  if (e instanceof BadResponse) return { reason: "bad-response", message: REASON_TEXT["bad-response"] };
  if (e instanceof ApiError) {
    const msg = e.message;
    if (e.status === 0) {
      if (msg === FUNCTIONS_MISSING || msg.startsWith("In der Offline-Datei")) return { reason: "no-server", message: REASON_TEXT["no-server"] };
      return online() ? { reason: "network", message: REASON_TEXT.network } : { reason: "offline", message: REASON_TEXT.offline };
    }
    if (e.status === 401) return { reason: "login", message: msg };
    if (e.status === 402) return { reason: "plan", message: msg };
    if (e.status === 429 || e.code === "rate_limited" || e.code === "stock_upstream_rate_limited") return { reason: "rate-limited", message: msg };
    if (e.status === 400) return { reason: e.code === "bad_symbols" ? "bad-symbol" : "bad-response", message: msg };
    if (e.code === "stock_upstream_blocked") return { reason: "blocked", message: msg };
    if (e.status === 404) return { reason: "no-server", message: REASON_TEXT["no-server"] };
    return { reason: "upstream", message: msg };
  }
  return online() ? { reason: "network", message: REASON_TEXT.network } : { reason: "offline", message: REASON_TEXT.offline };
}

class BadResponse extends Error {}

export function createStockData(deps: StockDataDeps = {}): StockDataContract & { cache: StockCache; limiter: Limiter } {
  const api: Api = deps.api ?? ((path, init) => apiFetch(path, init));
  const now = deps.now ?? (() => Date.now());
  const cache = deps.cache ?? createStockCache(deps.kv);
  const limiter = deps.limiter ?? createLimiter({ now });
  const online = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  const call = async <T>(path: string, query: Record<string, string>, o: { signal?: AbortSignal; fresh?: boolean }): Promise<T> => {
    const init: ApiFetchInit = { query, ...(o.signal ? { signal: o.signal } : {}), ...(o.fresh ? { cache: "no-cache" as RequestCache } : {}) };
    return limiter.run(() => api<T>(path, init), o.signal ? { signal: o.signal } : {});
  };

  /** What a failed refresh answers: the cached data as `stale`, else `unavailable`. */
  const fallback = <T>(cached: CacheEntry<T> | null, ages: Ages, f: Fail, source: string): StockResult<T> => {
    const t = now();
    const usable = cached && f.reason !== "bad-symbol" && f.reason !== "aborted" && t - cached.storedAt <= ages.maxStale;
    return usable ? stale(cached.data, cached.stamp, f.reason, f.message, t) : unavailable<T>(f.reason, t, f.message, source);
  };

  const noteFail = (f: Fail): void => {
    if (f.reason === "rate-limited") limiter.backoff(RATE_BACKOFF_MS);
  };

  /** One batched kind (bars / quotes / news): cache, then chunked requests, one result per symbol. */
  async function many<T>(kind: {
    symbols: readonly string[];
    ages: Ages;
    keyOf: (s: string) => string;
    perRequest: number;
    path: string;
    query: (chunk: string[]) => Record<string, string>;
    source: string;
    /** validates a whole answer once (throws `BadResponse` for a shape the app does not know) and returns the reader of one symbol's entry; `Fail` for an entry the source could not serve */
    parse: (raw: unknown) => (symbol: string, received: number) => { data: T; stamp: Stamp } | Fail;
    opts: { fresh?: boolean; signal?: AbortSignal };
  }): Promise<Record<string, StockResult<T>>> {
    const list = unique(kind.symbols);
    const out: Record<string, StockResult<T>> = {};
    const t0 = now();
    const cached = new Map<string, CacheEntry<T> | null>();
    await Promise.all(list.map(async (s) => void cached.set(s, await cache.get<T>(kind.keyOf(s)))));
    const todo: string[] = [];
    for (const s of list) {
      const c = cached.get(s) ?? null;
      if (!kind.opts.fresh && c && t0 - c.storedAt <= kind.ages.ttl) out[s] = ok(c.data, c.stamp);
      else todo.push(s);
    }
    await Promise.all(
      chunks(todo, kind.perRequest).map(async (chunk) => {
        let raw: unknown;
        try {
          raw = await call<unknown>(kind.path, kind.query(chunk), kind.opts);
        } catch (e) {
          const f = failFrom(e, online);
          noteFail(f);
          for (const s of chunk) out[s] = fallback(cached.get(s) ?? null, kind.ages, f, kind.source);
          return;
        }
        const received = now();
        let read: ReturnType<typeof kind.parse>;
        try {
          read = kind.parse(raw);
        } catch (e) {
          const f = failFrom(e, online);
          for (const s of chunk) out[s] = fallback(cached.get(s) ?? null, kind.ages, f, kind.source);
          return;
        }
        for (const s of chunk) {
          const r = read(s, received);
          if ("reason" in r) {
            noteFail(r);
            out[s] = fallback(cached.get(s) ?? null, kind.ages, r, kind.source);
            continue;
          }
          await cache.set<T>(kind.keyOf(s), { v: 1, data: r.data, stamp: r.stamp, storedAt: received });
          out[s] = ok(r.data, r.stamp);
        }
      }),
    );
    return out;
  }

  const wireFail = (r: { reason: string; message: string }): Fail => ({ reason: r.reason as UnavailableReason, message: r.message });

  const barsMany: StockDataContract["barsMany"] = (symbols, interval, opts = {}) => {
    const range = opts.range ?? DEFAULT_RANGE[interval];
    return many<StockBars>({
      symbols,
      ages: BARS_AGES[interval],
      keyOf: (s) => barsKey(s, interval, range),
      perRequest: STOCK_LIMITS.barsPerRequest,
      path: "/stocks/bars",
      query: (chunk) => ({ symbols: chunk.join(","), interval, range }),
      source: "yahoo",
      opts,
      parse: (raw) => {
        const parsed = BarsResponse.safeParse(raw);
        if (!parsed.success) throw new BadResponse();
        const d = parsed.data;
        return (symbol, received) => {
          const r = d.results[symbol];
          if (!r) return { reason: "bad-response", message: REASON_TEXT["bad-response"] };
          if (!r.ok) return wireFail(r);
          const candles: StockCandle[] = r.bars.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume, closed: isClosedBar(interval, time, d.fetchedAt) }));
          const last = candles[candles.length - 1];
          return {
            data: { symbol, interval, range: d.range, candles, meta: r.meta },
            stamp: { source: "yahoo", asOf: r.meta.marketTime ?? last?.time ?? null, receivedAt: received, fetchedAt: d.fetchedAt },
          };
        };
      },
    });
  };

  const quotes: StockDataContract["quotes"] = (symbols, opts = {}) =>
    many<StockQuote>({
      symbols,
      ages: QUOTE_AGES,
      keyOf: quoteKey,
      perRequest: STOCK_LIMITS.quotesPerRequest,
      path: "/stocks/quote",
      query: (chunk) => ({ symbols: chunk.join(",") }),
      source: "yahoo",
      opts,
      parse: (raw) => {
        const parsed = QuoteResponse.safeParse(raw);
        if (!parsed.success) throw new BadResponse();
        const d = parsed.data;
        return (symbol, received) => {
          const r = d.results[symbol];
          if (!r) return { reason: "bad-response", message: REASON_TEXT["bad-response"] };
          if (!r.ok) return wireFail(r);
          return {
            data: {
              symbol,
              name: r.name,
              currency: r.currency,
              exchange: r.exchange,
              price: r.price,
              prevClose: r.prevClose,
              change: r.change,
              changePct: r.changePct,
              dayHigh: r.dayHigh,
              dayLow: r.dayLow,
              volume: r.volume,
              fiftyTwoWeekHigh: r.fiftyTwoWeekHigh,
              fiftyTwoWeekLow: r.fiftyTwoWeekLow,
              marketTime: r.marketTime,
            },
            stamp: { source: "yahoo", asOf: r.marketTime, receivedAt: received, fetchedAt: d.fetchedAt },
          };
        };
      },
    });

  const news: StockDataContract["news"] = (symbols, opts = {}) =>
    many<NewsItem[]>({
      symbols,
      ages: NEWS_AGES,
      keyOf: newsKey,
      perRequest: STOCK_LIMITS.newsPerRequest,
      path: "/stocks/news",
      query: (chunk) => ({ symbols: chunk.join(",") }),
      source: "yahoo-rss",
      opts,
      parse: (raw) => {
        const parsed = NewsResponse.safeParse(raw);
        if (!parsed.success) throw new BadResponse();
        const d = parsed.data;
        return (symbol, received) => {
          const r = d.results[symbol];
          if (!r) return { reason: "bad-response", message: REASON_TEXT["bad-response"] };
          if (!r.ok) return wireFail(r);
          const items: NewsItem[] = r.items.map((i) => ({ ...i, symbol, origin: "yahoo-rss" }));
          return { data: items, stamp: { source: "yahoo-rss", asOf: items[0]?.publishedAt ?? null, receivedAt: received, fetchedAt: d.fetchedAt } };
        };
      },
    });

  return {
    cache,
    limiter,
    barsMany,
    quotes,
    news,
    async bars(symbol, interval: StockInterval, opts: BarsOptions = {}) {
      const s = symbol.trim().toUpperCase();
      return (await barsMany([s], interval, opts))[s]!;
    },
    async quote(symbol, opts = {}) {
      const s = symbol.trim().toUpperCase();
      return (await quotes([s], opts))[s]!;
    },
    async symbols(opts = {}): Promise<StockResult<SymbolDirectory>> {
      const t0 = now();
      const cached = await cache.get<SymbolDirectory>(SYMBOLS_KEY);
      if (!opts.fresh && cached && t0 - cached.storedAt <= SYMBOLS_AGES.ttl) return ok(cached.data, cached.stamp);
      try {
        const raw = await call<unknown>("/stocks/symbols", {}, opts);
        const parsed = SymbolsResponse.safeParse(raw);
        if (!parsed.success) throw new BadResponse();
        const received = now();
        const d = parsed.data;
        const data: SymbolDirectory = { entries: d.symbols.map(([symbol, name, exchange, fin]) => ({ symbol, name, exchange, fin })), fileTime: d.fileTime, counts: d.counts };
        const stamp: Stamp = { source: "nasdaqtrader", asOf: d.fileTime, receivedAt: received, fetchedAt: d.fetchedAt };
        await cache.set<SymbolDirectory>(SYMBOLS_KEY, { v: 1, data, stamp, storedAt: received });
        return ok(data, stamp);
      } catch (e) {
        const f = failFrom(e, online);
        noteFail(f);
        return fallback(cached, SYMBOLS_AGES, f, "nasdaqtrader");
      }
    },
  };
}

let shared: ReturnType<typeof createStockData> | null = null;

/** The app's one instance (real API, IndexedDB, the shared throttle). */
export function stockData(): ReturnType<typeof createStockData> {
  shared ??= createStockData();
  return shared;
}

/** Tests: forget the shared instance. */
export function resetStockDataForTests(): void {
  shared = null;
}
