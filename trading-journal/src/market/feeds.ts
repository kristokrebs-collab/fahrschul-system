/**
 * Feed table (Plan 4.2 / 4.5): cadence, staleness, alignment, cost and source preference per feed.
 * The ratio feeds depend on the configured period, so the table is built per provider instance.
 */
import type { FeedId, FeedSpec, HealthState, KlineFeed, LiveRatioFeed, RatioFeed, SeriesFeed, Source } from "./types";
import { INTERVAL_MS, PERIOD_MS, type FetchInterval, type KlineInterval, type Period } from "./period";

export const FEED_IDS: readonly FeedId[] = [
  "kline_1m",
  "kline_15m",
  "kline_1h",
  "kline_4h",
  "kline_1w",
  "kline_1d",
  "markPrice",
  "bookTop",
  "aggTrade",
  "ticker24h",
  "openInterest",
  "openInterestHist",
  "topPositionRatio",
  "topAccountRatio",
  "globalAccountRatio",
  "takerRatio",
  "topPositionRatio5m",
  "topAccountRatio5m",
  "globalAccountRatio5m",
  "fundingHistory",
];

/** Kline feeds the WebSocket streams (`kline_1d` is REST only and not part of them). */
export const KLINE_FEEDS: readonly KlineFeed[] = ["kline_1m", "kline_15m", "kline_1h", "kline_4h", "kline_1w"];
/**
 * Daily candles (Lage-Ampel, a `1D` ladder rung): REST only, cached like every series. The first start fetches
 * `BOOTSTRAP_LIMIT.kline1d` days (weight 5) unless the cache already holds them; afterwards only the missing days
 * (`limit` 2–3, weight 1) on hourly polls at hh:00:20 on the Binance clock — the closed day arrives 20 s after 00:00
 * UTC (a page that does not have it yet is asked again after 60 s, up to 30 min). Stale after 25 h.
 */
export const DAILY_FEED = "kline_1d" as const satisfies KlineFeed;
/** Hourly poll of the daily feed, `DAILY_LAG_MS` after the hour on the Binance clock. */
export const DAILY_POLL_MS = 3_600_000;
export const DAILY_LAG_MS = 20_000;
/** Daily feed: days held at least before a start skips the full bootstrap page (the cache serves them). */
export const DAILY_CACHE_MIN = 900;
export const RATIO_FEEDS: readonly RatioFeed[] = ["topPositionRatio", "topAccountRatio", "globalAccountRatio", "takerRatio"];
/** Feeds polled from `/futures/data/*` at the chosen ratio period (`settings.hyblock.timeframe`), aligned to that period. */
export const FUTURES_DATA_FEEDS: readonly FeedId[] = [...RATIO_FEEDS, "openInterestHist"];
/** The Binance ratios at the fixed 5-min period (fresh Top-Trader reading, see `LiveRatioFeed`). */
export const LIVE_RATIO_FEEDS: readonly LiveRatioFeed[] = ["topPositionRatio5m", "topAccountRatio5m", "globalAccountRatio5m"];
export const LIVE_RATIO_PERIOD: Period = "5m";
/** Live feed → the chosen-period feed with the same ratio. */
export const LIVE_RATIO_MAIN: Record<LiveRatioFeed, "topPositionRatio" | "topAccountRatio" | "globalAccountRatio"> = {
  topPositionRatio5m: "topPositionRatio",
  topAccountRatio5m: "topAccountRatio",
  globalAccountRatio5m: "globalAccountRatio",
};
/** Chosen-period feed → its 5-min live twin. */
export const LIVE_RATIO_OF: Partial<Record<FeedId, LiveRatioFeed>> = {
  topPositionRatio: "topPositionRatio5m",
  topAccountRatio: "topAccountRatio5m",
  globalAccountRatio: "globalAccountRatio5m",
};
/** Every `/futures/data/*` feed (chosen period + live): 30-day retention, period-tagged cache keys. */
export const ALL_FUTURES_DATA_FEEDS: readonly FeedId[] = [...FUTURES_DATA_FEEDS, ...LIVE_RATIO_FEEDS];
/**
 * Top-trader / retail ratios: only Binance has these cohorts (direct or through the proxy, which serves the same
 * data). A soft failure (network, timeout, 5xx, 429) never moves them to Bybit/OKX — they retry on Binance with a
 * capped backoff and switch to the proxy when it is usable; only a real geo-block (451) hands `globalAccountRatio`
 * to Bybit's all-accounts series.
 */
export const BINANCE_FAMILY_FEEDS: readonly FeedId[] = [...RATIO_FEEDS, ...LIVE_RATIO_FEEDS];
export const SERIES_FEEDS: readonly SeriesFeed[] = [...KLINE_FEEDS, DAILY_FEED, "openInterestHist", ...RATIO_FEEDS, ...LIVE_RATIO_FEEDS, "fundingHistory"];
export const WS_FEEDS: readonly FeedId[] = [...KLINE_FEEDS, "markPrice", "bookTop", "aggTrade"];

/** Feeds Bybit cannot serve at all (Plan 4.5: card shows `Nur mit Binance`). */
export const BYBIT_UNSUPPORTED: readonly FeedId[] = ["topPositionRatio", "topAccountRatio", "takerRatio", ...LIVE_RATIO_FEEDS];
/** Feeds OKX cannot serve. */
export const OKX_UNSUPPORTED: readonly FeedId[] = ["markPrice", "bookTop", "aggTrade", "ticker24h", "openInterest", "openInterestHist", "fundingHistory", ...LIVE_RATIO_FEEDS];

export function isFamilyFeed(feed: FeedId): boolean {
  return BINANCE_FAMILY_FEEDS.includes(feed);
}
export function isLiveRatioFeed(feed: FeedId): feed is LiveRatioFeed {
  return (LIVE_RATIO_FEEDS as readonly FeedId[]).includes(feed);
}

/** REST polling cadence for WS-fed feeds when the socket is dead (Plan 4.2 "nach 3 Fehlversuchen"). */
export const WS_REST_FALLBACK_MS = 10_000;
/**
 * REST polling cadence of the LAST PRICE (`aggTrade`, served by `ticker/24hr`) whenever the socket is not delivering —
 * from the first silence on, not only after three failed attempts: the price is what the user looks at.
 */
export const PRICE_REST_FALLBACK_MS = 5_000;
/**
 * The last price prefers the trade stream over the book mid over the ticker — but only while the preferred value is
 * within this much of the newest candidate (`asOf`, exchange clock). A trade price older than that loses to a fresher
 * ticker price (a silent trade stream must never keep a frozen number on screen while REST delivers).
 */
export const PRICE_PREFER_MS = 5_000;
/** The market card calls a last price older than this `veraltet` (`Kein Live-Kurs`): nothing — stream or REST — delivered for 2 min. */
export const PRICE_STALE_MS = 120_000;

export const DEFAULT_SOURCE_CHAIN: readonly Source[] = ["binance", "bybit", "proxy", "cache"];

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/**
 * Bootstrap limits per Plan 4.2; `kline15m`: 1500 × 15m = 500 × 45m for the signal check (weight 10, once); `kline1d`:
 * 1000 days for the Lage-Ampel (weight 5, only when the cache does not hold them).
 */
export const BOOTSTRAP_LIMIT = { kline: 499, kline15m: 1500, kline1w: 200, kline1d: 1000, futuresData: 500, funding: 200 } as const;
/** Largest page the gap fill after a WS reconnect requests (Binance maximum). */
export const GAP_FILL_MAX = 1500;
export const POLL_LIMIT_FUTURES_DATA = 30;
/**
 * Live 5-min ratios: 52 points (4 h 20 min) on bootstrap, the last 3 on every poll (upserted into the ring). The longest
 * Whale–Retail-Delta window (4h) compares with the point 48 periods before the newest one, so it has its change from the
 * first load (3 points of slack for a late or missing snapshot).
 */
export const LIVE_RATIO_BOOTSTRAP_LIMIT = 52;
export const LIVE_RATIO_POLL_LIMIT = 3;
export const HISTORY_PAGE_LIMIT = 1500;
export const HISTORY_MAX_CALLS = 8;
/** `/futures/data/*` history depth. */
export const FUTURES_DATA_RETENTION_MS = 30 * DAY;

export function klineFeedInterval(feed: KlineFeed): FetchInterval {
  return feed.slice(6) as FetchInterval;
}
/** REST bootstrap limit of a kline feed. */
export function klineBootstrapLimit(interval: FetchInterval): number {
  return interval === "1w" ? BOOTSTRAP_LIMIT.kline1w : interval === "15m" ? BOOTSTRAP_LIMIT.kline15m : interval === "1d" ? BOOTSTRAP_LIMIT.kline1d : BOOTSTRAP_LIMIT.kline;
}
export function klineFeedFor(interval: KlineInterval): KlineFeed {
  return `kline_${interval}` as KlineFeed;
}
export function isKlineFeed(feed: FeedId): feed is KlineFeed {
  return feed.startsWith("kline_");
}
export function isSeriesFeed(feed: FeedId): feed is SeriesFeed {
  return (SERIES_FEEDS as readonly FeedId[]).includes(feed);
}

function klineSpec(interval: KlineInterval, chain: readonly Source[]): FeedSpec {
  const iv = INTERVAL_MS[interval];
  return {
    id: klineFeedFor(interval),
    transport: "ws",
    cadenceMs: interval === "1w" ? iv : 250,
    // 1w: closeW is valid until the next weekly close (7 d + 1 h); others 2·interval + 60 s
    staleAfterMs: interval === "1w" ? 7 * DAY + HOUR : 2 * iv + MIN,
    cost: { bucket: "binance.weight", units: 2 },
    sources: [...chain],
  };
}

/**
 * `/futures/data/*` feed at `period`. Polls are aligned to the PERIOD boundary (+60–105 s: Binance publishes the
 * point about a minute after the boundary) — a 1h series gets a new point once per hour, so polling it every 5 min
 * only burned requests. A poll that brings no new point is retried after 60 s (+2 / +5 min for periods > 5 min).
 */
function futuresDataSpec(id: FeedId, period: Period, chain: readonly Source[]): FeedSpec {
  return {
    id,
    transport: "rest",
    cadenceMs: PERIOD_MS[period],
    staleAfterMs: 2 * PERIOD_MS[period] + 2 * MIN,
    alignMs: Math.max(5 * MIN, PERIOD_MS[period]),
    lagMs: 60_000,
    jitterMs: 45_000,
    cost: { bucket: "binance.futuresData", units: 1 },
    sources: [...chain],
    period,
  };
}

/** Live 5-min ratio: Binance only (direct or proxy), never Bybit/OKX (other cohort). */
function liveRatioSpec(id: LiveRatioFeed, chain: readonly Source[]): FeedSpec {
  return { ...futuresDataSpec(id, LIVE_RATIO_PERIOD, chain.filter((s) => s === "binance" || s === "proxy" || s === "cache")) };
}

/** Builds the full spec table for a period and a source chain (default: Binance → Bybit → Proxy → Cache). */
export function buildFeedSpecs(period: Period, chain: readonly Source[] = DEFAULT_SOURCE_CHAIN): Record<FeedId, FeedSpec> {
  const c = chain;
  return {
    kline_1m: klineSpec("1m", c),
    kline_15m: klineSpec("15m", c),
    kline_1h: klineSpec("1h", c),
    kline_4h: klineSpec("4h", c),
    kline_1w: klineSpec("1w", c),
    // REST only, hourly at hh:00:20 (Binance clock; the scheduling is the provider's `nextPollAt`), stale after 25 h
    kline_1d: { id: "kline_1d", transport: "rest", cadenceMs: DAILY_POLL_MS, staleAfterMs: 25 * HOUR, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    markPrice: { id: "markPrice", transport: "ws", cadenceMs: 1000, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    bookTop: { id: "bookTop", transport: "ws", cadenceMs: 250, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 0 }, sources: [...c] },
    // the REST stand-in for the trade stream is `ticker/24hr` (weight 1): a WS feed's cost is charged only for REST polls
    aggTrade: { id: "aggTrade", transport: "ws", cadenceMs: 100, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    ticker24h: { id: "ticker24h", transport: "rest", cadenceMs: 30_000, staleAfterMs: 90_000, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    openInterest: { id: "openInterest", transport: "rest", cadenceMs: 60_000, staleAfterMs: 180_000, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    openInterestHist: futuresDataSpec("openInterestHist", period, c),
    topPositionRatio: futuresDataSpec("topPositionRatio", period, c),
    topAccountRatio: futuresDataSpec("topAccountRatio", period, c),
    globalAccountRatio: futuresDataSpec("globalAccountRatio", period, c),
    takerRatio: futuresDataSpec("takerRatio", period, c),
    topPositionRatio5m: liveRatioSpec("topPositionRatio5m", c),
    topAccountRatio5m: liveRatioSpec("topAccountRatio5m", c),
    globalAccountRatio5m: liveRatioSpec("globalAccountRatio5m", c),
    fundingHistory: { id: "fundingHistory", transport: "rest", cadenceMs: 8 * HOUR, staleAfterMs: 9 * HOUR, cost: { bucket: "binance.funding", units: 1 }, sources: [...c] },
  };
}

/** Cadence of the Bybit REST fallback per feed (Plan 4.5 table). */
export const BYBIT_FALLBACK_CADENCE_MS: Partial<Record<FeedId, number>> = {
  markPrice: 5000,
  bookTop: 5000,
  ticker24h: 5000,
  openInterest: 5000,
  aggTrade: 5000,
  kline_1m: 10_000,
  kline_15m: 10_000,
  kline_1h: 10_000,
  kline_4h: 10_000,
  kline_1w: 10_000,
};
export const BYBIT_FALLBACK_STALE_MS: Partial<Record<FeedId, number>> = {
  markPrice: 15_000,
  bookTop: 15_000,
  ticker24h: 15_000,
  openInterest: 15_000,
  aggTrade: 15_000,
};

/**
 * Effective cadence / staleness for a feed served by a given source. WS feeds in `fallback` on Binance
 * itself (socket not delivering, REST polling every 10 s — the last price every 5 s) report the polling cadence.
 */
export function effectiveSpec(spec: FeedSpec, source: Source, state?: HealthState): { cadenceMs: number; staleAfterMs: number } {
  if (source === "binance" && spec.transport === "ws" && state === "fallback") {
    const cadenceMs = spec.id === "aggTrade" ? PRICE_REST_FALLBACK_MS : WS_REST_FALLBACK_MS;
    return { cadenceMs, staleAfterMs: 3 * cadenceMs };
  }
  if (source === "bybit" || source === "okx") {
    return {
      cadenceMs: BYBIT_FALLBACK_CADENCE_MS[spec.id] ?? spec.cadenceMs,
      staleAfterMs: BYBIT_FALLBACK_STALE_MS[spec.id] ?? spec.staleAfterMs,
    };
  }
  if (source === "proxy" && spec.transport === "ws") {
    // proxy has no WS: REST polling every 10 s
    return { cadenceMs: WS_REST_FALLBACK_MS, staleAfterMs: 3 * WS_REST_FALLBACK_MS };
  }
  return { cadenceMs: spec.cadenceMs, staleAfterMs: spec.staleAfterMs };
}
