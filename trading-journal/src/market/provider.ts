/**
 * `createMarketProvider` — the orchestrator (Plan 4.2–4.7). Owns the REST clients, the WebSocket, the
 * scheduler, the budgets, the cache and the health reducer. Views never talk to it directly; they use the
 * hooks in `marketStore.ts`.
 */
import type { Candle, FeedId, FeedSpec, FeedValue, HealthEvent, ProviderHealth, SeriesFeed, Source, Stamped, StatusLabel, MarketDataProvider, AggTrade } from "./types";
import { resolveSymbol, type SymbolInfo } from "./symbol";
import { normalizePeriod, INTERVAL_MS, type FetchInterval, type PeriodResult, type KlineInterval } from "./period";
import { BOOTSTRAP_LIMIT, GAP_FILL_MAX, klineBootstrapLimit, BYBIT_UNSUPPORTED, DEFAULT_SOURCE_CHAIN, FEED_IDS, FUTURES_DATA_FEEDS, FUTURES_DATA_RETENTION_MS, HISTORY_MAX_CALLS, HISTORY_PAGE_LIMIT, KLINE_FEEDS, OKX_UNSUPPORTED, POLL_LIMIT_FUTURES_DATA, RATIO_FEEDS, WS_FEEDS, WS_REST_FALLBACK_MS, buildFeedSpecs, effectiveSpec, isKlineFeed, klineFeedInterval, isSeriesFeed } from "./feeds";
import { Budget, klineWeight } from "./budget";
import { NON_ADVANCE_RETRY_MS, Scheduler, nextAlignedAt, probeBackoffMs, realTimerHost, type TimerHost } from "./schedule";
import { MarketCache, upsertBar, upsertSeries, RING_CAPACITY, type KVStore } from "./cache";
import { initialHealth, reduceHealth } from "./health";
import { statusLabelFor, STRINGS } from "./statusLabel";
import { binanceRest, buildStreamUrl, parseWsMessage, type BinanceRest } from "./sources/binance";
import { bybitRest, type BybitRest } from "./sources/bybit";
import { okxRest, type OkxRest } from "./sources/okx";
import { probeProxy, proxyRest } from "./sources/proxy";
import { RestError, toRestError, type FetchLike } from "./sources/http";
import { isFileProtocol } from "@/edition";
import { WsClient, type WsFactory } from "./sources/ws";
import type { FeedSnapshot } from "./mapping";

export interface ProviderDeps {
  fetch?: FetchLike;
  wsFactory?: WsFactory;
  host?: TimerHost;
  random?: () => number;
  /** `null` → memory only (tests); omitted → IndexedDB when available */
  kv?: KVStore | null;
  documentRef?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
  windowRef?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  online?: () => boolean;
  /** probe `/api/binance/fapi/v1/time` once on start (default: only in a browser) */
  probeProxy?: boolean;
  proxyBase?: string;
  timeZone?: string;
  /** health tick interval (staleness detection) */
  tickMs?: number;
}

export interface ProviderOptions {
  /** raw TradingView symbol (`BINANCE:BTCUSDT`) or bare Binance symbol */
  symbol: string;
  /** raw `settings.hyblock.timeframe` (validated with `normalizePeriod`) */
  period?: string;
  /** source chain; default Binance → Bybit → Proxy → Cache */
  sources?: Source[];
  /** subscribe to `bookTicker` (only when the Bid/Ask tile is visible) */
  bookTop?: boolean;
  deps?: ProviderDeps;
}

export interface MarketProvider extends MarketDataProvider {
  readonly symbolInfo: SymbolInfo;
  readonly period: PeriodResult;
  readonly specs: Record<FeedId, FeedSpec>;
  readonly started: boolean;
  setBookTop(on: boolean): void;
  /** any feed or health change (coarse; used by the store) */
  onChange(cb: () => void): () => void;
  snapshot(): FeedSnapshot;
  clearCache(): Promise<void>;
  /** advanced: feed an event into the health reducer (tests, adapters) */
  dispatch(ev: HealthEvent): void;
  /**
   * One kline page from the source the kline feeds currently use (Binance → proxy → Bybit), charged to the same
   * budget, WITHOUT touching the live cache (retro signal checks, the lazily polled `1d` rung). Waits up to
   * `maxWaitMs` (default 15 s) for budget tokens, then throws `RestError("rate_limited")`.
   */
  fetchKlines(interval: FetchInterval, p?: { endTime?: number; startTime?: number; limit?: number; maxWaitMs?: number }): Promise<Stamped<Candle[]>>;
}

type Batch = FeedSnapshot & { detail?: string };

class Unsupported extends Error {
  constructor(readonly detail?: string) {
    super("unsupported");
  }
}

const RETRY_MS = 15_000;
const BLOCK_PROBE_MEMO_MS = 30_000;
/** Default wait for budget tokens in `fetchKlines`. */
const FETCH_KLINES_MAX_WAIT_MS = 15_000;

export function createMarketProvider(opts: ProviderOptions): MarketProvider {
  const deps = opts.deps ?? {};
  const host = deps.host ?? realTimerHost;
  const now = () => host.now();
  const random = deps.random ?? Math.random;
  const symbolInfo = resolveSymbol(opts.symbol);
  const sym = symbolInfo.binance;
  const period = normalizePeriod(opts.period ?? "1h");
  const chain: Source[] = (opts.sources ?? [...DEFAULT_SOURCE_CHAIN]).filter((s) => {
    // Bybit/OKX only for USDT perps
    if (s === "bybit") return symbolInfo.bybit !== null;
    if (s === "okx") return symbolInfo.okx !== null;
    // opened from disk (single-file build) there is no Netlify function: `/api/binance` would be file:///api/…
    if (s === "proxy") return !isFileProtocol();
    return true;
  });
  const specs = buildFeedSpecs(period.period, chain);
  const doc = deps.documentRef === undefined ? (typeof document !== "undefined" ? document : null) : deps.documentRef;
  const win = deps.windowRef === undefined ? (typeof window !== "undefined" ? window : null) : deps.windowRef;
  const isOnline = deps.online ?? (() => (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true));
  const hidden = () => !!doc?.hidden;

  const cache = new MarketCache(sym, deps.kv);
  const budget = new Budget(now());
  const scheduler = new Scheduler(host);
  const binance: BinanceRest = binanceRest({ fetch: deps.fetch, now });
  const proxy: BinanceRest = proxyRest({ fetch: deps.fetch, now, base: deps.proxyBase });
  const bybit: BybitRest = bybitRest({ fetch: deps.fetch, now });
  const okx: OkxRest = okxRest({ fetch: deps.fetch, now });

  let health: ProviderHealth = initialHealth(specs);
  let started = false;
  let bookTop = !!opts.bookTop;
  let wsOpens = 0;
  let probeFailures = 0;
  let lastBlockProbeAt = 0;
  let lastNextFundingTime = 0;
  const lastAdvanceCheck = new Map<FeedId, { newest: number; retried: boolean }>();
  const inflight = new Map<string, Promise<Batch>>();
  /** results younger than this are shared between feeds that map to the same request (e.g. Bybit `tickers`) */
  const recent = new Map<string, { at: number; batch: Batch }>();
  const RECENT_MS = 1000;

  const feedSubs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const healthSubs = new Set<(h: ProviderHealth) => void>();
  const changeSubs = new Set<() => void>();

  // ------------------------------------------------------------ notify

  function notifyChange(): void {
    for (const cb of changeSubs) cb();
  }

  function dispatch(ev: HealthEvent): void {
    const next = reduceHealth(health, ev, specs);
    if (next === health) return;
    health = next;
    for (const cb of healthSubs) cb(health);
    notifyChange();
  }

  function publish<F extends FeedId>(feed: F, value: Stamped<FeedValue[F]>, o: { replace?: boolean } = {}): Stamped<FeedValue[F]> {
    const stored = cache.set(feed, value, o);
    const subs = feedSubs.get(feed);
    if (subs) for (const cb of subs) cb(stored as Stamped<unknown>);
    notifyChange();
    return stored;
  }

  // ------------------------------------------------------------ fetching per source

  function bucketFor(feed: FeedId, source: Source, units: number): { bucket: FeedSpec["cost"]["bucket"]; units: number } {
    if (source === "bybit") return { bucket: "bybit.ip", units: 1 };
    if (source === "okx") return { bucket: RATIO_FEEDS.includes(feed as never) ? "okx.rubik" : "okx.market", units: 1 };
    if (source === "proxy") return { bucket: "proxy", units: 1 };
    return { bucket: specs[feed].cost.bucket, units };
  }

  const set = <F extends FeedId>(b: Batch, feed: F, v: Stamped<FeedValue[F]>): void => {
    (b as Record<F, Stamped<FeedValue[F]>>)[feed] = v;
  };

  function aggFromTicker(t: Stamped<{ lastPrice: number; time: number }>, source: Source): Stamped<AggTrade> {
    return { data: { price: t.data.lastPrice, qty: 0, isBuyerMaker: false, time: t.asOf }, asOf: t.asOf, receivedAt: t.receivedAt, source, comparable: t.comparable };
  }

  /**
   * Rows a non-bootstrap kline poll requests: the forming + last closed bar (2), or – after a WS gap – every bar
   * since the newest cached one (+1), capped at `GAP_FILL_MAX`, so the series has no holes (the signal check
   * resamples 15m into 30m/45m and must not see missing bars).
   */
  function klinePollLimit(feed: FeedId): number {
    if (!isKlineFeed(feed)) return 2;
    const newest = newestTime(feed);
    if (newest === undefined) return 2;
    const missing = Math.ceil((now() - newest) / INTERVAL_MS[klineFeedInterval(feed)]) + 1;
    return Math.max(2, Math.min(GAP_FILL_MAX, missing));
  }

  function klineLimit(feed: FeedId, bootstrap: boolean): number {
    return isKlineFeed(feed) && bootstrap ? klineBootstrapLimit(klineFeedInterval(feed)) : klinePollLimit(feed);
  }

  async function fetchBinanceLike(client: BinanceRest, feed: FeedId, bootstrap: boolean): Promise<Batch> {
    const b: Batch = {};
    if (isKlineFeed(feed)) {
      const iv = klineFeedInterval(feed);
      set(b, feed, await client.klines(sym, iv, { limit: klineLimit(feed, bootstrap) }));
      return b;
    }
    switch (feed) {
      case "markPrice":
        set(b, "markPrice", await client.premiumIndex(sym));
        return b;
      case "ticker24h":
      case "aggTrade": {
        const t = await client.ticker24h(sym);
        set(b, "ticker24h", t);
        if (feed === "aggTrade" || health.feeds.aggTrade.state === "fallback") set(b, "aggTrade", aggFromTicker(t, client.source));
        return b;
      }
      case "openInterest":
        set(b, "openInterest", await client.openInterest(sym));
        return b;
      case "openInterestHist":
        set(b, "openInterestHist", await client.openInterestHist(sym, period.period, { limit: bootstrap ? BOOTSTRAP_LIMIT.futuresData : POLL_LIMIT_FUTURES_DATA }));
        return b;
      case "topPositionRatio":
      case "topAccountRatio":
      case "globalAccountRatio":
        set(b, feed, await client.ratio(feed, sym, period.period, { limit: bootstrap ? BOOTSTRAP_LIMIT.futuresData : POLL_LIMIT_FUTURES_DATA }));
        return b;
      case "takerRatio":
        set(b, "takerRatio", await client.takerRatio(sym, period.period, { limit: bootstrap ? BOOTSTRAP_LIMIT.futuresData : POLL_LIMIT_FUTURES_DATA }));
        return b;
      case "fundingHistory":
        set(b, "fundingHistory", await client.fundingRate(sym, { limit: BOOTSTRAP_LIMIT.funding }));
        return b;
      case "bookTop":
        throw new Unsupported();
    }
  }

  async function fetchBybit(feed: FeedId, bootstrap: boolean): Promise<Batch> {
    const s = symbolInfo.bybit;
    if (!s) throw new Unsupported(STRINGS.fallbackOnlyUsdt);
    if (BYBIT_UNSUPPORTED.includes(feed)) throw new Unsupported("Bybit: alle Konten, keine Top-Trader-Kohorte.");
    const b: Batch = {};
    if (isKlineFeed(feed)) {
      set(b, feed, await bybit.klines(s, klineFeedInterval(feed), { limit: bootstrap ? 1000 : Math.min(1000, klinePollLimit(feed)) }));
      return b;
    }
    switch (feed) {
      case "markPrice":
      case "bookTop":
      case "ticker24h":
      case "openInterest":
      case "aggTrade": {
        const t = await bybit.tickers(s);
        const st = { asOf: t.asOf, receivedAt: t.receivedAt, source: t.source, comparable: true };
        set(b, "markPrice", { ...st, data: t.data.markPrice });
        set(b, "bookTop", { ...st, data: t.data.bookTop });
        set(b, "ticker24h", { ...st, data: t.data.ticker24h });
        set(b, "openInterest", { ...st, data: t.data.openInterest, comparable: false });
        set(b, "aggTrade", { ...st, data: { price: t.data.lastPrice, qty: 0, isBuyerMaker: false, time: t.asOf } });
        return b;
      }
      case "globalAccountRatio": {
        const r = await bybit.accountRatio(s, period.period, { limit: bootstrap ? 500 : 30 });
        set(b, "globalAccountRatio", r);
        b.detail = r.detail;
        return b;
      }
      case "openInterestHist": {
        const r = await bybit.openInterestHist(s, period.period, { limit: 200 });
        set(b, "openInterestHist", r);
        b.detail = r.detail;
        return b;
      }
      case "fundingHistory":
        set(b, "fundingHistory", await bybit.fundingHistory(s, { limit: 200 }));
        return b;
      default:
        throw new Unsupported();
    }
  }

  async function fetchOkx(feed: FeedId, bootstrap: boolean): Promise<Batch> {
    const inst = symbolInfo.okx;
    if (!inst) throw new Unsupported(STRINGS.fallbackOnlyUsdt);
    if (OKX_UNSUPPORTED.includes(feed)) throw new Unsupported();
    const b: Batch = {};
    if (isKlineFeed(feed)) {
      set(b, feed, await okx.candles(inst, klineFeedInterval(feed), { limit: bootstrap ? 300 : Math.min(300, klinePollLimit(feed)) }));
      return b;
    }
    switch (feed) {
      case "globalAccountRatio":
        set(b, feed, await okx.globalAccountRatio(inst, period.period, { limit: bootstrap ? 100 : 30 }));
        return b;
      case "topAccountRatio":
        set(b, feed, await okx.topAccountRatio(inst, period.period, { limit: bootstrap ? 100 : 30 }));
        return b;
      case "topPositionRatio":
        set(b, feed, await okx.topPositionRatio(inst, period.period, { limit: bootstrap ? 100 : 30 }));
        return b;
      case "takerRatio":
        set(b, feed, await okx.takerVolume(inst, period.period, { limit: bootstrap ? 100 : 30 }));
        return b;
      default:
        throw new Unsupported();
    }
  }

  /** Memo key so that e.g. the four Bybit `tickers` feeds share one request. */
  function memoKey(feed: FeedId, source: Source, bootstrap: boolean): string {
    if (source === "bybit" && ["markPrice", "bookTop", "ticker24h", "openInterest", "aggTrade"].includes(feed)) return `bybit:tickers`;
    if ((source === "binance" || source === "proxy") && (feed === "ticker24h" || feed === "aggTrade")) return `${source}:ticker24h`;
    return `${source}:${feed}:${bootstrap ? "b" : "p"}`;
  }

  function fetchFeed(feed: FeedId, source: Source, bootstrap: boolean): Promise<Batch> {
    const key = memoKey(feed, source, bootstrap);
    const existing = inflight.get(key);
    if (existing) return existing;
    const fresh = recent.get(key);
    if (fresh && now() - fresh.at < RECENT_MS) return Promise.resolve(fresh.batch);
    const run = (async () => {
      switch (source) {
        case "binance":
          return fetchBinanceLike(binance, feed, bootstrap);
        case "proxy":
          return fetchBinanceLike(proxy, feed, bootstrap);
        case "bybit":
          return fetchBybit(feed, bootstrap);
        case "okx":
          return fetchOkx(feed, bootstrap);
        default:
          throw new Unsupported();
      }
    })();
    inflight.set(key, run);
    run
      .then((batch) => recent.set(key, { at: now(), batch }))
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    return run;
  }

  // ------------------------------------------------------------ polling

  function nextPollAt(feed: FeedId, source: Source, advanced: boolean): number {
    const spec = specs[feed];
    const t = now();
    const fh = health.feeds[feed];
    if (spec.alignMs) {
      const check = lastAdvanceCheck.get(feed);
      if (!advanced && check && !check.retried) {
        check.retried = true;
        return t + NON_ADVANCE_RETRY_MS;
      }
      if (check) check.retried = false;
      return nextAlignedAt(t, { alignMs: spec.alignMs, lagMs: spec.lagMs, jitterMs: spec.jitterMs }, random);
    }
    if (feed === "fundingHistory") {
      // refreshed on the funding tick (`T` from markPrice); safety net: 8 h
      const nft = cache.get("markPrice")?.data.nextFundingTime;
      return nft && nft > t ? nft + 30_000 : t + spec.cadenceMs;
    }
    const { cadenceMs } = effectiveSpec(spec, source, WS_FEEDS.includes(feed) && health.ws.state === "fallback" ? "fallback" : fh.state);
    return t + cadenceMs;
  }

  function schedulePoll(feed: FeedId, at: number, bootstrap = false): void {
    if (!started) return;
    scheduler.at(`poll:${feed}`, at, () => void poll(feed, { bootstrap }));
    dispatch({ type: "schedule", feed, nextRefreshAt: at });
  }

  function wsCovers(feed: FeedId): boolean {
    const fh = health.feeds[feed];
    return WS_FEEDS.includes(feed) && fh.source === "binance" && fh.state !== "fallback" && (health.ws.state === "live" || health.ws.state === "connecting") && wsOpens > 0;
  }

  async function poll(feed: FeedId, o: { bootstrap?: boolean; force?: boolean } = {}): Promise<void> {
    if (!started) return;
    const fh = health.feeds[feed];
    const source = fh.source;
    if (source === "cache" || source === "tradingview") return;
    if (feed === "bookTop" && !bookTop) return;
    if (WS_FEEDS.includes(feed) && !o.bootstrap && !o.force && wsCovers(feed)) return; // WS delivers
    const spec = specs[feed];
    const units = isKlineFeed(feed) ? klineWeight(klineLimit(feed, !!o.bootstrap)) : spec.cost.units;
    const cost = bucketFor(feed, source, units);
    if (!o.force && !budget.take(cost.bucket, cost.units, now())) {
      schedulePoll(feed, now() + Math.max(1000, budget.waitFor(cost.bucket, cost.units, now())), o.bootstrap);
      return;
    }
    if (o.force) budget.take(cost.bucket, cost.units, now());
    const before = newestTime(feed);
    try {
      const batch = await fetchFeed(feed, source, !!o.bootstrap);
      if (!started) return;
      const t = now();
      for (const id of FEED_IDS) {
        const v = batch[id];
        if (!v) continue;
        // WS is authoritative for feeds it currently serves; REST only fills gaps
        if (id !== feed && wsCovers(id) && !o.bootstrap) continue;
        publish(id, v as Stamped<FeedValue[typeof id]>);
        dispatch({ type: "rest_ok", feed: id, source: v.source, asOf: v.asOf, now: t });
        if (batch.detail) dispatch({ type: "bad_period", feeds: [id], detail: batch.detail, now: t });
        if (id === "markPrice") onFundingTick(v.data as FeedValue["markPrice"]);
      }
      const after = newestTime(feed);
      const advanced = before === undefined || (after !== undefined && after > before);
      if (spec.alignMs) lastAdvanceCheck.set(feed, { newest: after ?? 0, retried: lastAdvanceCheck.get(feed)?.retried ?? false });
      if (isSeriesFeed(feed)) void cache.persist(feed);
      // WS-fed feeds on Binance are only polled while the socket is down (10 s); otherwise the stream delivers
      if (WS_FEEDS.includes(feed) && source === "binance" && health.ws.state !== "fallback") return;
      schedulePoll(feed, nextPollAt(feed, source, advanced));
    } catch (err) {
      if (!started) return;
      await onFetchError(feed, source, err);
    }
  }

  function newestTime(feed: FeedId): number | undefined {
    const v = cache.get(feed);
    if (!v) return undefined;
    if (isSeriesFeed(feed)) {
      const arr = v.data as { time: number }[];
      return arr[arr.length - 1]?.time;
    }
    return v.asOf;
  }

  async function onFetchError(feed: FeedId, source: Source, err: unknown): Promise<void> {
    const t = now();
    if (err instanceof Unsupported) {
      dispatch({ type: "unsupported", feed, source, now: t, detail: err.detail });
      // nothing to poll on this source; re-probing the primary will bring it back
      return;
    }
    const rest = toRestError(err);
    let kind = rest.kind;
    if (kind === "offline" || !isOnline()) {
      dispatch({ type: "online", online: false, now: t });
      return;
    }
    if (kind === "rate_limited") budget.backoff(bucketFor(feed, source, 0).bucket, t);
    if (kind === "network" && (source === "binance" || source === "proxy") && source === "binance") {
      const blocked = await detectBlocked();
      if (blocked) kind = "blocked_451";
    }
    const before = health;
    dispatch({ type: "rest_fail", feed, source, kind, now: t, detail: rest.status ? `HTTP ${rest.status}` : undefined });
    if (kind === "blocked_451" || kind === "cors") {
      dispatch({ type: "probe", source: "binance", ok: false, blocked: true, now: t });
      scheduleProbe();
    }
    bootstrapMoved(before, feed);
    const after = health.feeds[feed];
    if (after.source !== source && after.source !== "cache") {
      // moved to the next source: bootstrap there right away
      schedulePoll(feed, now(), true);
      return;
    }
    if (after.state === "offline") {
      scheduleProbe();
      return;
    }
    schedulePoll(feed, now() + (specs[feed].alignMs ? NON_ADVANCE_RETRY_MS : RETRY_MS));
  }

  /** Feeds whose source changed through a reducer step are bootstrapped on the new source right away. */
  function bootstrapMoved(before: ProviderHealth, except?: FeedId): void {
    for (const f of FEED_IDS) {
      if (f === except) continue;
      const a = before.feeds[f];
      const b = health.feeds[f];
      if (a.source !== b.source && b.source !== "cache" && b.source !== "tradingview") schedulePoll(f, now(), true);
    }
  }

  /** Binance `TypeError` while Bybit answers → primary blocked (Plan 4.4). Memoised for 30 s. */
  async function detectBlocked(): Promise<boolean> {
    const t = now();
    if (t - lastBlockProbeAt < BLOCK_PROBE_MEMO_MS) return health.primary.blocked;
    lastBlockProbeAt = t;
    if (!symbolInfo.bybit) return false;
    try {
      await bybit.serverTime();
      return true;
    } catch {
      return false;
    }
  }

  function onFundingTick(m: FeedValue["markPrice"]): void {
    if (m.nextFundingTime && m.nextFundingTime !== lastNextFundingTime) {
      const first = lastNextFundingTime === 0;
      lastNextFundingTime = m.nextFundingTime;
      if (!first) schedulePoll("fundingHistory", now() + 30_000);
    }
  }

  // ------------------------------------------------------------ primary re-probe

  function scheduleProbe(): void {
    if (!started || scheduler.has("probe")) return;
    scheduler.in("probe", probeBackoffMs(probeFailures), () => void probePrimary());
  }

  async function probePrimary(): Promise<void> {
    if (!started) return;
    if (!isOnline() || hidden()) {
      // retried on visibilitychange / online
      return;
    }
    const t = now();
    if (!budget.take("binance.weight", 1, t)) {
      scheduleProbe();
      return;
    }
    try {
      await binance.serverTime();
      probeFailures = 0;
      dispatch({ type: "probe", source: "binance", ok: true, now: now() });
      bootstrapAll();
      if (chain.includes("binance")) ws.reconnect();
    } catch (err) {
      probeFailures += 1;
      const rest = toRestError(err);
      const blocked = rest.kind === "blocked_451" || (rest.kind === "network" && (await detectBlocked()));
      const before = health;
      dispatch({ type: "probe", source: "binance", ok: false, blocked, now: now() });
      bootstrapMoved(before);
      scheduleProbe();
    }
  }

  // ------------------------------------------------------------ WebSocket

  const ws = new WsClient({
    url: () => buildStreamUrl(sym, { bookTop }),
    factory: deps.wsFactory,
    host,
    random,
    hidden,
    onOpen: (t) => {
      wsOpens += 1;
      dispatch({ type: "ws_open", now: t });
      if (wsOpens > 1) {
        // close the gap after a reconnect: last 2 candles per interval
        for (const f of KLINE_FEEDS) void poll(f, { force: true });
      }
    },
    onMessage: (raw, t) => {
      const ev = parseWsMessage(raw);
      if (!ev) return;
      switch (ev.kind) {
        case "kline": {
          const feed = `kline_${ev.interval}` as const;
          const prev = cache.get(feed);
          // tail update (replace the forming bar / append the next one) instead of a full-ring merge per tick
          const merged = upsertBar(prev && prev.source === "binance" ? prev.data : [], ev.candle, RING_CAPACITY[feed]);
          publish(feed, { data: merged, asOf: ev.eventTime, receivedAt: t, source: "binance", comparable: true }, { replace: true });
          noteWs(feed, ev.eventTime, t);
          if (ev.candle.closed) void cache.persist(feed);
          break;
        }
        case "markPrice":
          publish("markPrice", { data: ev.value, asOf: ev.value.time, receivedAt: t, source: "binance", comparable: true });
          noteWs("markPrice", ev.value.time, t);
          onFundingTick(ev.value);
          break;
        case "aggTrade":
          publish("aggTrade", { data: ev.value, asOf: ev.value.time, receivedAt: t, source: "binance", comparable: true });
          noteWs("aggTrade", ev.value.time, t);
          break;
        case "bookTop":
          publish("bookTop", { data: ev.value, asOf: ev.value.time || t, receivedAt: t, source: "binance", comparable: true });
          noteWs("bookTop", ev.value.time || t, t);
          break;
        case "unknown":
          break;
      }
    },
    onClose: (code, failed, t) => dispatch({ type: "ws_close", code, now: t, failedAttempts: failed }),
    onSilent: (t) => dispatch({ type: "ws_silent", now: t }),
    onRetry: (attempt, nextRetryAt, t) => dispatch({ type: "ws_retry", attempt, nextRetryAt, now: t }),
    onFallback: () => {
      // REST polling every 10 s for the WS-fed feeds while the socket is down
      for (const f of WS_FEEDS) if (health.feeds[f].source === "binance") schedulePoll(f, now() + (f === "bookTop" ? WS_REST_FALLBACK_MS : 0));
    },
  });

  /** Health updates from WS data are throttled to ≥ 1 s per feed to avoid 10 Hz reducer runs. */
  function noteWs(feed: FeedId, asOf: number, t: number): void {
    const fh = health.feeds[feed];
    if (fh.state === "live" && fh.source === "binance" && fh.lastDataAt !== undefined && asOf - fh.lastDataAt < 1000) return;
    if (fh.state !== "live" || fh.source !== "binance") scheduler.cancel(`poll:${feed}`); // WS took over again
    dispatch({ type: "ws_message", now: t, feeds: [feed], asOf });
  }

  // ------------------------------------------------------------ lifecycle

  function bootstrapAll(): void {
    for (const f of FEED_IDS) {
      if (f === "bookTop" && !bookTop) continue;
      if (f === "aggTrade" && chain[0] === "binance" && !health.primary.blocked) continue; // WS only, price from ticker until then
      void poll(f, { bootstrap: true });
    }
  }

  function onVisibility(): void {
    if (hidden()) {
      scheduler.pause();
      void cache.persistAll();
    } else {
      scheduler.resume();
      ws.nudge();
      if (health.primary.blocked && !scheduler.has("probe")) scheduleProbe();
      armTick();
    }
  }
  function onOnline(): void {
    dispatch({ type: "online", online: true, now: now() });
    ws.nudge();
    for (const f of FEED_IDS) if (specs[f].transport === "rest") void poll(f);
  }
  function onOffline(): void {
    dispatch({ type: "online", online: false, now: now() });
  }
  function onPageHide(): void {
    void cache.persistAll();
  }

  function armTick(): void {
    if (!started || scheduler.has("tick")) return;
    scheduler.in("tick", deps.tickMs ?? 5000, () => {
      dispatch({ type: "tick", now: now() });
      armTick();
    });
  }

  function start(): void {
    if (started) return;
    started = true;
    const t = now();
    dispatch({ type: "start", now: t });
    if (!period.ok && period.detail) dispatch({ type: "bad_period", feeds: [...FUTURES_DATA_FEEDS], detail: period.detail, now: t });
    if (!isOnline()) dispatch({ type: "online", online: false, now: t });
    if (!symbolInfo.valid) {
      dispatch({ type: "bad_symbol", now: t });
      return;
    }
    doc?.addEventListener("visibilitychange", onVisibility);
    win?.addEventListener("online", onOnline);
    win?.addEventListener("offline", onOffline);
    win?.addEventListener("pagehide", onPageHide);
    void cache.hydrate(FEED_IDS).then((loaded) => {
      if (!started) return;
      for (const f of loaded) {
        const v = cache.get(f);
        const subs = feedSubs.get(f);
        if (v && subs) for (const cb of subs) cb(v as Stamped<unknown>);
      }
      if (loaded.length) notifyChange();
    });
    bootstrapAll();
    if (chain.includes("binance")) ws.start();
    if (deps.probeProxy ?? (typeof window !== "undefined" && chain.includes("proxy"))) {
      void probeProxy(deps.fetch, deps.proxyBase).then((p) => started && dispatch({ type: "probe", source: "proxy", ok: p.usable, blocked: p.blocked, now: now() }));
    }
    if (hidden()) scheduler.pause();
    armTick();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    ws.stop();
    scheduler.cancelAll();
    scheduler.resume();
    inflight.clear();
    doc?.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("online", onOnline);
    win?.removeEventListener("offline", onOffline);
    win?.removeEventListener("pagehide", onPageHide);
    void cache.persistAll();
    wsOpens = 0;
    dispatch({ type: "stop", now: now() });
  }

  // ------------------------------------------------------------ history

  async function history<F extends SeriesFeed>(feed: F, range: { from: number; to: number }): Promise<Stamped<FeedValue[F]>> {
    const t = now();
    const fh = health.feeds[feed];
    const source = fh.source === "cache" ? "binance" : fh.source;
    const client = source === "proxy" ? proxy : source === "binance" ? binance : null;
    let from = range.from;
    const isFutures = FUTURES_DATA_FEEDS.includes(feed);
    if (isFutures) {
      const oldest = t - FUTURES_DATA_RETENTION_MS;
      if (range.to < oldest) {
        dispatch({ type: "rest_fail", feed, source, kind: "beyond_retention", now: t });
        return { data: [] as unknown as FeedValue[F], asOf: t, receivedAt: t, source: "cache", comparable: true };
      }
      if (from < oldest) {
        from = oldest;
        dispatch({ type: "rest_fail", feed, source, kind: "beyond_retention", now: t });
      }
    }
    if (isKlineFeed(feed) && klineFeedInterval(feed) === "1m") from = Math.max(from, t - 7 * 86_400_000); // 1m cap: 7 days
    let calls = 0;
    while (calls < HISTORY_MAX_CALLS && started) {
      const cur = cache.get(feed);
      const arr = (cur?.data ?? []) as { time: number }[];
      const oldest = arr[0]?.time;
      if (oldest !== undefined && oldest <= from) break;
      if (oldest === undefined && arr.length === 0 && calls > 0) break;
      const endTime = oldest !== undefined ? oldest - 1 : range.to;
      let page: Stamped<FeedValue[F]>;
      try {
        if (isKlineFeed(feed)) {
          const iv: KlineInterval = klineFeedInterval(feed);
          if (client) {
            if (!budget.take("binance.weight", klineWeight(HISTORY_PAGE_LIMIT), now())) break;
            page = (await client.klines(sym, iv, { limit: HISTORY_PAGE_LIMIT, endTime })) as Stamped<FeedValue[F]>;
          } else if (source === "bybit" && symbolInfo.bybit) {
            if (!budget.take("bybit.ip", 1, now())) break;
            page = (await bybit.klines(symbolInfo.bybit, iv, { limit: 1000, end: endTime })) as Stamped<FeedValue[F]>;
          } else break;
        } else if (client && isFutures) {
          if (!budget.take("binance.futuresData", 1, now())) break;
          const p = { limit: 500, startTime: Math.max(from, endTime - 500 * specs[feed].cadenceMs), endTime };
          if (feed === "openInterestHist") page = (await client.openInterestHist(sym, period.period, p)) as Stamped<FeedValue[F]>;
          else if (feed === "takerRatio") page = (await client.takerRatio(sym, period.period, p)) as Stamped<FeedValue[F]>;
          else page = (await client.ratio(feed as "topPositionRatio" | "topAccountRatio" | "globalAccountRatio", sym, period.period, p)) as Stamped<FeedValue[F]>;
        } else if (client && feed === "fundingHistory") {
          if (!budget.take("binance.funding", 1, now())) break;
          page = (await client.fundingRate(sym, { limit: 1000, endTime })) as Stamped<FeedValue[F]>;
        } else break;
      } catch (err) {
        await onFetchError(feed, source, err);
        break;
      }
      calls += 1;
      const pageArr = page.data as unknown as { time: number }[];
      if (pageArr.length === 0) break;
      const merged = upsertSeries(arr, pageArr, Math.max(RING_CAPACITY[feed], arr.length + pageArr.length));
      publish(feed, { ...page, data: merged as unknown as FeedValue[F], asOf: cur?.asOf ?? page.asOf }, { replace: true });
      if ((pageArr[0]?.time ?? 0) <= from) break;
    }
    const finalV = cache.get(feed);
    const data = ((finalV?.data ?? []) as { time: number }[]).filter((p) => p.time >= from && p.time <= range.to) as unknown as FeedValue[F];
    return { data, asOf: finalV?.asOf ?? t, receivedAt: finalV?.receivedAt ?? t, source: finalV?.source ?? "cache", comparable: finalV?.comparable ?? true };
  }

  // ------------------------------------------------------------ one-off kline pages (signal check)

  async function waitBudget(bucket: FeedSpec["cost"]["bucket"], units: number, maxWaitMs: number): Promise<void> {
    const deadline = now() + maxWaitMs;
    while (!budget.take(bucket, units, now())) {
      const wait = Math.max(50, budget.waitFor(bucket, units, now()));
      if (now() + wait > deadline) throw new RestError("rate_limited", "Abfrage-Budget erschöpft, gleich nochmal versuchen");
      await new Promise<void>((resolve) => host.setTimeout(resolve, wait));
    }
  }

  async function fetchKlines(interval: FetchInterval, p: { endTime?: number; startTime?: number; limit?: number; maxWaitMs?: number } = {}): Promise<Stamped<Candle[]>> {
    if (!symbolInfo.valid) throw new RestError("bad_symbol", "Ungültiges Symbol");
    const fh = health.feeds.kline_1h;
    let source: Source = fh.source === "cache" || fh.source === "tradingview" ? "binance" : fh.source;
    // OKX candles have no end time in this adapter: use Bybit (USDT perps) or Binance
    if (source === "okx") source = symbolInfo.bybit ? "bybit" : "binance";
    const limit = Math.max(1, Math.min(HISTORY_PAGE_LIMIT, Math.round(p.limit ?? 500)));
    const cost = bucketFor("kline_1h", source, klineWeight(limit));
    await waitBudget(cost.bucket, cost.units, p.maxWaitMs ?? FETCH_KLINES_MAX_WAIT_MS);
    try {
      if (source === "bybit") {
        if (!symbolInfo.bybit) throw new RestError("bad_symbol", STRINGS.fallbackOnlyUsdt);
        return await bybit.klines(symbolInfo.bybit, interval, { limit: Math.min(1000, limit), end: p.endTime, start: p.startTime });
      }
      const client = source === "proxy" ? proxy : binance;
      return await client.klines(sym, interval, { limit, endTime: p.endTime, startTime: p.startTime });
    } catch (err) {
      const e = toRestError(err);
      if (e.kind === "rate_limited") budget.backoff(cost.bucket, now());
      throw e;
    }
  }

  // ------------------------------------------------------------ public

  const provider: MarketProvider = {
    symbol: sym,
    symbolInfo,
    period,
    specs,
    get started() {
      return started;
    },
    start,
    stop,
    get: <F extends FeedId>(f: F) => cache.get(f),
    subscribe<F extends FeedId>(f: F, cb: (v: Stamped<FeedValue[F]>) => void) {
      let set = feedSubs.get(f);
      if (!set) feedSubs.set(f, (set = new Set()));
      const wrapped = cb as (v: Stamped<unknown>) => void;
      set.add(wrapped);
      return () => void set!.delete(wrapped);
    },
    async refresh(f, o) {
      await poll(f, { force: !!o?.force, bootstrap: false });
    },
    history,
    getHealth: () => health,
    onHealth(cb) {
      healthSubs.add(cb);
      return () => void healthSubs.delete(cb);
    },
    statusLabel(f, t): StatusLabel {
      return statusLabelFor(health, f, specs, cache.get(f), t ?? now(), deps.timeZone);
    },
    setBookTop(on) {
      if (bookTop === on) return;
      bookTop = on;
      if (!started) return;
      if (chain.includes("binance") && !health.primary.blocked) ws.reconnect(); // socket rollover with the new stream set
      if (on) void poll("bookTop", { bootstrap: true });
      else scheduler.cancel("poll:bookTop");
    },
    onChange(cb) {
      changeSubs.add(cb);
      return () => void changeSubs.delete(cb);
    },
    snapshot(): FeedSnapshot {
      const s: FeedSnapshot = {};
      for (const [f, v] of cache.entries()) (s as Record<FeedId, Stamped<unknown>>)[f] = v;
      return s;
    },
    clearCache: () => cache.clear(),
    dispatch,
    fetchKlines,
  };
  return provider;
}

/** Utility for adapters/tests: build a kline series stamped as Binance. */
export function stampCandles(data: Candle[], asOf: number, receivedAt: number, source: Source = "binance"): Stamped<Candle[]> {
  return { data, asOf, receivedAt, source, comparable: true };
}

export { INTERVAL_MS };
