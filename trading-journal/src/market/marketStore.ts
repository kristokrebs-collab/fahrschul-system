/**
 * Module-level provider singleton + `useSyncExternalStore` hooks (Plan 4.3 / 4.8).
 *
 *   startMarket(settings)  → creates + starts the provider for `settings.market.symbol` / `settings.hyblock.timeframe`
 *   stopMarket()           → stops and releases it
 *   setSymbol(symbol)      → stop → new cache namespace → start (bundle effect with deps `[symbol]`)
 *
 * Hooks re-render only when the subscribed feed / health snapshot changes. Two notification channels:
 * - slow: lifecycle, health changes, REST feeds and kline BAR changes (new bar, bar closed, source switch)
 *   → `useMarketVersion`, `useMarketView`, `useTopTrader`, `useHealth`, `useFeed(slow feed)`
 * - fast: `aggTrade`, `bookTop`, `markPrice` and the forming-bar ticks of the kline feeds → only
 *   `useFeed(fast or kline feed)`, `useFeedSelect` on those feeds and `usePriceSnapshot`
 * Feed and health notifications are coalesced to at most one delivery per animation frame (`frame.update`);
 * lifecycle changes (start/stop) are delivered synchronously. Tests call `flushMarketNotifications()`.
 * The live price itself should be rendered from `motionValues.ts` (no React render per tick).
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { cancelFrame, frame } from "motion/react";
import type { Settings } from "@/domain/types";
import type { Candle, FeedId, FeedValue, ProviderHealth, Source, Stamped, StatusLabel } from "./types";
import { createMarketProvider, type MarketProvider, type ProviderDeps } from "./provider";
import { bindMotionValues } from "./motionValues";
import { deriveMarket, deriveTopTrader, lastPrice, type DeriveOptions, type MarketView, type TopTraderBase, type TopTraderView } from "./mapping";
import { initialHealth } from "./health";
import { buildFeedSpecs, FEED_IDS, isKlineFeed } from "./feeds";
import { STRINGS } from "./statusLabel";
import { startSignals, stopSignals } from "./signals/boot";
import { useUi } from "@/store/uiStore";

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

type FeedListener = (v: Stamped<unknown> | undefined) => void;

const state: StoreState = { provider: null, unbind: null, symbol: "", period: "", opts: {} };
/** slow channel */
const listeners = new Set<() => void>();
/** fast channel */
const fastListeners = new Set<() => void>();
/** per-feed imperative listeners (`subscribeFeed`) */
const feedListeners = new Map<FeedId, Set<FeedListener>>();
/** last bar key per kline feed: a kline publish is slow only when it changes */
const barKeys = new Map<FeedId, string>();
let version = 0;
let offProvider: (() => void) | null = null;
/** `tj2-ui.useProxy` → `provider.setPreferProxy` while a provider runs */
let offProxyPref: (() => void) | null = null;

function readProxyPref(): boolean {
  try {
    return useUi.getState().useProxy === true;
  } catch {
    return false;
  }
}

/**
 * Change signal of a kline series: `${source}:${length}:${lastOpen}:${lastClosed}`. It changes when a bar is
 * appended, the forming bar closes or the source switches, but not on forming-bar ticks.
 */
export function klineBarKey(v: Stamped<Candle[]> | undefined): string {
  if (!v) return "";
  const last = v.data[v.data.length - 1];
  return `${v.source}:${v.data.length}:${last?.time ?? 0}:${last?.closed ? 1 : 0}`;
}

// ------------------------------------------------------------ notification batching

let dueSlow = false;
let dueFast = false;
const dueFeeds = new Set<FeedId>();
let queued = false;

function deliver(): void {
  queued = false;
  const slow = dueSlow;
  const fast = dueFast;
  dueSlow = false;
  dueFast = false;
  if (dueFeeds.size > 0) {
    const feeds = [...dueFeeds];
    dueFeeds.clear();
    for (const feed of feeds) {
      const subs = feedListeners.get(feed);
      if (!subs) continue;
      const v = state.provider?.get(feed) as Stamped<unknown> | undefined;
      for (const cb of subs) cb(v);
    }
  }
  // `subscribeFast` registers on both channels, so a slow delivery already reached every fast listener
  if (slow) for (const l of listeners) l();
  else if (fast) for (const l of fastListeners) l();
}

function request(): void {
  if (queued) return;
  queued = true;
  frame.update(deliver, false);
}

/** Delivers pending notifications synchronously instead of on the next animation frame (tests, teardown). */
export function flushMarketNotifications(): void {
  if (!queued) return;
  cancelFrame(deliver);
  deliver();
}

/** Slow channel: bumps `version` (health, slow feeds, kline bar changes). */
function emit(): void {
  version += 1;
  dueSlow = true;
  request();
}

/** Fast channel: high-frequency feeds and forming-bar ticks; does not touch `version`. */
function emitFast(): void {
  dueFast = true;
  request();
}

/** Lifecycle (provider created / released): delivered synchronously so no hook ever reads a stopped provider. */
function emitNow(): void {
  version += 1;
  dueSlow = true;
  for (const feed of feedListeners.keys()) dueFeeds.add(feed);
  if (queued) cancelFrame(deliver);
  deliver();
}

function markFeed(feed: FeedId): void {
  if (feedListeners.has(feed)) dueFeeds.add(feed);
}

function feedHandler(feed: FeedId): (v: Stamped<unknown>) => void {
  if (HIGH_FREQUENCY_FEEDS.has(feed)) {
    return () => {
      markFeed(feed);
      emitFast();
    };
  }
  if (isKlineFeed(feed)) {
    return (v) => {
      markFeed(feed);
      const key = klineBarKey(v as Stamped<Candle[]>);
      if (key === barKeys.get(feed)) emitFast();
      else {
        barKeys.set(feed, key);
        emit();
      }
    };
  }
  return () => {
    markFeed(feed);
    emit();
  };
}

function attach(p: MarketProvider): void {
  offProvider?.();
  barKeys.clear();
  const offs: Array<() => void> = [p.onHealth(emit)];
  for (const feed of FEED_IDS) offs.push(p.subscribe(feed, feedHandler(feed)));
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
  const p = createMarketProvider({ symbol, period, sources: opts.sources, bookTop: opts.bookTop, preferProxy: readProxyPref(), deps: opts.deps });
  state.provider = p;
  state.symbol = symbol;
  state.period = period;
  state.opts = opts;
  attach(p);
  offProxyPref = useUi.subscribe((s, prev) => {
    if (s.useProxy !== prev.useProxy) state.provider?.setPreferProxy(s.useProxy === true);
  });
  p.start();
  // live "Einstiegs-Check" follows the provider (≤ 1 evaluation per second, off the render path)
  startSignals(p);
  emitNow();
  return p;
}

export function stopMarket(): void {
  offProxyPref?.();
  offProxyPref = null;
  stopSignals();
  state.unbind?.();
  state.unbind = null;
  offProvider?.();
  offProvider = null;
  state.provider?.stop();
  state.provider = null;
  barKeys.clear();
  emitNow();
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

/** Latest stamped value of a feed from the current provider (non-hook). */
export function getFeed<F extends FeedId>(feed: F): Stamped<FeedValue[F]> | undefined {
  return state.provider?.get(feed);
}

/** Toggles the `bookTicker` stream (Bid/Ask tile visibility). */
export function setBookTop(on: boolean): void {
  state.provider?.setBookTop(on);
}

/**
 * Imperative per-feed subscription that survives provider swaps (symbol/period change): `cb` receives the latest
 * value at most once per animation frame when the feed published (and `undefined`/the new provider's value after
 * a swap). No React involved — e.g. the chart pushes the forming candle straight into its series. It does not
 * fire on subscribe; read the current value with `getFeed(feed)`.
 */
export function subscribeFeed<F extends FeedId>(feed: F, cb: (v: Stamped<FeedValue[F]> | undefined) => void): () => void {
  let set = feedListeners.get(feed);
  if (!set) feedListeners.set(feed, (set = new Set()));
  const wrapped = cb as FeedListener;
  set.add(wrapped);
  return () => {
    const s = feedListeners.get(feed);
    if (!s) return;
    s.delete(wrapped);
    if (s.size === 0) feedListeners.delete(feed);
  };
}

// ------------------------------------------------------------------ hooks

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Lifecycle (start/stop) + the fast channel: what a high-frequency or kline feed hook needs. */
function subscribeFast(cb: () => void): () => void {
  listeners.add(cb);
  fastListeners.add(cb);
  return () => {
    listeners.delete(cb);
    fastListeners.delete(cb);
  };
}

/** Channel that carries every publish of `feed` (kline ticks travel on the fast channel). */
function channelFor(feed: FeedId): (cb: () => void) => () => void {
  return HIGH_FREQUENCY_FEEDS.has(feed) || isKlineFeed(feed) ? subscribeFast : subscribe;
}

const EMPTY_HEALTH = initialHealth(buildFeedSpecs("1h"));

export function useProvider(): MarketProvider | null {
  return useSyncExternalStore(subscribe, () => state.provider, () => null);
}

/**
 * Latest stamped value of a feed (undefined until the first datum / cache hydration). Re-renders on EVERY publish
 * of that feed: high-frequency feeds and forming-bar kline ticks included — prefer the MotionValues for the price
 * and `useFeedSelect` for anything derived (closed bars, bar keys, rounded values).
 */
export function useFeed<F extends FeedId>(feed: F): Stamped<FeedValue[F]> | undefined {
  const get = useCallback(() => state.provider?.get(feed), [feed]);
  return useSyncExternalStore(channelFor(feed), get, () => undefined);
}

/**
 * Selector variant of `useFeed`: re-renders only when `select(value)` changes according to `isEqual`
 * (default `Object.is`). Return primitives (e.g. `v => lastClosed4h(v?.data ?? [])?.t ?? null`) or pass an
 * `isEqual` for objects; the previous selection is kept while equal. `select`/`isEqual` should be stable
 * (module-level or memoised) when they return objects, so the memo survives re-renders.
 */
export function useFeedSelect<F extends FeedId, S>(feed: F, select: (v: Stamped<FeedValue[F]> | undefined) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
  const [getSnapshot, getServerSnapshot] = useMemo(() => feedSelector(feed, select, isEqual), [feed, select, isEqual]);
  return useSyncExternalStore(channelFor(feed), getSnapshot, getServerSnapshot);
}

/** Memoising snapshot getters for `useFeedSelect`: `select` runs only when the stamped value changed identity. */
function feedSelector<F extends FeedId, S>(feed: F, select: (v: Stamped<FeedValue[F]> | undefined) => S, isEqual: (a: S, b: S) => boolean): readonly [() => S, () => S] {
  const memo = () => {
    let has = false;
    let seen: Stamped<FeedValue[F]> | undefined;
    let selected: S;
    return (v: Stamped<FeedValue[F]> | undefined): S => {
      if (has && v === seen) return selected;
      const next = select(v);
      seen = v;
      if (!has || !isEqual(selected, next)) selected = next;
      has = true;
      return selected;
    };
  };
  const client = memo();
  const server = memo();
  return [() => client(state.provider?.get(feed)), () => server(undefined)];
}

export function useHealth(): ProviderHealth {
  return useSyncExternalStore(subscribe, () => state.provider?.getHealth() ?? EMPTY_HEALTH, () => EMPTY_HEALTH);
}

/**
 * Selector variant of `useHealth`: re-renders only when `select(health)` changes according to `isEqual`. Health
 * changes about once a second per live WS feed (`lastDataAt`), and `useHealth` re-renders every subscriber each
 * time; select the fields a component actually shows (a primitive key, or an object plus `isEqual`). `select` and
 * `isEqual` should be stable (module constants or memoised).
 */
export function useHealthSelect<S>(select: (h: ProviderHealth) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
  const [getSnapshot, getServerSnapshot] = useMemo(() => healthSelector(select, isEqual), [select, isEqual]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Memoising snapshot getters for `useHealthSelect`: `select` runs only when the health object changed identity. */
function healthSelector<S>(select: (h: ProviderHealth) => S, isEqual: (a: S, b: S) => boolean): readonly [() => S, () => S] {
  let seen: ProviderHealth | null = null;
  let selected: S;
  const read = (h: ProviderHealth): S => {
    if (h === seen) return selected;
    const next = select(h);
    if (seen === null || !isEqual(selected, next)) selected = next;
    seen = h;
    return selected;
  };
  const server = select(EMPTY_HEALTH);
  return [() => read(state.provider?.getHealth() ?? EMPTY_HEALTH), () => server];
}

const CONNECTING: StatusLabel = { tone: "muted", text: STRINGS.connecting };

/** The label reads the value only for presence and its `HH:mm` (`Zuletzt 12:00`): minute resolution suffices. */
function labelValueKey(v: Stamped<unknown> | undefined): number {
  return v ? Math.floor(v.asOf / 60_000) : -1;
}

const sameLabel = (a: StatusLabel, b: StatusLabel): boolean => a.tone === b.tone && a.text === b.text && a.detail === b.detail;

/**
 * German status label for a feed, derived from the health snapshot. Re-renders only when the label itself changes
 * (tone / text / detail – the provider replaces the health object several times a second while live, which used to
 * re-render every pill and dot) and at most once per minute from the feed itself (never per tick).
 */
export function useStatusLabel(feed: FeedId): StatusLabel {
  const valueKey = useFeedSelect(feed, labelValueKey);
  // a new select identity per feed / minute key: the health selector re-reads, so `Zuletzt HH:mm` stays current
  const select = useMemo(() => () => labelFor(feed, valueKey), [feed, valueKey]);
  return useHealthSelect(select, sameLabel);
}

/**
 * Only the tone of `useStatusLabel(feed)`: for dots that show no text (header ticker). Re-renders on a tone change
 * only, not when the label's text or detail changes (perf review perf-11).
 */
export function useStatusTone(feed: FeedId): StatusLabel["tone"] {
  const valueKey = useFeedSelect(feed, labelValueKey);
  const select = useMemo(() => () => labelFor(feed, valueKey).tone, [feed, valueKey]);
  return useHealthSelect(select);
}

/** `_minute` only ties the memoised selector to the feed's minute key (the label reads the provider directly). */
function labelFor(feed: FeedId, _minute: number): StatusLabel {
  return state.provider?.statusLabel(feed) ?? CONNECTING;
}

/**
 * Snapshot version counter — re-renders on any slow change (lifecycle, health, REST feeds, kline bar changes).
 * `aggTrade` / `bookTop` / `markPrice` publishes and forming-bar ticks do NOT bump it. Use sparingly.
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

/** Default throttle for `usePriceSnapshot` (≤ 10 renders per second even when the integer price flickers). */
export const PRICE_SNAPSHOT_INTERVAL_MS = 100;

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
 * Re-renders only when the rounded price or the source changes, throttled to `intervalMs` (default 100 ms);
 * the odometer / chart price line should keep reading `priceMv` instead.
 */
export function usePriceSnapshot(intervalMs: number = PRICE_SNAPSHOT_INTERVAL_MS): PriceSnapshot {
  const sub = useMemo(() => subscribePriceSnapshot(intervalMs), [intervalMs]);
  return useSyncExternalStore(sub, getPriceSnapshot, () => NO_PRICE);
}

/** Legacy market panel fields (price, change, close4h, closeW, rsiW, status, funding line …), slow changes only. */
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
  if (queued) cancelFrame(deliver);
  queued = false;
  dueSlow = false;
  dueFast = false;
  dueFeeds.clear();
  state.symbol = "";
  state.period = "";
  state.opts = {};
}
