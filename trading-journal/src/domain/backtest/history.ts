/**
 * Historic klines and funding for the lab (P07): paging + cache logic with injected I/O (the fetcher and the store are
 * passed in – `src/views/labor/historySource.ts` wires Binance REST through the market layer's clients and budget, and
 * IndexedDB). Rules:
 *
 * - CLOSED bars only (a bar whose close lies after `now` is never stored or returned).
 * - A series is cached per symbol and interval; a later run only fetches what is missing before the cached head or
 *   after the cached tail (closed bars never change). The earliest bar the exchange has (listing) is remembered, so a
 *   period that reaches before it does not fetch again and again.
 * - Pages run forward from `startTime` (Binance semantics: the first `limit` bars from it), sequentially, and stop on
 *   an empty page; an `AbortSignal` is checked between pages.
 */
import { cleanBars } from "./bars";
import type { Bar, FundingPoint, HistInterval } from "./types";
import { HIST_MS } from "./types";

export interface KlineQuery {
  symbol: string;
  interval: HistInterval;
  startTime: number;
  limit: number;
}

/** Fetches one page (ascending bars, `t` in seconds). */
export type KlinePager = (q: KlineQuery) => Promise<Bar[]>;
/** Fetches one funding page from `startTime` (ascending). */
export type FundingPager = (q: { symbol: string; startTime: number; limit: number }) => Promise<FundingPoint[]>;

export interface SeriesStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export const KLINE_PAGE = 1500;
export const FUNDING_PAGE = 1000;
/** Newest bars kept per cached series (15m for ~4 years). */
export const CACHE_MAX_BARS = 150_000;

export interface LoadProgress {
  /** pages fetched so far / estimated in total */
  done: number;
  total: number;
}

export interface LoadKlinesOptions {
  symbol: string;
  interval: HistInterval;
  /** ms: first bar open wanted, last bar open wanted */
  from: number;
  to: number;
  now: number;
  fetchPage: KlinePager;
  store?: SeriesStore | null;
  /** cache key prefix (namespaced by the caller) */
  prefix?: string;
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
}

export interface Loaded<T> {
  data: T[];
  /** pages fetched from the exchange (0 = all from the cache) */
  fetched: number;
  /** earliest time the exchange has data for (listing), when known */
  origin: number | null;
}

interface CachedSeries {
  v: 1;
  /** rows [t(s), o, h, l, c, v] */
  bars: number[][];
  origin?: number | null;
}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

function parseCached(raw: unknown): { bars: Bar[]; origin: number | null } {
  if (!raw || typeof raw !== "object" || (raw as CachedSeries).v !== 1 || !Array.isArray((raw as CachedSeries).bars)) return { bars: [], origin: null };
  const c = raw as CachedSeries;
  const bars: Bar[] = [];
  for (const r of c.bars) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const [t, o, h, l, cl, v] = r as number[];
    bars.push({ t: t!, o: o!, h: h!, l: l!, c: cl!, ...(Number.isFinite(v) ? { v: v! } : {}) });
  }
  return { bars: cleanBars(bars), origin: typeof c.origin === "number" ? c.origin : null };
}

/** Open time (ms) of the newest CLOSED bar at `now`. */
export const lastClosedOpen = (now: number, ivMs: number): number => Math.floor(now / ivMs) * ivMs - ivMs;

/** Pages needed for a span of bars. */
const pagesFor = (fromMs: number, toMs: number, ivMs: number): number => (toMs < fromMs ? 0 : Math.ceil((Math.floor((toMs - fromMs) / ivMs) + 1) / KLINE_PAGE));

export async function loadKlines(o: LoadKlinesOptions): Promise<Loaded<Bar>> {
  const iv = HIST_MS[o.interval];
  const key = `${o.prefix ?? "bt"}:${o.symbol}:${o.interval}`;
  const from = Math.floor(o.from / iv) * iv;
  const end = Math.min(Math.floor(o.to / iv) * iv, lastClosedOpen(o.now, iv));
  let cached: { bars: Bar[]; origin: number | null } = { bars: [], origin: null };
  if (o.store) {
    try {
      cached = parseCached(await o.store.get(key));
    } catch {
      /* no cache: fetch */
    }
  }
  let origin = cached.origin;
  const segs: [number, number][] = [];
  const first = cached.bars[0]?.t;
  const last = cached.bars[cached.bars.length - 1]?.t;
  const wantFrom = origin != null ? Math.max(from, origin) : from;
  if (first == null || last == null) {
    if (end >= wantFrom) segs.push([wantFrom, end]);
  } else {
    if (wantFrom < first * 1000) segs.push([wantFrom, first * 1000 - iv]);
    if (end > last * 1000) segs.push([last * 1000 + iv, end]);
  }
  const total = segs.reduce((s, [a, b]) => s + pagesFor(a, b, iv), 0);
  let done = 0;
  o.onProgress?.({ done, total });
  const fresh: Bar[] = [];
  for (const [a, b] of segs) {
    let start = a;
    let firstOfSeg = true;
    while (start <= b) {
      if (o.signal?.aborted) throw abortError();
      const page = await o.fetchPage({ symbol: o.symbol, interval: o.interval, startTime: start, limit: KLINE_PAGE });
      done++;
      o.onProgress?.({ done, total: Math.max(total, done) });
      const rows = page.filter((x) => x.t * 1000 <= b);
      if (firstOfSeg && a === wantFrom && (rows.length === 0 || rows[0]!.t * 1000 > a)) {
        // the exchange has nothing before this bar: the listing
        origin = rows.length ? rows[0]!.t * 1000 : (origin ?? null);
      }
      firstOfSeg = false;
      if (!rows.length) break;
      fresh.push(...rows);
      const nextStart = rows[rows.length - 1]!.t * 1000 + iv;
      if (nextStart <= start || page.length < 1) break;
      start = nextStart;
    }
  }
  const closedBefore = o.now;
  let all = cleanBars([...cached.bars, ...fresh]).filter((x) => x.t * 1000 + iv <= closedBefore);
  if (all.length > CACHE_MAX_BARS) all = all.slice(all.length - CACHE_MAX_BARS);
  if (o.store && fresh.length) {
    try {
      await o.store.set(key, { v: 1, origin, bars: all.map((x) => [x.t, x.o, x.h, x.l, x.c, x.v ?? 0]) } satisfies CachedSeries);
    } catch {
      /* quota / private mode: works without the cache */
    }
  }
  return { data: all.filter((x) => x.t * 1000 >= from && x.t * 1000 <= end), fetched: done, origin };
}

export interface LoadFundingOptions {
  symbol: string;
  from: number;
  to: number;
  now: number;
  fetchPage: FundingPager;
  store?: SeriesStore | null;
  prefix?: string;
  signal?: AbortSignal;
}

/** Funding settlements of `symbol` in [from, to] (cached like the klines; settlements in the past never change). */
export async function loadFunding(o: LoadFundingOptions): Promise<Loaded<FundingPoint>> {
  const key = `${o.prefix ?? "bt"}:${o.symbol}:funding`;
  let pts: FundingPoint[] = [];
  let origin: number | null = null;
  if (o.store) {
    try {
      const raw = (await o.store.get(key)) as { v?: number; pts?: number[][]; origin?: number | null } | undefined;
      if (raw && raw.v === 1 && Array.isArray(raw.pts)) {
        pts = raw.pts.filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1])).map(([t, rate]) => ({ t: t!, rate: rate! }));
        origin = typeof raw.origin === "number" ? raw.origin : null;
      }
    } catch {
      /* fetch */
    }
  }
  const end = Math.min(o.to, o.now);
  const wantFrom = origin != null ? Math.max(o.from, origin) : o.from;
  const segs: [number, number][] = [];
  const first = pts[0]?.t;
  const last = pts[pts.length - 1]?.t;
  if (first == null || last == null) segs.push([wantFrom, end]);
  else {
    if (wantFrom < first - 8 * 3_600_000) segs.push([wantFrom, first - 1]);
    if (end > last + 8 * 3_600_000) segs.push([last + 1, end]);
  }
  let fetched = 0;
  const fresh: FundingPoint[] = [];
  for (const [a, b] of segs) {
    let start = a;
    let firstOfSeg = true;
    while (start <= b) {
      if (o.signal?.aborted) throw abortError();
      const page = await o.fetchPage({ symbol: o.symbol, startTime: start, limit: FUNDING_PAGE });
      fetched++;
      const rows = page.filter((p) => p.t <= b && Number.isFinite(p.rate));
      if (firstOfSeg && a === wantFrom && (rows.length === 0 || rows[0]!.t > a + 8 * 3_600_000)) origin = rows.length ? rows[0]!.t : origin;
      firstOfSeg = false;
      if (!rows.length) break;
      fresh.push(...rows);
      const next = rows[rows.length - 1]!.t + 1;
      if (next <= start) break;
      start = next;
    }
  }
  const map = new Map<number, number>();
  for (const p of [...pts, ...fresh]) map.set(p.t, p.rate);
  const all = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, rate]) => ({ t, rate }));
  if (o.store && fresh.length) {
    try {
      await o.store.set(key, { v: 1, origin, pts: all.map((p) => [p.t, p.rate]) });
    } catch {
      /* without the cache */
    }
  }
  return { data: all.filter((p) => p.t >= o.from && p.t <= end), fetched, origin };
}

/** Pages a load of `interval` over [from, to] costs at most (for the budget hint before a run). */
export function estimatePages(interval: HistInterval, from: number, to: number): number {
  return pagesFor(from, to, HIST_MS[interval]);
}
