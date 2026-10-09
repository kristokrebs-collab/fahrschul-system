/**
 * Live Lage (src/market/lage.ts) at a 4H close on a device clock that runs a little behind Binance (less than the
 * 2 s the provider corrects, `SKEW_APPLY_MS`): the socket's final candle (x = true) arrives a few hundred ms after the
 * close, when the device's Binance clock still reads just before it. The closed bar must still count once the close
 * has passed on that clock — not only at the next closed 1H bar an hour later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import type { Candle, FeedHealth, Stamped } from "@/market/types";

interface Series {
  sec: number;
  t0: number;
  n: number;
  h: number[];
  l: number[];
  c: number[];
}
const F = fixture as unknown as Record<"1D" | "4h" | "1h_oct", Series>;
const candles = (s: Series, now: number): Candle[] =>
  s.c.map((c, i) => {
    const time = (s.t0 + i * s.sec) * 1000;
    return { time, open: i ? s.c[i - 1]! : c, high: s.h[i]!, low: s.l[i]!, close: c, volume: 1, closed: time + s.sec * 1000 <= now };
  });

const NOW = Date.parse("2026-10-08T15:30:00Z");
/** device clock behind Binance by this much (below the provider's 2-s correction threshold) */
const BEHIND_MS = 800;
const feeds: Record<string, Stamped<Candle[]> | undefined> = {};
const feedSubs = new Map<string, Set<() => void>>();
const stamp = (data: Candle[], at = Date.now()): Stamped<Candle[]> => ({ data, asOf: at, receivedAt: at, source: "binance", comparable: true });
const tick = (f: string, data: Candle[]): void => {
  feeds[f] = stamp(data);
  for (const cb of feedSubs.get(f) ?? []) cb();
};

const dailyHealth: FeedHealth = { feed: "kline_1d", state: "live", source: "binance", consecutiveFailures: 0, nextRefreshAt: NOW + 30 * 60_000 };
const makeProvider = () => ({
  symbol: "BTCUSDT",
  serverNow: () => Date.now() - BEHIND_MS,
  getHealth: () => ({ feeds: { kline_1d: dailyHealth } }),
  onHealth: () => () => undefined,
});
const current = makeProvider();

vi.mock("@/market/marketStore", () => ({
  getProvider: () => current,
  useProvider: () => current,
  getFeed: (f: string) => feeds[f],
  subscribeFeed: (f: string, cb: () => void) => {
    let s = feedSubs.get(f);
    if (!s) feedSubs.set(f, (s = new Set()));
    s.add(cb);
    return () => s.delete(cb);
  },
}));

const { retainLage, getLage, __resetLage } = await import("@/market/lage");
const { priceMv } = await import("@/market/motionValues");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetLage();
  for (const k of Object.keys(feeds)) delete feeds[k];
  feeds.kline_1d = stamp(candles(F["1D"], NOW));
  feeds.kline_4h = stamp(candles(F["4h"], NOW));
  feeds.kline_1h = stamp(candles(F["1h_oct"], NOW));
  priceMv.set(81_356.2);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => {
  __resetLage();
  vi.useRealTimers();
});

describe("Lage at a 4H close, device clock slightly behind Binance", () => {
  it("counts the closed 4H bar once its close has passed, without waiting for another bar", async () => {
    const release = retainLage();
    const data = feeds.kline_4h!.data;
    const last = data[data.length - 1]!;
    const open12 = last.time + 14_400_000; // 12:00 UTC, the bar forming at 15:30
    const close = open12 + 14_400_000; // 16:00 UTC
    const forming: Candle = { ...last, time: open12, open: last.close, high: 82_600, low: 81_000, close: 82_000, closed: false };
    tick("kline_4h", [...data, forming]);
    expect(getLage().lage?.h4?.at).toBe(last.time);

    // the socket's final frame of the 12:00 bar (x = true), 300 ms after 16:00 on Binance's clock
    vi.setSystemTime(close + 300);
    const closed: Candle = { ...forming, high: 86_000, close: 86_000, closed: true };
    tick("kline_4h", [...data, closed]);
    // the first frame of the 16:00 bar, two seconds later
    await vi.advanceTimersByTimeAsync(2_000);
    tick("kline_4h", [...data, closed, { ...closed, time: close, open: 86_000, low: 86_000, closed: false }]);
    // the price moves on (the live part runs at most once a second)
    priceMv.set(86_050);
    await vi.advanceTimersByTimeAsync(1_000);

    const l = getLage().lage!;
    expect(l.h4?.at).toBe(open12);
    expect(l.h4?.close).toBe(86_000);
    expect(l.signs.find((s) => s.id === "U2")?.met).toBe(true);
    release();
  });
});
