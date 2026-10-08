/**
 * Live Lage feed (src/market/lage.ts) on a fake provider: the daily REST series through `provider.fetchKlines`
 * (first page 1000, then the missing days), closed bars only, hourly + right after 00:00 UTC, retries, resume,
 * asleep while hidden, the 4H / 1H live series, the price at most 1×/s, publishes only on shown changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import type { Candle, Stamped } from "@/market/types";

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
const feeds: Record<string, Stamped<Candle[]> | undefined> = {};
const feedSubs = new Map<string, Set<() => void>>();
const stamp = (data: Candle[]): Stamped<Candle[]> => ({ data, asOf: Date.now(), receivedAt: Date.now(), source: "binance", comparable: true });

const fetchKlines = vi.fn();
const provider = { symbol: "BTCUSDT", serverNow: () => Date.now(), fetchKlines };
let current: typeof provider | null = provider;

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

const { retainLage, getLage, subscribeLage, __resetLage, LAGE_DAILY_LIMIT } = await import("@/market/lage");
const { priceMv } = await import("@/market/motionValues");

/** daily page as Binance answers at `now`: the closed days + the forming one */
function dailyPage(limit: number, now = Date.now()): Stamped<Candle[]> {
  const all = candles(F["1D"], now);
  const lastOpen = all[all.length - 1]!.time;
  const forming: Candle[] = [];
  for (let t = lastOpen + 86_400_000; t <= now; t += 86_400_000) forming.push({ time: t, open: 83_321.81, high: 83_500, low: 20_000, close: 20_000, volume: 1, closed: t + 86_400_000 <= now });
  return stamp([...all, ...forming].slice(-limit));
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetLage();
  current = provider;
  fetchKlines.mockReset();
  fetchKlines.mockImplementation((_iv: string, p: { limit: number }) => Promise.resolve(dailyPage(p.limit)));
  feeds.kline_4h = stamp(candles(F["4h"], NOW).filter((c) => c.time <= NOW));
  feeds.kline_1h = stamp(candles(F["1h_oct"], NOW).filter((c) => c.time <= NOW));
  priceMv.set(81_356.2);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => {
  __resetLage();
  vi.useRealTimers();
});

describe("Lage feed", () => {
  it("loads 1000 daily bars through the provider's kline route and computes the report's example", async () => {
    const release = retainLage();
    expect(getLage().status.state).toBe("loading");
    expect(fetchKlines).toHaveBeenCalledWith("1d", expect.objectContaining({ limit: LAGE_DAILY_LIMIT }));
    await flush();
    const { lage, status } = getLage();
    expect(status.state).toBe("ok");
    expect(status.fetchedAt).toBe(NOW);
    expect(status.closedAt).toBe(Date.parse("2026-10-08T00:00:00Z"));
    expect(lage?.state).toBe("green");
    expect(lage?.wobble).not.toBeNull();
    expect(lage?.ema21_1d).toBeCloseTo(83_381.13, 1);
    expect(lage?.h4?.ema21).toBeCloseTo(84_216.9, 0);
    expect(lage?.newLow1h).toBe(true);
    // the forming day (close 20 000) never counts
    expect(lage?.daily?.close).toBeCloseTo(83_321.81, 2);
    release();
  });

  it("refreshes right after the daily close (00:00 UTC + 20 s) and hourly, asking only for the missing days", async () => {
    vi.setSystemTime(Date.parse("2026-10-08T23:30:00Z"));
    const release = retainLage();
    await flush();
    expect(getLage().status.nextAt).toBe(Date.parse("2026-10-09T00:00:20Z"));
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 20_000);
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(fetchKlines.mock.calls[1]![1].limit).toBe(3);
    // the 08.10. close is in now (the forming page of 23:30 was left out)
    expect(getLage().status.closedAt).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(getLage().status.nextAt).toBe(Date.parse("2026-10-09T01:00:20Z"));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchKlines).toHaveBeenCalledTimes(3);
    release();
  });

  it("retries a failed fetch after 30 s, 1 min … with an honest status", async () => {
    const { RestError } = await import("@/market/sources/http");
    fetchKlines.mockImplementationOnce(() => Promise.reject(new RestError("network", "Failed to fetch")));
    const release = retainLage();
    await flush();
    expect(getLage().status).toMatchObject({ state: "error", detail: "Netzwerk/CORS-Fehler", nextAt: NOW + 30_000 });
    expect(getLage().lage).toBeNull();
    fetchKlines.mockImplementationOnce(() => Promise.reject(new RestError("timeout", "Zeit")));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getLage().status).toMatchObject({ state: "error", detail: "Zeitüberschreitung · 2× in Folge" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getLage().status.state).toBe("ok");
    expect(getLage().lage?.state).toBe("green");
    release();
  });

  it("sleeps while hidden and catches up on the way back", async () => {
    const release = retainLage();
    await flush();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    await flush();
    expect(getLage().status.state).toBe("ok");
    release();
  });

  it("the live price moves the distances at most once a second and publishes only shown changes", async () => {
    const release = retainLage();
    await flush();
    const seen: unknown[] = [];
    const off = subscribeLage(() => seen.push(getLage()));
    for (let i = 0; i < 60; i++) {
      priceMv.set(81_356.2 + (i % 2)); // sub-0.1 % noise: nothing to show
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(seen.length).toBe(0);
    priceMv.set(84_000); // above the 4H EMA 21: distances and the ladder move
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.length).toBe(1);
    expect(getLage().lage?.dist).toBeCloseTo(84_000 / 83_381.13 - 1, 4);
    for (let i = 0; i < 30; i++) {
      priceMv.set(84_000 + i * 100);
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(seen.length).toBeLessThanOrEqual(2);
    off();
    release();
  });

  it("a closed 4H bar recomputes; a forming tick does not", async () => {
    const release = retainLage();
    await flush();
    const before = getLage();
    const data = feeds.kline_4h!.data;
    const last = data[data.length - 1]!;
    const forming: Candle = { ...last, time: last.time + 14_400_000, open: last.close, close: 82_000, closed: false };
    const tick = (c: Candle[]): void => {
      feeds.kline_4h = stamp(c);
      for (const cb of feedSubs.get("kline_4h") ?? []) cb();
    };
    tick([...data, forming]);
    tick([...data, { ...forming, close: 82_100 }]);
    expect(getLage()).toBe(before);
    // the candle closes (16:00): EMAs and signs move
    vi.setSystemTime(Date.parse("2026-10-08T16:00:01Z"));
    tick([...data, { ...forming, close: 86_000, high: 86_000, closed: true }]);
    expect(getLage()).not.toBe(before);
    expect(getLage().lage?.h4?.close).toBe(86_000);
    expect(getLage().lage?.signs.find((s) => s.id === "U2")?.met).toBe(true);
    release();
  });

  it("stops its timers when the last holder releases; a symbol switch starts over", async () => {
    const release = retainLage();
    await flush();
    release();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    const other = { symbol: "ETHUSDT", serverNow: () => Date.now(), fetchKlines };
    current = other;
    const again = retainLage();
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(fetchKlines.mock.calls[1]![1].limit).toBe(LAGE_DAILY_LIMIT);
    again();
  });

  it("without a provider (market stopped) it is idle and asks for nothing", () => {
    current = null;
    const release = retainLage();
    expect(getLage().status.state).toBe("idle");
    expect(fetchKlines).not.toHaveBeenCalled();
    release();
  });
});
