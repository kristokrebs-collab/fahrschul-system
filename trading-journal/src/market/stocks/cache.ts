/**
 * Cache of the stock answers: memory for the session plus IndexedDB (`tj-market`, keys `stocks:…`, the same store the
 * crypto feeds use – `src/market/cache.ts`). Each entry keeps the data with its own stamp and the time it was stored, so
 * a cached answer shown after a failed refresh says honestly how old it is.
 *
 * Two ages per kind: `ttl` (still fresh – no request needed) and `maxStale` (the oldest the app still shows when the
 * refresh failed, as `stale`). Beyond that the answer is `unavailable` rather than a picture of last month.
 */
import { idbKV, memoryKV, type KVStore } from "../cache";
import type { Stamp, StockInterval } from "./types";

export const CACHE_PREFIX = "stocks:";

export interface CacheEntry<T> {
  v: 1;
  data: T;
  stamp: Stamp;
  storedAt: number;
}

export interface Ages {
  ttl: number;
  maxStale: number;
}

const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;

/** Freshness per kind. Intraday data older than a day is not shown as a stand-in any more. */
export const BARS_AGES: Readonly<Record<StockInterval, Ages>> = {
  "1m": { ttl: 20_000, maxStale: D },
  "5m": { ttl: 45_000, maxStale: D },
  "15m": { ttl: 90_000, maxStale: 2 * D },
  "1h": { ttl: 5 * MIN, maxStale: 3 * D },
  "1d": { ttl: 10 * MIN, maxStale: 7 * D },
};
export const QUOTE_AGES: Ages = { ttl: 15_000, maxStale: 6 * H };
export const NEWS_AGES: Ages = { ttl: 5 * MIN, maxStale: D };
/** The directory files change once a night. */
export const SYMBOLS_AGES: Ages = { ttl: 12 * H, maxStale: 14 * D };

export const barsKey = (symbol: string, interval: StockInterval, range: string): string => `${CACHE_PREFIX}bars:${symbol}:${interval}:${range}`;
export const quoteKey = (symbol: string): string => `${CACHE_PREFIX}quote:${symbol}`;
export const newsKey = (symbol: string): string => `${CACHE_PREFIX}news:${symbol}`;
export const SYMBOLS_KEY = `${CACHE_PREFIX}symbols`;

export interface StockCache {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  /** removes persisted entries older than `maxAgeMs`; returns how many */
  prune(now: number, maxAgeMs: number): Promise<number>;
  clear(): Promise<void>;
}

function isEntry(v: unknown): v is CacheEntry<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const e = v as { v?: unknown; storedAt?: unknown; stamp?: unknown; data?: unknown };
  return e.v === 1 && typeof e.storedAt === "number" && typeof e.stamp === "object" && e.stamp !== null && "data" in e;
}

/** `kv`: `undefined` = IndexedDB (memory only where it does not exist), `null` = memory only. */
export function createStockCache(kv?: KVStore | null): StockCache {
  const store: KVStore | null = kv === undefined ? idbKV() : kv;
  const mem = new Map<string, CacheEntry<unknown>>();
  return {
    async get<T>(key: string): Promise<CacheEntry<T> | null> {
      const m = mem.get(key);
      if (m) return m as CacheEntry<T>;
      if (!store) return null;
      try {
        const v = await store.get(key);
        if (isEntry(v)) {
          mem.set(key, v);
          return v as CacheEntry<T>;
        }
      } catch {
        /* unreadable: treated as not cached */
      }
      return null;
    },
    async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
      mem.set(key, entry);
      if (!store) return;
      try {
        await store.set(key, entry);
      } catch {
        /* quota / private mode: the cache is best effort */
      }
    },
    async prune(now: number, maxAgeMs: number): Promise<number> {
      if (!store) return 0;
      let removed = 0;
      try {
        for (const key of await store.keys()) {
          if (!key.startsWith(CACHE_PREFIX)) continue;
          const v = await store.get(key);
          if (!isEntry(v) || now - v.storedAt > maxAgeMs) {
            await store.del(key);
            mem.delete(key);
            removed++;
          }
        }
      } catch {
        /* best effort */
      }
      return removed;
    },
    async clear(): Promise<void> {
      mem.clear();
      if (!store) return;
      try {
        for (const key of await store.keys()) if (key.startsWith(CACHE_PREFIX)) await store.del(key);
      } catch {
        /* best effort */
      }
    },
  };
}

export { memoryKV };
