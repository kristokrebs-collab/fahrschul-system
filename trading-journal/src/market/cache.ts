/**
 * Memory + IndexedDB cache (Plan 4.7). Key `${source}:${symbol}:${feed}` (futures-data feeds:
 * `${source}:${symbol}:${period}:${feed}`), DB `tj-market`.
 * Series are ring buffers keyed by `time`; polls with `limit=30` upsert and never replace the buffer.
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { FeedId, FeedValue, SeriesFeed, Source, Stamped } from "./types";
import { isSeriesFeed } from "./feeds";

export const CACHE_DB = "tj-market";
export const CACHE_STORE = "kv";

export const RING_CAPACITY: Record<SeriesFeed, number> = {
  kline_1m: 10_080, // 7 days
  kline_15m: 3_000, // ≈ 31 days (1500 = 500 × 45m are evaluated)
  kline_1h: 2_200, // ≈ 90 days
  kline_4h: 600,
  kline_1w: 260,
  kline_1d: 1_100, // ≈ 3 years: the 1000 days the Lage-Ampel evaluates (EMA 200, 500-day structure)
  openInterestHist: 500,
  topPositionRatio: 500,
  topAccountRatio: 500,
  globalAccountRatio: 500,
  takerRatio: 500,
  topPositionRatio5m: 288, // 24 h
  topAccountRatio5m: 288,
  globalAccountRatio5m: 288,
  fundingHistory: 500,
};

/**
 * `${source}:${symbol}:${feed}`, or `${source}:${symbol}:${period}:${feed}` for the `/futures/data/*` feeds: their
 * points are period snapshots, and a ring hydrated from another period (1h → 4h switch) would mix both spacings and
 * show an old-period point as the newest value.
 */
export function cacheKey(source: Source, symbol: string, feed: FeedId, period?: string): string {
  return period ? `${source}:${symbol}:${period}:${feed}` : `${source}:${symbol}:${feed}`;
}

function trim<T>(arr: T[], cap: number): T[] {
  return arr.length > cap ? arr.slice(arr.length - cap) : arr;
}

function isStrictlyAscending(arr: readonly { time: number }[]): boolean {
  for (let i = 1; i < arr.length; i++) if (!(arr[i - 1]!.time < arr[i]!.time)) return false;
  return true;
}

/** Ascending by time, one point per time (the LAST occurrence wins). */
function sortedUnique<T extends { time: number }>(points: readonly T[]): T[] {
  if (isStrictlyAscending(points)) return points.slice();
  const map = new Map<number, T>();
  for (const p of points) map.set(p.time, p);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** First index whose time is ≥ `time` (binary search on an ascending series). */
function lowerBound(arr: readonly { time: number }[], time: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sorted upsert by `time` (incoming wins on equal times), trimmed to `cap` from the front (oldest dropped).
 * Polls and live updates touch the tail: the untouched prefix is copied as-is and only the overlap is merged,
 * so no hashing or re-sorting of the whole ring happens.
 */
export function upsertSeries<T extends { time: number }>(existing: readonly T[], incoming: readonly T[], cap: number): T[] {
  if (incoming.length === 0) return existing.slice(-cap);
  const inc = sortedUnique(incoming);
  // a ring that is not strictly ascending (never produced here, but cached data is external input) is rebuilt
  if (!isStrictlyAscending(existing)) return trim(sortedUnique([...existing, ...inc]), cap);
  const from = lowerBound(existing, inc[0]!.time);
  const out = existing.slice(0, from);
  let i = from;
  let j = 0;
  while (i < existing.length && j < inc.length) {
    const a = existing[i]!;
    const b = inc[j]!;
    if (a.time < b.time) {
      out.push(a);
      i++;
    } else {
      out.push(b);
      j++;
      if (a.time === b.time) i++;
    }
  }
  while (i < existing.length) out.push(existing[i++]!);
  while (j < inc.length) out.push(inc[j++]!);
  return trim(out, cap);
}

/**
 * Upsert of ONE point at the tail (the live kline path, several times per second per interval): replaces the last
 * point when the time matches, appends a newer one, and falls back to `upsertSeries` for an out-of-order point.
 * Always returns a new array (consumers detect history changes by identity), trimmed to `cap`.
 */
export function upsertBar<T extends { time: number }>(series: readonly T[], point: T, cap: number): T[] {
  const n = series.length;
  const last = series[n - 1];
  if (!last || point.time > last.time) {
    const out = n + 1 > cap ? series.slice(n + 1 - cap) : series.slice();
    out.push(point);
    return out;
  }
  if (point.time === last.time) {
    const out = trim(series.slice(), cap);
    out[out.length - 1] = point;
    return out;
  }
  return upsertSeries(series, [point], cap);
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
  /**
   * @param periodOf the request period of a feed (futures-data feeds) — part of its persisted key, so the snapshot
   *   of one period never hydrates the series of another
   */
  constructor(
    public symbol: string,
    kv?: KVStore | null,
    private periodOf: (feed: FeedId) => string | undefined = () => undefined,
  ) {
    this.kv = kv === undefined ? idbKV() : kv;
  }

  private key(source: Source, feed: FeedId): string {
    return cacheKey(source, this.symbol, feed, this.periodOf(feed));
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
          v = await this.kv.get(this.key(source, feed));
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
      await this.kv.set(this.key(v.source, feed), v);
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
