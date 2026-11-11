/**
 * Shared harness for the shell / overview tests: a deterministic market snapshot (no network), a fake
 * provider, jsdom polyfills and the journal boot from the legacy fixture. Not a test file itself.
 */
import { vi } from "vitest";
import type { Candle, FeedId, FeedSnapshot, MarketProvider, ProviderHealth, Stamped, StatusLabel } from "@/market";
import type { JournalState } from "@/store/journalStore";
import { loadV0File, seedV0 } from "./store.fixture";

export const H4 = 14_400_000;
export const W1 = 7 * 86_400_000;

/** `n` closed candles of `intervalMs` ending with the last bar closed before `now`, all closing at `close`. */
export function makeCandles(intervalMs: number, n: number, close: number, now: number): Candle[] {
  const lastOpen = Math.floor(now / intervalMs) * intervalMs - intervalMs;
  const out: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const time = lastOpen - i * intervalMs;
    out.push({ time, open: close - 50, high: close + 120, low: close - 130, close, volume: 100, closed: true, closeTime: time + intervalMs - 1 });
  }
  // forming bar
  out.push({ time: lastOpen + intervalMs, open: close, high: close + 40, low: close - 40, close: close + 10, volume: 10, closed: false });
  return out;
}

function stamp<T>(data: T, now: number): Stamped<T> {
  return { data, asOf: now, receivedAt: now, source: "binance", comparable: true };
}

export interface MarketFixture {
  now: number;
  price: number;
  close4h: number;
  closeW: number;
  change: number;
}

export const DEFAULT_FIXTURE: MarketFixture = { now: Date.now(), price: 86_100, close4h: 86_200, closeW: 83_000, change: 1.2 };

export function makeSnapshot(f: MarketFixture = DEFAULT_FIXTURE): FeedSnapshot {
  const { now } = f;
  return {
    kline_4h: stamp(makeCandles(H4, 30, f.close4h, now), now),
    kline_1h: stamp(makeCandles(3_600_000, 200, f.price, now), now),
    kline_1w: stamp(makeCandles(W1, 30, f.closeW, now), now),
    ticker24h: stamp({ lastPrice: f.price, priceChangePercent: f.change, high: f.price + 500, low: f.price - 900, volume: 1000, quoteVolume: 1e8, time: now }, now),
    markPrice: stamp({ markPrice: f.price + 12, indexPrice: f.price, fundingRate: 0.0001, nextFundingTime: now + 3_600_000, time: now }, now),
    aggTrade: stamp({ price: f.price, qty: 0.01, isBuyerMaker: false, time: now }, now),
  };
}

const LIVE_FEEDS: FeedId[] = ["kline_1m", "kline_1h", "kline_4h", "kline_1w", "markPrice", "aggTrade", "ticker24h"];

export function makeHealth(actual: typeof import("@/market"), now: number): ProviderHealth {
  const h = actual.initialHealth(actual.buildFeedSpecs("1h"));
  for (const f of LIVE_FEEDS) h.feeds[f] = { ...h.feeds[f], state: "live", lastDataAt: now, nextRefreshAt: f === "ticker24h" ? now + 20_000 : undefined };
  h.ws = { state: "live", connectedAt: now - 60_000, lastMessageAt: now, attempt: 0 };
  h.overall = "connecting";
  h.primary = { source: "binance", reachable: true, blocked: false, lastProbeAt: now };
  return h;
}

export interface FakeMarket {
  provider: MarketProvider;
  snapshot: FeedSnapshot;
  health: ProviderHealth;
  refresh: ReturnType<typeof vi.fn>;
  overrides: Record<string, unknown>;
}

/**
 * Overrides for `vi.mock("@/market", …)`: hooks read the fixture snapshot, the provider is a fake with a spied
 * `refresh`, lifecycle functions are no-ops. The live MotionValues (`priceMv`, `markMv`, `open24hMv` …) are the real
 * ones, seeded from the fixture snapshot.
 */
export function fakeMarket(actual: typeof import("@/market"), fixture: MarketFixture = DEFAULT_FIXTURE): FakeMarket {
  const snapshot = makeSnapshot(fixture);
  const health = makeHealth(actual, fixture.now);
  const refresh = vi.fn(() => Promise.resolve());
  const label = (feed: FeedId): StatusLabel => actual.statusLabelFor(health, feed, actual.buildFeedSpecs("1h"), snapshot[feed], fixture.now);
  const provider = {
    symbol: "BTCUSDT",
    started: true,
    start: () => undefined,
    stop: () => undefined,
    get: (f: FeedId) => snapshot[f],
    subscribe: () => () => undefined,
    refresh,
    history: vi.fn(() => Promise.resolve(stamp([], fixture.now))),
    getHealth: () => health,
    onHealth: () => () => undefined,
    statusLabel: label,
    onChange: () => () => undefined,
    snapshot: () => snapshot,
    clearCache: () => Promise.resolve(),
    setBookTop: () => undefined,
    dispatch: () => undefined,
  } as unknown as MarketProvider;
  actual.priceMv.set(fixture.price);
  // seed the other live MotionValues (mark, funding, 24 h open, trade time …) from the snapshot, like the real store
  actual.bindMotionValues(provider)();
  actual.flushMotionValues();
  // `useFeedSelect` memoises per selector, like the real hook (the snapshot never changes here)
  const selected = new WeakMap<object, Map<FeedId, unknown>>();
  const feedSelect = (f: FeedId, select: (v: unknown) => unknown): unknown => {
    let byFeed = selected.get(select);
    if (!byFeed) selected.set(select, (byFeed = new Map()));
    if (!byFeed.has(f)) byFeed.set(f, select(snapshot[f]));
    return byFeed.get(f);
  };
  const overrides = {
    startMarket: vi.fn(() => provider),
    stopMarket: vi.fn(),
    setSymbol: vi.fn(() => provider),
    setPeriod: vi.fn(() => provider),
    setBookTop: vi.fn(),
    getProvider: () => provider,
    useProvider: () => provider,
    useFeed: (f: FeedId) => snapshot[f],
    useFeedSelect: feedSelect,
    getFeed: (f: FeedId) => snapshot[f],
    subscribeFeed: () => () => undefined,
    flushMarketNotifications: () => undefined,
    useHealth: () => health,
    useHealthSelect: (select: (h: ProviderHealth) => unknown) => select(health),
    useStatusLabel: (f: FeedId) => label(f),
    useMarketVersion: () => 1,
    useMarketView: () => actual.deriveMarket(snapshot, health, { now: fixture.now }),
    useTopTrader: (base: "accounts" | "positions" = "accounts") => actual.deriveTopTrader(snapshot, health, base),
  };
  return { provider, snapshot, health, refresh, overrides };
}

/** jsdom lacks these; motion (`whileInView`) and Recharts need them. */
export function installDomPolyfills(): void {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
  if (typeof globalThis.IntersectionObserver === "undefined") {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
  }
  if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => undefined;
}

/** Seeds the legacy fixture, boots the journal in local mode and resets the ui store. */
export async function bootFixtureJournal(): Promise<JournalState> {
  const { resetJournal, bootJournal, useJournal } = await import("@/store/journalStore");
  const { useUi, DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT } = await import("@/store/uiStore");
  seedV0(loadV0File());
  sessionStorage.clear();
  location.hash = "";
  resetJournal();
  useUi.setState({
    page: "overview",
    acc: "all",
    tradeFilter: DEFAULT_TRADE_FILTER,
    tradeSort: DEFAULT_TRADE_SORT,
    detail: { id: null, source: null },
    editor: { open: false, fromFab: false },
    setupEditor: { open: false, fromTrade: false },
    transitioning: false,
    toasts: [],
    hideLocalBanner: false,
  });
  await bootJournal({ probeCloud: false, autoBackup: false });
  return useJournal.getState();
}
