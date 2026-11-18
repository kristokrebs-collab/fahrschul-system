/**
 * Live Lage (src/market/lage.ts) on a fake provider: reads the provider's daily feed `kline_1d` (closed candles only)
 * plus the 4H / 1H series, the price at most 1×/s, publishes only on shown changes, an honest feed status from the
 * daily feed's health, follows provider swaps.
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
const feeds: Record<string, Stamped<Candle[]> | undefined> = {};
const feedSubs = new Map<string, Set<() => void>>();
const stamp = (data: Candle[], at = Date.now()): Stamped<Candle[]> => ({ data, asOf: at, receivedAt: at, source: "binance", comparable: true });
const tick = (f: string, data: Candle[]): void => {
  feeds[f] = stamp(data);
  for (const cb of feedSubs.get(f) ?? []) cb();
};

let dailyHealth: FeedHealth = { feed: "kline_1d", state: "live", source: "binance", consecutiveFailures: 0, nextRefreshAt: NOW + 30 * 60_000 };
const healthSubs = new Set<() => void>();
const makeProvider = (symbol = "BTCUSDT") => ({
  symbol,
  serverNow: () => Date.now(),
  getHealth: () => ({ feeds: { kline_1d: dailyHealth } }),
  onHealth: (cb: () => void) => {
    healthSubs.add(cb);
    return () => void healthSubs.delete(cb);
  },
});
let current: ReturnType<typeof makeProvider> | null = makeProvider();

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

const { retainLage, getLage, subscribeLage, __resetLage } = await import("@/market/lage");
const { priceMv } = await import("@/market/motionValues");

/** the daily page as Binance answers at `now`: the closed days + the forming one (close 20 000, never read) */
function dailyPage(now = Date.now()): Candle[] {
  const all = candles(F["1D"], now);
  const lastOpen = all[all.length - 1]!.time;
  const forming: Candle[] = [];
  for (let t = lastOpen + 86_400_000; t <= now; t += 86_400_000) forming.push({ time: t, open: 83_321.81, high: 83_500, low: 20_000, close: 20_000, volume: 1, closed: t + 86_400_000 <= now });
  return [...all, ...forming];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetLage();
  current = makeProvider();
  dailyHealth = { feed: "kline_1d", state: "live", source: "binance", consecutiveFailures: 0, nextRefreshAt: NOW + 30 * 60_000 };
  for (const k of Object.keys(feeds)) delete feeds[k];
  feeds.kline_1d = stamp(dailyPage());
  feeds.kline_4h = stamp(candles(F["4h"], NOW).filter((c) => c.time <= NOW));
  feeds.kline_1h = stamp(candles(F["1h_oct"], NOW).filter((c) => c.time <= NOW));
  priceMv.set(81_356.2);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => {
  __resetLage();
  vi.useRealTimers();
});

describe("Lage from the provider's feeds", () => {
  it("computes the report's example from kline_1d (closed days only) + 4H + 1H, with the feed's status", () => {
    const release = retainLage();
    const { lage, status } = getLage();
    expect(lage?.state).toBe("green");
    expect(lage?.wobble).not.toBeNull();
    expect(lage?.ema21_1d).toBeCloseTo(83_381.13, 1);
    expect(lage?.h4?.ema21).toBeCloseTo(84_216.9, 0);
    expect(lage?.newLow1h).toBe(true);
    // the forming day (close 20 000) never counts
    expect(lage?.daily?.close).toBeCloseTo(83_321.81, 2);
    expect(status).toEqual({ state: "ok", fetchedAt: NOW, closedAt: Date.parse("2026-10-08T00:00:00Z"), nextAt: NOW + 30 * 60_000, source: "binance", detail: null });
    release();
  });

  it("a new daily page (the provider's poll after 00:00) moves the Lage to the new close", () => {
    const release = retainLage();
    expect(getLage().lage?.daily?.at).toBe(Date.parse("2026-10-07T00:00:00Z"));
    vi.setSystemTime(Date.parse("2026-10-09T00:00:30Z"));
    const page = dailyPage().map((c) => (c.time === Date.parse("2026-10-08T00:00:00Z") ? { ...c, close: 80_000, low: 79_000, closed: true } : c));
    tick("kline_1d", page);
    const l = getLage().lage!;
    expect(l.daily?.at).toBe(Date.parse("2026-10-08T00:00:00Z"));
    expect(l.daily?.close).toBe(80_000);
    expect(l.abwaerts).toBe(true); // second close under the EMA 21 → red / amber
    expect(["red", "amber"]).toContain(l.state);
    release();
  });

  it("honest status: failures of the daily feed, no data yet, the missing close", () => {
    const release = retainLage();
    dailyHealth = { ...dailyHealth, consecutiveFailures: 2, reason: "network" };
    for (const cb of healthSubs) cb();
    expect(getLage().status).toMatchObject({ state: "stale", detail: "Netzwerk/CORS-Fehler · 2× in Folge" });
    release();
    __resetLage();
    delete feeds.kline_1d;
    const r2 = retainLage();
    expect(getLage().status.state).toBe("error");
    expect(getLage().lage).toBeNull();
    r2();
    __resetLage();
    // 00:10 the next day, the page still ends with the 07.10. close: "Tagesschluss noch nicht geladen"
    dailyHealth = { ...dailyHealth, consecutiveFailures: 0, reason: undefined };
    feeds.kline_1d = stamp(dailyPage());
    vi.setSystemTime(Date.parse("2026-10-09T00:10:00Z"));
    const r3 = retainLage();
    expect(getLage().status).toMatchObject({ state: "stale", detail: "Tagesschluss noch nicht geladen" });
    r3();
  });

  it("the live price moves the distances at most once a second and publishes only shown changes", async () => {
    const release = retainLage();
    const seen: unknown[] = [];
    const off = subscribeLage(() => seen.push(getLage()));
    for (let i = 0; i < 60; i++) {
      priceMv.set(81_356.2 + (i % 2)); // sub-0.1 % noise: nothing to show
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(seen.length).toBe(0);
    priceMv.set(84_000);
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

  it("a closed 4H bar recomputes; a forming tick does not", () => {
    const release = retainLage();
    const before = getLage();
    const data = feeds.kline_4h!.data;
    const last = data[data.length - 1]!;
    const forming: Candle = { ...last, time: last.time + 14_400_000, open: last.close, close: 82_000, closed: false };
    tick("kline_4h", [...data, forming]);
    tick("kline_4h", [...data, { ...forming, close: 82_100 }]);
    expect(getLage()).toBe(before);
    vi.setSystemTime(Date.parse("2026-10-08T16:00:01Z"));
    tick("kline_4h", [...data, { ...forming, close: 86_000, high: 86_000, closed: true }]);
    expect(getLage()).not.toBe(before);
    expect(getLage().lage?.h4?.close).toBe(86_000);
    expect(getLage().lage?.signs.find((s) => s.id === "U2")?.met).toBe(true);
    release();
  });

  it("follows a provider swap; without a provider it is idle", () => {
    const release = retainLage();
    expect(getLage().lage?.state).toBe("green");
    current = null;
    tick("kline_4h", feeds.kline_4h!.data);
    expect(getLage()).toEqual({ lage: null, status: expect.objectContaining({ state: "idle" }) });
    current = makeProvider("BTCUSDT");
    tick("kline_4h", feeds.kline_4h!.data);
    expect(getLage().lage?.state).toBe("green");
    release();
  });

  it("listens only while held", () => {
    const release = retainLage();
    expect(feedSubs.get("kline_1d")?.size).toBe(1);
    expect(healthSubs.size).toBe(1);
    release();
    expect(feedSubs.get("kline_1d")?.size ?? 0).toBe(0);
    expect(healthSubs.size).toBe(0);
  });
});
