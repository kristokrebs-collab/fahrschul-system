/**
 * Market data provider contract (Plan 4.3). Implemented in `market/provider.ts`; sources in `market/sources/*`.
 * The market owner may extend `FeedValue` shapes but must keep the public surface below stable —
 * the views are written against it.
 */
export type Source = "binance" | "bybit" | "okx" | "proxy" | "tradingview" | "cache";
export type HealthState = "connecting" | "live" | "stale" | "fallback" | "offline";

export type KlineFeed = "kline_1m" | "kline_15m" | "kline_1h" | "kline_4h" | "kline_1w";
export type RatioFeed = "topPositionRatio" | "topAccountRatio" | "globalAccountRatio" | "takerRatio";
/**
 * Additive: the same Binance ratios at the fixed 5-min period, independent of the chosen ratio period
 * (`settings.hyblock.timeframe`). They give the Top-Trader card a reading that refreshes every 5 minutes while the
 * chosen-period series keeps the history (`Δ+ Kerzen`, sparkline).
 */
export type LiveRatioFeed = "topPositionRatio5m" | "topAccountRatio5m" | "globalAccountRatio5m";
export type FeedId =
  | KlineFeed
  | "markPrice"
  | "bookTop"
  | "aggTrade"
  | "ticker24h"
  | "openInterest"
  | "openInterestHist"
  | RatioFeed
  | LiveRatioFeed
  | "fundingHistory";

export interface Candle {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** true when the candle is closed */
  closed: boolean;
  /** close time, ms UTC (additive; `time + intervalMs − 1` when the source does not report it) */
  closeTime?: number;
  quoteVolume?: number;
  trades?: number;
  takerBuyBase?: number;
}
export interface MarkPrice {
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  time: number;
}
export interface BookTop {
  bid: number;
  ask: number;
  time: number;
}
export interface AggTrade {
  price: number;
  qty: number;
  isBuyerMaker: boolean;
  time: number;
}
export interface Ticker24h {
  lastPrice: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  time: number;
}
export interface OpenInterest {
  openInterest: number;
  time: number;
}
export interface OpenInterestPoint {
  time: number;
  openInterest: number;
  openInterestValue: number;
}
/** Long/short ratio point (Binance `futures/data/*`). `longPct` is 0–100. */
export interface RatioPoint {
  time: number;
  longPct: number;
  shortPct: number;
  ratio: number;
}
export interface TakerPoint {
  time: number;
  buyVol: number;
  sellVol: number;
  buySellRatio: number;
}
export interface FundingPoint {
  time: number;
  fundingRate: number;
}

export interface FeedValue {
  kline_1m: Candle[];
  /** additive: feeds the signal check (30m = 2 × 15m, 45m = 3 × 15m) */
  kline_15m: Candle[];
  kline_1h: Candle[];
  kline_4h: Candle[];
  kline_1w: Candle[];
  markPrice: MarkPrice;
  bookTop: BookTop;
  aggTrade: AggTrade;
  ticker24h: Ticker24h;
  openInterest: OpenInterest;
  openInterestHist: OpenInterestPoint[];
  topPositionRatio: RatioPoint[];
  topAccountRatio: RatioPoint[];
  globalAccountRatio: RatioPoint[];
  takerRatio: TakerPoint[];
  topPositionRatio5m: RatioPoint[];
  topAccountRatio5m: RatioPoint[];
  globalAccountRatio5m: RatioPoint[];
  fundingHistory: FundingPoint[];
}
export type SeriesFeed = KlineFeed | "openInterestHist" | RatioFeed | LiveRatioFeed | "fundingHistory";

export interface Stamped<T> {
  data: T;
  /** timestamp the data refers to (exchange time) */
  asOf: number;
  receivedAt: number;
  source: Source;
  /** false when a fallback source is not semantically comparable to the Binance feed */
  comparable: boolean;
}

export type CostBucket =
  | "binance.weight"
  | "binance.futuresData"
  | "binance.funding"
  | "bybit.ip"
  | "okx.rubik"
  | "okx.market"
  | "proxy";

export interface FeedSpec {
  id: FeedId;
  transport: "ws" | "rest";
  cadenceMs: number;
  staleAfterMs: number;
  alignMs?: number;
  lagMs?: number;
  jitterMs?: number;
  cost: { bucket: CostBucket; units: number };
  sources: Source[];
  /** additive: the `/futures/data/*` period this feed is requested with (futures-data feeds only) */
  period?: string;
}

export type FailureReason =
  | "network"
  | "cors"
  | "blocked_451"
  | "rate_limited"
  | "http_5xx"
  | "ws_closed"
  | "ws_silent"
  | "offline"
  | "bad_symbol"
  | "bad_period"
  | "beyond_retention"
  /** additive: the current source has no equivalent for this feed (e.g. Bybit top-trader ratios) */
  | "unsupported"
  /** additive: the request timed out (soft failure, never read as a geo-block) */
  | "timeout";

export interface FeedHealth {
  feed: FeedId;
  state: HealthState;
  source: Source;
  lastDataAt?: number;
  nextRefreshAt?: number;
  consecutiveFailures: number;
  reason?: FailureReason;
  /** additive: human-readable German detail for tooltips (e.g. "Bybit: 2h → 1h") */
  detail?: string;
}

export interface ProviderHealth {
  overall: HealthState;
  online: boolean;
  /** `nextProbeAt` (additive): when the provider re-probes Binance (blocked primary or feeds parked elsewhere) */
  primary: { source: "binance"; reachable: boolean | "unknown"; blocked: boolean; lastProbeAt?: number; nextProbeAt?: number };
  proxy: { usable: boolean | "unknown"; blocked?: boolean };
  ws: { state: HealthState; connectedAt?: number; lastMessageAt?: number; attempt: number; nextRetryAt?: number };
  feeds: Record<FeedId, FeedHealth>;
}

/** Additive: events consumed by the pure health reducer in `market/health.ts`. */
export type HealthEvent =
  | { type: "start"; now: number }
  | { type: "stop"; now: number }
  | { type: "online"; online: boolean; now: number }
  | { type: "tick"; now: number }
  | { type: "ws_open"; now: number }
  | { type: "ws_message"; now: number; feeds: FeedId[]; asOf?: number }
  | { type: "ws_close"; code: number; now: number; failedAttempts: number }
  | { type: "ws_silent"; now: number }
  | { type: "ws_retry"; now: number; attempt: number; nextRetryAt: number }
  | { type: "rest_ok"; feed: FeedId; source: Source; asOf: number; now: number; nextRefreshAt?: number }
  | { type: "rest_fail"; feed: FeedId; source: Source; kind: FailureReason; now: number; detail?: string }
  | { type: "schedule"; feed: FeedId; nextRefreshAt: number }
  | { type: "probe"; source: "binance" | "proxy" | "bybit" | "okx"; ok: boolean; now: number; blocked?: boolean }
  | { type: "unsupported"; feed: FeedId; source: Source; now: number; detail?: string }
  /** additive: explicit source switch by the provider (proxy routing, a forced refresh back on the primary) */
  | { type: "move"; feed: FeedId; source: Source; now: number; reason?: FailureReason; detail?: string }
  /** additive: the next primary re-probe (`undefined` = none pending) */
  | { type: "probe_scheduled"; at: number | undefined; now: number }
  | { type: "bad_period"; feeds: FeedId[]; detail: string; now: number }
  | { type: "bad_symbol"; now: number };

export interface StatusLabel {
  tone: "live" | "warn" | "error" | "muted";
  text: string;
  detail?: string;
}

export interface MarketDataProvider {
  /** Binance symbol, e.g. "BTCUSDT" (derived from settings.market.symbol "BINANCE:BTCUSDT"). */
  readonly symbol: string;
  start(): void;
  stop(): void;
  get<F extends FeedId>(f: F): Stamped<FeedValue[F]> | undefined;
  subscribe<F extends FeedId>(f: F, cb: (v: Stamped<FeedValue[F]>) => void): () => void;
  refresh(f: FeedId, o?: { force?: boolean }): Promise<void>;
  history<F extends SeriesFeed>(f: F, range: { from: number; to: number }): Promise<Stamped<FeedValue[F]>>;
  getHealth(): ProviderHealth;
  onHealth(cb: (h: ProviderHealth) => void): () => void;
  statusLabel(f: FeedId, now?: number): StatusLabel;
}
