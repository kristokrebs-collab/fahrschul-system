/**
 * Real history for the lab (P07): Binance USDⓈ-M klines and funding through the market layer's REST clients, on the
 * lab's OWN token buckets (sequential pages, separate from the live provider's budget) and cached in the market
 * IndexedDB (`tj-market`, keys `${storageKey("labor")}:{symbol}:{interval}`): closed bars never change, so a second run
 * only fetches the new tail. The paging / cache rules are the pure `loadKlines` / `loadFunding`
 * (`@/domain/backtest/index`).
 *
 * A load can never hang (the cause of "Lade Kerzen 0 von 2 …" for ever):
 *  - EVERY request has a time limit that covers the whole answer, headers AND body (`HistoryTiming.timeoutMs`, 12 s), and it
 *    is enforced here as well as in the client – a client that ignores its signal cannot keep the load waiting;
 *  - the cancel button (`signal`) ends the request under way and any pause (back-off, budget wait) at once;
 *  - a failed request is repeated a limited number of times with a growing pause – only where a repeat can help (see
 *    `attemptsFor`): a host that hangs on the very first page is not asked again, the next source is;
 *  - the budget wait is capped (`maxBudgetWaitMs`) – a long ban is an error with a reason, not a silent minute;
 *  - what is going on is reported (`onStatus`): which source, which attempt, what comes next. Progress is real pages.
 *
 * Fallback chain (`LoadRequest.fallback`, the Labor run only; other consumers stop after the EU proxy and keep their
 * "Binance" wording), the source that really served the candles is named in the result (`LoadedData.source`):
 *   1. `binance`  Binance USDⓈ-M futures, direct
 *   2. `proxy`    the same futures series through the app's same-origin EU proxy (`/api/binance`, netlify.toml)
 *   3. `bybit`    Bybit USDT perpetual (another exchange: close, not equal)
 *   4. `spot`     Binance SPOT (`data-api.binance.vision`) – NOT futures: the price differs by the basis, no funding
 *   5. `spot-app` the same spot rows through the app's own function (`/api/v1/klines`) when the browser cannot reach the host
 * Each source has its own cache namespace (spot candles never end up in the futures series); one load uses ONE source for
 * all its intervals – a run never mixes venues. `bad_symbol` ends the chain (a typo is not a reason to swap markets).
 */
import { deriveBars, estimatePages, HIST_MS, KLINE_PAGE, loadFunding, loadKlines, sourceIntervals, type Bar, type BarsBy, type FundingPoint, type HistInterval, type KlineQuery, type SeriesStore } from "@/domain/backtest/index";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import type { FetchInterval } from "@/market/period";
import { klineWeight, TokenBucket } from "@/market/budget";
import { idbKV } from "@/market/cache";
import { binanceRest, type BinanceRest } from "@/market/sources/binance";
import { spotRest, SPOT_PAGE, type SpotRest } from "@/market/sources/binanceSpot";
import { bybitRest, type BybitRest } from "@/market/sources/bybit";
import { RestError, toRestError } from "@/market/sources/http";
import { proxyRest } from "@/market/sources/proxy";
import { toBybitSymbol } from "@/market/symbol";
import type { Candle, FailureReason } from "@/market/types";
import { storageKey } from "@/store/storage";

/** The lab's own Binance budget: 300 weight per minute (a 1500-bar page weighs 10; Binance allows 2400 per IP). */
export const LAB_BUDGET = { capacity: 300, windowMs: 60_000 } as const;
export const LAB_CACHE_PREFIX = storageKey("labor");

// ------------------------------------------------------------------ sources

export type HistorySource = "binance" | "proxy" | "bybit" | "spot" | "spot-app";

export interface HistorySourceInfo {
  id: HistorySource;
  /** where the candles come from: the Binance USDⓈ-M series, Bybit's perpetual or the Binance spot market */
  market: "futures" | "bybit" | "spot";
  /** one word for badges and the comparison ("Futures", "Bybit", "Spot") */
  short: string;
  /** name inside a sentence */
  name: string;
  /** the Binance USDⓈ-M series (direct or through the proxy): only this one has the funding history and the Labor's default wording */
  futures: boolean;
  /** bars per page the source gives at most */
  pageSize: number;
  /** the text of the "Quelle:" line of a finished run */
  stand: string;
}

export const HISTORY_SOURCES: Readonly<Record<HistorySource, HistorySourceInfo>> = {
  binance: { id: "binance", market: "futures", short: "Futures", name: "Binance-Futures", futures: true, pageSize: KLINE_PAGE, stand: "Binance USDⓈ-M, geschlossene Kerzen" },
  proxy: { id: "proxy", market: "futures", short: "Futures", name: "Binance-Futures (über den EU-Proxy der App)", futures: true, pageSize: KLINE_PAGE, stand: "Binance USDⓈ-M über den EU-Proxy der App, geschlossene Kerzen" },
  bybit: { id: "bybit", market: "bybit", short: "Bybit", name: "Bybit (USDT-Perp, eine andere Börse)", futures: false, pageSize: SPOT_PAGE, stand: "Bybit USDT-Perp, nicht Binance, geschlossene Kerzen" },
  spot: { id: "spot", market: "spot", short: "Spot", name: "Binance Spot, nicht Futures", futures: false, pageSize: SPOT_PAGE, stand: "Spot, nicht Futures (Binance), geschlossene Kerzen" },
  "spot-app": { id: "spot-app", market: "spot", short: "Spot", name: "Binance Spot, nicht Futures (über den Server der App)", futures: false, pageSize: SPOT_PAGE, stand: "Spot, nicht Futures (Binance, über den Server der App), geschlossene Kerzen" },
};

/** The sources the Labor run walks through, best first. */
export const FALLBACK_CHAIN: readonly HistorySource[] = ["binance", "proxy", "bybit", "spot", "spot-app"];
/** Everybody else (signal checks, replay, studio …): Binance-Futures only, directly or through the proxy. */
export const FUTURES_CHAIN: readonly HistorySource[] = ["binance", "proxy"];

/** Cache namespace of a source: the futures series (direct and proxy are the same rows) keeps the old keys. */
export const cachePrefixOf = (source: HistorySource): string => (HISTORY_SOURCES[source].futures ? LAB_CACHE_PREFIX : `${LAB_CACHE_PREFIX}:${HISTORY_SOURCES[source].market}`);

// ------------------------------------------------------------------ timing, dependencies

export interface HistoryTiming {
  /** one request, whole answer (ms) */
  timeoutMs: number;
  /** pauses before the 2nd, 3rd … attempt (ms) */
  backoffMs: readonly number[];
  /** longest wait for budget tokens before the load gives up on the source */
  maxBudgetWaitMs: number;
  /** how long a source that timed out is skipped by the next load (it is asked again afterwards, and by "Erneut versuchen" at once) */
  skipMemoMs: number;
}

export const HISTORY_TIMING: HistoryTiming = { timeoutMs: 12_000, backoffMs: [800, 2_400], maxBudgetWaitMs: 20_000, skipMemoMs: 60_000 };

export interface HistoryDeps {
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  bybit: () => BybitRest | null;
  spot: () => SpotRest | null;
  spotApp: () => SpotRest | null;
  store: () => SeriesStore | null;
  now: () => number;
  timing: HistoryTiming;
}

const defaultDeps = (): HistoryDeps => ({
  rest: () => binanceRest(),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest()),
  bybit: () => bybitRest(),
  spot: () => spotRest(),
  spotApp: () => (IS_FILE_BUILD || isFileProtocol() ? null : spotRest({ viaApp: true })),
  store: () => {
    const kv = idbKV();
    return kv ? { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) } : null;
  },
  now: () => Date.now(),
  timing: HISTORY_TIMING,
});

let deps: HistoryDeps = defaultDeps();
const buckets = new Map<string, TokenBucket>();
/** sources that hung on their last load → until when the next load skips them */
const skipUntil = new Map<HistorySource, { until: number; kind: FailureReason }>();

/**
 * Test hook: other deps (mocked REST / store / clock). A given object replaces the WHOLE chain: the fallback sources
 * (Bybit, spot) are off unless the test passes them – a test never reaches for the real network by accident. `null`
 * restores the real thing. Resets the budgets and the skip memory.
 */
export function __setHistoryDeps(d: Partial<HistoryDeps> | null): void {
  deps = d ? { ...defaultDeps(), bybit: () => null, spot: () => null, spotApp: () => null, ...d } : defaultDeps();
  buckets.clear();
  skipUntil.clear();
}

/** "Erneut versuchen": forget which sources hung, ask all of them again. */
export function forgetRoutes(): void {
  skipUntil.clear();
}

function bucketOf(source: HistorySource): TokenBucket {
  const key = source === "proxy" ? "binance" : source === "spot-app" ? "spot" : source;
  let b = buckets.get(key);
  if (!b) {
    b = new TokenBucket(key === "bybit" ? { capacity: 60, windowMs: 10_000 } : LAB_BUDGET, deps.now());
    buckets.set(key, b);
  }
  return b;
}

// ------------------------------------------------------------------ status, errors

/** What the load is doing right now (for the Labor's status line). `at` = wall clock ms when this step began. */
export type LoadStatus =
  | { step: "request"; source: HistorySource; attempt: number; at: number; prev?: StageFailure }
  | { step: "retry"; source: HistorySource; attempt: number; reason: FailureReason; inMs: number; at: number }
  | { step: "switch"; from: HistorySource; to: HistorySource; reason: FailureReason; at: number }
  | { step: "budget"; source: HistorySource; inMs: number; at: number };

/** One source that did not deliver. `skipped`: not asked this time because it hung on the load before. */
export interface StageFailure {
  source: HistorySource;
  kind: FailureReason;
  status?: number;
  skipped?: boolean;
  /** the time limit that ran out (ms), for a `timeout` */
  limitMs?: number;
}

/** The whole chain failed: `kind` is the most telling reason (a network-type one first), `failures` lists every source asked. */
export class LabLoadError extends RestError {
  constructor(
    readonly failures: readonly StageFailure[],
    kind: FailureReason,
    message: string,
    status?: number,
  ) {
    super(kind, message, status);
    this.name = "LabLoadError";
  }
}

const NETWORKISH: ReadonlySet<FailureReason> = new Set(["blocked_451", "timeout", "network", "cors", "offline"]);

function summarize(failures: readonly StageFailure[]): LabLoadError {
  const lead = failures.find((f) => NETWORKISH.has(f.kind)) ?? failures[failures.length - 1] ?? { kind: "network" as FailureReason };
  return new LabLoadError(failures, lead.kind, `Kerzen nicht ladbar: ${failures.map((f) => `${f.source}=${f.kind}`).join(", ") || lead.kind}`, lead.kind === "blocked_451" ? 451 : undefined);
}

/** The per-source failures of a load error (empty for any other error). */
export const failuresOf = (err: unknown): readonly StageFailure[] => (err instanceof LabLoadError ? err.failures : []);

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** How many attempts a request gets after it failed with `kind`; a source that has not answered yet is given up on sooner. */
export function attemptsFor(kind: FailureReason, proven: boolean): number {
  switch (kind) {
    case "blocked_451":
    case "bad_symbol":
    case "bad_period":
    case "cors":
    case "offline":
    case "unsupported":
      return 1; // a repeat gives the same answer
    case "timeout":
      return proven ? 3 : 1; // a host that hangs on its first page is not asked again: the next source is
    case "rate_limited":
      return proven ? 2 : 1;
    case "network":
    case "http_5xx":
      return proven ? 3 : 2;
    default:
      return 2;
  }
}

/** Sleeps `ms`; ends at once (with an `AbortError`) when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `run` with a time limit and the caller's cancel signal. Settles when the first of these happens – the work itself
 * finishing, the limit (a `timeout` RestError, the work's own signal aborted) or the caller's abort (an `AbortError`).
 * A `run` that ignores its signal and never answers cannot hold the caller any longer than `timeoutMs`.
 */
export function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, user?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (user?.aborted) return reject(abortError());
    const ctl = new AbortController();
    let settled = false;
    const end = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      user?.removeEventListener("abort", onUser);
      fn();
    };
    const onUser = (): void =>
      end(() => {
        ctl.abort();
        reject(abortError());
      });
    const timer = setTimeout(
      () =>
        end(() => {
          ctl.abort();
          reject(new RestError("timeout", `Keine Antwort in ${Math.round(timeoutMs / 1000)} s`));
        }),
      timeoutMs,
    );
    user?.addEventListener("abort", onUser, { once: true });
    let p: Promise<T>;
    try {
      p = run(ctl.signal);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => end(() => resolve(v)),
      (e) => end(() => reject(user?.aborted ? abortError() : toRestError(e))),
    );
  });
}

// ------------------------------------------------------------------ one source

const toBar = (c: { time: number; open: number; high: number; low: number; close: number; volume?: number }): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, ...(Number.isFinite(c.volume) ? { v: c.volume } : {}) });

export interface LoadRequest {
  symbol: string;
  intervals: readonly HistInterval[];
  /** ms: first bar wanted (start − warm-up) and the end */
  from: number;
  to: number;
  funding: boolean;
  signal?: AbortSignal;
  /** pages fetched / expected for the source that is loading now (starts again at 0 when the load moves to the next source) */
  onProgress?: (done: number, total: number) => void;
  /** may the load fall back to Bybit and Binance spot when Binance-Futures does not answer? Only the Labor run says yes. */
  fallback?: boolean;
  onStatus?: (s: LoadStatus) => void;
}

export interface LoadedData {
  data: BarsBy;
  funding: FundingPoint[] | null;
  pages: number;
  /** the candles came through the app's EU proxy (`source === "proxy"`) */
  viaProxy: boolean;
  /** the source that really served the candles (the cache of a source counts as that source) */
  source: HistorySource;
  /** sources asked before it that did not deliver, with the reason */
  failed: readonly StageFailure[];
}

interface Stage {
  /** requests of this load that succeeded: a source that answered once is worth a few more attempts */
  proven: boolean;
  /** the source asked just before this one and why it did not deliver (the status line keeps saying it while this one works) */
  prev?: StageFailure;
}

/** One request with budget, time limit, retries and status reports. */
async function request<T>(source: HistorySource, weight: number, run: (signal: AbortSignal) => Promise<T>, req: LoadRequest, stage: Stage, maxAttempts = Infinity): Promise<T> {
  const timing = deps.timing;
  for (let attempt = 1; ; attempt++) {
    await takeBudget(source, weight, req);
    req.onStatus?.({ step: "request", source, attempt, at: Date.now(), ...(stage.prev ? { prev: stage.prev } : {}) });
    try {
      const v = await withDeadline(run, timing.timeoutMs, req.signal);
      stage.proven = true;
      return v;
    } catch (e) {
      if (req.signal?.aborted || isAbort(e)) throw abortError();
      const err = toRestError(e);
      if (err.kind === "rate_limited") bucketOf(source).backoff(5_000, deps.now());
      if (attempt >= Math.min(maxAttempts, attemptsFor(err.kind, stage.proven))) throw err;
      const inMs = timing.backoffMs[Math.min(attempt - 1, timing.backoffMs.length - 1)] ?? 1_000;
      req.onStatus?.({ step: "retry", source, attempt: attempt + 1, reason: err.kind, inMs, at: Date.now() });
      await sleep(inMs, req.signal);
    }
  }
}

/** Waits for `units` of the source's budget – but never longer than `maxBudgetWaitMs`; abortable. */
async function takeBudget(source: HistorySource, units: number, req: LoadRequest): Promise<void> {
  const b = bucketOf(source);
  for (;;) {
    if (req.signal?.aborted) throw abortError();
    const now = deps.now();
    if (b.take(units, now, "price")) return;
    const wait = Math.max(200, b.waitFor(units, now, "price"));
    if (wait > deps.timing.maxBudgetWaitMs) throw new RestError("rate_limited", "Abruf-Budget erschöpft");
    req.onStatus?.({ step: "budget", source, inMs: wait, at: Date.now() });
    await sleep(Math.min(wait, 1_000), req.signal);
  }
}

const keepClosed = (iv: HistInterval, now: number) => (c: Candle) => (c.closed ?? true) && c.time + HIST_MS[iv] <= now;

/** Bybit has no "first `limit` bars from startTime": a window [start, start + limit·iv) is read; empty / short windows (before the listing) are skipped on. */
const BYBIT_MAX_HOPS = 8;

async function pageOf(source: HistorySource, q: KlineQuery, req: LoadRequest, stage: Stage): Promise<Bar[]> {
  const now = deps.now();
  const timeoutMs = deps.timing.timeoutMs;
  const keep = keepClosed(q.interval, now);
  const interval = q.interval as FetchInterval;
  switch (source) {
    case "binance":
    case "proxy": {
      const rows = await request(source, klineWeight(q.limit), async (signal) => {
        const c = source === "binance" ? deps.rest() : deps.proxy();
        if (!c) throw new RestError("network", "Kein Zugang");
        return (await c.klines(q.symbol, interval, { startTime: q.startTime, limit: q.limit, signal, timeoutMs })).data;
      }, req, stage);
      return rows.filter(keep).map(toBar);
    }
    case "spot":
    case "spot-app": {
      const rows = await request(source, 2, async (signal) => {
        const c = source === "spot" ? deps.spot() : deps.spotApp();
        if (!c) throw new RestError("network", "Kein Zugang");
        return c.klines(q.symbol, interval, { startTime: q.startTime, limit: q.limit, signal, timeoutMs });
      }, req, stage);
      return rows.filter(keep).map(toBar);
    }
    case "bybit": {
      const sym = toBybitSymbol(q.symbol);
      if (!sym) throw new RestError("bad_symbol", "Kein USDT-Perp");
      const ivMs = HIST_MS[q.interval];
      const out: Candle[] = [];
      let start = q.startTime;
      for (let hop = 0; hop < BYBIT_MAX_HOPS && out.length < q.limit && start <= now; hop++) {
        const want = q.limit - out.length;
        const end = Math.min(start + want * ivMs - 1, now);
        const rows = await request(source, 1, async (signal) => {
          const c = deps.bybit();
          if (!c) throw new RestError("network", "Kein Zugang");
          return (await c.klines(sym, interval, { start, end, limit: Math.min(1_000, want), signal, timeoutMs })).data;
        }, req, stage);
        out.push(...rows);
        start = end + 1;
      }
      return out.filter(keep).map(toBar);
    }
  }
}

async function fundingPageOf(source: HistorySource, q: { symbol: string; startTime: number; limit: number }, req: LoadRequest, stage: Stage): Promise<FundingPoint[]> {
  const page = await request(source, 1, async (signal) => {
    const c = source === "binance" ? deps.rest() : deps.proxy();
    if (!c) throw new RestError("network", "Kein Zugang");
    return (await c.fundingRate(q.symbol, { startTime: q.startTime, limit: q.limit, signal, timeoutMs: deps.timing.timeoutMs })).data;
  }, req, stage, 2);
  return page.map((p) => ({ t: p.time, rate: p.fundingRate }));
}

/** Loads every interval (and, on a futures source, the funding history) from ONE source. */
async function loadFrom(source: HistorySource, req: LoadRequest, prev?: StageFailure): Promise<Pick<LoadedData, "data" | "funding" | "pages">> {
  const info = HISTORY_SOURCES[source];
  const store = deps.store();
  const now = deps.now();
  const prefix = cachePrefixOf(source);
  const stage: Stage = { proven: false, ...(prev ? { prev } : {}) };
  // 30m / 2h are built from 15m / 1h: the exchange is asked for the source intervals only
  const sources = sourceIntervals(req.intervals);
  // pages the intervals AFTER the current one may still need (an upper bound – their cache is not read yet); the current one is exact
  const later = sources.map((_, i) => sources.slice(i + 1).reduce((s, iv) => s + estimatePages(iv, req.from, Math.min(req.to, now), info.pageSize), 0));
  let done = 0;
  let data: BarsBy = {};
  for (const [at, interval] of sources.entries()) {
    const base = done;
    const res = await loadKlines({
      symbol: req.symbol,
      interval,
      from: req.from,
      to: req.to,
      now,
      store,
      prefix,
      signal: req.signal,
      pageSize: info.pageSize,
      onProgress: (p) => req.onProgress?.(base + p.done, base + p.total + (later[at] ?? 0)),
      fetchPage: (q) => pageOf(source, q, req, stage),
    });
    done += res.fetched;
    data[interval] = res.data;
  }
  data = deriveBars(data, req.intervals);
  let funding: FundingPoint[] | null = null;
  if (req.funding && info.futures) {
    try {
      const f = await loadFunding({
        symbol: req.symbol,
        from: req.from,
        to: req.to,
        now,
        store,
        prefix,
        signal: req.signal,
        fetchPage: (q) => fundingPageOf(source, q, req, stage),
      });
      funding = f.data.length ? f.data : null;
    } catch (e) {
      if (isAbort(e)) throw e;
      funding = null; // the run uses the flat assumption and says so
    }
  }
  return { data, funding, pages: done };
}

/** Is there a way to ask this source at all (file build without proxy, a symbol Bybit does not list …)? */
function reachable(source: HistorySource, symbol: string): boolean {
  switch (source) {
    case "binance":
      return true;
    case "proxy":
      return deps.proxy() !== null;
    case "bybit":
      return deps.bybit() !== null && toBybitSymbol(symbol) !== null;
    case "spot":
      return deps.spot() !== null;
    case "spot-app":
      return deps.spotApp() !== null;
  }
}

/** Failures that end the chain: asking another market would answer a different question. */
const STOPS_CHAIN: ReadonlySet<FailureReason> = new Set(["bad_symbol", "offline"]);

/**
 * Loads every interval (sequentially) and, when asked, the funding history – from the first source of the chain that
 * delivers (see the file header). Throws an `AbortError` on cancel, a `LabLoadError` (a `RestError` with the reason and
 * the list of every source asked) when none delivers.
 */
export async function loadLabData(req: LoadRequest): Promise<LoadedData> {
  const chain = (req.fallback ? FALLBACK_CHAIN : FUTURES_CHAIN).filter((s) => reachable(s, req.symbol));
  const failures: StageFailure[] = [];
  const stamp = deps.now();
  // sources that hung a moment ago are not asked again first – unless that would leave nothing to ask
  const live = chain.filter((s) => (skipUntil.get(s)?.until ?? 0) <= stamp);
  const order = live.length ? live : chain;
  for (const s of chain) if (!order.includes(s)) failures.push({ source: s, kind: skipUntil.get(s)?.kind ?? "timeout", skipped: true });
  for (const [i, source] of order.entries()) {
    if (req.signal?.aborted) throw abortError();
    try {
      const out = await loadFrom(source, req, failures.filter((f) => !f.skipped).at(-1));
      skipUntil.delete(source);
      return { ...out, viaProxy: source === "proxy", source, failed: failures };
    } catch (e) {
      if (req.signal?.aborted || isAbort(e)) throw abortError();
      const err = toRestError(e);
      failures.push({ source, kind: err.kind, ...(err.status ? { status: err.status } : {}), ...(err.kind === "timeout" ? { limitMs: deps.timing.timeoutMs } : {}) });
      if (err.kind === "timeout") skipUntil.set(source, { until: deps.now() + deps.timing.skipMemoMs, kind: err.kind });
      const next = order[i + 1];
      if (STOPS_CHAIN.has(err.kind) || !next) throw summarize(failures);
      req.onStatus?.({ step: "switch", from: source, to: next, reason: err.kind, at: Date.now() });
    }
  }
  throw summarize(failures);
}

/** German message of a load error. */
export function loadErrorKind(err: unknown): "blocked" | "rate" | "symbol" | "failed" {
  const e = toRestError(err);
  if (e.kind === "rate_limited") return "rate";
  if (e.kind === "bad_symbol" || e.status === 400) return "symbol";
  if (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors" || e.kind === "timeout" || e.kind === "offline") return "blocked";
  return "failed";
}
