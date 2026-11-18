/**
 * Live check at a candle close (src/market/signals/engine.ts): the frame's price is taken at the last 1m close and
 * completes the FORMING candles between frames. When a rung's candle closes before the next frame starts (the socket's
 * final frame arrives within the frame grace after the boundary), the evaluation in between must use the candle's
 * final close from the feed — never the older frame price in its place (a state computed from a minute-old close,
 * flipping back one second later at the next frame).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_CFG, checkTf, type Bar } from "@/domain/signals";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import { priceMv, priceReceivedAtMv, tradeTimeMv } from "@/market/motionValues";
import type { MarketProvider } from "@/market/provider";
import type { Candle, FeedId, ProviderHealth, Stamped } from "@/market/types";
import { __resetSignalEngine, attachSignalEngine, buildBars, getSignalSnapshot, SIGNAL_FRAME_GRACE_MS } from "@/market/signals/engine";
import { benchAgg, synthBars } from "./signals.fixtures";

const S15 = 900;
const N15 = 9000;
const T_START = Math.floor(1_780_000_000 / 14_400) * 14_400;
const HIST15 = synthBars(N15, 42, { t0: T_START, sec: S15 });
/** inside the last (forming) 15m bar; its close C is a 15m, 30m and 1h boundary */
const NOW = (HIST15[N15 - 1]!.t + 400) * 1000;
const C = (HIST15[N15 - 1]!.t + S15) * 1000;

const toCandle = (b: Bar, sec: number, now: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: (b.t + sec) * 1000 <= now, closeTime: (b.t + sec) * 1000 - 1 });
const candles = (sec: number): Candle[] => (sec === S15 ? HIST15 : benchAgg(HIST15, sec)).map((b) => toCandle(b, sec, NOW));

function fakeProvider(feeds: Partial<Record<FeedId, Candle[]>>) {
  const store = new Map<FeedId, Stamped<Candle[]>>();
  const subs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const health: ProviderHealth = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: NOW };
  const stamp = (data: Candle[]): Stamped<Candle[]> => ({ data, asOf: Date.now(), receivedAt: Date.now(), source: "binance", comparable: true });
  for (const [f, d] of Object.entries(feeds)) store.set(f as FeedId, stamp(d!));
  return {
    publish(feed: FeedId, data: Candle[]) {
      const v = stamp(data);
      store.set(feed, v);
      for (const cb of subs.get(feed) ?? []) cb(v as Stamped<unknown>);
    },
    provider: {
      symbol: "BTCUSDT",
      get: ((f: FeedId) => store.get(f)) as MarketProvider["get"],
      subscribe: ((f: FeedId, cb: (v: Stamped<unknown>) => void) => {
        let s = subs.get(f);
        if (!s) subs.set(f, (s = new Set()));
        s.add(cb);
        return () => void s!.delete(cb);
      }) as MarketProvider["subscribe"],
      onHealth: () => () => undefined,
      getHealth: () => health,
    } as unknown as MarketProvider,
  };
}

function setPrice(price: number, at: number): void {
  tradeTimeMv.set(at);
  priceReceivedAtMv.set(at);
  priceMv.set(price);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSignalEngine();
  localStorage.clear();
  setPrice(0, 0);
});
afterEach(() => {
  __resetSignalEngine();
  vi.useRealTimers();
});

describe("live check at a candle close", () => {
  it("an evaluation between the close and the next frame reads the closed candle's final close, not the frame price", async () => {
    const feeds = { kline_15m: candles(S15).slice(-1500), kline_1h: candles(3600).slice(-499), kline_4h: candles(14_400).slice(-499) };
    const fake = fakeProvider(feeds);
    const last15 = feeds.kline_15m.at(-1)!;
    setPrice(last15.close, NOW);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);

    // the last frame before the close (C − 59 s) takes the price of that moment
    await vi.advanceTimersByTimeAsync(C - 60_000 + 500 - Date.now());
    const pFrame = last15.close * 1.012;
    setPrice(pFrame, Date.now());
    await vi.advanceTimersByTimeAsync(SIGNAL_FRAME_GRACE_MS);
    expect(getSignalSnapshot().snapshot!.price).toBe(pFrame);

    // 300 ms after the close the socket delivers the candle's final frame (x = true) with a different close
    await vi.advanceTimersByTimeAsync(C + 300 - Date.now());
    const pFinal = last15.close * 0.988;
    const closed: Candle = { ...last15, close: pFinal, low: Math.min(last15.low, pFinal), high: Math.max(last15.high, pFinal), closed: true };
    fake.publish("kline_15m", [...feeds.kline_15m.slice(0, -1), closed]);
    await vi.advanceTimersByTimeAsync(50);
    expect(Date.now()).toBeLessThan(C + SIGNAL_FRAME_GRACE_MS); // still the frame taken before the close

    const snap = getSignalSnapshot().snapshot!;
    const c30 = snap.checks[0]!;
    expect(c30.tf).toBe("30m");
    expect(c30.forming).toBe(false);
    // the same rung from the feed's own (closed) candles
    const expected = checkTf("30m", buildBars(fake.provider, DEFAULT_SIGNAL_CFG, null)["30m"]!, DEFAULT_SIGNAL_CFG, Date.now());
    expect(c30.rsi).toBeCloseTo(expected!.rsi, 9);
    expect(c30.wt.wt1).toBeCloseTo(expected!.wt.wt1, 9);
  });
});
