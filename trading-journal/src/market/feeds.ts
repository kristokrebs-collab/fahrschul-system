/**
 * Feed table (Plan 4.2 / 4.5): cadence, staleness, alignment, cost and source preference per feed.
 * The ratio feeds depend on the configured period, so the table is built per provider instance.
 */
import type { FeedId, FeedSpec, HealthState, KlineFeed, LiveRatioFeed, RatioFeed, SeriesFeed, Source } from "./types";
import { INTERVAL_MS, PERIOD_MS, type KlineInterval, type Period } from "./period";

export const FEED_IDS: readonly FeedId[] = [
  "kline_1m",
  "kline_15m",
  "kline_1h",
  "kline_4h",
  "kline_1w",
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

export const KLINE_FEEDS: readonly KlineFeed[] = ["kline_1m", "kline_15m", "kline_1h", "kline_4h", "kline_1w"];
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
export const SERIES_FEEDS: readonly SeriesFeed[] = [...KLINE_FEEDS, "openInterestHist", ...RATIO_FEEDS, ...LIVE_RATIO_FEEDS, "fundingHistory"];
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

export const DEFAULT_SOURCE_CHAIN: readonly Source[] = ["binance", "bybit", "proxy", "cache"];

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Bootstrap limits per Plan 4.2; `kline15m`: 1500 × 15m = 500 × 45m for the signal check (weight 10, once). */
export const BOOTSTRAP_LIMIT = { kline: 499, kline15m: 1500, kline1w: 200, futuresData: 500, funding: 200 } as const;
/** Largest page the gap fill after a WS reconnect requests (Binance maximum). */
export const GAP_FILL_MAX = 1500;
export const POLL_LIMIT_FUTURES_DATA = 30;
/** Live 5-min ratios: 36 points (3 h) on bootstrap, the last 3 on every poll (upserted into the ring). */
export const LIVE_RATIO_BOOTSTRAP_LIMIT = 36;
export const LIVE_RATIO_POLL_LIMIT = 3;
export const HISTORY_PAGE_LIMIT = 1500;
export const HISTORY_MAX_CALLS = 8;
/** `/futures/data/*` history depth. */
export const FUTURES_DATA_RETENTION_MS = 30 * DAY;

export function klineFeedInterval(feed: KlineFeed): KlineInterval {
  return feed.slice(6) as KlineInterval;
}
/** REST bootstrap limit of a kline feed. */
export function klineBootstrapLimit(interval: KlineInterval): number {
  return interval === "1w" ? BOOTSTRAP_LIMIT.kline1w : interval === "15m" ? BOOTSTRAP_LIMIT.kline15m : BOOTSTRAP_LIMIT.kline;
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
    markPrice: { id: "markPrice", transport: "ws", cadenceMs: 1000, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 1 }, sources: [...c] },
    bookTop: { id: "bookTop", transport: "ws", cadenceMs: 250, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 0 }, sources: [...c] },
    aggTrade: { id: "aggTrade", transport: "ws", cadenceMs: 100, staleAfterMs: 5000, cost: { bucket: "binance.weight", units: 0 }, sources: [...c] },
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
 * itself (socket dead, REST polling every 10 s) report the polling cadence.
 */
export function effectiveSpec(spec: FeedSpec, source: Source, state?: HealthState): { cadenceMs: number; staleAfterMs: number } {
  if (source === "binance" && spec.transport === "ws" && state === "fallback") return { cadenceMs: WS_REST_FALLBACK_MS, staleAfterMs: 3 * WS_REST_FALLBACK_MS };
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
