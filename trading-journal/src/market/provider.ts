/**
 * `createMarketProvider` — the orchestrator (Plan 4.2–4.7). Owns the REST clients, the WebSocket, the
 * scheduler, the budgets, the cache and the health reducer. Views never talk to it directly; they use the
 * hooks in `marketStore.ts`.
 */
import type { Candle, FeedId, FeedSpec, FeedValue, HealthEvent, ProviderHealth, SeriesFeed, Source, Stamped, StatusLabel, MarketDataProvider, AggTrade } from "./types";
import { resolveSymbol, type SymbolInfo } from "./symbol";
import { normalizePeriod, INTERVAL_MS, type FetchInterval, type PeriodResult, type KlineInterval, type Period } from "./period";
import {
  ALL_FUTURES_DATA_FEEDS,
  BINANCE_FAMILY_FEEDS,
  BOOTSTRAP_LIMIT,
  GAP_FILL_MAX,
  klineBootstrapLimit,
  BYBIT_UNSUPPORTED,
  DEFAULT_SOURCE_CHAIN,
  FEED_IDS,
  FUTURES_DATA_FEEDS,
  FUTURES_DATA_RETENTION_MS,
  HISTORY_MAX_CALLS,
  HISTORY_PAGE_LIMIT,
  KLINE_FEEDS,
  LIVE_RATIO_BOOTSTRAP_LIMIT,
  LIVE_RATIO_MAIN,
  LIVE_RATIO_OF,
  LIVE_RATIO_PERIOD,
  LIVE_RATIO_POLL_LIMIT,
  OKX_UNSUPPORTED,
  POLL_LIMIT_FUTURES_DATA,
  RATIO_FEEDS,
  WS_FEEDS,
  WS_REST_FALLBACK_MS,
  buildFeedSpecs,
  effectiveSpec,
  isFamilyFeed,
  isKlineFeed,
  isLiveRatioFeed,
  klineFeedInterval,
  isSeriesFeed,
} from "./feeds";
import { Budget, klineWeight, type BudgetClass } from "./budget";
import {
  NON_ADVANCE_RETRIES_MS,
  Scheduler,
  WS_SILENT_MS,
  banBackoffMs,
  failureRetryMs,
  nextAlignedAt,
  nonAdvanceRetries,
  probeBackoffMs,
  realTimerHost,
  watchdogKickMs,
  type TimerHost,
} from "./schedule";
import { ClockSkew } from "./clock";
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
  /** `visibilitychange` and the Page Lifecycle `resume` / `freeze` events */
  documentRef?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
  /** `online` / `offline` / `pagehide` / `pageshow` / `focus` */
  windowRef?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  online?: () => boolean;
  /**
   * probe `/api/binance/fapi/v1/time` on start and again when a ratio feed needs it (default: only in a browser);
   * `false` never touches the proxy
   */
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
  /** route the Binance ratio feeds through the same-origin proxy when it is usable (`tj2-ui.useProxy`) */
  preferProxy?: boolean;
  deps?: ProviderDeps;
}

export interface MarketProvider extends MarketDataProvider {
  readonly symbolInfo: SymbolInfo;
  readonly period: PeriodResult;
  readonly specs: Record<FeedId, FeedSpec>;
  readonly started: boolean;
  setBookTop(on: boolean): void;
  /** `EU-Proxy verwenden`: route the Binance ratio feeds through `/api/binance` when the proxy is usable. */
  setPreferProxy(on: boolean): void;
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
  /** Device time corrected to the Binance server clock (`Date.now() + clockSkewMs`); compare it with `asOf` / point times. */
  serverNow(): number;
  /**
   * Re-checks every feed now (what a tab resume does): overdue polls fire, stale REST feeds are re-polled, the socket
   * reconnects when silent. Called by the provider itself on `visibilitychange` / `pageshow` / `focus` / `online` /
   * Page Lifecycle `resume` and after a device sleep; exposed for adapters and tests.
   */
  resume(reason?: string): void;
}

type Batch = FeedSnapshot & { detail?: string };

class Unsupported extends Error {
  constructor(readonly detail?: string) {
    super("unsupported");
  }
}

const RETRY_MS = 15_000;
/** German detail per HTTP status (tooltip, Live-Daten row). */
const HTTP_DETAIL: Record<number, string> = {
  429: "HTTP 429 · zu viele Anfragen",
  418: "HTTP 418 · IP vorübergehend gesperrt",
  451: "HTTP 451 · Region gesperrt",
  403: "HTTP 403 · Zugriff verweigert",
};
/** Bybit liveness memo for the blocked check. */
const BLOCK_PROBE_MEMO_MS = 30_000;
/** A Binance WebSocket frame this recent proves Binance is reachable from here: no geo-block, whatever REST says. */
const WS_PROOF_MS = 30_000;
/** Same for a successful Binance REST answer. */
const REST_PROOF_MS = 60_000;
/** "Blocked" needs network failures on ≥ 2 different Binance paths within this window (plus Bybit answering). */
const BLOCK_WINDOW_MS = 120_000;
const BLOCK_MIN_PATHS = 2;
/** Failures right after the tab becomes visible (radio / stale HTTP/2 connection waking up) never count as a block. */
const RESUME_GRACE_MS = 10_000;
/** Overdue polls on resume are spread out instead of all firing in the same tick. */
const RESUME_STAGGER_MS = 1_500;
const RESUME_STAGGER_STEP_MS = 300;
/** Re-probe soon when evidence says Binance answers again (WS frame / REST success while marked blocked; resume). */
const FAST_PROBE_MS = 5_000;
/** …but at most this often (a socket that delivers while REST stays unreachable must not trigger a probe storm). */
const FAST_PROBE_MIN_GAP_MS = 2 * 60_000;
/** While `navigator.onLine` is false the failed feed is retried at this pace (the `online` event can be missed). */
const OFFLINE_RETRY_MS = 30_000;
/** Proxy re-probe throttle. */
const PROXY_REPROBE_MS = 5 * 60_000;
/** Watchdog re-arm delay for a REST feed without a pending poll. */
const WATCHDOG_REARM_MS = 1_000;
/** Default wait for budget tokens in `fetchKlines`. */
const FETCH_KLINES_MAX_WAIT_MS = 15_000;
/** A scheduled poll this late (its timer was lost: device sleep, frozen tab) is re-armed by the watchdog. */
const OVERDUE_GRACE_MS = 3_000;
/** Health ticks further apart than this many tick intervals mean the device slept / the tab was frozen: resume. */
const WAKE_TICK_FACTOR = 3;
/** `focus` / `pageshow` / `resume` re-checks at most this often (a visibilitychange always runs). */
const RESUME_THROTTLE_MS = 5_000;
/**
 * A WS stream that delivered nothing for this long while the socket itself delivers (other streams arrive) is stalled:
 * its feed is fetched over REST (klines with gap fill) and a second stall within `STREAM_STALL_WINDOW_MS`
 * re-subscribes (socket reconnect). BTC trades every second, so every subscribed stream updates several times a second.
 */
const STREAM_STALL_MS: Partial<Record<FeedId, number>> = {
  markPrice: 15_000,
  aggTrade: 60_000,
  bookTop: 60_000,
  kline_1m: 90_000,
  kline_15m: 90_000,
  kline_1h: 90_000,
  kline_4h: 90_000,
  kline_1w: 90_000,
};
const STREAM_STALL_WINDOW_MS = 10 * 60_000;
/** The socket counts as delivering when its last frame is younger than this. */
const SOCKET_ALIVE_MS = 5_000;
/** The stale-feed watchdog leaves a feed alone whose next poll is at most this far away. */
const KICK_LEAD_MS = 10_000;
/** Kline tail scanned for holes on every health tick (the gap fill itself scans up to `GAP_FILL_MAX` bars). */
const HOLE_SCAN_BARS = 300;

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
  /** With the chosen period = 5m the live 5-min ratios are the same request: they ride along with their main feed. */
  const mirrorLive = period.period === LIVE_RATIO_PERIOD;
  const doc = deps.documentRef === undefined ? (typeof document !== "undefined" ? document : null) : deps.documentRef;
  const win = deps.windowRef === undefined ? (typeof window !== "undefined" ? window : null) : deps.windowRef;
  const isOnline = deps.online ?? (() => (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true));
  const hidden = () => !!doc?.hidden;
  /** device clock vs. Binance server clock (see `clock.ts`) */
  const skew = new ClockSkew();
  /** device time on the Binance clock: compare with `asOf` / point times (exchange time) */
  const serverNow = () => now() + skew.offsetMs;

  const cache = new MarketCache(sym, deps.kv, (f) => specs[f].period);
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
  let lastNextFundingTime = 0;
  let preferProxy = !!opts.preferProxy;
  /** evidence for / against a geo-block (see `detectBlocked`) */
  let lastWsMessageAt = -Infinity;
  let lastBinanceOkAt = -Infinity;
  let resumedAt = -Infinity;
  const netFailures: { at: number; path: string }[] = [];
  let bybitCheck: { at: number; alive: Promise<boolean> } | null = null;
  let lastProxyProbeAt = -Infinity;
  let lastFastProbeAt = -Infinity;
  let proxyProbing = false;
  const proxyAllowed = chain.includes("proxy") && (deps.probeProxy ?? typeof window !== "undefined");
  /** feeds whose poll is in flight (the watchdog must not re-arm them) */
  const active = new Set<FeedId>();
  /** local time of the last successful delivery per feed (REST answer or WS frame): transport liveness */
  const lastOkAt = new Map<FeedId, number>();
  /** local time of the last WS frame per stream (stall detection) */
  const lastStreamAt = new Map<FeedId, number>();
  /** recent stream stalls (local times) → a second one re-subscribes the socket */
  const streamStalls: number[] = [];
  /** watchdog kicks per feed since its last delivery (backoff) */
  const kicks = new Map<FeedId, number>();
  /**
   * WS-fed feeds whose REST fetch must go out although the socket covers them: a kline gap after a reconnect / stall
   * (survives a failed request: the feed's normal retry sends it again), a stalled stream
   */
  const restDue = new Set<FeedId>();
  /** holes a completed gap fill could not close (no bars at the exchange): never requested again */
  const knownHoles = new Map<FeedId, Set<number>>();
  let lastTickAt = -Infinity;
  let lastResumeAt = -Infinity;
  let wsOpenedAt = -Infinity;
  /** consecutive HTTP 418 bans (bucket pause grows) */
  let bans = 0;
  /** feeds moved to the proxy because Binance banned this IP (418): a primary probe brings them back */
  const movedForBan = new Set<FeedId>();
  const lastAdvanceCheck = new Map<FeedId, { newest: number; retries: number }>();
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
    const iv = INTERVAL_MS[klineFeedInterval(feed)];
    // from the oldest open hole in the tail (a failed gap fill, frames lost while the socket stalled), else the newest
    // bar; counted on the Binance clock so a device clock that runs behind never leaves the last bars out
    const from = oldestHole(feed, GAP_FILL_MAX) ?? newest;
    const missing = Math.ceil((serverNow() - from) / iv) + 1;
    return Math.max(2, Math.min(GAP_FILL_MAX, missing));
  }

  /**
   * Open time of the bar BEFORE the oldest unfilled hole within the last `scan` bars of a kline series (undefined =
   * contiguous). Holes a completed gap fill could not close (no trading at the exchange) are skipped.
   */
  function oldestHole(feed: FeedId, scan: number): number | undefined {
    if (!isKlineFeed(feed)) return undefined;
    const arr = cache.get(feed)?.data as Candle[] | undefined;
    if (!arr || arr.length < 2) return undefined;
    const iv = INTERVAL_MS[klineFeedInterval(feed)];
    const known = knownHoles.get(feed);
    // a tail request reaches at most GAP_FILL_MAX bars back: older holes stay (the chart's history() pages them)
    const reach = serverNow() - GAP_FILL_MAX * iv;
    let hole: number | undefined;
    for (let i = arr.length - 1; i >= Math.max(1, arr.length - scan); i--) {
      const prev = arr[i - 1]!.time;
      if (prev < reach) break;
      if (arr[i]!.time - prev > iv && !known?.has(prev)) hole = prev;
    }
    return hole;
  }

  /** After a gap fill that covered `limit` bars: holes still inside that range have no bars at the exchange. */
  function rememberHoles(feed: FeedId, limit: number): void {
    const arr = cache.get(feed)?.data as Candle[] | undefined;
    if (!arr || arr.length < 2 || !isKlineFeed(feed)) return;
    const iv = INTERVAL_MS[klineFeedInterval(feed)];
    const covered = serverNow() - (limit - 1) * iv;
    let known = knownHoles.get(feed);
    for (let i = arr.length - 1; i >= 1 && arr[i]!.time >= covered; i--) {
      const prev = arr[i - 1]!.time;
      if (arr[i]!.time - prev > iv && prev >= covered - iv) {
        if (!known) knownHoles.set(feed, (known = new Set()));
        known.add(prev);
      }
    }
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
      case "globalAccountRatio": {
        const v = await client.ratio(feed, sym, period.period, { limit: bootstrap ? BOOTSTRAP_LIMIT.futuresData : POLL_LIMIT_FUTURES_DATA });
        set(b, feed, v);
        const twin = LIVE_RATIO_OF[feed];
        if (twin && isMirrored(twin, client.source)) set(b, twin, v);
        return b;
      }
      case "topPositionRatio5m":
      case "topAccountRatio5m":
      case "globalAccountRatio5m":
        set(b, feed, await client.ratio(LIVE_RATIO_MAIN[feed], sym, LIVE_RATIO_PERIOD, { limit: bootstrap ? LIVE_RATIO_BOOTSTRAP_LIMIT : LIVE_RATIO_POLL_LIMIT }));
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
      if (!advanced && check && check.retries < nonAdvanceRetries(spec.alignMs)) {
        const wait = NON_ADVANCE_RETRIES_MS[check.retries]!;
        check.retries += 1;
        return t + wait;
      }
      if (check) check.retries = 0;
      // Binance publishes on ITS clock: align on the corrected time, then back to the device clock for the timer
      const off = skew.offsetMs;
      return nextAlignedAt(t + off, { alignMs: spec.alignMs, lagMs: spec.lagMs, jitterMs: spec.jitterMs }, random) - off;
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
    const twin = LIVE_RATIO_OF[feed];
    if (twin && isMirrored(twin)) dispatch({ type: "schedule", feed: twin, nextRefreshAt: at });
  }

  /** A live 5-min ratio served by its main feed's request (chosen period = 5m, both on the same source). */
  function isMirrored(feed: FeedId, source?: Source): boolean {
    if (!mirrorLive || !isLiveRatioFeed(feed)) return false;
    const own = health.feeds[feed].source;
    return own === (source ?? health.feeds[LIVE_RATIO_MAIN[feed]].source);
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
    if (isMirrored(feed)) return; // fetched with its chosen-period twin
    // WS delivers (a pending gap fill after a reconnect / stall still goes out)
    if (WS_FEEDS.includes(feed) && !o.bootstrap && !o.force && !restDue.has(feed) && wsCovers(feed)) return;
    const spec = specs[feed];
    const limit = isKlineFeed(feed) ? klineLimit(feed, !!o.bootstrap) : 0;
    const units = isKlineFeed(feed) ? klineWeight(limit) : spec.cost.units;
    const cost = bucketFor(feed, source, units);
    if (!o.force && !budget.take(cost.bucket, cost.units, now())) {
      schedulePoll(feed, now() + Math.max(1000, budget.waitFor(cost.bucket, cost.units, now())), o.bootstrap);
      return;
    }
    if (o.force) budget.take(cost.bucket, cost.units, now());
    const before = newestTime(feed);
    active.add(feed);
    try {
      const batch = await fetchFeed(feed, source, !!o.bootstrap);
      active.delete(feed);
      if (!started) return;
      const t = now();
      if (!health.online) backOnline(feed); // data arrived: we are online (the event was missed)
      if (source === "binance") onBinanceOk(t);
      if (source === "binance" || source === "proxy") bans = 0;
      restDue.delete(feed);
      for (const id of FEED_IDS) {
        let v = batch[id];
        if (!v) continue;
        // WS is authoritative for feeds it currently serves; REST only fills gaps
        if (id !== feed && wsCovers(id) && !o.bootstrap) continue;
        if (isKlineFeed(id)) v = klineAsOf(v as Stamped<Candle[]>);
        else if (id === "markPrice" && (v.source === "binance" || v.source === "proxy")) noteServerTime(v.asOf, v.receivedAt);
        const prevNewest = isSeriesFeed(id) ? newestTime(id) : undefined;
        publish(id, v as Stamped<FeedValue[typeof id]>);
        lastOkAt.set(id, t);
        // the stale-feed backoff restarts only when the data moved on (a series that answers with the same old point
        // stays on the 30 s → 5 min kick backoff instead of being kicked again at once)
        if (!isSeriesFeed(id) || prevNewest === undefined || (newestTime(id) ?? 0) > prevNewest) kicks.delete(id);
        dispatch({ type: "rest_ok", feed: id, source: v.source, asOf: v.asOf, now: t });
        if (batch.detail) dispatch({ type: "bad_period", feeds: [id], detail: batch.detail, now: t });
        if (id === "markPrice") onFundingTick(v.data as FeedValue["markPrice"]);
      }
      if (isKlineFeed(feed) && !o.bootstrap && limit > 2) rememberHoles(feed, limit);
      const after = newestTime(feed);
      const advanced = before === undefined || (after !== undefined && after > before);
      if (spec.alignMs) lastAdvanceCheck.set(feed, { newest: after ?? 0, retries: lastAdvanceCheck.get(feed)?.retries ?? 0 });
      for (const id of FEED_IDS) if (batch[id] && isSeriesFeed(id)) void cache.persist(id);
      // WS-fed feeds on Binance are only polled while the socket is down (10 s); otherwise the stream delivers
      if (WS_FEEDS.includes(feed) && source === "binance" && health.ws.state !== "fallback") return;
      schedulePoll(feed, nextPollAt(feed, source, advanced));
    } catch (err) {
      active.delete(feed);
      if (!started) return;
      await onFetchError(feed, source, err);
    }
  }

  /** Binance answered over REST: evidence against a block; while marked blocked, re-probe right away. */
  function onBinanceOk(t: number): void {
    lastBinanceOkAt = t;
    netFailures.length = 0;
    if (health.primary.blocked) fastProbe(t);
  }

  /**
   * A REST kline page is stamped `min(device receive time, close time of the newest bar)`: on the Binance clock the
   * receive time is `receivedAt + skew` (a device clock running behind would otherwise age the series at once).
   */
  function klineAsOf(v: Stamped<Candle[]>): Stamped<Candle[]> {
    if (!skew.offsetMs) return v;
    const last = v.data[v.data.length - 1];
    const asOf = last ? Math.min(v.receivedAt + skew.offsetMs, last.closeTime ?? Infinity) : v.asOf;
    return asOf === v.asOf ? v : { ...v, asOf };
  }

  /** One device-vs-Binance clock observation; a changed offset is published in the health snapshot. */
  function noteServerTime(serverTime: number, localAt: number): void {
    if (skew.sample(serverTime, localAt)) dispatch({ type: "clock", skewMs: skew.offsetMs, now: now() });
  }

  /** Evidence that Binance answers while marked blocked: probe in 5 s instead of the 5–60 min backoff (throttled). */
  function fastProbe(t: number): void {
    if (t - lastFastProbeAt < FAST_PROBE_MIN_GAP_MS) return;
    lastFastProbeAt = t;
    scheduleProbe(FAST_PROBE_MS);
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

  /** German detail for the feed's tooltip / the Live-Daten table. */
  function failureDetail(kind: string, status?: number, message?: string): string | undefined {
    if (status) return HTTP_DETAIL[status] ?? `HTTP ${status}`;
    if (kind === "timeout") return "Zeitüberschreitung (keine Antwort in 15 s)";
    if (kind === "network") return `Netzwerk/CORS: ${message || "Abruf fehlgeschlagen"}`;
    if (kind === "cors") return "Browser darf die Antwort nicht lesen (CORS)";
    return message || undefined;
  }

  async function onFetchError(feed: FeedId, source: Source, err: unknown): Promise<void> {
    const t = now();
    if (err instanceof Unsupported) {
      const before = health;
      dispatch({ type: "unsupported", feed, source, now: t, detail: err.detail });
      bootstrapMoved(before);
      if (health.feeds[feed].source === source) {
        // parked (e.g. a top-trader ratio on Bybit): the proxy or the primary re-probe brings it back — never idle
        if (isFamilyFeed(feed)) void maybeProbeProxy();
        scheduleProbe();
      }
      return;
    }
    const rest = toRestError(err);
    let kind = rest.kind;
    if (kind === "offline" || !isOnline()) {
      dispatch({ type: "online", online: false, now: t });
      // keep a retry armed: the `online` event is easily missed by a frozen tab
      schedulePoll(feed, t + OFFLINE_RETRY_MS);
      return;
    }
    if (kind === "rate_limited") {
      // 429: the bucket pauses 60 s; 418 (IP banned for ignoring 429s): 2 → 4 → … 30 min. Other buckets keep going.
      const banned = rest.status === 418;
      if (banned) bans += 1;
      budget.backoff(bucketFor(feed, source, 0).bucket, t, banned ? banBackoffMs(bans) : undefined);
    }
    if (kind === "network" && source === "binance") {
      noteNetworkFailure(feed, t);
      if (await detectBlocked(t)) kind = "blocked_451";
      // a request fails again while the rest of Binance answers: the browser cannot read this endpoint (CORS / an
      // edge error without CORS headers) → the proxy, if it serves Binance's data
      else if (specs[feed].sources.includes("proxy") && health.feeds[feed].consecutiveFailures >= 1 && binanceProvenReachable(t) && health.proxy.usable === true) kind = "cors";
    }
    if (!started) return;
    const before = health;
    dispatch({ type: "rest_fail", feed, source, kind, now: t, detail: failureDetail(kind, rest.status, rest.message) });
    if (rest.status === 418 && source === "binance") routeAroundBan(t, rest.status);
    if (kind === "blocked_451") {
      dispatch({ type: "probe", source: "binance", ok: false, blocked: true, now: t });
      scheduleProbe();
    }
    bootstrapMoved(before, feed);
    const after = health.feeds[feed];
    if (after.source !== source && after.source !== "cache") {
      // moved to the next source: bootstrap there right away; a soft move off the primary gets a way back
      schedulePoll(feed, now(), true);
      if (!health.primary.blocked && after.source !== "proxy") scheduleProbe();
      return;
    }
    if (after.state === "offline") {
      scheduleProbe();
      return;
    }
    // stayed on its source: retry with a capped backoff (the ratio feeds never park on a source without a retry)
    if (isFamilyFeed(feed) && after.consecutiveFailures >= 2) void maybeProbeProxy();
    const aligned = !!specs[feed].alignMs;
    schedulePoll(feed, now() + (aligned || isFamilyFeed(feed) ? failureRetryMs(after.consecutiveFailures) : RETRY_MS));
  }

  /**
   * HTTP 418: Binance banned this IP for minutes to days. Every direct REST feed the proxy serves moves there at once
   * (the proxy asks Binance from another IP) instead of collecting three failures behind a growing pause; a primary
   * probe after the ban brings them back (the futures-data series stay on the proxy: same Binance data).
   */
  function routeAroundBan(t: number, status: number): void {
    if (health.proxy.usable !== true) return;
    const before = health;
    for (const f of FEED_IDS) {
      if (specs[f].transport !== "rest" || health.feeds[f].source !== "binance" || !specs[f].sources.includes("proxy")) continue;
      dispatch({ type: "move", feed: f, source: "proxy", now: t, reason: "rate_limited", detail: HTTP_DETAIL[status] });
      movedForBan.add(f);
    }
    bootstrapMoved(before);
    scheduleProbe(banBackoffMs(bans) + 5_000);
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

  function noteNetworkFailure(path: string, t: number): void {
    netFailures.push({ at: t, path });
    while (netFailures.length && t - netFailures[0]!.at > BLOCK_WINDOW_MS) netFailures.shift();
  }

  /** Binance itself answered recently (a WS frame or a REST success). */
  function binanceProvenReachable(t: number): boolean {
    return t - lastWsMessageAt < WS_PROOF_MS || t - lastBinanceOkAt < REST_PROOF_MS;
  }

  /**
   * Primary blocked (Plan 4.4) — strict, because a false positive takes the top traders off Binance: never while
   * Binance demonstrably answers (WS frame < 30 s, REST success < 60 s) or right after a resume; otherwise network
   * failures on ≥ 2 different Binance paths within 2 min AND Bybit answering. Bybit's answer is memoised for 30 s.
   */
  async function detectBlocked(t: number): Promise<boolean> {
    if (health.primary.blocked) return true;
    if (!symbolInfo.bybit) return false;
    if (binanceProvenReachable(t)) return false;
    if (t - resumedAt < RESUME_GRACE_MS) return false;
    const paths = new Set(netFailures.filter((x) => t - x.at <= BLOCK_WINDOW_MS).map((x) => x.path));
    if (paths.size < BLOCK_MIN_PATHS) return false;
    if (!bybitCheck || t - bybitCheck.at >= BLOCK_PROBE_MEMO_MS) {
      bybitCheck = {
        at: t,
        alive: bybit.serverTime().then(
          () => true,
          () => false,
        ),
      };
    }
    const alive = await bybitCheck.alive;
    // the socket may have delivered while Bybit was being asked
    return alive && !binanceProvenReachable(now());
  }

  function onFundingTick(m: FeedValue["markPrice"]): void {
    if (m.nextFundingTime && m.nextFundingTime !== lastNextFundingTime) {
      const first = lastNextFundingTime === 0;
      lastNextFundingTime = m.nextFundingTime;
      if (!first) schedulePoll("fundingHistory", now() + 30_000);
    }
  }

  // ------------------------------------------------------------ primary re-probe

  /**
   * Primary re-probe: after `probeBackoffMs(failures)` (5 → 60 min), or after `delayMs` (fast path: Binance answers
   * again, tab resumed). An earlier pending probe is kept, a later one is pulled forward.
   */
  function scheduleProbe(delayMs?: number): void {
    if (!started) return;
    const at = now() + (delayMs ?? probeBackoffMs(probeFailures));
    const due = scheduler.dueAt("probe");
    if (due !== undefined && due <= at) return;
    scheduler.at("probe", at, () => {
      dispatch({ type: "probe_scheduled", at: undefined, now: now() });
      void probePrimary();
    });
    dispatch({ type: "probe_scheduled", at, now: now() });
  }

  /** Something waits for the primary: blocked, or a REST feed parked on another exchange / the cache. */
  function needsProbe(): boolean {
    if (health.primary.blocked) return true;
    if (movedForBan.size > 0) return true;
    for (const f of FEED_IDS) {
      const fh = health.feeds[f];
      if (specs[f].transport !== "rest" || (specs[f].sources[0] ?? "binance") !== "binance") continue;
      if (fh.source !== "binance" && fh.source !== "proxy") return true;
      if (fh.reason === "unsupported") return true;
    }
    return false;
  }

  async function probePrimary(): Promise<void> {
    if (!started) return;
    if (!isOnline() || hidden()) {
      // retried on visibilitychange / online / by the watchdog
      return;
    }
    const t = now();
    if (!budget.take("binance.weight", 1, t)) {
      scheduleProbe();
      return;
    }
    try {
      const serverTime = await binance.serverTime();
      if (!started) return;
      noteServerTime(serverTime, now());
      probeFailures = 0;
      movedForBan.clear();
      lastBinanceOkAt = now();
      netFailures.length = 0;
      const before = health;
      dispatch({ type: "probe", source: "binance", ok: true, now: now() });
      if (preferProxy) routeFamilyToProxy();
      bootstrapMoved(before);
      if (chain.includes("binance") && health.ws.state !== "live") ws.reconnect();
    } catch (err) {
      if (!started) return;
      probeFailures += 1;
      const rest = toRestError(err);
      if (rest.kind === "network") noteNetworkFailure("probe", now());
      const blocked = rest.kind === "blocked_451" || (rest.kind === "network" && (await detectBlocked(now())));
      if (!started) return;
      const before = health;
      dispatch({ type: "probe", source: "binance", ok: false, blocked, now: now() });
      bootstrapMoved(before);
      if (needsProbe()) scheduleProbe();
    }
  }

  // ------------------------------------------------------------ proxy

  /** (Re-)probes `/api/binance` — on start, and when a ratio feed needs it (throttled to every 5 min). */
  async function maybeProbeProxy(force = false): Promise<void> {
    if (!started || !proxyAllowed || proxyProbing) return;
    const t = now();
    if (!force && t - lastProxyProbeAt < PROXY_REPROBE_MS) return;
    lastProxyProbeAt = t;
    proxyProbing = true;
    try {
      const p = await probeProxy(deps.fetch, deps.proxyBase);
      if (!started) return;
      const before = health;
      dispatch({ type: "probe", source: "proxy", ok: p.usable, blocked: p.blocked, now: now() });
      if (preferProxy) routeFamilyToProxy();
      bootstrapMoved(before);
    } finally {
      proxyProbing = false;
    }
  }

  /** `EU-Proxy verwenden`: every Binance ratio feed on the direct route moves to the usable proxy. */
  function routeFamilyToProxy(): void {
    if (health.proxy.usable !== true) return;
    for (const f of BINANCE_FAMILY_FEEDS) {
      if (health.feeds[f].source === "binance" && specs[f].sources.includes("proxy")) dispatch({ type: "move", feed: f, source: "proxy", now: now() });
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
      wsOpenedAt = t;
      lastStreamAt.clear();
      dispatch({ type: "ws_open", now: t });
      if (wsOpens > 1) {
        // close the gap after a reconnect: every bar since the newest cached one, per interval; a failed request
        // stays pending (`restDue`) and is retried with the feed's normal retry
        for (const f of KLINE_FEEDS) {
          restDue.add(f);
          void poll(f, { force: true });
        }
      }
    },
    onMessage: (raw, t) => {
      lastWsMessageAt = t;
      // the Binance socket delivers, so Binance is not blocked from here: re-probe soon instead of in 5–60 min
      if (health.primary.blocked) fastProbe(t);
      const ev = parseWsMessage(raw);
      if (!ev) return;
      switch (ev.kind) {
        case "kline": {
          const feed = `kline_${ev.interval}` as const;
          lastStreamAt.set(feed, t);
          const prev = cache.get(feed);
          // tail update (replace the forming bar / append the next one) instead of a full-ring merge per tick
          const merged = upsertBar(prev && prev.source === "binance" ? prev.data : [], ev.candle, RING_CAPACITY[feed]);
          publish(feed, { data: merged, asOf: ev.eventTime, receivedAt: t, source: "binance", comparable: true }, { replace: true });
          noteWs(feed, ev.eventTime, t);
          if (ev.candle.closed) void cache.persist(feed);
          break;
        }
        case "markPrice":
          lastStreamAt.set("markPrice", t);
          noteServerTime(ev.value.time, t);
          publish("markPrice", { data: ev.value, asOf: ev.value.time, receivedAt: t, source: "binance", comparable: true });
          noteWs("markPrice", ev.value.time, t);
          onFundingTick(ev.value);
          break;
        case "aggTrade":
          lastStreamAt.set("aggTrade", t);
          publish("aggTrade", { data: ev.value, asOf: ev.value.time, receivedAt: t, source: "binance", comparable: true });
          noteWs("aggTrade", ev.value.time, t);
          break;
        case "bookTop":
          lastStreamAt.set("bookTop", t);
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
    lastOkAt.set(feed, t);
    if (kicks.size) kicks.delete(feed);
    const fh = health.feeds[feed];
    if (fh.state === "live" && fh.source === "binance" && fh.lastDataAt !== undefined && asOf - fh.lastDataAt < 1000) return;
    if (fh.state !== "live" || fh.source !== "binance") scheduler.cancel(`poll:${feed}`); // WS took over again
    dispatch({ type: "ws_message", now: t, feeds: [feed], asOf });
  }

  // ------------------------------------------------------------ lifecycle

  function bootstrapAll(): void {
    for (const f of FEED_IDS) {
      if (f === "bookTop" && !bookTop) continue;
      if (isMirrored(f)) continue;
      if (f === "aggTrade" && chain[0] === "binance" && !health.primary.blocked) continue; // WS only, price from ticker until then
      void poll(f, { bootstrap: true });
    }
  }

  function onVisibility(): void {
    if (hidden()) {
      scheduler.pause();
      void cache.persistAll();
    } else resume("visible");
  }

  /**
   * Back in front (`visibilitychange`, `pageshow` from the back/forward cache, `focus` — a split-screen switch fires no
   * visibilitychange —, the Page Lifecycle `resume` after a freeze, `online`, or a device sleep detected by the health
   * tick): fire what fell due (spread over a few seconds), re-poll every REST feed whose data is older than its cadence,
   * reconnect a silent socket (the reconnect fills the kline gap) and re-probe parked feeds.
   */
  function resume(reason = "visible"): void {
    if (!started || hidden()) return;
    const t = now();
    if (reason !== "visible" && reason !== "wake" && t - lastResumeAt < RESUME_THROTTLE_MS) return;
    lastResumeAt = t;
    resumedAt = t;
    lastTickAt = t;
    staggerOverdue(t);
    scheduler.resume();
    kickStale(t, true);
    ws.nudge();
    if (needsProbe()) scheduleProbe(RESUME_GRACE_MS / 3);
    armTick();
  }
  const onPageShow = () => resume("pageshow");
  const onFocus = () => resume("focus");
  const onDocResume = () => resume("lifecycle");

  /**
   * Resume after the tab was hidden: every poll that fell due meanwhile would fire in the same tick, while the radio /
   * the pooled HTTP/2 connection is still waking up. Spread them over a few seconds instead.
   */
  function staggerOverdue(t: number): void {
    let i = 0;
    for (const [key, at] of scheduler.pending()) {
      if (!key.startsWith("poll:") || at > t + RESUME_STAGGER_MS) continue;
      const next = t + RESUME_STAGGER_MS + i * RESUME_STAGGER_STEP_MS + Math.floor(random() * RESUME_STAGGER_STEP_MS);
      if (scheduler.reschedule(key, next)) dispatch({ type: "schedule", feed: key.slice(5) as FeedId, nextRefreshAt: next });
      i += 1;
    }
  }
  function onOnline(): void {
    backOnline();
  }

  /**
   * Back online (the `online` event, or data arriving while marked offline because that event was missed): every
   * feed restarts `connecting`, so every REST feed is polled again now — spread over a few seconds — instead of
   * waiting for its next aligned slot (an hourly series would otherwise stay `connecting` for up to an hour).
   */
  function backOnline(except?: FeedId): void {
    const t = now();
    dispatch({ type: "online", online: true, now: t });
    ws.nudge();
    let i = 0;
    for (const f of FEED_IDS) {
      if (f === except || specs[f].transport !== "rest" || isMirrored(f)) continue;
      schedulePoll(f, t + i * RESUME_STAGGER_STEP_MS);
      i += 1;
    }
  }
  function onOffline(): void {
    dispatch({ type: "online", online: false, now: now() });
  }
  function onPageHide(): void {
    void cache.persistAll();
  }

  const tickMs = deps.tickMs ?? 5000;

  function armTick(): void {
    if (!started || scheduler.has("tick")) return;
    scheduler.in("tick", tickMs, () => {
      const t = now();
      // ticks far apart while visible: the device slept or the tab was frozen (timers do not run then) → resume
      const slept = t - lastTickAt > WAKE_TICK_FACTOR * tickMs && lastTickAt > -Infinity;
      lastTickAt = t;
      if (slept && !hidden()) resume("wake");
      dispatch({ type: "tick", now: serverNow() });
      watchdog();
      armTick();
    });
  }

  /**
   * Invariant: every REST feed has a pending poll, a poll in flight, or (parked on another exchange / the cache /
   * unsupported) a pending primary probe. Re-arms whatever slipped through (a missed `online` event, an error path
   * that returned early) — a feed that silently stops polling is exactly the "prices move, top traders don't" bug.
   */
  function watchdog(): void {
    if (!started) return;
    const t = now();
    // 1. timers that were lost (device sleep, frozen tab): the job is still listed but long overdue → re-arm now
    let i = 0;
    for (const key of scheduler.overdue(t, OVERDUE_GRACE_MS)) {
      scheduler.reschedule(key, t + i * RESUME_STAGGER_STEP_MS);
      i += 1;
    }
    // 2. every REST feed has a poll pending, in flight, or (parked) a probe
    for (const f of FEED_IDS) {
      if (specs[f].transport !== "rest" || isMirrored(f)) continue;
      if (active.has(f) || scheduler.has(`poll:${f}`)) continue;
      const fh = health.feeds[f];
      if (fh.reason === "bad_symbol") continue;
      if (fh.source === "cache" || fh.source === "tradingview" || fh.reason === "unsupported") continue; // probe below
      schedulePoll(f, t + WATCHDOG_REARM_MS + Math.floor(random() * WATCHDOG_REARM_MS), fh.lastDataAt === undefined);
    }
    if (needsProbe() && !scheduler.has("probe")) scheduleProbe();
    // 3. data older than the feed's expected cadence while its next poll is far away: re-poll (backoff per feed)
    kickStale(t, false);
    // 4. the socket: a lost silent timer, a dead socket without a pending retry, single streams that stalled, holes
    watchSocket(t);
  }

  /** Feed is parked on the cache / unsupported / bad symbol: the probe (not a poll) brings it back. */
  function parked(f: FeedId): boolean {
    const fh = health.feeds[f];
    return fh.reason === "bad_symbol" || fh.source === "cache" || fh.source === "tradingview" || fh.reason === "unsupported";
  }

  /**
   * Stale-feed watchdog for REST feeds: the data is older than the feed's `staleAfterMs` (on the Binance clock; for
   * the aligned futures-data series that means "no new point"), or nothing arrived for that long (device clock), and
   * the next poll is further away than the kick backoff (now → 30 s → 60 s → 2 min → 5 min) → poll then. A feed that
   * is failing keeps its own retry (≤ 5 min). `resume`: every feed whose data is older than ONE cadence, staggered.
   */
  function kickStale(t: number, resuming: boolean): void {
    if (!health.online && isOnline() === false) return;
    const sn = serverNow();
    let i = 0;
    for (const f of FEED_IDS) {
      const spec = specs[f];
      if (spec.transport !== "rest" || isMirrored(f) || parked(f) || active.has(f)) continue;
      if (f === "fundingHistory" && !resuming) continue; // refreshed on the funding tick; 8 h safety net
      const fh = health.feeds[f];
      if (fh.lastDataAt === undefined) continue; // bootstrap pending: the re-arm above covers it
      if (fh.consecutiveFailures > 0 && scheduler.has(`poll:${f}`)) continue; // its own retry/backoff runs
      const { cadenceMs, staleAfterMs } = effectiveSpec(spec, fh.source, fh.state);
      const dataAge = sn - fh.lastDataAt;
      const quietFor = t - (lastOkAt.get(f) ?? -Infinity);
      const limit = resuming ? cadenceMs : staleAfterMs;
      if (dataAge <= limit && quietFor <= limit) continue;
      const due = scheduler.dueAt(`poll:${f}`);
      const n = kicks.get(f) ?? 0;
      const at = t + (resuming ? RESUME_STAGGER_MS + i * RESUME_STAGGER_STEP_MS : watchdogKickMs(n));
      // a poll that comes soon anyway (e.g. staggered by a resume) is left alone
      if (due !== undefined && due <= Math.max(at, t + KICK_LEAD_MS)) continue;
      if (resuming && quietFor <= cadenceMs) continue; // fetched recently, the exchange has no newer point yet
      kicks.set(f, n + 1);
      schedulePoll(f, at);
      i += 1;
    }
  }

  /**
   * WebSocket watchdog (visible tab only): re-arms a lost silent check, reconnects a dead socket that has no retry
   * armed, fetches a stalled single stream over REST (kline gap fill included) and re-subscribes on a repeat, and
   * fills holes in the kline tails that the stream left (frames lost during a stall).
   */
  function watchSocket(t: number): void {
    if (hidden() || !chain.includes("binance") || health.primary.blocked || !symbolInfo.valid) return;
    if (ws.state === "open" && t - ws.lastMessageAt > 2 * WS_SILENT_MS) {
      ws.nudge(); // the silent timer did not fire (frozen timers)
      return;
    }
    if ((ws.state === "closed" || ws.state === "fallback" || ws.state === "silent" || ws.state === "idle") && !ws.retryPending) {
      ws.nudge();
      return;
    }
    const alive = ws.state === "open" && t - lastWsMessageAt < SOCKET_ALIVE_MS;
    if (!alive || wsOpens === 0) return;
    let stalled = 0;
    for (const f of WS_FEEDS) {
      if (f === "bookTop" && !bookTop) continue;
      if (!wsCovers(f)) continue;
      const limit = STREAM_STALL_MS[f];
      if (limit === undefined) continue;
      const last = lastStreamAt.get(f) ?? wsOpenedAt;
      if (t - last <= limit) continue;
      const n = kicks.get(f) ?? 0;
      const due = scheduler.dueAt(`poll:${f}`);
      if (due !== undefined && due > t) continue; // a REST fetch for it is already pending
      if (n > 0 && t - last < limit + watchdogKickMs(n)) continue;
      kicks.set(f, n + 1);
      stalled += 1;
      restDue.add(f);
      // the REST answer is published (`rest_ok`), the socket stays the source; the poll is not re-armed while WS covers it
      schedulePoll(f, t + stalled * RESUME_STAGGER_STEP_MS);
    }
    if (stalled > 0) {
      for (let k = 0; k < stalled; k++) streamStalls.push(t);
      while (streamStalls.length && t - streamStalls[0]! > STREAM_STALL_WINDOW_MS) streamStalls.shift();
      if (streamStalls.length >= 2) {
        streamStalls.length = 0;
        ws.reconnect(); // re-subscribe every stream; the reconnect fills the kline gaps
      }
      return;
    }
    // holes in the kline tails (frames lost while the socket stalled): fill them over REST
    for (const f of KLINE_FEEDS) {
      if (restDue.has(f) || !wsCovers(f) || scheduler.has(`poll:${f}`) || active.has(f)) continue;
      if (oldestHole(f, HOLE_SCAN_BARS) === undefined) continue;
      restDue.add(f);
      schedulePoll(f, t + WATCHDOG_REARM_MS);
    }
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
    doc?.addEventListener("resume", onDocResume);
    win?.addEventListener("online", onOnline);
    win?.addEventListener("offline", onOffline);
    win?.addEventListener("pagehide", onPageHide);
    win?.addEventListener("pageshow", onPageShow);
    win?.addEventListener("focus", onFocus);
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
    void maybeProbeProxy(true);
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
    active.clear();
    netFailures.length = 0;
    bybitCheck = null;
    lastFastProbeAt = -Infinity;
    lastAdvanceCheck.clear();
    lastOkAt.clear();
    lastStreamAt.clear();
    streamStalls.length = 0;
    kicks.clear();
    restDue.clear();
    knownHoles.clear();
    lastTickAt = -Infinity;
    lastResumeAt = -Infinity;
    wsOpenedAt = -Infinity;
    bans = 0;
    movedForBan.clear();
    doc?.removeEventListener("visibilitychange", onVisibility);
    doc?.removeEventListener("resume", onDocResume);
    win?.removeEventListener("online", onOnline);
    win?.removeEventListener("offline", onOffline);
    win?.removeEventListener("pagehide", onPageHide);
    win?.removeEventListener("pageshow", onPageShow);
    win?.removeEventListener("focus", onFocus);
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
    const isFutures = ALL_FUTURES_DATA_FEEDS.includes(feed);
    const feedPeriod = (specs[feed].period ?? period.period) as Period;
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
            if (!budget.take("binance.weight", klineWeight(HISTORY_PAGE_LIMIT), now(), "bulk")) break;
            page = (await client.klines(sym, iv, { limit: HISTORY_PAGE_LIMIT, endTime })) as Stamped<FeedValue[F]>;
          } else if (source === "bybit" && symbolInfo.bybit) {
            if (!budget.take("bybit.ip", 1, now(), "bulk")) break;
            page = (await bybit.klines(symbolInfo.bybit, iv, { limit: 1000, end: endTime })) as Stamped<FeedValue[F]>;
          } else break;
        } else if (client && isFutures) {
          if (!budget.take("binance.futuresData", 1, now(), "bulk")) break;
          const p = { limit: 500, startTime: Math.max(from, endTime - 500 * specs[feed].cadenceMs), endTime };
          if (feed === "openInterestHist") page = (await client.openInterestHist(sym, feedPeriod, p)) as Stamped<FeedValue[F]>;
          else if (feed === "takerRatio") page = (await client.takerRatio(sym, feedPeriod, p)) as Stamped<FeedValue[F]>;
          else {
            const kind = isLiveRatioFeed(feed) ? LIVE_RATIO_MAIN[feed] : (feed as "topPositionRatio" | "topAccountRatio" | "globalAccountRatio");
            page = (await client.ratio(kind, sym, feedPeriod, p)) as Stamped<FeedValue[F]>;
          }
        } else if (client && feed === "fundingHistory") {
          if (!budget.take("binance.funding", 1, now(), "bulk")) break;
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

  /** Waits for `bulk` tokens (never below the live reserve, see `BULK_RESERVE`). */
  async function waitBudget(bucket: FeedSpec["cost"]["bucket"], units: number, maxWaitMs: number, cls: BudgetClass = "bulk"): Promise<void> {
    const deadline = now() + maxWaitMs;
    while (!budget.take(bucket, units, now(), cls)) {
      const wait = Math.max(50, budget.waitFor(bucket, units, now(), cls));
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
      let bootstrap = false;
      if (o?.force && started) {
        // `Jetzt aktualisieren` on a feed parked elsewhere while Binance is not blocked: ask Binance again
        const fh = health.feeds[f];
        const primary = specs[f].sources[0] ?? "binance";
        if (specs[f].transport === "rest" && fh.source !== primary && fh.source !== "proxy" && !health.primary.blocked && !isMirrored(f)) {
          dispatch({ type: "move", feed: f, source: primary, now: now() });
          bootstrap = true;
        }
      }
      await poll(f, { force: !!o?.force, bootstrap });
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
    setPreferProxy(on) {
      if (preferProxy === on) return;
      preferProxy = on;
      if (!started) return;
      const before = health;
      if (on) {
        if (health.proxy.usable === true) routeFamilyToProxy();
        else void maybeProbeProxy(true);
      } else if (!health.primary.blocked) {
        for (const f of BINANCE_FAMILY_FEEDS) if (health.feeds[f].source === "proxy") dispatch({ type: "move", feed: f, source: "binance", now: now() });
      }
      bootstrapMoved(before);
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
    serverNow,
    resume: (reason?: string) => resume(reason ?? "manual"),
  };
  return provider;
}

/** Utility for adapters/tests: build a kline series stamped as Binance. */
export function stampCandles(data: Candle[], asOf: number, receivedAt: number, source: Source = "binance"): Stamped<Candle[]> {
  return { data, asOf, receivedAt, source, comparable: true };
}

export { INTERVAL_MS };
