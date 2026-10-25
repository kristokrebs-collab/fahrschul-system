/**
 * The stock data contract (F67/F68): what the app asks for and in which shape every answer arrives. Pure types and
 * constants – no imports from the app, so the Netlify functions use them by relative path.
 *
 * Every value carries where it came from and when (`source`, `asOf`, `receivedAt`). A failure is a typed result, never
 * a thrown error and never invented data:
 *   `ok`           fresh data
 *   `stale`        the refresh failed, the last good data is shown with its own stand and the reason
 *   `unavailable`  nothing to show, with the reason in words
 */

export const STOCK_INTERVALS = ["1m", "5m", "15m", "1h", "1d"] as const;
export type StockInterval = (typeof STOCK_INTERVALS)[number];

export const STOCK_INTERVAL_MS: Readonly<Record<StockInterval, number>> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000 };

/** Where a value comes from. `(string & {})` keeps the list open: other news sources (SEC 8-K …) add their own id. */
export type StockSourceId = "yahoo" | "yahoo-rss" | "nasdaqtrader" | "cache" | (string & {});

export const SOURCE_NAME: Readonly<Record<string, string>> = {
  yahoo: "Yahoo Finance (inoffiziell)",
  "yahoo-rss": "Yahoo Finance Schlagzeilen",
  nasdaqtrader: "Nasdaq Trader Symbolverzeichnis",
  cache: "Zwischenspeicher dieses Browsers",
};

/** The market's candle: the same shape as the crypto feeds (`time` = open time in ms UTC), so every rule works on both. */
export interface StockCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** the bar is complete at `receivedAt` (its interval, or for a daily bar its session, is over) */
  closed: boolean;
}

export interface Stamp {
  source: StockSourceId;
  /** the time the data refers to (last candle / quote time / file time); `null` = the source did not say */
  asOf: number | null;
  /** when this app received it */
  receivedAt: number;
  /** when the server fetched it upstream (a cached server answer is older than `receivedAt`) */
  fetchedAt?: number;
}

export type UnavailableReason =
  /** the server functions are not deployed here (static host, offline file) */
  | "no-server"
  | "offline"
  /** the device is online but the server did not answer */
  | "network"
  | "timeout"
  /** 401: sign-in needed (payments are on) */
  | "login"
  /** 402: not included in the plan */
  | "plan"
  | "rate-limited"
  /** the source refuses requests from our server (HTTP 401/403 from Yahoo, a block) */
  | "blocked"
  /** the source answered with an error or not at all */
  | "upstream"
  | "bad-symbol"
  /** the symbol is known but there is nothing to show (no trades, new listing) */
  | "no-data"
  | "bad-response"
  | "aborted";

export type StockResult<T> =
  | ({ status: "ok"; data: T } & Stamp)
  | ({ status: "stale"; data: T; reason: UnavailableReason; message: string; failedAt: number } & Stamp)
  | { status: "unavailable"; reason: UnavailableReason; message: string; at: number; source?: StockSourceId };

export interface BarsMeta {
  name: string | null;
  currency: string | null;
  exchange: string | null;
  /** last regular-market price the source reports */
  price: number | null;
  /** the close of the session before (derived from daily candles, else the source's own field for a one-day range) */
  prevClose: number | null;
  /** volume of the running / last session */
  volume: number | null;
  marketTime: number | null;
}

export interface StockBars {
  symbol: string;
  interval: StockInterval;
  range: string;
  candles: StockCandle[];
  meta: BarsMeta;
}

export interface StockQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketTime: number | null;
}

export type ListingKind = "stock" | "adr";

export interface SymbolEntry {
  /** as the directory writes it (`BRK.B`) */
  symbol: string;
  name: string;
  /** `NASDAQ` | `NYSE` | `NYSE American` | `NYSE Arca` | `Cboe BZX` | `IEX` */
  exchange: string;
  /** Nasdaq financial status (`N` = normal; `D`, `E`, `Q`, `G`, `H`, `J`, `K` = deficient / delinquent / bankrupt); `null` for NYSE-family listings */
  fin: string | null;
}

export interface SymbolDirectory {
  entries: SymbolEntry[];
  /** `File Creation Time` of the directory files (ms), `null` when unreadable */
  fileTime: number | null;
  counts: { rows: number; kept: number; dropped: Record<string, number> };
}

export interface NewsItem {
  /** stable across fetches (the source's id, else a hash of the link) */
  id: string;
  symbol: string;
  title: string;
  url: string;
  /** host of the link ("finance.yahoo.com", "fool.com") or the source's own name */
  publisher: string | null;
  publishedAt: number;
  summary: string | null;
  /** which source delivered it */
  origin: StockSourceId;
}

export interface BarsOptions {
  /** `5d`, `6mo` … – Yahoo's range words; default per interval (`DEFAULT_RANGE`) */
  range?: string;
  /** skip the cache and ask the source */
  fresh?: boolean;
  signal?: AbortSignal;
}

export interface StockDataContract {
  bars(symbol: string, interval: StockInterval, opts?: BarsOptions): Promise<StockResult<StockBars>>;
  /** several symbols in as few requests as the server allows; one result per requested symbol */
  barsMany(symbols: readonly string[], interval: StockInterval, opts?: BarsOptions): Promise<Record<string, StockResult<StockBars>>>;
  quote(symbol: string, opts?: { fresh?: boolean; signal?: AbortSignal }): Promise<StockResult<StockQuote>>;
  quotes(symbols: readonly string[], opts?: { fresh?: boolean; signal?: AbortSignal }): Promise<Record<string, StockResult<StockQuote>>>;
  symbols(opts?: { fresh?: boolean; signal?: AbortSignal }): Promise<StockResult<SymbolDirectory>>;
  news(symbols: readonly string[], opts?: { fresh?: boolean; signal?: AbortSignal }): Promise<Record<string, StockResult<NewsItem[]>>>;
}

/** Default Yahoo range per interval (enough history for the rules, within what Yahoo allows). */
export const DEFAULT_RANGE: Readonly<Record<StockInterval, string>> = { "1m": "1d", "5m": "1d", "15m": "5d", "1h": "1mo", "1d": "6mo" };

/** Longest range Yahoo serves per interval (the server refuses a longer one before asking). */
export const RANGES_BY_INTERVAL: Readonly<Record<StockInterval, readonly string[]>> = {
  "1m": ["1d", "5d"],
  "5m": ["1d", "5d", "1mo"],
  "15m": ["1d", "5d", "1mo"],
  "1h": ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y"],
  "1d": ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"],
};

/** Request limits shared by the functions and the client's batching. */
export const STOCK_LIMITS = { barsPerRequest: 8, quotesPerRequest: 20, newsPerRequest: 8 } as const;

/** `AAPL`, `BRK.B`, `BF-B` – what the app accepts as a US ticker. */
export const STOCK_SYMBOL = /^[A-Z]{1,5}([.-][A-Z])?$/;
export const isStockSymbol = (s: string): boolean => STOCK_SYMBOL.test(s);
