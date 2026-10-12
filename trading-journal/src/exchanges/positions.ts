/**
 * Live exchange positions contract (Wave 0 – owner P11, consumer P05 exposure / margin / liquidation).
 * Signatures are final; until P11 lands there is no connection and no position.
 *
 * P11 fills it from `/api/v1/exchange/positions` (polled while a consumer is mounted and the tab is visible). Hooks
 * must return a referentially stable array between updates (consumers memoise on it).
 */
import type { MarginMode, Side } from "@/domain/types";

/** Venue id; matches `Trade.exchange` and `exchange_connections.exchange`. */
export type ExchangeId = "bitunix" | "binance" | "bybit" | "okx" | (string & {});

export interface ExchangePosition {
  /** Venue position id (stable while open). */
  id: string;
  exchange: ExchangeId;
  /** Sub-account / connection label (`Trade.exchangeAccount`). */
  account?: string;
  /** Venue symbol without separator, e.g. "BTCUSDT". */
  symbol: string;
  side: Side;
  /** Base-asset quantity (> 0). */
  qty: number;
  /** Average entry price. */
  entry: number;
  /** Mark price at `updatedAt`, null when the venue did not send one. */
  mark: number | null;
  /** qty × (mark ?? entry), quote currency. */
  notional: number;
  leverage: number | null;
  marginMode: MarginMode | null;
  /** Position margin, quote currency. */
  margin: number | null;
  liqPrice: number | null;
  unrealizedPnl: number | null;
  /** Funding paid so far (positive = paid). */
  fundingFees: number | null;
  /** Epoch ms. */
  openedAt: number | null;
  updatedAt: number;
}

const NONE: readonly ExchangePosition[] = Object.freeze([]);

/** Open positions over all connected venues. STUB: always `[]` until P11. */
export function useExchangePositions(): readonly ExchangePosition[] {
  return NONE;
}

/** True when at least one exchange connection exists (Margin card empty state). STUB: always false until P11. */
export function useHasExchangeConnection(): boolean {
  return false;
}
