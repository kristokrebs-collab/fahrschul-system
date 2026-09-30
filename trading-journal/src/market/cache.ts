/**
 * Memory + IndexedDB cache (Plan 4.7). Key `${source}:${symbol}:${feed}`, DB `tj-market`.
 * Series are ring buffers keyed by `time`; polls with `limit=30` upsert and never replace the buffer.
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { FeedId, FeedValue, SeriesFeed, Source, Stamped } from "./types";
import { isSeriesFeed } from "./feeds";

export const CACHE_DB = "tj-market";
export const CACHE_STORE = "kv";

export const RING_CAPACITY: Record<SeriesFeed, number> = {
  kline_1m: 10_080, // 7 days
  kline_1h: 2_200, // ≈ 90 days
  kline_4h: 600,
  kline_1w: 260,
  openInterestHist: 500,
  topPositionRatio: 500,
  topAccountRatio: 500,
  globalAccountRatio: 500,
  takerRatio: 500,
  fundingHistory: 500,
};

export function cacheKey(source: Source, symbol: string, feed: FeedId): string {
  return `${source}:${symbol}:${feed}`;
}

/** Sorted upsert by `time`, trimmed to `cap` from the front (oldest dropped). */
export function upsertSeries<T extends { time: number }>(existing: readonly T[], incoming: readonly T[], cap: number): T[] {
  if (incoming.length === 0) return existing.slice(-cap);
  const map = new Map<number, T>();
  for (const p of existing) map.set(p.time, p);
  for (const p of incoming) map.set(p.time, p);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/** Minimal async KV interface so tests can inject a Map-backed store. */
export interface KVStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function memoryKV(): KVStore {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

export function idbKV(): KVStore | null {
  if (typeof indexedDB === "undefined") return null;
  let store: UseStore | null = null;
  const s = (): UseStore => (store ??= createStore(CACHE_DB, CACHE_STORE));
  return {
    get: (k) => get(k, s()),
    set: (k, v) => set(k, v, s()),
    del: (k) => del(k, s()),
    keys: async () => (await keys(s())).map(String),
  };
}

export type StampedAny = Stamped<FeedValue[FeedId]>;

export class MarketCache {
  private mem = new Map<FeedId, StampedAny>();
  private kv: KVStore | null;
  constructor(
    public symbol: string,
    kv?: KVStore | null,
  ) {
    this.kv = kv === undefined ? idbKV() : kv;
  }

  get<F extends FeedId>(feed: F): Stamped<FeedValue[F]> | undefined {
    return this.mem.get(feed) as Stamped<FeedValue[F]> | undefined;
  }

  /** Stores a value; series are merged into the ring buffer unless `replace` is set. */
  set<F extends FeedId>(feed: F, value: Stamped<FeedValue[F]>, opts: { replace?: boolean } = {}): Stamped<FeedValue[F]> {
    let next = value;
    if (isSeriesFeed(feed) && !opts.replace) {
      const prev = this.mem.get(feed) as Stamped<{ time: number }[]> | undefined;
      const incoming = value.data as unknown as { time: number }[];
      const cap = RING_CAPACITY[feed];
      const base = prev && prev.source === value.source ? prev.data : [];
      next = { ...value, data: upsertSeries(base, incoming, cap) as unknown as FeedValue[F] };
    }
    this.mem.set(feed, next as StampedAny);
    return next;
  }

  delete(feed: FeedId): void {
    this.mem.delete(feed);
  }

  entries(): [FeedId, StampedAny][] {
    return [...this.mem.entries()];
  }

  clearMemory(): void {
    this.mem.clear();
  }

  /** Loads the newest snapshot per feed for this symbol (any source) into memory; returns the hydrated feeds. */
  async hydrate(feeds: readonly FeedId[], sources: readonly Source[] = ["binance", "bybit", "okx", "proxy"]): Promise<FeedId[]> {
    if (!this.kv) return [];
    const loaded: FeedId[] = [];
    for (const feed of feeds) {
      let best: StampedAny | undefined;
      for (const source of sources) {
        let v: unknown;
        try {
          v = await this.kv.get(cacheKey(source, this.symbol, feed));
        } catch {
          v = undefined;
        }
        if (isStamped(v) && (!best || v.asOf > best.asOf)) best = v;
      }
      if (best && !this.mem.has(feed)) {
        this.mem.set(feed, best);
        loaded.push(feed);
      }
    }
    return loaded;
  }

  async persist(feed: FeedId): Promise<void> {
    const v = this.mem.get(feed);
    if (!v || !this.kv) return;
    try {
      await this.kv.set(cacheKey(v.source, this.symbol, feed), v);
    } catch {
      /* quota / private mode: cache is best-effort */
    }
  }

  async persistAll(): Promise<void> {
    await Promise.all([...this.mem.keys()].map((f) => this.persist(f)));
  }

  /** `Cache leeren`: removes every persisted key (all symbols) and the memory snapshot. */
  async clear(): Promise<void> {
    this.mem.clear();
    if (!this.kv) return;
    try {
      const all = await this.kv.keys();
      await Promise.all(all.map((k) => this.kv!.del(k)));
    } catch {
      /* ignore */
    }
  }
}

function isStamped(v: unknown): v is StampedAny {
  return (
    typeof v === "object" &&
    v !== null &&
    "data" in v &&
    typeof (v as { asOf?: unknown }).asOf === "number" &&
    typeof (v as { receivedAt?: unknown }).receivedAt === "number" &&
    typeof (v as { source?: unknown }).source === "string"
  );
}
