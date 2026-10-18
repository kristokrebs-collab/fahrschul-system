/**
 * Real history for the lab (P07): Binance USDⓈ-M klines and funding through the market layer's REST clients
 * (`binanceRest`, same-origin `proxyRest` on a 451 / CORS / network failure – never in the file build), on the lab's
 * OWN token bucket (`LAB_BUDGET`, sequential pages, separate from the live provider's budget) and cached in the market
 * IndexedDB (`tj-market`, keys `${storageKey("labor")}:{symbol}:{interval}`): closed bars never change, so a second run
 * only fetches the new tail. The paging / cache rules are the pure `loadKlines` / `loadFunding`
 * (`@/domain/backtest/index`).
 */
import { deriveBars, estimatePages, HIST_MS, loadFunding, loadKlines, sourceIntervals, type Bar, type BarsBy, type FundingPoint, type HistInterval, type SeriesStore } from "@/domain/backtest/index";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import type { FetchInterval } from "@/market/period";
import { klineWeight, TokenBucket } from "@/market/budget";
import { idbKV } from "@/market/cache";
import { binanceRest, type BinanceRest } from "@/market/sources/binance";
import { toRestError } from "@/market/sources/http";
import { proxyRest } from "@/market/sources/proxy";
import { storageKey } from "@/store/storage";

/** The lab's own Binance budget: 300 weight per minute (a 1500-bar page weighs 10; Binance allows 2400 per IP). */
export const LAB_BUDGET = { capacity: 300, windowMs: 60_000 } as const;
export const LAB_CACHE_PREFIX = storageKey("labor");

export interface HistoryDeps {
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  store: () => SeriesStore | null;
  now: () => number;
}

const defaultDeps = (): HistoryDeps => ({
  rest: () => binanceRest(),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest()),
  store: () => {
    const kv = idbKV();
    return kv ? { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) } : null;
  },
  now: () => Date.now(),
});

let deps: HistoryDeps = defaultDeps();
let bucket: TokenBucket | null = null;
let viaProxy = false;

/** Test hook: other deps (mocked REST / store / clock); resets the budget and the proxy switch. */
export function __setHistoryDeps(d: Partial<HistoryDeps> | null): void {
  deps = d ? { ...defaultDeps(), ...d } : defaultDeps();
  bucket = null;
  viaProxy = false;
}

async function take(units: number, signal?: AbortSignal): Promise<void> {
  const b = (bucket ??= new TokenBucket(LAB_BUDGET, deps.now()));
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const now = deps.now();
    if (b.take(units, now, "price")) return;
    await new Promise<void>((r) => setTimeout(r, Math.max(200, b.waitFor(units, now, "price"))));
  }
}

/** Runs `fn` on Binance, switching the rest of the session to the proxy on a 451 / CORS / network failure. */
async function withRoute<T>(fn: (c: BinanceRest) => Promise<T>): Promise<T> {
  const client = viaProxy ? deps.proxy() : deps.rest();
  if (!client) throw toRestError(new TypeError("Failed to fetch"));
  try {
    return await fn(client);
  } catch (err) {
    const e = toRestError(err);
    if (e.kind === "rate_limited") bucket?.backoff(60_000, deps.now());
    if (!viaProxy && (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors") && deps.proxy()) {
      viaProxy = true;
      return withRoute(fn);
    }
    throw e;
  }
}

const toBar = (c: { time: number; open: number; high: number; low: number; close: number; volume?: number }): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, ...(Number.isFinite(c.volume) ? { v: c.volume } : {}) });

export interface LoadRequest {
  symbol: string;
  intervals: readonly HistInterval[];
  /** ms: first bar wanted (start − warm-up) and the end */
  from: number;
  to: number;
  funding: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface LoadedData {
  data: BarsBy;
  funding: FundingPoint[] | null;
  pages: number;
  viaProxy: boolean;
}

/** Loads every interval (sequentially) and, when asked, the funding history. */
export async function loadLabData(req: LoadRequest): Promise<LoadedData> {
  const store = deps.store();
  const now = deps.now();
  // 30m / 2h are built from 15m / 1h: the exchange is asked for the source intervals only
  const sources = sourceIntervals(req.intervals);
  const est = sources.reduce((s, iv) => s + estimatePages(iv, req.from, Math.min(req.to, now)), 0);
  let done = 0;
  let data: BarsBy = {};
  for (const interval of sources) {
    const base = done;
    const res = await loadKlines({
      symbol: req.symbol,
      interval,
      from: req.from,
      to: req.to,
      now,
      store,
      prefix: LAB_CACHE_PREFIX,
      signal: req.signal,
      onProgress: (p) => req.onProgress?.(base + p.done, Math.max(est, base + p.total)),
      fetchPage: async (q) => {
        await take(klineWeight(q.limit), req.signal);
        const page = await withRoute((c) => c.klines(q.symbol, q.interval as FetchInterval, { startTime: q.startTime, limit: q.limit }));
        return page.data.filter((c) => (c.closed ?? true) && c.time + intervalMs(q.interval) <= deps.now()).map(toBar);
      },
    });
    done += res.fetched;
    data[interval] = res.data;
  }
  data = deriveBars(data, req.intervals);
  let funding: FundingPoint[] | null = null;
  if (req.funding) {
    try {
      const f = await loadFunding({
        symbol: req.symbol,
        from: req.from,
        to: req.to,
        now,
        store,
        prefix: LAB_CACHE_PREFIX,
        signal: req.signal,
        fetchPage: async (q) => {
          await take(1, req.signal);
          const page = await withRoute((c) => c.fundingRate(q.symbol, { startTime: q.startTime, limit: q.limit }));
          return page.data.map((p) => ({ t: p.time, rate: p.fundingRate }));
        },
      });
      funding = f.data.length ? f.data : null;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      funding = null; // the run uses the flat assumption and says so
    }
  }
  return { data, funding, pages: done, viaProxy };
}

const intervalMs = (iv: HistInterval): number => HIST_MS[iv];

/** German message of a load error. */
export function loadErrorKind(err: unknown): "blocked" | "rate" | "symbol" | "failed" {
  const e = toRestError(err);
  if (e.kind === "rate_limited") return "rate";
  if (e.kind === "bad_symbol" || e.status === 400) return "symbol";
  if (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors" || e.kind === "timeout" || e.kind === "offline") return "blocked";
  return "failed";
}
