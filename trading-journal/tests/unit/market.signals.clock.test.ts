/**
 * The live check decides "forming vs closed" on the exchange clock (`provider.serverNow()`), not the device clock: a
 * tablet whose clock runs ahead must not treat the running Binance candle as closed (and confirm its signals early).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bar } from "@/domain/signals";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import { priceMv, priceReceivedAtMv, tradeTimeMv } from "@/market/motionValues";
import type { MarketProvider } from "@/market/provider";
import { __resetSignalEngine, attachSignalEngine, getSignalCandles, runSignalCheck, signalClockOffset } from "@/market/signals/engine";
import type { Candle, FeedId, Stamped } from "@/market/types";
import { benchAgg, synthBars } from "./signals.fixtures";

const T0 = Math.floor(1_780_000_000 / 14_400) * 14_400;
const H = synthBars(6000, 42, { t0: T0, sec: 900 });

function setup(skew: number) {
  // Binance time: 29 min into a 30m candle (14 min into its second 15m bar)
  const j = H.findIndex((b, i) => i > 5000 && b.t % 1800 === 900);
  const serverT = (H[j]!.t + 14 * 60) * 1000;
  const local = serverT + skew;
  vi.useFakeTimers();
  vi.setSystemTime(local);
  __resetSignalEngine();
  const upto = H.slice(0, j + 1);
  const toC = (b: Bar, sec: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1, closed: (b.t + sec) * 1000 <= serverT, closeTime: (b.t + sec) * 1000 - 1 });
  const feeds: Partial<Record<FeedId, Candle[]>> = {
    kline_15m: upto.slice(-1500).map((b) => toC(b, 900)),
    kline_1h: benchAgg(upto, 3600).slice(-499).map((b) => toC(b, 3600)),
    kline_4h: benchAgg(upto, 14_400).slice(-499).map((b) => toC(b, 14_400)),
  };
  const health = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: serverT };
  const provider = {
    symbol: "BTCUSDT",
    get: (f: FeedId) => (feeds[f] ? ({ data: feeds[f], asOf: serverT, receivedAt: local, source: "binance", comparable: true } as Stamped<Candle[]>) : undefined),
    subscribe: () => () => undefined,
    onHealth: () => () => undefined,
    getHealth: () => health,
    serverNow: () => Date.now() - skew,
    fetchKlines: async () => ({ data: [], asOf: serverT, receivedAt: local, source: "binance", comparable: true }),
  } as unknown as MarketProvider;
  tradeTimeMv.set(serverT); // a live trade at Binance time: the candle is still trading
  priceReceivedAtMv.set(local);
  priceMv.set(H[j]!.c);
  attachSignalEngine(provider);
  return { serverT };
}

describe("exchange clock", () => {
  afterEach(() => {
    __resetSignalEngine();
    vi.useRealTimers();
  });

  it("device clock 2 min ahead: the running 30m candle is still forming, 1 min to its close", () => {
    const { serverT } = setup(120_000);
    const base = runSignalCheck().snapshot!.checks[0]!;
    expect(base.forming).toBe(true);
    expect(base.msToClose).toBe(60_000);
    expect(base.closesAt).toBe(serverT + 60_000);
    // countdowns: closesAt − (device now + offset)
    expect(signalClockOffset()).toBe(-120_000);
    expect(base.closesAt! - (Date.now() + signalClockOffset())).toBe(60_000);
    // the chart's candle feed: the running candle is not closed either
    expect(getSignalCandles("30m").at(-1)!.closed).toBe(false);
  });

  it("no skew: unchanged", () => {
    setup(0);
    const base = runSignalCheck().snapshot!.checks[0]!;
    expect(base.forming).toBe(true);
    expect(base.msToClose).toBe(60_000);
    expect(signalClockOffset()).toBe(0);
  });
});
