/**
 * The provider's REST daily feed `kline_1d` (Lage-Ampel, a `1D` ladder rung): 1000 days on a fresh start only, the
 * missing days hourly at hh:00:20 on the Binance clock (00:00:20 brings the closed day), no "no new point" retries in
 * between, a cached series skips the 1000-day page, no stream, stale after 25 h. Real provider, synthetic Binance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKV, type KVStore } from "@/market/cache";
import { DAILY_FEED, KLINE_FEEDS, WS_FEEDS, buildFeedSpecs } from "@/market/feeds";
import { createMarketProvider, type MarketProvider } from "@/market/provider";
import type { Candle } from "@/market/types";
import { FakeSocket, HOUR, MIN, SEC, T0, flush, makeFetch, requests, runFor, setup, type Net } from "./market.netHarness";

const dailyLimits = (net: Net, since = -Infinity) =>
  requests(net, "/fapi/v1/klines", since)
    .filter((u) => u.searchParams.get("interval") === "1d")
    .map((u) => Number(u.searchParams.get("limit")));
const daily = (p: MarketProvider) => (p.get(DAILY_FEED)?.data ?? []) as Candle[];
const DAY = 24 * HOUR;

describe("kline_1d feed", () => {
  let p: MarketProvider | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0); // 2026-09-30 10:02 UTC
  });
  afterEach(() => {
    p?.stop();
    p = null;
    vi.useRealTimers();
  });

  it("is a REST feed outside the stream, hourly, stale after 25 h", () => {
    const spec = buildFeedSpecs("1h")[DAILY_FEED];
    expect(spec).toMatchObject({ transport: "rest", cadenceMs: HOUR, staleAfterMs: 25 * HOUR });
    expect(KLINE_FEEDS).not.toContain(DAILY_FEED);
    expect(WS_FEEDS).not.toContain(DAILY_FEED);
  });

  // 14 h of fake time on the real provider (every feed polling, the socket pumped every 10–30 s): ≈ 2.5–3 s of CPU on
  // its own, so a parallel full run (`--maxWorkers=2` beside other work) crossed vitest's 5-s default and failed by
  // timeout — not by an assertion
  it("fresh start: one 1000-day page, then the missing days hourly at hh:00:20 — 00:00:20 brings the closed day", { timeout: 30_000 }, async () => {
    const env = setup();
    p = env.provider;
    p.start();
    await flush();
    await runFor(env.net, 5 * SEC);
    expect(dailyLimits(env.net)).toEqual([1000]);
    expect(daily(p)).toHaveLength(1000);
    expect(FakeSocket.live()?.url ?? "").not.toContain("kline_1d");
    expect(p.getHealth().feeds[DAILY_FEED]).toMatchObject({ state: "live", source: "binance" });
    expect(p.getHealth().feeds[DAILY_FEED].nextRefreshAt).toBe(Date.UTC(2026, 8, 30, 11, 0, 20));
    // 11:00:20: the missing days only (weight 1), and nothing in between (no "no new point" retries)
    const at = Date.now();
    await runFor(env.net, 58 * MIN + 30 * SEC, { step: 10 * SEC });
    expect(dailyLimits(env.net, at)).toEqual([2]);
    // to the daily close: 13 hourly polls, then 00:00:20 has the new day as the newest bar
    await runFor(env.net, 13 * HOUR + 2 * MIN, { step: 30 * SEC });
    const dayStart = Math.floor(Date.now() / DAY) * DAY;
    expect(Date.now() - dayStart).toBeLessThan(5 * MIN);
    expect(daily(p).at(-1)!.time).toBe(dayStart);
    // the 29.09. … 30.09. day closed (its last candle is the new day's predecessor, marked closed)
    expect(daily(p).at(-2)).toMatchObject({ time: dayStart - DAY, closed: true });
    expect(dailyLimits(env.net, at).length).toBe(14);
  });

  it("a cached series (second start) asks only for the missing days — no second 1000-day page", async () => {
    const kv: KVStore = memoryKV();
    const net: Net = { log: [], fail: () => undefined, serverSkewMs: 0, proxyUp: false, wsUp: false };
    const make = () =>
      createMarketProvider({ symbol: "BINANCE:BTCUSDT", period: "1h", deps: { fetch: makeFetch(net), wsFactory: (url) => new FakeSocket(url), kv, random: () => 0.5, timeZone: "UTC", probeProxy: false } });
    const first = make();
    first.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5 * SEC);
    expect(dailyLimits(net)).toEqual([1000]);
    first.stop(); // persists the rings
    await flush();
    vi.setSystemTime(T0 + 3 * DAY);
    const since = Date.now();
    p = make();
    p.start();
    await flush();
    await vi.advanceTimersByTimeAsync(5 * SEC);
    const limits = dailyLimits(net, since);
    expect(limits).toHaveLength(1);
    expect(limits[0]).toBeLessThanOrEqual(5);
    expect(daily(p).length).toBeGreaterThanOrEqual(1000);
  });

  it("around the daily close on a skewed clock: the poll lands at 00:00:20 Binance time and brings the new day", async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 30, 23, 58));
    const env = setup({ serverSkewMs: -40 * SEC }); // the exchange clock is 40 s behind: at 00:00:20 device time it is 23:59:40
    p = env.provider;
    p.start();
    await flush();
    await runFor(env.net, 5 * SEC);
    const at = Date.now();
    await runFor(env.net, 5 * MIN, { step: 5 * SEC });
    // one poll at the aligned hh:00:20 on the Binance clock (00:01:00 on the device), which has the new day
    const n = dailyLimits(env.net, at).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    expect(daily(p).at(-1)!.time).toBe(Date.UTC(2026, 9, 1));
  });
});
