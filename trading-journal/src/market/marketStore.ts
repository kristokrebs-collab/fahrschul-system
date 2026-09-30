/**
 * Module-level provider singleton + `useSyncExternalStore` hooks (Plan 4.3 / 4.8).
 *
 *   startMarket(settings)  → creates + starts the provider for `settings.market.symbol` / `settings.hyblock.timeframe`
 *   stopMarket()           → stops and releases it
 *   setSymbol(symbol)      → stop → new cache namespace → start (bundle effect with deps `[symbol]`)
 *
 * Hooks re-render only when the subscribed feed / health snapshot changes. Two notification channels:
 * - slow: health changes + every feed except the high-frequency ones → `useMarketVersion`, `useMarketView`,
 *   `useTopTrader`, `useHealth`, `useFeed(slow feed)`
 * - fast: `aggTrade` (≈10 Hz), `bookTop`, `markPrice` (1 Hz) → only `useFeed(fast feed)` and `usePriceSnapshot`
 * The live price itself should be rendered from `motionValues.ts` (no React render per tick).
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Settings } from "@/domain/types";
import type { FeedId, FeedValue, ProviderHealth, Source, Stamped, StatusLabel } from "./types";
import { createMarketProvider, type MarketProvider, type ProviderDeps } from "./provider";
import { bindMotionValues } from "./motionValues";
import { deriveMarket, deriveTopTrader, lastPrice, type DeriveOptions, type MarketView, type TopTraderBase, type TopTraderView } from "./mapping";
import { initialHealth } from "./health";
import { buildFeedSpecs, FEED_IDS } from "./feeds";
import { STRINGS } from "./statusLabel";

/** Feeds that publish several times per second; they never bump the slow version counter. */
export const HIGH_FREQUENCY_FEEDS: ReadonlySet<FeedId> = new Set<FeedId>(["aggTrade", "bookTop", "markPrice"]);

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
const fastListeners = new Set<() => void>();
let version = 0;
let offProvider: (() => void) | null = null;

/** Slow channel: bumps `version` (lifecycle, health, slow feeds). */
function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

/** Fast channel: high-frequency feeds only; does not touch `version`. */
function emitFast(): void {
  for (const l of fastListeners) l();
}

function attach(p: MarketProvider): void {
  offProvider?.();
  const offs: Array<() => void> = [p.onHealth(emit)];
  for (const feed of FEED_IDS) offs.push(p.subscribe(feed, HIGH_FREQUENCY_FEEDS.has(feed) ? emitFast : emit));
  offProvider = () => {
    for (const off of offs) off();
  };
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

/** Lifecycle (start/stop) + the fast channel: what a high-frequency feed hook needs. */
function subscribeFast(cb: () => void): () => void {
  listeners.add(cb);
  fastListeners.add(cb);
  return () => {
    listeners.delete(cb);
    fastListeners.delete(cb);
  };
}

const EMPTY_HEALTH = initialHealth(buildFeedSpecs("1h"));

export function useProvider(): MarketProvider | null {
  return useSyncExternalStore(subscribe, () => state.provider, () => null);
}

/**
 * Latest stamped value of a feed (undefined until the first datum / cache hydration).
 * High-frequency feeds (`HIGH_FREQUENCY_FEEDS`) re-render per publish — prefer the MotionValues for those.
 */
export function useFeed<F extends FeedId>(feed: F): Stamped<FeedValue[F]> | undefined {
  const get = useCallback(() => state.provider?.get(feed), [feed]);
  return useSyncExternalStore(HIGH_FREQUENCY_FEEDS.has(feed) ? subscribeFast : subscribe, get, () => undefined);
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

/**
 * Snapshot version counter — re-renders on any slow change (lifecycle, health, REST feeds, klines).
 * `aggTrade` / `bookTop` / `markPrice` publishes do NOT bump it. Use sparingly (settings page diagnostics).
 */
export function useMarketVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

// ------------------------------------------------------------ price snapshot

/** Rounded last price + its source: primitives only, so consumers re-render just when the integer changes. */
export interface PriceSnapshot {
  /** `Math.round(lastPrice)` or `null` before the first datum. */
  price: number | null;
  source: Source | null;
}

const NO_PRICE: PriceSnapshot = { price: null, source: null };
let priceSnapshot: PriceSnapshot = NO_PRICE;

/** Current rounded price + source from the provider snapshot (stable object while both are unchanged). */
export function getPriceSnapshot(): PriceSnapshot {
  const p = state.provider;
  const lp = p ? lastPrice(p.snapshot()) : null;
  const price = lp ? Math.round(lp.price) : null;
  const source = lp ? lp.provenance.source : null;
  if (price !== priceSnapshot.price || source !== priceSnapshot.source) priceSnapshot = { price, source };
  return priceSnapshot;
}

/** Default throttle for `usePriceSnapshot` (≤ 4 renders per second even when the integer price flickers). */
export const PRICE_SNAPSHOT_INTERVAL_MS = 250;

function subscribePriceSnapshot(intervalMs: number): (cb: () => void) => () => void {
  return (cb) => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      last = Date.now();
      cb();
    };
    const throttled = () => {
      const wait = intervalMs - (Date.now() - last);
      if (wait <= 0) fire();
      else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          fire();
        }, wait);
      }
    };
    const off = subscribeFast(throttled);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  };
}

/**
 * Rounded live price + source for consumers that need a primitive (e.g. `App.tsx` → `TradeEditor.livePrice`).
 * Re-renders only when the rounded price or the source changes, throttled to `intervalMs` (default 250 ms);
 * the odometer / chart price line should keep reading `priceMv` instead.
 */
export function usePriceSnapshot(intervalMs: number = PRICE_SNAPSHOT_INTERVAL_MS): PriceSnapshot {
  const sub = useMemo(() => subscribePriceSnapshot(intervalMs), [intervalMs]);
  return useSyncExternalStore(sub, getPriceSnapshot, () => NO_PRICE);
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
