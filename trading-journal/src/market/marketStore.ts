/**
 * Module-level provider singleton + `useSyncExternalStore` hooks (Plan 4.3 / 4.8).
 *
 *   startMarket(settings)  → creates + starts the provider for `settings.market.symbol` / `settings.hyblock.timeframe`
 *   stopMarket()           → stops and releases it
 *   setSymbol(symbol)      → stop → new cache namespace → start (bundle effect with deps `[symbol]`)
 *
 * Hooks re-render only when the subscribed feed / health snapshot changes. High-frequency ticks
 * (aggTrade at 10 Hz) should be consumed through `motionValues.ts`; `useFeed("aggTrade")` is throttled
 * to one render per animation frame.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Settings } from "@/domain/types";
import type { FeedId, FeedValue, ProviderHealth, Stamped, StatusLabel } from "./types";
import { createMarketProvider, type MarketProvider, type ProviderDeps } from "./provider";
import { bindMotionValues } from "./motionValues";
import { deriveMarket, deriveTopTrader, type DeriveOptions, type MarketView, type TopTraderBase, type TopTraderView } from "./mapping";
import { initialHealth } from "./health";
import { buildFeedSpecs } from "./feeds";
import { STRINGS } from "./statusLabel";

export interface StartOptions {
  sources?: MarketProvider["specs"][FeedId]["sources"];
  bookTop?: boolean;
  deps?: ProviderDeps;
}

interface StoreState {
  provider: MarketProvider | null;
  unbind: (() => void) | null;
  symbol: string;
  period: string;
  opts: StartOptions;
}

const state: StoreState = { provider: null, unbind: null, symbol: "", period: "", opts: {} };
const listeners = new Set<() => void>();
let version = 0;
let offProvider: (() => void) | null = null;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function attach(p: MarketProvider): void {
  offProvider?.();
  const offChange = p.onChange(emit);
  offProvider = () => offChange();
  state.unbind = bindMotionValues(p);
}

/** Creates and starts the provider (idempotent for the same symbol/period). */
export function startMarket(settings: Pick<Settings, "market" | "hyblock">, opts: StartOptions = {}): MarketProvider {
  const symbol = settings.market.symbol || "BINANCE:BTCUSDT";
  const period = settings.hyblock.timeframe || "1h";
  if (state.provider && state.symbol === symbol && state.period === period) {
    if (!state.provider.started) state.provider.start();
    return state.provider;
  }
  stopMarket();
  const p = createMarketProvider({ symbol, period, sources: opts.sources, bookTop: opts.bookTop, deps: opts.deps });
  state.provider = p;
  state.symbol = symbol;
  state.period = period;
  state.opts = opts;
  attach(p);
  p.start();
  emit();
  return p;
}

export function stopMarket(): void {
  state.unbind?.();
  state.unbind = null;
  offProvider?.();
  offProvider = null;
  state.provider?.stop();
  state.provider = null;
  emit();
}

/** Symbol change from the settings: stop → new namespace → start (Plan 4.1). */
export function setSymbol(symbol: string): MarketProvider {
  return startMarket({ market: { symbol } as Settings["market"], hyblock: { timeframe: state.period || "1h" } as Settings["hyblock"] }, state.opts);
}

/** Period change (`settings.hyblock.timeframe`). */
export function setPeriod(period: string): MarketProvider {
  return startMarket({ market: { symbol: state.symbol || "BINANCE:BTCUSDT" } as Settings["market"], hyblock: { timeframe: period } as Settings["hyblock"] }, state.opts);
}

export function getProvider(): MarketProvider | null {
  return state.provider;
}

/** Toggles the `bookTicker` stream (Bid/Ask tile visibility). */
export function setBookTop(on: boolean): void {
  state.provider?.setBookTop(on);
}

// ------------------------------------------------------------------ hooks

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

const EMPTY_HEALTH = initialHealth(buildFeedSpecs("1h"));

export function useProvider(): MarketProvider | null {
  return useSyncExternalStore(subscribe, () => state.provider, () => null);
}

/** Latest stamped value of a feed (undefined until the first datum / cache hydration). */
export function useFeed<F extends FeedId>(feed: F): Stamped<FeedValue[F]> | undefined {
  const get = useCallback(() => state.provider?.get(feed), [feed]);
  return useSyncExternalStore(subscribe, get, () => undefined);
}

export function useHealth(): ProviderHealth {
  return useSyncExternalStore(subscribe, () => state.provider?.getHealth() ?? EMPTY_HEALTH, () => EMPTY_HEALTH);
}

const CONNECTING: StatusLabel = { tone: "muted", text: STRINGS.connecting };

/** German status label for a feed, derived from the health snapshot only. */
export function useStatusLabel(feed: FeedId): StatusLabel {
  const health = useHealth();
  const value = useFeed(feed);
  return useMemo(() => labelFor(feed, health, value), [feed, health, value]);
}

function labelFor(feed: FeedId, _health: ProviderHealth, _value: unknown): StatusLabel {
  return state.provider?.statusLabel(feed) ?? CONNECTING;
}

/** Snapshot version counter — re-renders on any change; use sparingly (e.g. settings page diagnostics). */
export function useMarketVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/** Legacy market panel fields (price, change, close4h, closeW, rsiW, status, funding line …). */
export function useMarketView(opts: DeriveOptions = {}): MarketView {
  const health = useHealth();
  const v = useMarketVersion();
  return useMemo(() => {
    const p = state.provider;
    const snap = p ? p.snapshot() : {};
    return deriveMarket(snap, p?.getHealth() ?? health, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health, v, opts.rsiWOverride, opts.retryInSec]);
}

/** Top-trader card fields; `base` = `tj2-ui.topTraderBase` (default `accounts`). */
export function useTopTrader(base: TopTraderBase = "accounts"): TopTraderView {
  const health = useHealth();
  const v = useMarketVersion();
  return useMemo(() => {
    const p = state.provider;
    return deriveTopTrader(p ? p.snapshot() : {}, p?.getHealth() ?? health, base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health, v, base]);
}

/** Testing helper: reset the singleton without touching a running provider's timers. */
export function __resetMarketStore(): void {
  stopMarket();
  state.symbol = "";
  state.period = "";
  state.opts = {};
}
