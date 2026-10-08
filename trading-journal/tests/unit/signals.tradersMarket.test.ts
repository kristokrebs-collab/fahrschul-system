/**
 * Top-Trader-Kombi on market data (decision 5): the live reading from the provider's 5-min twins (no extra request,
 * Binance only, Binance clock), graded inside the ≤ 1/s evaluation; retro readings from the live ring or one
 * `fetchRatios` page per series ending at T (memoised, retried after a failure), older than ~30 days → no data.
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
import { __resetTraders, tradersAt } from "@/market/signals/traders";
import { benchAgg, synthBars } from "./signals.fixtures";

const S15 = 900;
const N15 = 9000;
const T_START = Math.floor(1_780_000_000 / 14_400) * 14_400;
const HIST15 = synthBars(N15, 42, { t0: T_START, sec: S15 });
const NOW = (HIST15[N15 - 1]!.t + 400) * 1000;
const H = 3_600_000;
const M5 = 300_000;

const toCandle = (b: Bar, sec: number, now: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: (b.t + sec) * 1000 <= now, closeTime: (b.t + sec) * 1000 - 1 });
function candles(sec: number, upTo: number = NOW): Candle[] {
  const src = HIST15.filter((b) => b.t * 1000 <= upTo);
  return (sec === S15 ? src : benchAgg(src, sec)).map((b) => toCandle(b, sec, upTo));
}

/** 5-min long-share points ending at the last 5-min boundary ≤ `end`. */
function series(end: number, values: number[]): RatioPoint[] {
  const last = Math.floor(end / M5) * M5;
  return values.map((v, i) => ({ time: last - (values.length - 1 - i) * M5, longPct: v, shortPct: 100 - v, ratio: v / (100 - v) }));
}
/** Top traders 66 % / 65 % long, retail falling (red): 4 of 4 for a long in discount. */
const LONG_SET = { pos: [60, 63, 66], acc: [61, 63, 65], ret: [47.2, 46.8, 46.3] };

function fakeProvider(o: { ratioSource?: Source; ratios?: boolean; fetchFails?: boolean } = {}) {
  const store = new Map<FeedId, Stamped<unknown>>();
  const subs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const health = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: NOW, source: f.endsWith("5m") ? (o.ratioSource ?? "binance") : "binance" };
  const stamp = <T,>(data: T, source: Source = "binance"): Stamped<T> => ({ data, asOf: NOW, receivedAt: NOW, source, comparable: true });
  store.set("kline_15m", stamp(candles(S15).slice(-1500)));
  store.set("kline_1h", stamp(candles(3600).slice(-499)));
  store.set("kline_4h", stamp(candles(14_400).slice(-499)));
  if (o.ratios !== false) {
    store.set("topPositionRatio5m", stamp(series(NOW, LONG_SET.pos), o.ratioSource));
    store.set("topAccountRatio5m", stamp(series(NOW, LONG_SET.acc), o.ratioSource));
    store.set("globalAccountRatio5m", stamp(series(NOW, LONG_SET.ret), o.ratioSource));
  }
  const fetches: { kind: string; period: string; endTime?: number; startTime?: number; limit?: number }[] = [];
  const state = { fail: !!o.fetchFails };
  const provider = {
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
    serverNow: () => Date.now(),
    async fetchKlines(iv: string, p: { endTime?: number; limit?: number } = {}) {
      const sec = iv === "15m" ? 900 : iv === "1h" ? 3600 : iv === "4h" ? 14_400 : 86_400;
      const all = candles(sec, Number.POSITIVE_INFINITY).filter((c) => c.time <= (p.endTime ?? NOW));
      return { data: all.slice(-(p.limit ?? 500)), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
    },
    async fetchRatios(kind: string, period: string, p: { endTime?: number; startTime?: number; limit?: number } = {}) {
      fetches.push({ kind, period, ...p });
      if (state.fail) throw Object.assign(new Error("Failed to fetch"), { kind: "network" });
      const v = kind === "topPositionRatio" ? LONG_SET.pos : kind === "topAccountRatio" ? LONG_SET.acc : LONG_SET.ret;
      return { data: series(p.endTime ?? NOW, v), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
    },
  } as unknown as MarketProvider;
  const publish = (f: FeedId, data: unknown) => {
    const v = stamp(data, o.ratioSource);
    store.set(f, v);
    for (const cb of subs.get(f) ?? []) cb(v);
  };
  return { provider, publish, fetches, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSignalEngine();
  __resetTraders();
  __clearRetroMemo();
  tradeTimeMv.set(0);
  priceReceivedAtMv.set(0);
  priceMv.set(0);
});
afterEach(() => {
  __resetSignalEngine();
  vi.useRealTimers();
});

describe("live", () => {
  it("reads the provider's 5-min twins (no request) and grades both sides; the trade snapshot stores the parts", () => {
    setSignalConfig({});
    const { provider, fetches } = fakeProvider();
    attachSignalEngine(provider);
    const snap = runSignalCheck(NOW).snapshot as LiveSignals;
    expect(fetches).toEqual([]);
    expect(snap.traders).toMatchObject({ position: 66, account: 65, retail: 46.3, period: "5m" });
    expect(snap.traders!.retailChg).toBeCloseTo(-0.5, 9);
    const long = snap.long.parts!.find((p) => p.id === "traders")!;
    expect(long.items.slice(0, 3).map((i) => i.met)).toEqual([true, true, true]);
    expect(long.data).toBe(true);
    expect(snap.short.parts!.find((p) => p.id === "traders")!.items.slice(0, 3).map((i) => i.met)).toEqual([false, false, false]);
    const stored = toTradeSnapshot(snap, "long");
    expect(stored.parts!.find((p) => p.id === "traders")).toMatchObject({ data: true, period: "5m" });
    expect(stored.whale).toBeUndefined();
    expect(snap.knife!.long.items.find((i) => i.id === "whale")!.met).toBe(true);
  });

  it("a new 5-min point only marks the engine dirty (no evaluation outside the ≤ 1/s timer)", () => {
    setSignalConfig({});
    const fake = fakeProvider();
    attachSignalEngine(fake.provider);
    runSignalCheck(NOW);
    const before = __signalStats().computes;
    fake.publish("globalAccountRatio5m", series(NOW, [46.3, 46.8, 47.4])); // retail turns green
    expect(__signalStats().computes).toBe(before);
    vi.advanceTimersByTime(1000);
    expect(__signalStats().computes).toBe(before + 1);
    const p = getSignalSnapshot().snapshot!.long.parts!.find((x) => x.id === "traders")!;
    expect(p.items.find((i) => i.id === "retail")!.met).toBe(false);
  });

  it("stale points (older than 2 steps + 5 min on the Binance clock) give no value", () => {
    setSignalConfig({});
    const { provider } = fakeProvider();
    attachSignalEngine(provider);
    vi.setSystemTime(NOW + 20 * 60_000);
    const snap = runSignalCheck(NOW + 20 * 60_000).snapshot!;
    expect(snap.traders).toBeNull();
    expect(snap.long.parts!.find((p) => p.id === "traders")).toMatchObject({ data: false, detail: "keine Daten" });
  });

  it("only Binance has top traders: a Bybit / OKX series gives no reading (keine Daten, never a fail)", () => {
    setSignalConfig({});
    attachSignalEngine(fakeProvider({ ratioSource: "bybit" }).provider);
    const snap = runSignalCheck(NOW).snapshot as LiveSignals;
    expect(snap.traders).toBeNull();
    expect(snap.long.parts!.find((p) => p.id === "traders")!.data).toBe(false);
    expect(snap.knife!.long.items.find((i) => i.id === "whale")!.met).toBeNull();
  });

  it("switched off: no part, no reading", () => {
    setSignalConfig({ ...DEFAULT_SIGNAL_CFG, whale: { on: false } });
    attachSignalEngine(fakeProvider().provider);
    const snap = runSignalCheck(NOW).snapshot!;
    expect(snap.traders).toBeNull();
    expect(snap.long.parts!.some((p) => p.id === "traders")).toBe(false);
    expect(toTradeSnapshot(snap, "long").parts!.some((p) => p.id === "traders")).toBe(false);
  });
});

describe("retro (back-dated trades)", () => {
  it("within the live ring: no request", async () => {
    setSignalConfig({});
    const { provider, fetches } = fakeProvider();
    attachSignalEngine(provider);
    const r = await tradersAt(provider, { whale: undefined }, NOW - 60_000, NOW);
    expect(r).toMatchObject({ position: 66, account: 65 });
    expect(fetches).toEqual([]);
  });

  it("inside Binance's ~30-day window: one 5-min page per series ending at T, graded and stored; memoised per minute", async () => {
    setSignalConfig({});
    const { provider, fetches } = fakeProvider({ ratios: false });
    attachSignalEngine(provider);
    const T = NOW - 50 * H + 123_000;
    const snap = await checkTradeAt(T, "long");
    expect(snap?.mode).toBe("retro");
    expect(["confirmed", "strong", "none"]).toContain(snap!.state); // closed bars only: never provisional
    expect(snap!.parts!.find((p) => p.id === "traders")).toMatchObject({ data: true, period: "5m" });
    expect(fetches.map((f) => [f.kind, f.period, f.endTime]).sort()).toEqual(
      [
        ["globalAccountRatio", "5m", T],
        ["topAccountRatio", "5m", T],
        ["topPositionRatio", "5m", T],
      ].sort(),
    );
    await checkTradeAt(T + 5_000, "short");
    expect(fetches).toHaveLength(3);
  });

  it("older than the window → no data, no request, graded without the part", async () => {
    setSignalConfig({});
    const { provider, fetches } = fakeProvider({ ratios: false });
    attachSignalEngine(provider);
    const snap = await checkTradeAt(NOW - 40 * 24 * H, "long");
    expect(snap).not.toBeNull();
    expect(snap!.parts!.find((p) => p.id === "traders")!.data).toBe(false);
    expect(fetches).toEqual([]);
  });

  it("a failed request is no fail either and is retried on the next check", async () => {
    setSignalConfig({});
    const fake = fakeProvider({ ratios: false, fetchFails: true });
    attachSignalEngine(fake.provider);
    const T = NOW - 6 * H;
    expect((await checkTradeAt(T, "long"))!.parts!.find((p) => p.id === "traders")!.data).toBe(false);
    fake.state.fail = false;
    expect((await checkTradeAt(T, "long"))!.parts!.find((p) => p.id === "traders")!.data).toBe(true);
    expect(fake.fetches.filter((c) => c.endTime === T)).toHaveLength(6);
  });
});
