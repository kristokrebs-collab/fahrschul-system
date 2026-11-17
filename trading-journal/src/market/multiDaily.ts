/**
 * Daily closes of several symbols (P05 correlation): `useMultiDaily(symbols)` / `requestDaily(symbols)` /
 * `getMultiDaily()` / `subscribeMultiDaily(cb)` / `retryDaily()`.
 *
 * - Budget: AT MOST ONE fetch per symbol and UTC day (memo in memory + IndexedDB `tj-market`, key
 *   `${storageKey("risk-daily")}:${symbol}`, with the UTC day of the fetch). A failed fetch is not repeated that day
 *   either (only `retryDaily()`, the card's "Erneut laden"). The provider's own `kline_1d` series is reused for its
 *   symbol (no fetch at all).
 * - One page of `DAILY_LIMIT` (99) candles per symbol = weight 1, through its OWN token bucket (≤ 10 weight / min),
 *   separate from the live provider's buckets; sequential, never in parallel.
 * - Route: direct Binance; a 451 / CORS / network failure switches the rest of the session to the same-origin proxy
 *   (`/api/binance`), except in the file build (no proxy) – then the honest error.
 * - Closed days only (the forming UTC day is dropped). Symbols are normalised Binance USDT perpetuals ("BTCUSDT").
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DailyClose } from "@/domain/risk/correlation";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import { storageKey } from "@/store/storage";
import { klineWeight, TokenBucket } from "./budget";
import { idbKV, type KVStore } from "./cache";
import { DAILY_FEED } from "./feeds";
import { getFeed, getProvider } from "./marketStore";
import { binanceRest, type BinanceRest } from "./sources/binance";
import { toRestError } from "./sources/http";
import { proxyRest } from "./sources/proxy";

export const DAILY_LIMIT = 99;
export const DAILY_BUDGET = { capacity: 10, windowMs: 60_000 } as const;
export const DAILY_CACHE_PREFIX = storageKey("risk-daily");
/** Symbols fetched at most per request (the correlation card asks for the most traded ones). */
export const DAILY_MAX_SYMBOLS = 10;
const DAY_MS = 86_400_000;

export type DailyState = "idle" | "loading" | "ok" | "error";

export interface MultiDailyView {
  state: DailyState;
  /** closes per symbol (closed UTC days, oldest first) */
  series: Readonly<Record<string, readonly DailyClose[]>>;
  /** symbols that could not be read today */
  failed: readonly string[];
  /** symbols still waiting for their fetch */
  pending: readonly string[];
  viaProxy: boolean;
  detail: string | null;
}

export const DAILY_STRINGS = {
  loading: (n: number) => `Lade Tageskerzen (${n}) …`,
  blocked: "Binance nicht erreichbar (Region/CORS) – kein Proxy in der Datei-Version.",
  failed: (n: number) => `${n} Paar${n === 1 ? "" : "e"} nicht lesbar.`,
} as const;

export interface MultiDailyDeps {
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  kv: () => KVStore | null;
  now: () => number;
}

const defaultDeps = (): MultiDailyDeps => ({
  rest: () => binanceRest(),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest()),
  kv: () => idbKV(),
  now: () => Date.now(),
});

interface Entry {
  day: string;
  closes: DailyClose[];
}

interface Ctl {
  deps: MultiDailyDeps;
  data: Map<string, Entry>;
  /** symbol → UTC day of the last attempt (success or failure) */
  attempted: Map<string, string>;
  failed: Set<string>;
  queue: string[];
  running: Promise<void> | null;
  bucket: TokenBucket | null;
  viaProxy: boolean;
  version: number;
  view: MultiDailyView;
}

const EMPTY: MultiDailyView = { state: "idle", series: {}, failed: [], pending: [], viaProxy: false, detail: null };
const listeners = new Set<() => void>();
const fresh = (deps: MultiDailyDeps = defaultDeps()): Ctl => ({ deps, data: new Map(), attempted: new Map(), failed: new Set(), queue: [], running: null, bucket: null, viaProxy: false, version: 0, view: EMPTY });
let ctl: Ctl = fresh();

/** UTC day key of an instant. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function publish(state?: DailyState): void {
  const series: Record<string, readonly DailyClose[]> = {};
  for (const [s, e] of ctl.data) series[s] = e.closes;
  const failed = [...ctl.failed];
  const pending = [...ctl.queue];
  const allFailed = failed.length > 0 && ctl.data.size === 0 && pending.length === 0;
  const st: DailyState = state ?? (pending.length || ctl.running ? "loading" : allFailed ? "error" : ctl.data.size ? "ok" : "idle");
  ctl.version++;
  ctl.view = {
    state: st,
    series,
    failed,
    pending,
    viaProxy: ctl.viaProxy,
    detail: st === "loading" ? DAILY_STRINGS.loading(pending.length + (ctl.running ? 1 : 0)) : allFailed && !ctl.deps.proxy() ? DAILY_STRINGS.blocked : failed.length ? DAILY_STRINGS.failed(failed.length) : null,
  };
  for (const l of [...listeners]) l();
}

async function take(units: number): Promise<void> {
  const b = (ctl.bucket ??= new TokenBucket(DAILY_BUDGET, ctl.deps.now()));
  for (;;) {
    const now = ctl.deps.now();
    if (b.take(units, now, "price")) return;
    await new Promise<void>((r) => setTimeout(r, Math.max(250, b.waitFor(units, now, "price"))));
  }
}

const closedOnly = (rows: readonly { time: number; close: number }[], now: number): DailyClose[] =>
  rows.filter((c) => c.time + DAY_MS <= now && Number.isFinite(c.close) && c.close > 0).map((c) => ({ t: c.time, c: c.close }));

async function fetchSymbol(symbol: string): Promise<DailyClose[]> {
  await take(klineWeight(DAILY_LIMIT));
  const client = ctl.viaProxy ? ctl.deps.proxy() : ctl.deps.rest();
  if (!client) throw new Error("no client");
  try {
    const res = await client.klines(symbol, "1d", { limit: DAILY_LIMIT });
    return closedOnly(res.data, ctl.deps.now());
  } catch (err) {
    const e = toRestError(err);
    if (e.kind === "rate_limited") ctl.bucket?.backoff(60_000, ctl.deps.now());
    if (!ctl.viaProxy && (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors") && ctl.deps.proxy()) {
      ctl.viaProxy = true;
      return fetchSymbol(symbol);
    }
    throw e;
  }
}

/** The provider's own daily series when it is this symbol (no fetch). */
function fromProvider(symbol: string): DailyClose[] | null {
  const p = getProvider();
  if (!p || p.symbolInfo.binance !== symbol) return null;
  const rows = getFeed(DAILY_FEED)?.data;
  if (!rows || rows.length < 30) return null;
  return closedOnly(rows, ctl.deps.now()).slice(-DAILY_LIMIT);
}

async function fromCache(symbol: string, day: string): Promise<DailyClose[] | null> {
  const kv = ctl.deps.kv();
  if (!kv) return null;
  try {
    const raw = (await kv.get(`${DAILY_CACHE_PREFIX}:${symbol}`)) as { day?: string; closes?: number[][] } | undefined;
    if (!raw || raw.day !== day || !Array.isArray(raw.closes)) return null;
    return raw.closes.map(([t, c]) => ({ t: t!, c: c! })).filter((x) => Number.isFinite(x.t) && x.c > 0);
  } catch {
    return null;
  }
}

async function persist(symbol: string, e: Entry): Promise<void> {
  const kv = ctl.deps.kv();
  if (!kv) return;
  try {
    await kv.set(`${DAILY_CACHE_PREFIX}:${symbol}`, { day: e.day, closes: e.closes.map((x) => [x.t, x.c]) });
  } catch {
    /* private mode / quota: works without the reload cache */
  }
}

async function drain(): Promise<void> {
  const mine = ctl;
  while (mine.queue.length) {
    const symbol = mine.queue[0]!;
    const day = utcDay(mine.deps.now());
    let closes = fromProvider(symbol) ?? (await fromCache(symbol, day));
    if (!closes) {
      mine.attempted.set(symbol, day);
      try {
        closes = await fetchSymbol(symbol);
      } catch {
        closes = null;
      }
    }
    if (ctl !== mine) return; // reset while fetching
    mine.queue.shift();
    if (closes && closes.length > 1) {
      const e = { day, closes };
      mine.data.set(symbol, e);
      mine.failed.delete(symbol);
      void persist(symbol, e);
    } else mine.failed.add(symbol);
    publish();
  }
}

/** Asks for the symbols' daily closes (memoised per UTC day; the rest is fetched in the background). */
export function requestDaily(symbols: readonly string[]): Promise<void> {
  const day = utcDay(ctl.deps.now());
  let added = false;
  for (const s of symbols.slice(0, DAILY_MAX_SYMBOLS)) {
    if (ctl.data.get(s)?.day === day) continue;
    if (ctl.queue.includes(s)) continue;
    if (ctl.attempted.get(s) === day && ctl.failed.has(s)) continue;
    ctl.queue.push(s);
    added = true;
  }
  if (!added) return ctl.running ?? Promise.resolve();
  publish("loading");
  if (!ctl.running) {
    const mine = ctl;
    mine.running = drain().finally(() => {
      if (ctl !== mine) return;
      mine.running = null;
      publish();
    });
  }
  return ctl.running ?? Promise.resolve();
}

/** "Erneut laden": failed symbols may be fetched once more today. */
export function retryDaily(): Promise<void> {
  const failed = [...ctl.failed];
  for (const s of failed) ctl.attempted.delete(s);
  ctl.failed.clear();
  return requestDaily(failed);
}

export function getMultiDaily(): MultiDailyView {
  return ctl.view;
}

export function subscribeMultiDaily(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Daily closes of `symbols` (fetched on mount / when the list changes; at most once per symbol and UTC day). */
export function useMultiDaily(symbols: readonly string[]): MultiDailyView {
  const key = symbols.join(",");
  useEffect(() => {
    if (key) void requestDaily(key.split(","));
  }, [key]);
  const view = useSyncExternalStore(subscribeMultiDaily, getMultiDaily, getMultiDaily);
  return useMemo(() => {
    const want = key ? key.split(",") : [];
    const series: Record<string, readonly DailyClose[]> = {};
    for (const s of want) if (view.series[s]) series[s] = view.series[s]!;
    return { ...view, series, failed: view.failed.filter((s) => want.includes(s)), pending: view.pending.filter((s) => want.includes(s)) };
  }, [view, key]);
}

/** Tests: fresh state with injected deps. */
export function __resetMultiDaily(deps?: Partial<MultiDailyDeps>): void {
  ctl = fresh({ ...defaultDeps(), ...deps });
  listeners.clear();
}
