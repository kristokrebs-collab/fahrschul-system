/**
 * "Top-Trader kaufen · Retail rot" on market data: live series from the provider's own ratio period (no request) or
 * polled for other periods, Binance-only, retro within Binance's ~30-day window (older → `whale: null`, never a
 * fail), failures retried, cadence (a data change only marks the engine dirty).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_CFG, type Bar } from "@/domain/signals";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import { priceMv, priceReceivedAtMv, tradeTimeMv } from "@/market/motionValues";
import type { MarketProvider } from "@/market/provider";
import type { Candle, FeedId, RatioPoint, Source, Stamped } from "@/market/types";
import { __resetSignalEngine, __signalStats, attachSignalEngine, getSignalSnapshot, runSignalCheck, setSignalConfig, toTradeSnapshot, type LiveSignals } from "@/market/signals/engine";
import { __clearRetroMemo, checkTradeAt } from "@/market/signals/retro";
import { __resetWhale, __setWhaleClient, type WhaleClient } from "@/market/signals/whale";
import { benchAgg, synthBars } from "./signals.fixtures";

const S15 = 900;
const N15 = 9000;
const T_START = Math.floor(1_780_000_000 / 14_400) * 14_400;
const HIST15 = synthBars(N15, 42, { t0: T_START, sec: S15 });
const NOW = (HIST15[N15 - 1]!.t + 400) * 1000;
const H = 3_600_000;
const M30 = 1_800_000;

const toCandle = (b: Bar, sec: number, now: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: (b.t + sec) * 1000 <= now, closeTime: (b.t + sec) * 1000 - 1 });
function candles(sec: number, upTo: number = NOW): Candle[] {
  const src = HIST15.filter((b) => b.t * 1000 <= upTo);
  return (sec === S15 ? src : benchAgg(src, sec)).map((b) => toCandle(b, sec, upTo));
}

/** Ratio points ending at the last `step` boundary ≤ `end`: top rises / retail falls over the last `run` periods. */
function ratios(step: number, end: number, run: number, n = 12): { top: RatioPoint[]; glob: RatioPoint[] } {
  const last = Math.floor(end / step) * step;
  const top: RatioPoint[] = [];
  const glob: RatioPoint[] = [];
  for (let i = 0; i < n; i++) {
    const time = last - (n - 1 - i) * step;
    const k = i - (n - 1 - run); // > 0 inside the run
    const t = k > 0 ? 60 + k : 60; // flat before the run: those steps fit neither side
    const g = k > 0 ? 50 - k : 50;
    top.push({ time, longPct: t, shortPct: 100 - t, ratio: t / (100 - t) });
    glob.push({ time, longPct: g, shortPct: 100 - g, ratio: g / (100 - g) });
  }
  return { top, glob };
}

function fakeProvider(o: { period?: string; ratioSource?: Source; withRatios?: boolean } = {}) {
  const store = new Map<FeedId, Stamped<unknown>>();
  const subs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const health = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: NOW };
  const stamp = <T,>(data: T, source: Source = "binance"): Stamped<T> => ({ data, asOf: NOW, receivedAt: NOW, source, comparable: true });
  store.set("kline_15m", stamp(candles(S15).slice(-1500)));
  store.set("kline_1h", stamp(candles(3600).slice(-499)));
  store.set("kline_4h", stamp(candles(14_400).slice(-499)));
  if (o.withRatios) {
    const r = ratios(H, NOW, 3);
    store.set("topPositionRatio", stamp(r.top, o.ratioSource));
    store.set("globalAccountRatio", stamp(r.glob, o.ratioSource));
  }
  const provider = {
    symbol: "BTCUSDT",
    period: o.period ? { period: o.period, ok: true, raw: o.period } : undefined,
    get: (f: FeedId) => store.get(f),
    subscribe: (f: FeedId, cb: (v: Stamped<unknown>) => void) => {
      let s = subs.get(f);
      if (!s) subs.set(f, (s = new Set()));
      s.add(cb);
      return () => void s!.delete(cb);
    },
    onHealth: () => () => undefined,
    getHealth: () => health,
    async fetchKlines(iv: string, p: { endTime?: number; limit?: number } = {}) {
      const sec = iv === "15m" ? 900 : iv === "1h" ? 3600 : iv === "4h" ? 14_400 : 86_400;
      const all = candles(sec, Number.POSITIVE_INFINITY).filter((c) => c.time <= (p.endTime ?? NOW));
      return { data: all.slice(-(p.limit ?? 500)), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
    },
  } as unknown as MarketProvider;
  const publish = (f: FeedId, data: unknown) => {
    const v = stamp(data, o.ratioSource);
    store.set(f, v);
    for (const cb of subs.get(f) ?? []) cb(v);
  };
  return { provider, publish };
}

/** Fake futures-data client: `run` periods top ↑ / retail ↓ ending at the request's end time (or NOW). */
function fakeClient(run = 3, fail = { on: false }) {
  const calls: { kind: string; period: string; endTime?: number; limit?: number }[] = [];
  const client: WhaleClient = {
    async ratio(kind, _symbol, period, p = {}) {
      calls.push({ kind, period, endTime: p.endTime, limit: p.limit });
      if (fail.on) throw new Error("Failed to fetch");
      const step = period === "30m" ? M30 : period === "1h" ? H : period === "15m" ? 900_000 : period === "2h" ? 2 * H : 4 * H;
      const r = ratios(step, p.endTime ?? NOW, run);
      return { data: kind === "topPositionRatio" ? r.top : r.glob, asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
    },
  };
  return { client, calls };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSignalEngine();
  __resetWhale();
  __clearRetroMemo();
  tradeTimeMv.set(0);
  priceReceivedAtMv.set(0);
  priceMv.set(0);
});
afterEach(() => {
  __resetSignalEngine();
  __resetWhale();
  vi.useRealTimers();
});

describe("live", () => {
  it("the provider's own ratio period: reads its feeds (no request) and grades both sides", () => {
    const { client, calls } = fakeClient();
    __setWhaleClient(() => client);
    setSignalConfig({ whale: { periods: ["1h"], minRun: 2, weight: 10 } });
    const { provider } = fakeProvider({ period: "1h", withRatios: true });
    attachSignalEngine(provider);
    const snap = runSignalCheck(NOW).snapshot!;
    expect(calls).toEqual([]);
    expect(snap.whale?.periods).toEqual([expect.objectContaining({ period: "1h", runLong: 3, runShort: 0 })]);
    expect(snap.long.whale).toMatchObject({ ok: true, run: 3, period: "1h", points: 10 });
    expect(snap.short.whale).toMatchObject({ ok: false, points: 0 });
    expect(snap.long.reasons.at(-1)).toMatchObject({ ok: true });
    expect(toTradeSnapshot(snap, "long").whale).toMatchObject({ ok: true, run: 3, need: 2, periods: [expect.objectContaining({ period: "1h", run: 3 })] });
  });

  it("other periods are polled (two requests, limit 30) and the result is graded on the next evaluation", async () => {
    const { client, calls } = fakeClient(2);
    __setWhaleClient(() => client);
    setSignalConfig({ whale: { periods: ["30m"], minRun: 2 } });
    const { provider } = fakeProvider({ period: "1h" });
    attachSignalEngine(provider);
    expect(calls.map((c) => [c.kind, c.period, c.limit])).toEqual([
      ["topPositionRatio", "30m", 30],
      ["globalAccountRatio", "30m", 30],
    ]);
    expect(runSignalCheck(NOW).snapshot!.whale).toBeUndefined(); // not loaded yet: no reading, grade unchanged
    await flush();
    const snap = runSignalCheck(NOW + 1000).snapshot!;
    expect(snap.long.whale).toMatchObject({ ok: true, run: 2, period: "30m" });
  });

  it("a data change only marks the engine dirty (no evaluation outside the ≤ 1/s timer)", () => {
    __setWhaleClient(() => null);
    setSignalConfig({ whale: { periods: ["1h"] } });
    const fake = fakeProvider({ period: "1h", withRatios: true });
    attachSignalEngine(fake.provider);
    runSignalCheck(NOW);
    const before = __signalStats().computes;
    const r = ratios(H, NOW, 1);
    fake.publish("topPositionRatio", r.top);
    fake.publish("globalAccountRatio", r.glob);
    expect(__signalStats().computes).toBe(before);
    vi.advanceTimersByTime(1000);
    expect(__signalStats().computes).toBe(before + 1);
    expect(getSignalSnapshot().snapshot!.long.whale).toMatchObject({ ok: false, run: 1 });
  });

  it("only Binance has top traders: a Bybit / OKX series gives no reading, the trade snapshot stores whale: null", () => {
    __setWhaleClient(() => null);
    setSignalConfig({ whale: { periods: ["1h"] } });
    attachSignalEngine(fakeProvider({ period: "1h", withRatios: true, ratioSource: "bybit" }).provider);
    const snap = runSignalCheck(NOW).snapshot as LiveSignals;
    expect(snap.whale).toBeUndefined();
    expect(snap.long.whale).toBeUndefined();
    expect(toTradeSnapshot(snap, "long").whale).toBeNull();
  });

  it("switched off: nothing is fetched and the evaluation carries no reading", () => {
    const { client, calls } = fakeClient();
    __setWhaleClient(() => client);
    setSignalConfig({ ...DEFAULT_SIGNAL_CFG, whale: { on: false } });
    attachSignalEngine(fakeProvider({ period: "1h", withRatios: true }).provider);
    const snap = runSignalCheck(NOW).snapshot!;
    expect(calls).toEqual([]);
    expect(snap.whale).toBeUndefined();
    expect("whale" in toTradeSnapshot(snap, "long")).toBe(false);
  });
});

describe("retro (back-dated trades)", () => {
  it("inside Binance's ~30-day window: the series ending at T, graded and stored", async () => {
    const { client, calls } = fakeClient(4);
    __setWhaleClient(() => client);
    setSignalConfig({ whale: { periods: ["30m", "1h"], minRun: 2 } });
    attachSignalEngine(fakeProvider({ period: "4h" }).provider);
    const T = NOW - 50 * H + 123_000;
    const snap = await checkTradeAt(T, "long");
    expect(snap?.mode).toBe("retro");
    expect(snap?.whale).toMatchObject({ ok: true, run: 4, need: 2 });
    const retro = () => calls.filter((c) => c.endTime !== undefined); // the rest are the live polls (provider period 4h)
    expect(new Set(retro().map((c) => c.endTime))).toEqual(new Set([T]));
    expect(retro().map((c) => c.period).sort()).toEqual(["1h", "1h", "30m", "30m"]);
    // memoised per minute
    await checkTradeAt(T + 5_000, "short");
    expect(retro()).toHaveLength(4);
  });

  it("older than the window → whale: null (keine Daten), no request, grade without the condition", async () => {
    const { client, calls } = fakeClient();
    __setWhaleClient(() => client);
    setSignalConfig({ whale: { periods: ["1h"] } });
    attachSignalEngine(fakeProvider({ period: "1h" }).provider);
    const snap = await checkTradeAt(NOW - 40 * 24 * H, "long");
    expect(snap).not.toBeNull();
    expect(snap!.whale).toBeNull();
    expect(snap!.tfs.length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });

  it("a failed request is no fail either (null) and is retried on the next check", async () => {
    const fail = { on: true };
    const { client, calls } = fakeClient(3, fail);
    __setWhaleClient(() => client);
    setSignalConfig({ whale: { periods: ["1h"] } });
    attachSignalEngine(fakeProvider({ period: "4h" }).provider);
    const T = NOW - 6 * H;
    expect((await checkTradeAt(T, "long"))!.whale).toBeNull();
    fail.on = false;
    const again = await checkTradeAt(T, "long");
    expect(again!.whale).toMatchObject({ ok: true, run: 3 });
    expect(calls.filter((c) => c.endTime === T)).toHaveLength(4);
  });
});
