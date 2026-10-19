/**
 * Exchange adapter contract (P11). One adapter per venue (`bitunix.ts` now; Binance / Bybit / OKX in phase 2 through the
 * same interface). Adapters only READ: no adapter exposes an order, transfer or withdrawal call, and the HTTP layer of
 * each adapter refuses any path outside its read-only allowlist.
 *
 * Venue payloads are normalised into the `Venue*` shapes below (numbers parsed, timestamps in epoch ms); `mapping.ts`
 * turns them into journal trades. Nothing here imports `src/` with an alias.
 */

export type ExchangeId = "bitunix" | "binance" | "bybit" | "okx";
export const EXCHANGE_IDS: readonly ExchangeId[] = ["bitunix", "binance", "bybit", "okx"];
export const isExchangeId = (v: unknown): v is ExchangeId => typeof v === "string" && (EXCHANGE_IDS as readonly string[]).includes(v);

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  passphrase?: string;
}

/** Epoch-ms window, both ends inclusive as the venue interprets them. */
export interface TimeWindow {
  startTime: number;
  endTime: number;
}

/** A page of a skip/limit list. `total` as the venue reported it (null when it did not). */
export interface VenuePage<T> {
  items: T[];
  total: number | null;
}

export type VenueSide = "long" | "short";

/** A closed position (Bitunix `get_history_positions`). Money in the margin coin (USDT). */
export interface VenueClosedPosition {
  positionId: string;
  symbol: string;
  side: VenueSide;
  /** Largest quantity held (base units). */
  maxQty: number;
  entryPrice: number;
  closePrice: number;
  /** Quantity closed by liquidation (0 = none). */
  liqQty: number;
  marginMode: "isolated" | "cross" | null;
  positionMode: "one_way" | "hedge" | null;
  leverage: number | null;
  /** As the venue reports them (sign conventions are resolved in `mapping.ts`). */
  fee: number;
  funding: number;
  realizedPnl: number;
  liqPrice: number | null;
  /** Epoch ms. */
  openedAt: number;
  closedAt: number;
}

/** An open position (Bitunix `get_pending_positions`). */
export interface VenueOpenPosition {
  positionId: string;
  symbol: string;
  side: VenueSide;
  qty: number;
  entryPrice: number;
  marginMode: "isolated" | "cross" | null;
  leverage: number | null;
  fee: number;
  funding: number;
  realizedPnl: number;
  unrealizedPnl: number | null;
  margin: number | null;
  liqPrice: number | null;
  openedAt: number;
  updatedAt: number;
}

/** One execution (Bitunix `get_history_trades`). */
export interface VenueFill {
  tradeId: string;
  orderId: string;
  symbol: string;
  /** BUY / SELL as sent by the venue; null when the payload carried none. */
  side: "buy" | "sell" | null;
  qty: number;
  price: number;
  fee: number;
  realizedPnl: number;
  reduceOnly: boolean | null;
  at: number;
}

/** One order (Bitunix `get_history_orders`), incl. the TP / SL attached to it. */
export interface VenueOrder {
  orderId: string;
  symbol: string;
  side: "buy" | "sell" | null;
  qty: number;
  tradeQty: number;
  price: number | null;
  status: string;
  reduceOnly: boolean | null;
  tpPrice: number | null;
  slPrice: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One TP/SL order (Bitunix `tpsl/get_history_orders`), bound to a position. */
export interface VenueTpSl {
  id: string;
  positionId: string;
  symbol: string;
  tpPrice: number | null;
  slPrice: number | null;
  tpQty: number | null;
  slQty: number | null;
  status: string;
  createdAt: number;
  triggeredAt: number | null;
}

/** Futures account of one margin coin (Bitunix `GET /api/v1/futures/account`). */
export interface VenueAccount {
  marginCoin: string;
  available: number;
  frozen: number;
  margin: number;
  unrealizedPnl: number;
  positionMode: "one_way" | "hedge" | null;
}

/** Last / mark price per symbol (public tickers). */
export interface VenueTicker {
  symbol: string;
  markPrice: number | null;
  lastPrice: number | null;
}

/** Which list `fetchFills` reads. */
export type FillQuery = { positionId: string } | ({ symbol?: string } & TimeWindow);

/**
 * The read-only adapter. Every list method pages internally (`skip` / `limit`), respects the venue's rate limit and
 * stops starting new requests once `deadline` (epoch ms, optional) has passed – then `complete` is false.
 */
export interface ExchangeAdapter {
  readonly id: ExchangeId;
  /** Checks the credentials with one cheap private call; throws `ExchangeError` (German message) when they fail. */
  validate(): Promise<VenueAccount>;
  fetchAccount(marginCoin?: string): Promise<VenueAccount>;
  fetchClosedPositions(window: TimeWindow, opts?: ListOptions): Promise<ListResult<VenueClosedPosition>>;
  fetchOrders(window: TimeWindow, opts?: ListOptions): Promise<ListResult<VenueOrder>>;
  fetchFills(query: FillQuery, opts?: ListOptions): Promise<ListResult<VenueFill>>;
  fetchTpSl(window: TimeWindow, opts?: ListOptions): Promise<ListResult<VenueTpSl>>;
  fetchOpenPositions(): Promise<VenueOpenPosition[]>;
  fetchTickers(symbols: readonly string[]): Promise<VenueTicker[]>;
}

export interface ListOptions {
  /** Resume offset. */
  skip?: number;
  /** Stop starting requests after this time (epoch ms). */
  deadline?: number;
  /** Hard cap on items (default: everything). */
  max?: number;
}

export interface ListResult<T> {
  items: T[];
  /** False when the list was cut by `deadline` / `max`; `nextSkip` then resumes it. */
  complete: boolean;
  nextSkip: number;
  /** Requests made (rate-limit budget, tests). */
  requests: number;
}

/** Venue error with a German, user-facing message (never contains the key, secret or a signature). */
export class ExchangeError extends Error {
  /** `bitunix_10007`, `network`, `bad_response`, … */
  readonly code: string;
  /** HTTP status the function answers with. */
  readonly status: number;
  /** The credentials are wrong / revoked – the connection is marked `invalid`. */
  readonly authFailure: boolean;
  /** Worth retrying later (rate limit, network). */
  readonly retryable: boolean;
  constructor(code: string, message: string, opts: { status?: number; authFailure?: boolean; retryable?: boolean } = {}) {
    super(message);
    this.name = "ExchangeError";
    this.code = code;
    this.status = opts.status ?? 502;
    this.authFailure = opts.authFailure ?? false;
    this.retryable = opts.retryable ?? false;
  }
}

/** Injected runtime (tests replace fetch / clock / sleep). */
export interface AdapterRuntime {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Random 32-hex nonce (tests pin it). */
  nonce?: () => string;
}
