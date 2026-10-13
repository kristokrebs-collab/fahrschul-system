/**
 * Box-zu-Box live layer (P02): the domain additions (`settings.boxes` sanitiser, trade snapshot, analysis key), the live
 * store (closed-key recomputes, idle chunks, history once, live price only for the pending state), the watchlist
 * scanner (own ≤ 20-weight budget, 451 → proxy, IDB cache, A+ / A only), the alerts (seed, close-only, dedup) and the
 * trade snapshot resolver (live / retro). Real BTCUSDT bars (fixtures), a real provider on the synthetic Binance of the
 * net harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import btc1d from "./fixtures/binance-btcusdt-1d.json";
import {
  analyzeBoxes,
  boxesCfgKey,
  boxesCfgOf,
  boxGradeOf,
  boxKey,
  boxState,
  DEFAULT_BOXES_CFG,
  DEFAULT_WATCHLIST,
  normalizeWatchSymbol,
  parseBoxSnapshot,
  toBoxSnapshot,
  traderBiasOf,
  withBoxesSettings,
  WATCHLIST_MAX,
} from "@/domain/boxes";
import type { Bar } from "@/domain/signals/indicators";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import { memoryKV, type KVStore } from "@/market/cache";
import type { MarketProvider } from "@/market/provider";
import { binanceRest } from "@/market/sources/binance";
import { proxyRest } from "@/market/sources/proxy";
import type { Candle, Stamped } from "@/market/types";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { HOUR, SEC, flush, makeFetch, requests, runFor, setup, type Net } from "./market.netHarness";

// ------------------------------------------------------------------ fixtures

const load = (j: unknown): Bar[] => (j as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const B4 = load(btc4h);
const B1 = load(btc1d);
const H4 = 4 * HOUR;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const toCandle = (b: Bar, ivMs: number, now: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1, closed: b.t * 1000 + ivMs <= now });
/** Monday-based weeks from the daily bars (Binance weeks open Monday 00:00 UTC). */
function weekly(days: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const d of days) {
    const open = Math.floor((d.t * 1000 - 4 * DAY) / WEEK) * WEEK + 4 * DAY;
    const last = out[out.length - 1];
    if (last && last.t * 1000 === open) Object.assign(last, { h: Math.max(last.h, d.h), l: Math.min(last.l, d.l), c: d.c });
    else out.push({ t: open / 1000, o: d.o, h: d.h, l: d.l, c: d.c });
  }
  return out;
}
const W1 = weekly(B1);

/** The fixture's newest 4h bar opens 2026-10-12 00:00 UTC: "now" is inside it (forming). */
const NOW = (B4[B4.length - 1]!.t + 2 * 3600) * 1000;

// ------------------------------------------------------------------ market store mock (a fake or a real provider)

type Listener = (v: unknown) => void;
const fakeFeeds: Record<string, Stamped<Candle[]> | undefined> = {};
const fakeSubs = new Map<string, Set<Listener>>();
const market = vi.hoisted(() => ({ current: null as unknown, real: null as unknown }));

vi.mock("@/market/marketStore", () => ({
  getProvider: () => market.current,
  useProvider: () => market.current,
  getFeed: (f: string) => (market.real ? (market.real as MarketProvider).get(f as never) : fakeFeeds[f]),
  subscribeFeed: (f: string, cb: Listener) => {
    if (market.real) return (market.real as MarketProvider).subscribe(f as never, cb as never);
    let s = fakeSubs.get(f);
    if (!s) fakeSubs.set(f, (s = new Set()));
    s.add(cb);
    return () => void s.delete(cb);
  },
}));

const { retainBoxes, getBoxes, subscribeBoxes, getBoxBars, closedBars, __boxStats, __resetBoxes } = await import("@/market/boxes/store");
const { scanSymbol, getScan, retainScanner, scanNow, nextScanAt, lastClosedOpen, __resetScanner, SCAN_BUDGET, budgetedKlines } = await import("@/market/boxes/scanner");
const { boxSnapCandidates, backfillBoxSnap, startBoxSnapBackfill, BOXSNAP_TRIED_KEY, BOXSNAP_START_MS, BOXSNAP_GAP_MS, BOXSNAP_RETRY_MS } = await import("@/market/boxes/backfill");
const { evaluateBoxes, __resetBoxAlerts, startBoxAlerts, scanAlertKey, BOX_ALERTS_KEY } = await import("@/market/boxes/alerts");
const { resolveTradeBoxes, tradeDateMs, barOpenOf, __resetBoxSnapshotMemo } = await import("@/market/boxes/snapshot");
const { priceMv } = await import("@/market/motionValues");

const stamp = (data: Candle[], at = Date.now()): Stamped<Candle[]> => ({ data, asOf: at, receivedAt: at, source: "binance", comparable: true });
function publishFeed(f: string, data: Candle[]): void {
  fakeFeeds[f] = stamp(data);
  for (const cb of [...(fakeSubs.get(f) ?? [])]) cb(fakeFeeds[f]);
}
function fakeProvider(over: Partial<Record<string, unknown>> = {}) {
  return {
    symbol: "BTCUSDT",
    serverNow: () => Date.now(),
    get: () => undefined,
    getHealth: () => initialHealth(buildFeedSpecs("1h")),
    history: vi.fn((_feed: string, _range: { from: number; to: number }) => Promise.resolve(stamp([]))),
    fetchKlines: vi.fn(),
    ...over,
  };
}
const setBoxesSettings = (boxes: unknown): void => {
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, boxes } as typeof s });
};
const feedsAt = (now: number, cut4h = B4.length, n4 = 760) => {
  publishFeed("kline_4h", B4.slice(Math.max(0, cut4h - n4), cut4h).map((b) => toCandle(b, H4, now)));
  publishFeed("kline_1d", B1.map((b) => toCandle(b, DAY, now)));
  publishFeed("kline_1w", W1.slice(-200).map((b) => toCandle(b, WEEK, now)));
};

// ------------------------------------------------------------------ domain

describe("domain: settings.boxes, bias, snapshot, key", () => {
  it("boxesCfgOf defaults, clamps and normalises the watchlist", () => {
    expect(boxesCfgOf(undefined)).toEqual({ ...DEFAULT_BOXES_CFG, watchlist: [...DEFAULT_WATCHLIST], box: { ...DEFAULT_BOXES_CFG.box } });
    expect(DEFAULT_WATCHLIST).toHaveLength(10);
    const c = boxesCfgOf({ on: false, minGrade: "A+", watchlist: ["binance:ethusdt.p", "sol", "SOLUSDT", "bad sym!", 3], box: { tolAtr: 99, lookback: "500" } });
    expect(c.on).toBe(false);
    expect(c.minGrade).toBe("A+");
    expect(c.watchlist).toEqual(["ETHUSDT", "SOLUSDT"]);
    expect(c.box.tolAtr).toBe(2);
    expect(c.box.lookback).toBe(500);
    expect(boxesCfgOf({ minGrade: "B" }).minGrade).toBe("A");
    expect(boxesCfgOf({ watchlist: Array.from({ length: 40 }, (_, i) => `C${i}USDT`) }).watchlist).toHaveLength(WATCHLIST_MAX);
    expect(normalizeWatchSymbol("eth/usdt")).toBe("ETHUSDT");
    expect(normalizeWatchSymbol("")).toBeNull();
  });

  it("withBoxesSettings keeps unknown keys and returns the same object when nothing changes", () => {
    const raw = { alerts: true, future: { x: 1 } };
    const same = withBoxesSettings(raw, { alerts: true });
    expect(same).toBe(raw);
    const next = withBoxesSettings(raw, { notify: true, watchlist: ["eth"] });
    expect(next).toEqual({ alerts: true, future: { x: 1 }, notify: true, watchlist: ["ETHUSDT"] });
    expect(boxesCfgKey(boxesCfgOf(next))).not.toBe(boxesCfgKey(boxesCfgOf(raw)));
  });

  it("traderBiasOf: long-heavy with a non-negative delta, short-heavy mirrored, else neutral; no data → null", () => {
    expect(traderBiasOf(null)).toBeNull();
    expect(traderBiasOf({ position: null, account: null })).toBeNull();
    expect(traderBiasOf({ position: 62, account: 58, delta: 4 })).toBe(1);
    expect(traderBiasOf({ position: 62, account: 58, delta: -2 })).toBe(0);
    expect(traderBiasOf({ position: 40, account: 42, delta: -3 })).toBe(-1);
    expect(traderBiasOf({ position: 50, account: 51 })).toBe(0);
  });

  it("toBoxSnapshot → parseBoxSnapshot → boxGradeOf round trip (side of the trade, rounded)", () => {
    const a = analyzeBoxes({ tf: "4h", bars: B4.slice(0, 1493), bias: 1 })!;
    const best = a.setups[0]!;
    const snap = toBoxSnapshot(a, { symbol: "BTCUSDT", tf: "4h", side: best.side, source: "retro" });
    expect(snap).toMatchObject({ v: 1, symbol: "BTCUSDT", tf: "4h", source: "retro", phase: a.box.phase, at: a.at * 1000 });
    expect(snap.setup?.grade).toBe(best.grade);
    expect(parseBoxSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(boxGradeOf({ boxSnap: snap })).toBe(best.grade);
    const other = toBoxSnapshot(a, { symbol: "BTCUSDT", tf: "4h", side: best.side === "long" ? "short" : "long", source: "retro" });
    expect(other.setup?.side ?? (best.side === "long" ? "short" : "long")).not.toBe(best.side);
  });

  it("boxKey is stable for the same analysis and changes with what is shown", () => {
    const bars = B4.slice(0, 1493);
    const a = analyzeBoxes({ tf: "4h", bars, bias: 1 })!;
    const b = analyzeBoxes({ tf: "4h", bars, bias: 1 })!;
    expect(boxKey(a)).toBe(boxKey(b));
    const c = analyzeBoxes({ tf: "4h", bars, bias: -1 })!;
    expect(boxKey(c)).not.toBe(boxKey(a)); // the score of the setup changed
    expect(boxKey(null)).toBe("∅");
  });
});

// ------------------------------------------------------------------ store

describe("live box store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    __resetBoxes();
    market.real = null;
    market.current = fakeProvider();
    for (const k of Object.keys(fakeFeeds)) delete fakeFeeds[k];
    fakeSubs.clear();
    priceMv.set(0);
    setBoxesSettings(undefined);
    feedsAt(NOW);
  });
  afterEach(() => {
    __resetBoxes();
    vi.useRealTimers();
  });

  it("analyses 4h / 1D / 1W from the closed bars, one timeframe per idle chunk, history requested once", async () => {
    feedsAt(NOW, B4.length, 499); // the provider's bootstrap: 499 bars → the store asks for the rest once
    const release = retainBoxes();
    expect((market.current as ReturnType<typeof fakeProvider>).history).toHaveBeenCalledTimes(1);
    expect((market.current as ReturnType<typeof fakeProvider>).history.mock.calls[0]![0]).toBe("kline_4h");
    expect(getBoxes().state).toBe("loading");
    // one base per idle callback (setTimeout fallback in jsdom): 3 bases + the live pass
    await vi.advanceTimersByTimeAsync(16);
    expect(__boxStats().baseRuns).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(__boxStats().baseRuns).toBe(3);
    const v = getBoxes();
    expect(v.state).toBe("ok");
    expect(v.symbol).toBe("BTCUSDT");
    for (const tf of ["4h", "1d", "1w"] as const) {
      expect(v.tfs[tf].analysis).not.toBeNull();
      expect(v.tfs[tf].boxId).toMatch(new RegExp(`^${tf}:`));
    }
    // closed bars only: the forming 4h bar is not analysed
    expect(getBoxBars("4h").at(-1)!.t).toBe(B4[B4.length - 2]!.t);
    expect(v.tfs["4h"].closesAt).toBe(B4[B4.length - 1]!.t * 1000 + H4);
    // the higher timeframe grades the lower one
    expect(v.tfs["4h"].analysis!.htf?.tf).toBe("1d");
    expect(v.tfs["1d"].analysis!.htf?.tf).toBe("1w");
    release();
  });

  it("recomputes only when a closed bar changes: forming ticks cost nothing, a new 4h close recomputes 4h alone", async () => {
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(3);
    let published = 0;
    const off = subscribeBoxes(() => (published += 1));
    // the forming bar moves (same closed history)
    const forming = fakeFeeds.kline_4h!.data.map((c) => ({ ...c }));
    forming[forming.length - 1] = { ...forming[forming.length - 1]!, close: forming[forming.length - 1]!.close + 25 };
    publishFeed("kline_4h", forming);
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(3);
    // the bar closes and the next one opens
    vi.setSystemTime(NOW + H4);
    const closed = forming.map((c) => ({ ...c, closed: true }));
    const nextOpen = closed[closed.length - 1]!.time + H4;
    publishFeed("kline_4h", [...closed, { time: nextOpen, open: 83_900, high: 83_950, low: 83_850, close: 83_900, volume: 1, closed: false }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(4);
    expect(getBoxes().tfs["4h"].closedAt).toBe(closed[closed.length - 1]!.time);
    expect(published).toBeGreaterThanOrEqual(1);
    off();
    release();
  });

  it("a keep-alive page released and retained again keeps its boxes: no recompute, no second history request", async () => {
    feedsAt(NOW, B4.length, 499);
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(3);
    release();
    expect(__boxStats().refs).toBe(0);
    const again = retainBoxes();
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(3);
    expect((market.current as ReturnType<typeof fakeProvider>).history).toHaveBeenCalledTimes(1);
    expect(getBoxes().state).toBe("ok");
    again();
  });

  it("the live price (≤ 1/s) drives the pending state without recomputing the boxes", async () => {
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(200);
    const box = getBoxes().tfs["4h"].analysis!.box.box!;
    expect(getBoxes().tfs["4h"].analysis!.box.pending).toBe(0);
    priceMv.set(box.top + box.atr); // beyond the edge, before any close
    await vi.advanceTimersByTimeAsync(1100);
    const a = getBoxes().tfs["4h"].analysis!;
    expect(a.box.pending).toBe(1);
    expect(a.box.phase).toBe("inside"); // a breakout counts on the CLOSE only
    expect(__boxStats().baseRuns).toBe(3);
    release();
  });

  it("settings.boxes.on = false: nothing is computed, the status says so", async () => {
    setBoxesSettings({ on: false });
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(200);
    expect(__boxStats().baseRuns).toBe(0);
    expect(getBoxes().state).toBe("off");
    expect(getBoxes().best).toEqual([]);
    setBoxesSettings({ on: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(getBoxes().state).toBe("ok");
    release();
  });

  it("best setups: only A+ / A that pass the minimum grade, best score first", async () => {
    // the 4h series cut where the 4h range long is A+ (RSI break at support, box strong)
    for (const k of Object.keys(fakeFeeds)) delete fakeFeeds[k];
    const now = (B4[1493]!.t + 3600) * 1000;
    vi.setSystemTime(now);
    feedsAt(now, 1494);
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(300);
    const best = getBoxes().best;
    for (const b of best) {
      expect(["A+", "A"]).toContain(b.setup.grade);
      expect(b.setup.best).toBe(true);
    }
    for (let i = 1; i < best.length; i++) expect(best[i - 1]!.setup.score).toBeGreaterThanOrEqual(best[i]!.setup.score);
    expect(best.some((b) => b.tf === "4h")).toBe(true);
    setBoxesSettings({ minGrade: "A+" });
    await vi.advanceTimersByTimeAsync(300);
    expect(getBoxes().best.every((b) => b.setup.grade === "A+")).toBe(true);
    release();
  });

  // ---------------------------------------------------------------- box fix: the bars the engine sees = the chart's

  const ascendingGapFree = (bars: readonly Bar[], stepSec: number): boolean => bars.every((b, i) => i === 0 || b.t - bars[i - 1]!.t === stepSec);

  it("history page + the provider's trimmed ring: strictly ascending, gap-free 4h bars up to the last close", async () => {
    // a live upsert trimmed the ring back to 600 bars after the history load; the page reaches 760 bars back and overlaps it
    publishFeed("kline_4h", B4.slice(B4.length - 600).map((b) => toCandle(b, H4, NOW)));
    const page = B4.slice(B4.length - 760).map((b) => toCandle(b, H4, NOW));
    market.current = fakeProvider({ history: vi.fn(() => Promise.resolve(stamp(page))) });
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(300);
    const bars = getBoxBars("4h");
    expect(bars).toHaveLength(759); // 760 − the forming bar
    expect(ascendingGapFree(bars, H4 / 1000)).toBe(true);
    expect(bars[0]!.t).toBe(B4[B4.length - 760]!.t);
    expect(bars.at(-1)!.t).toBe(B4[B4.length - 2]!.t);
    expect(getBoxes().tfs["4h"].analysis).not.toBeNull();
    release();
  });

  it("a history page that does not reach the ring is not glued on (a hole would read as adjacent bars)", async () => {
    publishFeed("kline_4h", B4.slice(B4.length - 600).map((b) => toCandle(b, H4, NOW)));
    const page = B4.slice(B4.length - 760, B4.length - 605).map((b) => toCandle(b, H4, NOW)); // ends 5 bars short
    market.current = fakeProvider({ history: vi.fn(() => Promise.resolve(stamp(page))) });
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(300);
    const bars = getBoxBars("4h");
    expect(bars).toHaveLength(599);
    expect(ascendingGapFree(bars, H4 / 1000)).toBe(true);
    release();
  });

  it("closedBars: drops the forming bar, repeated / out-of-order rows and everything before the newest hole", () => {
    const c = (i: number, closed = true): Candle => ({ time: i * H4, open: 1, high: 2, low: 0, close: 1, volume: 1, closed });
    expect(closedBars([], [c(1), c(2), c(3, false)], H4).map((x) => x.time / H4)).toEqual([1, 2]);
    expect(closedBars([c(0), c(1)], [c(2), c(3), c(4, false)], H4).map((x) => x.time / H4)).toEqual([0, 1, 2, 3]);
    expect(closedBars([c(0)], [c(2), c(3)], H4).map((x) => x.time / H4)).toEqual([2, 3]); // the page misses bar 1
    const dup = closedBars([], [c(1), c(2), { ...c(2), close: 9 }, c(3), c(0)], H4); // a repeated bar, one out of order
    expect(dup.map((x) => x.time / H4)).toEqual([1, 2, 3]);
    expect(dup[1]!.close).toBe(9); // the newer row wins
    expect(closedBars([], [c(1), c(2), c(5), c(6)], H4).map((x) => x.time / H4)).toEqual([5, 6]); // a hole in the ring
    expect(closedBars([], [], H4)).toEqual([]);
  });

  it("a re-entered box: liveFrom is the first bar of the current run of closes back inside (the chart's live part)", async () => {
    for (const k of Object.keys(fakeFeeds)) delete fakeFeeds[k];
    const now = (B4[1493]!.t + 3600) * 1000;
    vi.setSystemTime(now);
    feedsAt(now, 1494);
    const release = retainBoxes();
    await vi.advanceTimersByTimeAsync(300);
    const v = getBoxes().tfs["4h"];
    const box = v.analysis!.box.box!;
    expect(box.brk).toBe(1); // broke out upward on 2026-10-02, back inside since
    const bars = getBoxBars("4h");
    const i = bars.findIndex((b) => b.t * 1000 === v.liveFrom);
    expect(i).toBeGreaterThan(box.i1 + 1);
    const buf = DEFAULT_BOXES_CFG.box.breakAtr * box.atr;
    const inside = (b: Bar) => b.c <= box.top + buf && b.c >= box.bottom - buf;
    expect(bars.slice(i).every(inside)).toBe(true);
    expect(inside(bars[i - 1]!)).toBe(false);
    // an unbroken newest box needs no live part
    for (const tf of ["1d", "1w"] as const) if (getBoxes().tfs[tf].analysis?.box.box?.brk === 0) expect(getBoxes().tfs[tf].liveFrom).toBeNull();
    release();
  });
});

describe("live box store on the real provider (net harness)", () => {
  let p: MarketProvider | null = null;
  afterEach(() => {
    __resetBoxes();
    p?.stop();
    p = null;
    market.real = null;
    vi.useRealTimers();
  });

  it("asks the provider's history for ~760 4h bars once and analyses closed bars", { timeout: 30_000 }, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 12, 9, 30));
    __resetBoxes();
    setBoxesSettings(undefined);
    const env = setup();
    p = env.provider;
    market.current = p;
    market.real = p;
    p.start();
    await flush();
    await runFor(env.net, 5 * SEC);
    const before = requests(env.net, "/fapi/v1/klines").filter((u) => u.searchParams.get("interval") === "4h").length;
    const release = retainBoxes();
    await runFor(env.net, 3 * SEC, { step: 500 });
    const pages = requests(env.net, "/fapi/v1/klines").filter((u) => u.searchParams.get("interval") === "4h");
    expect(pages.length).toBeGreaterThan(before);
    expect(pages.at(-1)!.searchParams.get("endTime")).not.toBeNull();
    expect(getBoxBars("4h").length).toBeGreaterThanOrEqual(700);
    expect(getBoxBars("4h").every((b, i, a) => i === 0 || b.t - a[i - 1]!.t === 14_400)).toBe(true);
    expect(["ok", "loading"]).toContain(getBoxes().state);
    // a second retain does not ask again
    const release2 = retainBoxes();
    await runFor(env.net, 2 * SEC, { step: 500 });
    expect(requests(env.net, "/fapi/v1/klines").filter((u) => u.searchParams.get("interval") === "4h" && u.searchParams.get("endTime")).length).toBe(pages.filter((u) => u.searchParams.get("endTime")).length);
    release2();
    release();
  });
});

// ------------------------------------------------------------------ scanner

describe("watchlist scanner", () => {
  let net: Net;
  let kv: KVStore;
  const deps = () => ({
    rest: () => binanceRest({ fetch: makeFetch(net) }),
    proxy: () => proxyRest({ fetch: makeFetch(net) }),
    kv: () => kv,
    now: () => Date.now(),
    random: () => 0.5,
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 12, 9, 30));
    net = { log: [], fail: () => undefined, serverSkewMs: 0, proxyUp: true, wsUp: true };
    kv = memoryKV();
    __resetScanner(deps());
    setBoxesSettings(undefined);
  });
  afterEach(() => {
    __resetScanner();
    vi.useRealTimers();
  });

  it("pure: only setups at the minimum grade, best score first", () => {
    const now = (B4[1493]!.t + 3600) * 1000;
    const h4 = B4.slice(733, 1493);
    const d1 = B1.filter((b) => (b.t + 86_400) * 1000 <= now);
    const rows = scanSymbol("BTCUSDT", { "4h": h4, "1d": d1 }, boxesCfgOf(undefined));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(["A+", "A"]).toContain(r.setup.grade);
    expect(rows[0]!.symbol).toBe("BTCUSDT");
    // at the fixture end the 4h box offers only C / B: trade the best, fuck the rest → nothing listed
    expect(scanSymbol("BTCUSDT", { "4h": B4.slice(-760, -1), "1d": B1.slice(0, -1) }, boxesCfgOf({ minGrade: "A+" })).filter((r) => r.tf === "4h")).toHaveLength(0);
  });

  it("schedule: the next 4h close plus 20–80 s jitter; the last closed 4h bar", () => {
    const now = Date.UTC(2026, 9, 12, 9, 30);
    expect(nextScanAt(now, () => 0)).toBe(Date.UTC(2026, 9, 12, 12, 0, 20));
    expect(nextScanAt(now, () => 1)).toBe(Date.UTC(2026, 9, 12, 12, 1, 20));
    expect(lastClosedOpen(now)).toBe(Date.UTC(2026, 9, 12, 4));
  });

  it("its own budget: ≤ 20 weight per minute (10 symbols × 2 pages × weight 2 take ~2 minutes)", { timeout: 20_000 }, async () => {
    const release = retainScanner();
    await vi.advanceTimersByTimeAsync(1000);
    const first = requests(net, "/fapi/v1/klines").length;
    expect(first).toBe(SCAN_BUDGET.capacity / 2); // 20 weight = 10 pages
    expect(getScan().state).toBe("scanning");
    expect(getScan().progress).toMatchObject({ total: 10 });
    await vi.advanceTimersByTimeAsync(60 * SEC);
    expect(requests(net, "/fapi/v1/klines").length).toBeLessThanOrEqual(first + 11);
    await vi.advanceTimersByTimeAsync(70 * SEC);
    expect(requests(net, "/fapi/v1/klines").length).toBe(20);
    expect(getScan().state).toBe("ok");
    expect(getScan().lastScanAt).not.toBeNull();
    expect(getScan().nextScanAt).toBe(nextScanAt(Date.now(), () => 0.5));
    // every listed row is A+ / A
    for (const r of getScan().rows) expect(["A+", "A"]).toContain(r.setup.grade);
    release();
  });

  it("a 451 on the direct route switches to the same-origin proxy; the bars land in the cache", async () => {
    setBoxesSettings({ watchlist: ["BTCUSDT", "ETHUSDT"] });
    net.fail = (_u, host) => (host === "binance" ? 451 : undefined);
    const release = retainScanner();
    await vi.advanceTimersByTimeAsync(2000);
    expect(requests(net, "/api/binance/fapi/v1/klines").length).toBe(4);
    expect(getScan().viaProxy).toBe(true);
    expect(getScan().state).toBe("ok");
    expect(await kv.keys()).toEqual(expect.arrayContaining([expect.stringContaining(":BTCUSDT:4h"), expect.stringContaining(":ETHUSDT:1d")]));
    release();
    // a reload reads the cache: no request while the newest closed bar is cached
    __resetScanner(deps());
    const before = net.log.length;
    const release2 = retainScanner();
    await vi.advanceTimersByTimeAsync(500);
    expect(net.log.length).toBe(before);
    expect(getScan().state).toBe("ok");
    // "Jetzt scannen" forces a fresh read
    await scanNow();
    expect(net.log.length).toBeGreaterThan(before);
    release2();
  });

  it("off in the settings: nothing is requested", async () => {
    setBoxesSettings({ scanner: false });
    const release = retainScanner();
    await vi.advanceTimersByTimeAsync(2000);
    expect(net.log).toHaveLength(0);
    expect(getScan().state).toBe("off");
    release();
  });
});

// ------------------------------------------------------------------ alerts

describe("box alerts", () => {
  const range = () => {
    const boxes = analyzeBoxes({ tf: "4h", bars: B4 })!.box.boxes;
    return boxes.find((b) => b.bottom > 61_500 && b.bottom < 62_800 && b.top > 65_300)!;
  };
  const viewAt = (bars: Bar[], over: Partial<{ symbol: string }> = {}) => {
    const a = analyzeBoxes({ tf: "4h", bars, bias: 1, htf: { tf: "1d", state: boxState(B1.filter((d) => d.t < bars.at(-1)!.t)) } })!;
    const view = getBoxes();
    const tfv = { tf: "4h" as const, analysis: a, bars: bars.length, closedAt: a.at * 1000, closesAt: a.at * 1000 + 2 * H4, boxId: a.box.box ? `4h:${a.box.box.t0}:${a.box.box.top}:${a.box.box.bottom}` : null, key: boxKey(a) };
    const empty = { analysis: null, bars: 0, closedAt: null, closesAt: null, boxId: null, key: "∅" };
    return { ...view, state: "ok" as const, symbol: over.symbol ?? "BTCUSDT", cfg: boxesCfgOf(undefined), tfs: { "4h": tfv, "1d": { ...empty, tf: "1d" as const }, "1w": { ...empty, tf: "1w" as const } }, best: [] };
  };
  beforeEach(() => {
    localStorage.removeItem(BOX_ALERTS_KEY);
    __resetBoxAlerts();
    useUi.setState({ toasts: [] });
  });

  it("seeds silently, alerts a breakout at the close once, never again for the same box and phase", () => {
    const r = range();
    const before = B4.slice(0, r.brkI!); // last closed bar inside the box
    const atBreak = B4.slice(0, r.brkI! + 1); // the breakout close
    expect(evaluateBoxes(viewAt(before))).toEqual([]); // seed
    const v = viewAt(atBreak);
    const phase = v.tfs["4h"].analysis!.box.phase;
    expect(["breakout", "retest", "target"]).toContain(phase); // a big breakout candle can reach target 1 at once
    const fired = evaluateBoxes(v);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.id).toContain(`:${phase}`);
    expect(fired[0]!.title).toMatch(/^(Ausbruch ↑|Retest der Kante|Ziel erreicht) · BTCUSDT 4h$/);
    expect(fired[0]!.tone).toBe("win");
    const brk = evaluateBoxes(viewAt(B4.slice(0, r.brkI! + 1)));
    expect(brk).toEqual([]);
    // the same state again (a re-publish, a reload of the store) – nothing
    expect(evaluateBoxes(viewAt(atBreak))).toEqual([]);
    expect(JSON.parse(localStorage.getItem(BOX_ALERTS_KEY) ?? "[]")).toContain(fired[0]!.id);
  });

  it("scanner alerts dedupe per setup and box, not per scan: the same A+ row on the next 4h close is the same key", () => {
    const now = (B4[1493]!.t + 3600) * 1000;
    const d1 = B1.filter((b) => (b.t + 86_400) * 1000 <= now);
    const rowsAt = (end: number) => scanSymbol("BTCUSDT", { "4h": B4.slice(end - 760, end), "1d": d1 }, boxesCfgOf(undefined));
    const a = rowsAt(1493);
    const b = rowsAt(1494);
    const same = a.find((r) => b.some((x) => x.id === r.id));
    expect(same).toBeDefined();
    const next = b.find((x) => x.id === same!.id)!;
    expect(next.at).toBeGreaterThan(same!.at);
    expect(scanAlertKey(next)).toBe(scanAlertKey(same!));
    expect(scanAlertKey(same!)).toBe(`x:${same!.id}`);
  });

  it("a state that was already true at start never alerts later", () => {
    const r = range();
    const atBreak = B4.slice(0, r.brkI! + 1);
    expect(evaluateBoxes(viewAt(atBreak))).toEqual([]); // seed (breakout already there)
    expect(evaluateBoxes(viewAt(B4.slice(0, r.brkI! + 2)))).toEqual([]); // next close, same box/phase key → seen
  });

  it("the host pushes a signal toast through the store (the island is the only live region)", async () => {
    vi.useFakeTimers();
    __resetBoxes();
    market.real = null;
    market.current = fakeProvider();
    vi.setSystemTime(NOW);
    feedsAt(NOW);
    const stop = startBoxAlerts();
    await vi.advanceTimersByTimeAsync(300);
    expect(useUi.getState().toasts).toHaveLength(0); // seeding
    stop();
    __resetBoxes();
    __resetScanner();
    vi.useRealTimers();
  });

  it("alerts off: the host keeps neither the box store nor the scanner running; on again → both, seeded silently", async () => {
    vi.useFakeTimers();
    __resetBoxes();
    market.real = null;
    market.current = fakeProvider();
    vi.setSystemTime(NOW);
    feedsAt(NOW);
    const net: Net = { log: [], fail: () => undefined, serverSkewMs: 0, proxyUp: true, wsUp: true };
    __resetScanner({ rest: () => binanceRest({ fetch: makeFetch(net) }), proxy: () => proxyRest({ fetch: makeFetch(net) }), kv: () => memoryKV(), now: () => Date.now(), random: () => 0.5 });
    setBoxesSettings({ alerts: false });
    const stop = startBoxAlerts();
    await vi.advanceTimersByTimeAsync(2000);
    expect(__boxStats().refs).toBe(0);
    expect(requests(net, "/fapi/v1/klines")).toHaveLength(0);
    setBoxesSettings({ alerts: true, watchlist: ["BTCUSDT"] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(__boxStats().refs).toBe(1);
    expect(requests(net, "/fapi/v1/klines").length).toBeGreaterThan(0);
    expect(useUi.getState().toasts).toHaveLength(0); // seeded silently
    stop();
    expect(__boxStats().refs).toBe(0);
    setBoxesSettings(undefined);
    __resetBoxes();
    __resetScanner();
    vi.useRealTimers();
  });
});

// ------------------------------------------------------------------ trade snapshot

describe("resolveTradeBoxes", () => {
  beforeEach(() => {
    __resetBoxSnapshotMemo();
    __resetBoxes();
    market.real = null;
  });

  it("reads the trade's local wall clock and the bar it falls in", () => {
    expect(Number.isFinite(tradeDateMs("2026-10-02T10:00"))).toBe(true);
    expect(Number.isNaN(tradeDateMs("gestern"))).toBe(true);
    expect(barOpenOf(Date.UTC(2026, 9, 12, 9, 30), "4h")).toBe(Date.UTC(2026, 9, 12, 8));
    expect(barOpenOf(Date.UTC(2026, 9, 14, 9, 30), "1w")).toBe(Date.UTC(2026, 9, 12)); // Monday
  });

  it("retro: closed bars before the entry through fetchKlines (endTime), the higher timeframe, the trade's side", async () => {
    const entry = new Date((B4[1493]!.t + 3600) * 1000);
    const at = entry.getTime();
    const fetchKlines = vi.fn(async (iv: string, o: { endTime: number; limit: number }) => {
      const src = iv === "4h" ? B4 : B1;
      const ms = iv === "4h" ? H4 : DAY;
      const rows = src.filter((b) => b.t * 1000 <= o.endTime).slice(-o.limit).map((b) => toCandle(b, ms, o.endTime));
      return stamp(rows);
    });
    market.current = fakeProvider({ fetchKlines, serverNow: () => at + 30 * DAY });
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${entry.getFullYear()}-${pad(entry.getMonth() + 1)}-${pad(entry.getDate())}T${pad(entry.getHours())}:${pad(entry.getMinutes())}`;
    const snap = await resolveTradeBoxes(local, "long");
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe("retro");
    expect(snap!.tf).toBe("4h");
    expect(snap!.htf?.tf).toBe("1d");
    expect(snap!.at).toBeLessThan(at); // the newest CLOSED bar, never the forming one
    expect(fetchKlines.mock.calls.map((c) => c[0])).toEqual(["4h", "1d"]);
    expect(fetchKlines.mock.calls[0]![1].endTime).toBe(at);
    expect(snap!.setup?.side ?? "long").toBe("long");
    // memoised per bar
    await resolveTradeBoxes(local, "short");
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("another pair (review MM-6): BTC's live box and the provider's BTC klines never answer for an ETH trade", async () => {
    // the live store holds BTC, the entry lies in the current bar: a BTC trade gets the live context …
    const now = NOW;
    market.current = fakeProvider({ serverNow: () => now, fetchKlines: vi.fn() });
    const release = retainBoxes();
    feedsAt(now);
    await vi.waitFor(() => expect(getBoxes().tfs["4h"]?.analysis).toBeTruthy());
    const d = new Date(now - 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect((await resolveTradeBoxes(local, "long", { symbol: "BTCUSDT" }))?.symbol).toBe("BTCUSDT");
    // … an ETH trade at the same moment gets none (no kline source for ETH) – never BTC's box
    expect(await resolveTradeBoxes(local, "long", { symbol: "ETHUSDT" })).toBeNull();
    expect((market.current as { fetchKlines: ReturnType<typeof vi.fn> }).fetchKlines).not.toHaveBeenCalled();
    // the editor's save path passes the trade's pair (it used to resolve the live symbol for every pair)
    const { boxSnapAt } = await import("@/overlays/TradeEditor");
    expect(await boxSnapAt(local, "long", "ETH/USDT")).toBeNull();
    expect((await boxSnapAt(local, "long", "BTC/USDT"))?.symbol).toBe("BTCUSDT");
    expect(await boxSnapAt(local, "long", "")).toBeNull();
    release();
  });

  it("another pair with its own kline source: the retro analysis of THAT symbol", async () => {
    const entry = new Date((B4[1493]!.t + 3600) * 1000);
    const at = entry.getTime();
    const providerKlines = vi.fn();
    market.current = fakeProvider({ fetchKlines: providerKlines, serverNow: () => at + 30 * DAY });
    const klines = vi.fn(async (symbol: string, tf: string, o: { endTime: number; limit: number }) => {
      expect(symbol).toBe("ETHUSDT");
      const src = tf === "4h" ? B4 : B1;
      const ms = tf === "4h" ? H4 : DAY;
      return src.filter((b) => b.t * 1000 <= o.endTime).slice(-o.limit).map((b) => toCandle(b, ms, o.endTime));
    });
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${entry.getFullYear()}-${pad(entry.getMonth() + 1)}-${pad(entry.getDate())}T${pad(entry.getHours())}:${pad(entry.getMinutes())}`;
    const snap = await resolveTradeBoxes(local, "short", { symbol: "ETHUSDT", klines });
    expect(snap).toMatchObject({ symbol: "ETHUSDT", source: "retro", tf: "4h" });
    expect(klines.mock.calls.map((c) => c[1])).toEqual(["4h", "1d"]);
    expect(providerKlines).not.toHaveBeenCalled();
  });

  it("no provider / unreadable date / failing request → null", async () => {
    market.current = null;
    expect(await resolveTradeBoxes("2026-10-02T10:00", "long")).toBeNull();
    market.current = fakeProvider({ fetchKlines: vi.fn(() => Promise.reject(new Error("offline"))) });
    expect(await resolveTradeBoxes("2026-10-02T10:00", "long")).toBeNull();
    expect(await resolveTradeBoxes("kaputt", "long")).toBeNull();
  });
});

// ------------------------------------------------------------------ snapshot backfill (review F02)

describe("box snapshot backfill (F02): synced and imported trades get the context of their own pair", () => {
  const snapOf = (symbol: string) => ({ v: 1, symbol, tf: "4h", at: 1, source: "retro", phase: "inside", dir: 0, pos: 0.5, zone: "mid", box: null, setup: null, htf: null, rsi: null });
  const trade = (id: string, pair: string, extra: Record<string, unknown> = {}) =>
    ({ id, pair, side: "long", status: "closed", date: "2026-10-01T10:00", entry: 1, account: "scalp", ...extra }) as unknown as import("@/domain/types").Trade;
  const NOW_MS = Date.UTC(2026, 9, 12, 9, 30);

  beforeEach(() => localStorage.removeItem(BOXSNAP_TRIED_KEY));

  it("candidates: no snapshot of the own pair, a readable pair, a past entry, not tried within a day; newest first", () => {
    const list = [
      trade("a", "ETH/USDT", { date: "2026-09-01T10:00" }),
      trade("b", "BTC/USDT", { boxSnap: snapOf("BTCUSDT") }), // has its own: done
      trade("c", "ETH/USDT", { boxSnap: snapOf("BTCUSDT"), date: "2026-10-05T10:00" }), // foreign snapshot: missing (MM-6)
      trade("d", "", {}), // no pair
      trade("e", "SOL/USDT", { date: "2027-01-01T10:00" }), // future
      trade("f", "XRP/USDT", {}),
    ];
    expect(boxSnapCandidates(list, {}, NOW_MS).map((t) => t.id)).toEqual(["c", "f", "a"]);
    expect(boxSnapCandidates(list, { f: NOW_MS - 1000 }, NOW_MS).map((t) => t.id)).toEqual(["c", "a"]);
    expect(boxSnapCandidates(list, { f: NOW_MS - BOXSNAP_RETRY_MS - 1 }, NOW_MS).map((t) => t.id)).toEqual(["c", "f", "a"]);
  });

  it("stores the resolved context; never over a changed trade, never a foreign symbol", async () => {
    const t = trade("a", "ETH/USDT");
    const saved: unknown[] = [];
    const deps = { latest: () => t, save: async (x: unknown) => void saved.push(x) };
    expect(await backfillBoxSnap(t, deps, async () => snapOf("ETHUSDT") as never)).toBe(true);
    expect(saved[0]).toMatchObject({ id: "a", boxSnap: { symbol: "ETHUSDT" } });
    // the resolver handed back another symbol: nothing stored
    expect(await backfillBoxSnap(t, deps, async () => snapOf("BTCUSDT") as never)).toBe(false);
    // the pair was edited meanwhile: nothing stored
    expect(await backfillBoxSnap(t, { ...deps, latest: () => ({ ...t, pair: "SOL/USDT" }) }, async () => snapOf("ETHUSDT") as never)).toBe(false);
    expect(saved).toHaveLength(1);
  });

  it("the idle queue: waits a minute, one trade per gap, remembers every attempt, looks again later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const trades = [trade("a", "ETH/USDT"), trade("b", "SOL/USDT", { date: "2026-10-02T10:00" })];
    const resolved: string[] = [];
    const job = startBoxSnapBackfill(
      {
        trades: () => trades,
        latest: (id) => trades.find((x) => x.id === id),
        save: async (x) => {
          trades.splice(trades.findIndex((y) => y.id === x.id), 1, x);
        },
      },
      {
        resolve: async (x) => {
          resolved.push(x.id);
          return x.id === "b" ? (snapOf("SOLUSDT") as never) : null;
        },
      },
    );
    await vi.advanceTimersByTimeAsync(BOXSNAP_START_MS - 100);
    expect(resolved).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toEqual(["b"]);
    await vi.advanceTimersByTimeAsync(BOXSNAP_GAP_MS + 100);
    expect(resolved).toEqual(["b", "a"]);
    expect(trades.find((x) => x.id === "b")!.boxSnap).toMatchObject({ symbol: "SOLUSDT" });
    expect(Object.keys(JSON.parse(localStorage.getItem(BOXSNAP_TRIED_KEY)!))).toEqual(expect.arrayContaining(["a", "b"]));
    // an imported trade arrives later in the session: picked up on the next look
    trades.push(trade("c", "XRP/USDT", { date: "2026-10-03T10:00" }));
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(resolved).toEqual(["b", "a", "c"]);
    job.stop();
    vi.useRealTimers();
  });

  it("budgetedKlines: any symbol with an end time, through the scanner's own route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 12, 9, 30));
    const net: Net = { log: [], fail: () => undefined, serverSkewMs: 0, proxyUp: true, wsUp: true };
    __resetScanner({ rest: () => binanceRest({ fetch: makeFetch(net) }), proxy: () => proxyRest({ fetch: makeFetch(net) }), kv: () => memoryKV(), now: () => Date.now(), random: () => 0.5 });
    const end = Date.UTC(2026, 8, 1);
    const rows = await budgetedKlines("ETHUSDT", "4h", { endTime: end, limit: 100 });
    expect(rows.length).toBeGreaterThan(0);
    const url = requests(net, "/fapi/v1/klines")[0]!;
    expect(url.searchParams.get("symbol")).toBe("ETHUSDT");
    expect(url.searchParams.get("endTime")).toBe(String(end));
    __resetScanner();
    vi.useRealTimers();
  });
});
