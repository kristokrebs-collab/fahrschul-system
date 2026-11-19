/**
 * Live top-trader / retail readings for the Einstiegs-Check (decisions 5, 11, 14): the three Binance ratio series at the
 * fixed 5-minute period — top traders by POSITION (`topLongShortPositionRatio`), top traders by ACCOUNT
 * (`topLongShortAccountRatio`) and all accounts = retail (`globalLongShortAccountRatio`) — straight from the provider's
 * 5-min twins (`topPositionRatio5m`, `topAccountRatio5m`, `globalAccountRatio5m`), so the engine, the Top-Trader card
 * and the falling-knife filter read the SAME points (single source of truth, no extra requests).
 *
 * Only Binance data counts (direct or through the EU proxy, per feed health AND per value); a Bybit/OKX fallback has no
 * top-trader cohort → empty series with `status: "unsupported"`. `status` / `detail` / `nextAt` say honestly why a
 * series has no fresh point (loading, retrying after a network/CORS error, blocked region, offline, stale).
 *
 * Shapes are structural: `position` / `account` / `retail` are `RatioPoint[]` (`{ time (ms, period boundary), longPct
 * (0–100), … }`), which the engine's `TraderSeries` (`@/domain/signals`) accepts as is.
 */
import { useSyncExternalStore } from "react";
import { LIVE_RATIO_FEEDS, LIVE_RATIO_PERIOD } from "./feeds";
import { getProvider, subscribeFeed, useHealthSelect } from "./marketStore";
import { isBinanceSeries, type FeedSnapshot } from "./mapping";
import { PERIOD_MS } from "./period";
import { SOFT_FAILURE_TEXT, STRINGS } from "./statusLabel";
import type { FeedHealth, LiveRatioFeed, ProviderHealth, RatioPoint, Stamped } from "./types";

/** Point spacing of the live series (Binance publishes a new snapshot every 5 minutes). */
export const TRADER_SERIES_STEP_MS = PERIOD_MS[LIVE_RATIO_PERIOD];
/** A series whose newest point is older than two steps + 5 min of publication slack is stale (matches the engine). */
export const TRADER_SERIES_FRESH_MS = 2 * TRADER_SERIES_STEP_MS + 5 * 60_000;

/** Which twin feeds the three series. */
export const TRADER_SERIES_FEEDS = { position: "topPositionRatio5m", account: "topAccountRatio5m", retail: "globalAccountRatio5m" } as const satisfies Record<string, LiveRatioFeed>;

export type TraderSeriesStatus =
  /** every series has a fresh Binance point */
  | "live"
  /** no point yet (start, symbol/period switch) */
  | "loading"
  /** a series failed on its last poll (network/CORS, timeout, 5xx, 429) — retry pending */
  | "retrying"
  /** points exist but the newest is older than `TRADER_SERIES_FRESH_MS` */
  | "stale"
  /** Binance blocked here and no usable proxy */
  | "blocked"
  /** the feeds sit on a source without top traders (Bybit/OKX) or the symbol has none */
  | "unsupported"
  | "offline";

export interface LiveTraderSeries {
  /** top traders, positions — long share %, oldest first */
  position: readonly RatioPoint[];
  /** top traders, accounts */
  account: readonly RatioPoint[];
  /** all accounts ("retail") */
  retail: readonly RatioPoint[];
  /** spacing of the points in ms (5 min) */
  step: number;
  /** Binance route of the data (`proxy` = EU proxy), `null` = no Binance data */
  source: "binance" | "proxy" | null;
  /** time of the newest point across the three series (ms, exchange clock), `null` = none */
  asOf: number | null;
  /** when the next point is expected / the next retry runs (device clock, earliest of the three feeds) */
  nextAt: number | null;
  status: TraderSeriesStatus;
  /** German one-liner for the UI when `status !== "live"` (e.g. `Binance antwortet nicht (Netzwerk/CORS-Fehler)`) */
  detail?: string;
  /** Binance-clock "now" the freshness was judged at */
  now: number;
}

const EMPTY: readonly RatioPoint[] = Object.freeze([]) as readonly RatioPoint[];

/** The series a twin contributes: its points when they come from Binance (per health and value), else none. */
function seriesOf(feeds: FeedSnapshot, health: ProviderHealth, feed: LiveRatioFeed): readonly RatioPoint[] {
  const v = feeds[feed] as Stamped<RatioPoint[]> | undefined;
  return isBinanceSeries(health, feed, v) ? v!.data : EMPTY;
}

const newest = (s: readonly RatioPoint[]): number | null => s.at(-1)?.time ?? null;

/**
 * Pure: the live series + an honest status from a feed snapshot and the provider health. `now` is the Binance-clock
 * time (`provider.serverNow()`), so a device clock that runs off never makes fresh data look stale.
 */
export function deriveTraderSeries(feeds: FeedSnapshot, health: ProviderHealth, now: number): LiveTraderSeries {
  const position = seriesOf(feeds, health, TRADER_SERIES_FEEDS.position);
  const account = seriesOf(feeds, health, TRADER_SERIES_FEEDS.account);
  const retail = seriesOf(feeds, health, TRADER_SERIES_FEEDS.retail);
  const fhs = LIVE_RATIO_FEEDS.map((f) => health.feeds[f]).filter((f): f is FeedHealth => !!f);
  const times = [newest(position), newest(account), newest(retail)].filter((t): t is number => t !== null);
  const asOf = times.length ? Math.max(...times) : null;
  const nexts = fhs.map((f) => f.nextRefreshAt).filter((t): t is number => typeof t === "number");
  const nextAt = nexts.length ? Math.min(...nexts) : null;
  const viaProxy = fhs.some((f) => f.source === "proxy");
  const source = times.length ? (viaProxy ? "proxy" : "binance") : null;
  const base = { position, account, retail, step: TRADER_SERIES_STEP_MS, source, asOf, nextAt, now } as const;

  const allFresh = times.length === 3 && times.every((t) => now - t <= TRADER_SERIES_FRESH_MS);
  const failing = fhs.find((f) => f.consecutiveFailures > 0 && f.reason !== undefined && SOFT_FAILURE_TEXT[f.reason] !== undefined);
  if (!health.online) return { ...base, status: "offline", detail: STRINGS.offline };
  if (allFresh) return { ...base, status: "live" };
  if (failing) return { ...base, status: "retrying", detail: `Binance antwortet nicht (${SOFT_FAILURE_TEXT[failing.reason!]})` };
  if (fhs.some((f) => f.reason === "unsupported") || fhs.some((f) => f.source === "bybit" || f.source === "okx")) {
    return { ...base, status: health.primary.blocked ? "blocked" : "unsupported", detail: health.primary.blocked ? "Binance blockiert (Region)" : STRINGS.onlyBinance };
  }
  if (health.primary.blocked && !viaProxy) return { ...base, status: "blocked", detail: "Binance blockiert (Region)" };
  if (!times.length) return { ...base, status: "loading", detail: "Top-Trader-Daten werden geladen …" };
  return { ...base, status: "stale", detail: "Top-Trader-Daten veraltet" };
}

/** Changes whenever a newest point, the route or the status changes — a cheap memo / re-evaluation key. */
export function traderSeriesKey(s: LiveTraderSeries | null): string {
  if (!s) return "-";
  return `${s.status}|${s.source ?? "-"}|${newest(s.position) ?? 0}:${s.position.length}|${newest(s.account) ?? 0}:${s.account.length}|${newest(s.retail) ?? 0}:${s.retail.length}`;
}

/** Current live series from the running provider (`null` while the market is stopped). */
export function getTraderSeries(): LiveTraderSeries | null {
  const p = getProvider();
  if (!p) return null;
  const feeds: FeedSnapshot = {};
  for (const f of LIVE_RATIO_FEEDS) (feeds as Record<string, unknown>)[f] = p.get(f);
  const now = typeof p.serverNow === "function" ? p.serverNow() : Date.now();
  return deriveTraderSeries(feeds, p.getHealth(), now);
}

/**
 * Calls `cb` (at most once per animation frame) whenever one of the three 5-min series publishes, and after a
 * provider swap (symbol / period change). Health-only changes (a failing poll) are not pushed — read
 * `getTraderSeries()` when evaluating, or watch `useHealthSelect`. Returns the unsubscribe.
 */
export function subscribeTraderSeries(cb: () => void): () => void {
  const offs = LIVE_RATIO_FEEDS.map((f) => subscribeFeed(f, () => cb()));
  return () => offs.forEach((off) => off());
}

let snapCache: { key: string; value: LiveTraderSeries | null } = { key: "", value: null };
function snapshotSeries(): LiveTraderSeries | null {
  const s = getTraderSeries();
  const key = `${traderSeriesKey(s)}|${s?.nextAt ?? 0}`;
  if (key !== snapCache.key) snapCache = { key, value: s };
  return snapCache.value;
}

/** Health fields the status reads (the provider replaces the health object several times a second). */
export function traderHealthSignature(h: ProviderHealth): string {
  const parts = LIVE_RATIO_FEEDS.map((id) => {
    const f = h.feeds[id];
    return f ? `${f.state}:${f.source}:${f.reason ?? ""}:${f.consecutiveFailures}:${f.nextRefreshAt ?? 0}` : "-";
  });
  return `${h.online ? 1 : 0}|${h.primary.blocked ? 1 : 0}|${parts.join("|")}`;
}

/**
 * React: the live series; re-renders only when a newest point, the route, the status or the next poll time changes
 * (never per price tick).
 */
export function useTraderSeries(): LiveTraderSeries | null {
  // health changes (a failing poll, the next poll time) re-run the snapshot through this selector's re-render
  useHealthSelect(traderHealthSignature);
  return useSyncExternalStore(subscribeTraderSeries, snapshotSeries, () => null);
}
