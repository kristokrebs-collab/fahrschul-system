/**
 * Live exchange positions contract (Wave 0 – owner P11, consumer P05 exposure / margin / liquidation).
 *
 * Filled from `GET /api/v1/exchange/positions` (read-only key, mark price from the venue's tickers): polled every
 * `POLL_MS` while at least one consumer is mounted, the tab is visible, the user is signed in and a connection exists.
 * Signatures are final. The hook returns a referentially stable array between updates (consumers memoise on it): a
 * poll that brings the same positions keeps the old array; without a connection it is the frozen empty list.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { MarginMode, Side } from "@/domain/types";
import { useCloudSession } from "@/cloud/session";
import { fetchExchangePositions } from "./api";
import { exchangeEnabled, loadExchangeStatus, useExchange } from "./store";

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

/** Poll cadence while a consumer is mounted (the venue allows 10 req/s; this is one request per 15 s). */
export const POLL_MS = 15_000;

interface PositionsState {
  positions: readonly ExchangePosition[];
  at: number | null;
  error: string | null;
}

export const usePositionsStore = create<PositionsState>()(() => ({ positions: NONE, at: null, error: null }));

let consumers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

const hasConnection = (): boolean => !!useExchange.getState().status?.connections.some((c) => c.status === "active");
const signedIn = (): boolean => useCloudSession.getState().phase === "signedIn";
const visible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

const samePositions = (a: readonly ExchangePosition[], b: readonly ExchangePosition[]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/** One poll (exported for tests / a manual refresh). */
export async function refreshPositions(): Promise<void> {
  if (inflight || !exchangeEnabled() || !signedIn() || !hasConnection()) {
    if (!hasConnection() && usePositionsStore.getState().positions !== NONE) usePositionsStore.setState({ positions: NONE });
    return;
  }
  inflight = true;
  try {
    const res = await fetchExchangePositions();
    const cur = usePositionsStore.getState().positions;
    const next = samePositions(cur, res.positions) ? cur : Object.freeze([...res.positions]);
    usePositionsStore.setState({ positions: next, at: Date.parse(res.at) || Date.now(), error: res.errors[0]?.message ?? null });
  } catch (e) {
    usePositionsStore.setState({ error: e instanceof Error ? e.message : "Positionen nicht erreichbar." });
  } finally {
    inflight = false;
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (consumers <= 0) return;
  timer = setTimeout(async () => {
    timer = null;
    if (visible()) await refreshPositions();
    schedule();
  }, POLL_MS);
}

function onVisibility(): void {
  if (visible() && consumers > 0) void refreshPositions();
}

function retain(): () => void {
  consumers++;
  if (consumers === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    if (exchangeEnabled() && signedIn() && !useExchange.getState().status) void loadExchangeStatus().then(() => refreshPositions());
    else void refreshPositions();
    schedule();
  }
  return () => {
    consumers--;
    if (consumers <= 0) {
      consumers = 0;
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

/** Open positions over all connected venues (polled while mounted). */
export function useExchangePositions(): readonly ExchangePosition[] {
  useEffect(() => (exchangeEnabled() ? retain() : undefined), []);
  return usePositionsStore((s) => s.positions);
}

/** True when at least one exchange connection exists (Margin card empty state). */
export function useHasExchangeConnection(): boolean {
  return useExchange((s) => !!s.status?.connections.some((c) => c.status !== "revoked"));
}
