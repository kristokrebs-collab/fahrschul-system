/**
 * Market data provider contract (Plan 4.3). Implemented in `market/provider.ts`; sources in `market/sources/*`.
 * The market owner may extend `FeedValue` shapes but must keep the public surface below stable —
 * the views are written against it.
 */
export type Source = "binance" | "bybit" | "okx" | "proxy" | "tradingview" | "cache";
export type HealthState = "connecting" | "live" | "stale" | "fallback" | "offline";

export type KlineFeed = "kline_1m" | "kline_1h" | "kline_4h" | "kline_1w";
export type RatioFeed = "topPositionRatio" | "topAccountRatio" | "globalAccountRatio" | "takerRatio";
export type FeedId =
  | KlineFeed
  | "markPrice"
  | "bookTop"
  | "aggTrade"
  | "ticker24h"
  | "openInterest"
  | "openInterestHist"
  | RatioFeed
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
  fundingHistory: FundingPoint[];
}
export type SeriesFeed = KlineFeed | "openInterestHist" | RatioFeed | "fundingHistory";

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
  | "beyond_retention";

export interface FeedHealth {
  feed: FeedId;
  state: HealthState;
  source: Source;
  lastDataAt?: number;
  nextRefreshAt?: number;
  consecutiveFailures: number;
  reason?: FailureReason;
}

export interface ProviderHealth {
  overall: HealthState;
  online: boolean;
  primary: { source: "binance"; reachable: boolean | "unknown"; blocked: boolean; lastProbeAt?: number };
  proxy: { usable: boolean | "unknown" };
  ws: { state: HealthState; connectedAt?: number; lastMessageAt?: number; attempt: number; nextRetryAt?: number };
  feeds: Record<FeedId, FeedHealth>;
}

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
