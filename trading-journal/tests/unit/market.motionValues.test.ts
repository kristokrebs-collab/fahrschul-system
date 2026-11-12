import { describe, expect, it } from "vitest";
import {
  askMv,
  bidMv,
  bindMotionValues,
  buyVolMv,
  flowImbalance,
  flowImbalanceMv,
  flushMotionValues,
  fundingMv,
  markMv,
  nextFundingMv,
  open24hFrom,
  open24hMv,
  ORDER_FLOW_HALF_LIFE_MS,
  priceMv,
  priceReceivedAtMv,
  sellVolMv,
  tickDirMv,
  tickerCarriesPrice,
  tradeCountMv,
  tradeTimeMv,
  volAccumMv,
} from "@/market/motionValues";
import type { AggTrade, FeedId, FeedValue, MarketDataProvider, Stamped } from "@/market/types";

const T0 = 1790762400000;

/** Minimal provider: a snapshot + per-feed subscribers, `push` publishes like the real one. */
function fakeProvider(symbol: string, snapshot: Partial<{ [F in FeedId]: Stamped<FeedValue[F]> }> = {}) {
  const subs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const snap: Partial<Record<FeedId, Stamped<unknown>>> = { ...snapshot };
  const provider = {
    symbol,
    get: <F extends FeedId>(f: F) => snap[f] as Stamped<FeedValue[F]> | undefined,
    subscribe: <F extends FeedId>(f: F, cb: (v: Stamped<FeedValue[F]>) => void) => {
      let set = subs.get(f);
      if (!set) subs.set(f, (set = new Set()));
      set.add(cb as (v: Stamped<unknown>) => void);
      return () => void set.delete(cb as (v: Stamped<unknown>) => void);
    },
  } as unknown as MarketDataProvider;
  const push = <F extends FeedId>(f: F, data: FeedValue[F], at: number) => {
    const v: Stamped<FeedValue[F]> = { data, asOf: at, receivedAt: at + 5, source: "binance", comparable: true };
    snap[f] = v as Stamped<unknown>;
    for (const cb of subs.get(f) ?? []) cb(v as Stamped<unknown>);
  };
  return { provider, push, subscribers: (f: FeedId) => subs.get(f)?.size ?? 0 };
}

const stamp = <T>(data: T, at: number): Stamped<T> => ({ data, asOf: at, receivedAt: at + 5, source: "binance", comparable: true });
const trade = (price: number, qty: number, isBuyerMaker: boolean, time: number): AggTrade => ({ price, qty, isBuyerMaker, time });
const ticker = (lastPrice: number, priceChangePercent: number) => ({ lastPrice, priceChangePercent, high: 0, low: 0, volume: 0, quoteVolume: 0, time: T0 });

describe("market motion values", () => {
  it("pure helpers: flow imbalance and the 24 h open", () => {
    expect(flowImbalance(0, 0)).toBe(0);
    expect(flowImbalance(3, 1)).toBe(0.5);
    expect(flowImbalance(0, 2)).toBe(-1);
    expect(open24hFrom({ lastPrice: 101.2, priceChangePercent: 1.2 })).toBeCloseTo(100, 10);
    expect(open24hFrom({ lastPrice: 100, priceChangePercent: -100 })).toBeNull();
    expect(open24hFrom({ lastPrice: 0, priceChangePercent: 1 })).toBeNull();
    expect(open24hFrom({ lastPrice: 100, priceChangePercent: Number.NaN })).toBeNull();
  });

  it("seeds every value from the snapshot without a tick direction", () => {
    const { provider } = fakeProvider("SEEDUSDT", {
      aggTrade: stamp(trade(86100, 0.1, false, T0 - 50), T0 - 50),
      ticker24h: stamp(ticker(86000, 1.2), T0 - 1000),
      bookTop: stamp({ bid: 86099.9, ask: 86100, time: T0 }, T0),
      markPrice: stamp({ markPrice: 86112, indexPrice: 86110, fundingRate: 0.0001, nextFundingTime: T0 + 3_600_000, time: T0 }, T0),
    });
    const off = bindMotionValues(provider);
    flushMotionValues();
    expect(priceMv.get()).toBe(86100);
    expect(tradeTimeMv.get()).toBe(T0 - 50);
    expect(priceReceivedAtMv.get()).toBe(T0 - 45);
    expect(bidMv.get()).toBe(86099.9);
    expect(askMv.get()).toBe(86100);
    expect(markMv.get()).toBe(86112);
    expect(fundingMv.get()).toBe(0.0001);
    expect(nextFundingMv.get()).toBe(T0 + 3_600_000);
    expect(open24hMv.get()).toBeCloseTo(86000 / 1.012, 8);
    expect(tickDirMv.get()).toBe(0);
    expect(tradeCountMv.get()).toBe(0); // the seed trade happened before the binding
    expect(volAccumMv.get()).toBe(0);
    off();
  });

  it("accumulates every trade of a frame (side by aggressor) and sets the price last", () => {
    const { provider, push } = fakeProvider("FLOWUSDT");
    const off = bindMotionValues(provider);
    const order: string[] = [];
    const offs = [
      priceMv.on("change", () => order.push(`price@${tradeTimeMv.get()}:${tickDirMv.get()}`)),
      tradeTimeMv.on("change", () => order.push("time")),
    ];
    push("aggTrade", trade(100, 0.5, false, T0), T0); // taker buy
    push("aggTrade", trade(101, 0.2, true, T0 + 10), T0 + 10); // taker sell
    push("aggTrade", trade(102, 0.3, false, T0 + 20), T0 + 20); // taker buy
    expect(volAccumMv.get()).toBe(0); // queued until the frame
    flushMotionValues();
    expect(buyVolMv.get()).toBeCloseTo(0.8, 12);
    expect(sellVolMv.get()).toBeCloseTo(0.2, 12);
    expect(volAccumMv.get()).toBeCloseTo(1, 12);
    expect(tradeCountMv.get()).toBe(3);
    expect(priceMv.get()).toBe(102);
    expect(tradeTimeMv.get()).toBe(T0 + 20);
    expect(order).toEqual(["time", `price@${T0 + 20}:0`]); // first price after the bind has no previous → no direction

    push("aggTrade", trade(101.5, 0.1, true, T0 + 30), T0 + 30);
    flushMotionValues();
    expect(tickDirMv.get()).toBe(-1);
    expect(order.at(-1)).toBe(`price@${T0 + 30}:-1`);
    for (const o of offs) o();
    off();
  });

  it("decays the order flow by trade time (half-life) and keeps the ratio exact", () => {
    const { provider, push } = fakeProvider("DECAYUSDT");
    const off = bindMotionValues(provider);
    push("aggTrade", trade(100, 3, false, T0), T0);
    push("aggTrade", trade(100, 1, true, T0), T0);
    flushMotionValues();
    expect(flowImbalanceMv.get()).toBeCloseTo(0.5, 12);
    // one half-life later: buy 3 → 1.5, sell 1 → 0.5, + new sell 1 → 1.5 : 1.5
    push("aggTrade", trade(100, 1, true, T0 + ORDER_FLOW_HALF_LIFE_MS), T0 + ORDER_FLOW_HALF_LIFE_MS);
    flushMotionValues();
    expect(flowImbalanceMv.get()).toBeCloseTo(0, 12);
    // fallback prints (qty 0, ticker-derived) count as prints but carry no flow
    const before = flowImbalanceMv.get();
    push("aggTrade", trade(100, 0, false, T0 + ORDER_FLOW_HALF_LIFE_MS + 5), T0 + ORDER_FLOW_HALF_LIFE_MS + 5);
    flushMotionValues();
    expect(flowImbalanceMv.get()).toBe(before);
    expect(tradeCountMv.get()).toBe(4);
    off();
  });

  it("the ticker refreshes the 24 h open always and the price only without a trade stream", () => {
    const { provider, push } = fakeProvider("TICKUSDT");
    const off = bindMotionValues(provider);
    push("ticker24h", ticker(50_500, 1), T0);
    flushMotionValues();
    expect(open24hMv.get()).toBeCloseTo(50_000, 8);
    expect(priceMv.get()).toBe(50_500);
    expect(tradeTimeMv.get()).toBe(T0);
    push("aggTrade", trade(50_600, 0.1, false, T0 + 100), T0 + 100);
    push("ticker24h", ticker(50_400, -0.2), T0 + 200);
    flushMotionValues();
    expect(priceMv.get()).toBe(50_600);
    expect(open24hMv.get()).toBeCloseTo(50_400 / 0.998, 8);
    off();
  });

  it("the trade stream falls silent: the next ticker (30-s poll / 5-s REST stand-in) carries the price into the odometer and header", () => {
    expect(tickerCarriesPrice(stamp(ticker(1, 0), T0 + 5_000), stamp(trade(2, 1, false, T0), T0))).toBe(false); // within 5 s: the trade wins
    expect(tickerCarriesPrice(stamp(ticker(1, 0), T0 + 5_001), stamp(trade(2, 1, false, T0), T0))).toBe(true);
    expect(tickerCarriesPrice(stamp(ticker(1, 0), T0), undefined)).toBe(true);
    const { provider, push } = fakeProvider("SILENTUSDT");
    const off = bindMotionValues(provider);
    push("aggTrade", trade(82_446.4, 0.1, false, T0), T0);
    flushMotionValues();
    expect(priceMv.get()).toBe(82_446.4);
    push("ticker24h", ticker(82_080, -1), T0 + 360_000); // 6 min later, no trade since (Galaxy Tab)
    flushMotionValues();
    expect(priceMv.get()).toBe(82_080);
    expect(tradeTimeMv.get()).toBe(T0 + 360_000);
    off();
    // a re-bind (remount) seeds from the fresher ticker, not the cached trade
    const again = bindMotionValues(provider);
    flushMotionValues();
    expect(priceMv.get()).toBe(82_080);
    again();
  });

  it("zeroes the symbol-scoped values on a symbol switch and keeps them when the same symbol re-binds", () => {
    const a = fakeProvider("AAAUSDT");
    const offA = bindMotionValues(a.provider);
    a.push("aggTrade", trade(10, 1, false, T0), T0);
    a.push("aggTrade", trade(11, 1, false, T0 + 1), T0 + 1);
    flushMotionValues();
    offA();
    expect(a.subscribers("aggTrade")).toBe(0);

    const again = fakeProvider("AAAUSDT");
    const offAgain = bindMotionValues(again.provider);
    flushMotionValues();
    expect(priceMv.get()).toBe(11);
    expect(volAccumMv.get()).toBe(2);
    offAgain();

    const b = fakeProvider("BBBUSDT");
    const offB = bindMotionValues(b.provider);
    expect(priceMv.get()).toBe(0);
    expect(volAccumMv.get()).toBe(0);
    expect(tradeCountMv.get()).toBe(0);
    expect(tickDirMv.get()).toBe(0);
    b.push("aggTrade", trade(2000, 1, true, T0 + 2), T0 + 2);
    flushMotionValues();
    expect(priceMv.get()).toBe(2000);
    expect(tickDirMv.get()).toBe(0); // first price of the new symbol: no direction against the old one
    expect(flowImbalanceMv.get()).toBe(-1);
    offB();
  });
});
