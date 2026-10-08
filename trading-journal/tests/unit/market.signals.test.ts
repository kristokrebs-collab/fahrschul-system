/**
 * Live and retro "Einstiegs-Check" on a fake provider: pipeline parity with the other journal's engine, ≤ 1/s
 * cadence, stable identity, status, chart markers, retro history (null instead of fake strength 0), notifications
 * and a performance budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ref from "./reference/otherSignals.js";
import { DEFAULT_SIGNAL_CFG, bestVerdict, mcbSeries, resampleBars, type Bar, type Signals, type SignalCfg, type TfCheck } from "@/domain/signals";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth } from "@/market/health";
import { priceMv, priceReceivedAtMv, tradeTimeMv } from "@/market/motionValues";
import type { MarketProvider } from "@/market/provider";
import type { Candle, FeedId, ProviderHealth, Stamped } from "@/market/types";
import {
  __resetSignalEngine,
  __signalStats,
  attachSignalEngine,
  getDivergences,
  getMcbSeries,
  getSignalCandles,
  getSignalSnapshot,
  getStructure,
  runSignalCheck,
  setSignalConfig,
  subscribeSignalCheck,
  SIGNAL_FRAME_GRACE_MS,
  SIGNAL_FRAME_MS,
  type LiveSignals,
} from "@/market/signals/engine";
import { __clearRetroMemo, checkTradeAt, retroCheck } from "@/market/signals/retro";
import { noteSignals, resetSignalNotifier, SIGNAL_HOLD_MS, SIGNAL_LAST_KEY, signalBarOpen, signalNotifyDetail, signalNotifyMinStrength } from "@/market/signals/notify";
import { useUi } from "@/store/uiStore";
import { benchAgg, synthBars } from "./signals.fixtures";

const S15 = 900;
/** "now": inside the forming 15m bar of the synthetic history */
const N15 = 9000;
const T_START = Math.floor(1_780_000_000 / 14_400) * 14_400;
const HIST15 = synthBars(N15, 42, { t0: T_START, sec: S15 });
const NOW = (HIST15[N15 - 1]!.t + 400) * 1000;

const toCandle = (b: Bar, sec: number, now: number): Candle => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: (b.t + sec) * 1000 <= now, closeTime: (b.t + sec) * 1000 - 1 });
function candles(sec: number, upTo: number = NOW): Candle[] {
  const src = HIST15.filter((b) => b.t * 1000 <= upTo);
  const bars = sec === S15 ? src : benchAgg(src, sec);
  return bars.map((b) => toCandle(b, sec, upTo));
}

interface Fake {
  provider: MarketProvider;
  publish(feed: FeedId, data: Candle[]): void;
  calls: { iv: string; endTime?: number; limit?: number }[];
  setHealth(f: (h: ProviderHealth) => void): void;
  failFetch: boolean;
}

function fakeProvider(feeds: Partial<Record<FeedId, Candle[]>>): Fake {
  const store = new Map<FeedId, Stamped<Candle[]>>();
  const subs = new Map<FeedId, Set<(v: Stamped<unknown>) => void>>();
  const healthSubs = new Set<(h: ProviderHealth) => void>();
  let health = initialHealth(buildFeedSpecs("1h"));
  for (const f of Object.keys(health.feeds) as FeedId[]) health.feeds[f] = { ...health.feeds[f], state: "live", lastDataAt: NOW };
  const stamp = (data: Candle[]): Stamped<Candle[]> => ({ data, asOf: NOW, receivedAt: NOW, source: "binance", comparable: true });
  for (const [f, d] of Object.entries(feeds)) store.set(f as FeedId, stamp(d!));
  const fake: Fake = {
    calls: [],
    failFetch: false,
    publish(feed, data) {
      const v = stamp(data);
      store.set(feed, v);
      for (const cb of subs.get(feed) ?? []) cb(v as Stamped<unknown>);
    },
    setHealth(f) {
      health = structuredClone(health);
      f(health);
      for (const cb of healthSubs) cb(health);
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
      onHealth: (cb: (h: ProviderHealth) => void) => {
        healthSubs.add(cb);
        return () => void healthSubs.delete(cb);
      },
      getHealth: () => health,
      async fetchKlines(iv: string, p: { endTime?: number; limit?: number } = {}) {
        fake.calls.push({ iv, endTime: p.endTime, limit: p.limit });
        if (fake.failFetch) throw Object.assign(new Error("Failed to fetch"), { kind: "network" });
        const sec = iv === "15m" ? 900 : iv === "1h" ? 3600 : iv === "4h" ? 14_400 : 86_400;
        const end = p.endTime ?? NOW;
        if (iv === "1d") {
          const daily = synthBars(700, 9, { sec: 86_400, t0: Math.floor(NOW / 86_400_000) * 86_400 - 699 * 86_400 }).map((b) => toCandle(b, 86_400, NOW));
          return { data: daily.filter((c) => c.time <= end).slice(-(p.limit ?? 500)), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
        }
        const all = candles(sec, Number.POSITIVE_INFINITY).filter((c) => c.time <= end);
        return { data: all.slice(-(p.limit ?? 500)), asOf: NOW, receivedAt: NOW, source: "binance" as const, comparable: true };
      },
    } as unknown as MarketProvider,
  };
  return fake;
}

const liveFeeds = () => ({ kline_15m: candles(S15).slice(-1500), kline_1h: candles(3600).slice(-499), kline_4h: candles(14_400).slice(-499) });

function setPrice(price: number, at: number = NOW): void {
  tradeTimeMv.set(at);
  priceReceivedAtMv.set(at);
  priceMv.set(price);
}

/** The other journal's pipeline on the same candles: aggregate, last 500 bars, `withLivePrice`, `computeSignals`. */
function reference(feeds: ReturnType<typeof liveFeeds>, price: number | null, cfg: SignalCfg = DEFAULT_SIGNAL_CFG): Signals | null {
  const toBars = (cs: Candle[]): Bar[] => cs.map((c) => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
  const b15 = toBars(feeds.kline_15m);
  const raw: Record<string, Bar[]> = { "30m": benchAgg(b15, 1800), "45m": benchAgg(b15, 2700), "1h": toBars(feeds.kline_1h), "4h": toBars(feeds.kline_4h) };
  const sec: Record<string, number> = { "30m": 1800, "45m": 2700, "1h": 3600, "4h": 14_400 };
  const bars: Record<string, Bar[]> = {};
  for (const [tf, b] of Object.entries(raw)) {
    const last = b.slice(-500);
    bars[tf] = price == null ? last : ref.withLivePrice(last, sec[tf]!, price, NOW);
  }
  const spy = vi.spyOn(Date, "now").mockReturnValue(NOW);
  try {
    return ref.computeSignals(bars, cfg);
  } finally {
    spy.mockRestore();
  }
}

/** The reference's fields of a check (ours adds candle-close states, divergences, structure). */
const CHECK_KEYS = ["tf", "ok", "closeAt", "rsi", "rsiMa", "wt", "zone", "longSignal", "shortSignal", "rsiLong", "rsiShort"] as const;
const refCheck = (c: TfCheck | null) => (c ? Object.fromEntries(CHECK_KEYS.map((k) => [k, c[k]])) : c);
/**
 * The 1:1 core of an evaluation: the checks' reference fields and the raw ladder verdicts (`bestVerdict`). Ours
 * grades on top (candle-close rule, parts) — tested in signals.v2.test.ts.
 */
function core(s: LiveSignals | null) {
  if (!s) return null;
  return { checks: s.checks.map(refCheck), zone: refCheck(s.zone), ...bestVerdict(s.checks, DEFAULT_SIGNAL_CFG, s.zone) };
}
function refCore(s: Signals | null) {
  if (!s) return null;
  return { checks: s.checks, zone: s.zone, long: s.long, short: s.short, best: s.best };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSignalEngine();
  __clearRetroMemo();
  localStorage.clear();
  useUi.setState({ toasts: [] });
  setPrice(0, 0);
});
afterEach(() => {
  __resetSignalEngine();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live check", () => {
  it("equals the other journal's computeSignals on the same candles (30m/45m from 15m, live price)", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    const price = feeds.kline_15m.at(-1)!.close * 1.002;
    setPrice(price);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const st = getSignalSnapshot();
    expect(st.state).toBe("ok");
    expect(st.message).toBeNull();
    expect(st.snapshot).not.toBeNull();
    expect(st.snapshot!.symbol).toBe("BTCUSDT");
    expect(st.snapshot!.price).toBe(price);
    expect(core(st.snapshot)).toEqual(refCore(reference(feeds, price)));
    expect(st.snapshot!.checks.map((c) => c?.tf)).toEqual(["30m", "45m", "1h", "4h"]);
    // without a fresh price the forming candles stay as the exchange sent them
    setPrice(price, NOW - 10 * 60_000);
    __resetSignalEngine();
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    expect(core(getSignalSnapshot().snapshot)).toEqual(refCore(reference(feeds, null)));
  });

  it("evaluates at most once per second, off the publish path, and only re-renders on a real change", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    setPrice(feeds.kline_15m.at(-1)!.close);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const first = getSignalSnapshot();
    let notified = 0;
    const off = subscribeSignalCheck(() => notified++);
    const runs0 = __signalStats().runs;
    // 40 WS ticks + price frames within one second
    for (let i = 0; i < 40; i++) {
      const k = [...feeds.kline_15m];
      const last = k.at(-1)!;
      k[k.length - 1] = { ...last, close: last.close + (i % 2 ? 0.01 : -0.01) };
      fake.publish("kline_15m", k);
      priceMv.set(last.close + (i % 2 ? 0.01 : -0.01));
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(1000);
    const runs = __signalStats().runs - runs0;
    expect(runs).toBeGreaterThanOrEqual(1);
    expect(runs).toBeLessThanOrEqual(2);
    // a cent of price noise does not change the rounded result → same object, no notification
    expect(getSignalSnapshot()).toBe(first);
    expect(notified).toBe(0);
    // no data → no evaluation until the next frame (1m close + grace, 20 s after NOW here): sleeps when idle
    const idle = __signalStats().runs;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(__signalStats().runs).toBe(idle);
    off();
  });

  it("re-publishes when the result changes and on status changes", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const a = getSignalSnapshot();
    // a big move changes RSI / wt1 → new snapshot
    setPrice(feeds.kline_15m.at(-1)!.close * 0.97);
    await vi.advanceTimersByTimeAsync(1100);
    const b = getSignalSnapshot();
    expect(b).not.toBe(a);
    expect(b.snapshot).not.toBe(a.snapshot);
    expect(b.updatedAt!).toBeGreaterThan(a.updatedAt!);
    // feed goes stale → state stale, snapshot kept
    fake.setHealth((h) => void (h.feeds.kline_15m.state = "stale"));
    await vi.advanceTimersByTimeAsync(1100);
    expect(getSignalSnapshot()).toMatchObject({ state: "stale", snapshot: b.snapshot, updatedAt: b.updatedAt });
    expect(getSignalSnapshot().message).toMatch(/veraltet/);
    fake.setHealth((h) => void (h.online = false));
    await vi.advanceTimersByTimeAsync(1100);
    expect(getSignalSnapshot().state).toBe("stale");
  });

  it("loading / offline / too few bars", async () => {
    const empty = fakeProvider({});
    empty.setHealth((h) => {
      for (const f of ["kline_15m", "kline_1h", "kline_4h"] as const) h.feeds[f] = { ...h.feeds[f], state: "connecting", lastDataAt: undefined };
    });
    attachSignalEngine(empty.provider);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSignalSnapshot()).toMatchObject({ state: "loading", snapshot: null, message: "Kerzen werden geladen …" });
    empty.setHealth((h) => void (h.feeds.kline_15m = { ...h.feeds.kline_15m, state: "offline" }));
    await vi.advanceTimersByTimeAsync(1100);
    expect(getSignalSnapshot()).toMatchObject({ state: "offline", snapshot: null, message: "Keine Marktdaten (Binance)." });
    __resetSignalEngine();
    const short = fakeProvider({ kline_15m: candles(S15).slice(-100), kline_1h: candles(3600).slice(-100), kline_4h: candles(14_400).slice(-100) });
    attachSignalEngine(short.provider);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSignalSnapshot()).toMatchObject({ state: "loading", snapshot: null, message: "Zu wenig Kerzen für den Check." });
    short.setHealth((h) => void (h.feeds.kline_1h = { ...h.feeds.kline_1h, reason: "bad_symbol" }));
    await vi.advanceTimersByTimeAsync(1100);
    expect(getSignalSnapshot()).toMatchObject({ state: "offline", message: "Kein Live-Kurs für dieses Symbol." });
  });

  it("follows settings.signals (sanitised) — e.g. a 3-rung ladder with 2h and 3h from 1h", async () => {
    const feeds = liveFeeds();
    attachSignalEngine(fakeProvider(feeds).provider);
    setSignalConfig({ ...DEFAULT_SIGNAL_CFG, ladder: ["3h", "30m", "2h"], required: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const s = getSignalSnapshot().snapshot!;
    expect(s.cfg).toMatchObject({ ladder: ["30m", "2h", "3h"], required: 3 });
    expect(s.checks.map((c) => c?.tf)).toEqual(["30m", "2h", "3h"]);
  });

  it("a 1D rung is polled lazily over REST (499 daily bars) and completed with the live price", async () => {
    const fake = fakeProvider(liveFeeds());
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toEqual([]); // default ladder: no REST
    setSignalConfig({ ...DEFAULT_SIGNAL_CFG, ladder: ["30m", "1h", "1D"], zoneTf: "1D" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(fake.calls).toEqual([{ iv: "1d", endTime: undefined, limit: 499 }]);
    const s = getSignalSnapshot().snapshot!;
    expect(s.checks.map((c) => c?.tf)).toEqual(["30m", "1h", "1D"]);
    expect(s.zone?.tf).toBe("1D");
    // re-polled every 5 minutes, not per evaluation
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fake.calls).toHaveLength(2);
  });

  it("chart markers and signal candles come from the same bars as the check", async () => {
    const feeds = liveFeeds();
    attachSignalEngine(fakeProvider(feeds).provider);
    await vi.advanceTimersByTimeAsync(0);
    const c45 = getSignalCandles("45m");
    expect(c45).toHaveLength(500);
    expect(c45.every((c) => (c.time / 1000) % 2700 === 0)).toBe(true);
    expect(c45.at(-1)!.closed).toBe(false);
    expect(c45.at(-2)!.closed).toBe(true);
    for (const iv of ["30m", "45m", "1h", "4h"]) {
      const m = getMcbSeries(iv);
      const bars = getSignalCandles(iv).map((c) => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close }));
      expect(m.map((x) => ({ t: x.time / 1000, kind: x.kind }))).toEqual(mcbSeries(bars, DEFAULT_SIGNAL_CFG));
      expect(m.every((x) => ["bottom", "top", "buy", "sell"].includes(x.kind))).toBe(true);
      expect(getMcbSeries(iv, { minor: true }).length).toBeGreaterThanOrEqual(m.length);
    }
    expect(getMcbSeries("7m")).toEqual([]);
    // the newest marker of the check's base rung matches the check's own event when it is on the last bars
    const base = getSignalSnapshot().snapshot!.checks[0]!;
    const evs = getMcbSeries("30m", { minor: true });
    if (base.wt.kind && base.wt.barsAgo === 0) expect(evs.at(-1)!.live).toBe(true);
  });

  it("stays under the per-check budget (< 3 ms for a full evaluation)", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    attachSignalEngine(fake.provider);
    const times: number[] = [];
    const computes = __signalStats().computes;
    for (let i = 0; i < 25; i++) {
      // a new frame with a new price → full evaluation every time
      const at = NOW + (i + 1) * SIGNAL_FRAME_MS;
      setPrice(feeds.kline_15m.at(-1)!.close + i, at);
      const t = performance.now();
      runSignalCheck(at);
      times.push(performance.now() - t);
    }
    expect(__signalStats().computes - computes).toBe(25);
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeLessThan(3);
  });
});

describe("retro check (checkTradeAt)", () => {
  const T = (HIST15[N15 - 200]!.t + 123) * 1000; // 50 h ago, inside a 15m bar

  /** Reference: the same windows (1500 × 15m, 499 × 1h, 499 × 4h ending at T), the other journal's signalsAt. */
  function refAt(t: number): Signals | null {
    const upTo = (sec: number, n: number) => candles(sec, Number.POSITIVE_INFINITY).filter((c) => c.time <= t).slice(-n).map((c) => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
    const b15 = upTo(900, 1500);
    const bars = { "30m": resampleBars(b15, 900, 1800).slice(-501), "45m": resampleBars(b15, 900, 2700).slice(-501), "1h": upTo(3600, 499), "4h": upTo(14_400, 499) };
    const spy = vi.spyOn(Date, "now").mockReturnValue(t + 86_400_000);
    try {
      return ref.signalsAt(bars, DEFAULT_SIGNAL_CFG, t);
    } finally {
      spy.mockRestore();
    }
  }

  it("rebuilds every rung from history ending at T (one page per interval) and equals the reference", async () => {
    const fake = fakeProvider({}); // no live data → must fetch
    // graded parts off: a back-dated check sees closed bars only, so the rest is the reference's evaluation
    setSignalConfig({ whale: { on: false }, div: { on: false }, sr: { on: false } });
    attachSignalEngine(fake.provider);
    const snap = await checkTradeAt(new Date(T), "long");
    expect(snap).not.toBeNull();
    expect(fake.calls.map((c) => [c.iv, c.limit, c.endTime])).toEqual(expect.arrayContaining([["15m", 1500, T], ["1h", 499, T], ["4h", 499, T]]));
    expect(fake.calls).toHaveLength(3);
    const r = refAt(T)!;
    expect(snap).toMatchObject({ ...ref.snapshot(r, "long"), mode: "retro", v: 2, symbol: "BTCUSDT", source: "binance", tfs: ref.snapshot(r, "long").tfs.map((x) => expect.objectContaining(x)) });
    expect(snap!.at).toBe(new Date(T).toISOString());
    // memoised per minute: no second fetch, the other side from the same evaluation
    await checkTradeAt(T + 5_000, "short");
    expect(fake.calls).toHaveLength(3);
  });

  it("uses the live series without network when it covers T", async () => {
    // rings that grew beyond the bootstrap (chart history): 3000 × 15m, 1000 × 1h, 600 × 4h
    const fake = fakeProvider({ kline_15m: candles(S15).slice(-3000), kline_1h: candles(3600).slice(-1000), kline_4h: candles(14_400).slice(-600) });
    attachSignalEngine(fake.provider);
    const t = (HIST15[N15 - 9]!.t + 10) * 1000; // 2 h ago
    const r = await retroCheck(t);
    expect(r.status).toBe("ok");
    expect(fake.calls).toEqual([]);
    // the bootstrap-sized 15m ring (1500) holds only 1492 bars before T → that interval is fetched
    __clearRetroMemo();
    const small = fakeProvider({ kline_15m: candles(S15).slice(-1500), kline_1h: candles(3600).slice(-1000), kline_4h: candles(14_400).slice(-600) });
    attachSignalEngine(small.provider);
    expect((await retroCheck(t)).status).toBe("ok");
    expect(small.calls.map((c) => c.iv)).toEqual(["15m"]);
  });

  it("returns null (never a fake strength 0) when history does not reach back far enough", async () => {
    const fake = fakeProvider({});
    attachSignalEngine(fake.provider);
    // 20 days after the start of the synthetic history: 15m / 1h are fine, the 4h rung has only 120 bars
    const t = (T_START + 20 * 86_400 + 77) * 1000;
    const ours = await retroCheck(t);
    expect(ours).toMatchObject({ status: "no-history", signals: null, message: "Keine Kerzen für diesen Zeitpunkt." });
    expect(await checkTradeAt(t, "long")).toBeNull();
    // the other journal's engine returns a verdict here although the 4h rung is missing
    const theirs = refAt(t);
    expect(theirs?.checks[3]).toBeNull();
  });

  it("network error → null and status error (retried next time); no provider → unavailable", async () => {
    const fake = fakeProvider({});
    attachSignalEngine(fake.provider);
    fake.failFetch = true;
    expect(await retroCheck(T)).toMatchObject({ status: "error", signals: null });
    expect(await checkTradeAt(T, "short")).toBeNull();
    fake.failFetch = false;
    expect((await retroCheck(T)).status).toBe("ok");
    __resetSignalEngine();
    expect(await retroCheck(T)).toMatchObject({ status: "unavailable" });
    expect(await checkTradeAt("not a date", "long")).toBeNull();
  });

  it("within 5 minutes of now the live evaluation is used", async () => {
    const fake = fakeProvider(liveFeeds());
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const snap = await checkTradeAt(NOW - 60_000, "short");
    expect(snap).toMatchObject({ mode: "live", side: "short" });
    expect(fake.calls).toHaveLength(0);
    expect(snap!.score).toBe(getSignalSnapshot().snapshot!.short.score);
  });
});

describe("notification on a new valid entry", () => {
  function sig(valid: { long: boolean; short: boolean }, barOpenSec: number, strength = 2): Signals & { cfg: SignalCfg } {
    const v = (side: "long" | "short", ok: boolean) => ({ side, tiers: ok ? 3 : 0, strength: ok ? strength : 0, label: ok ? `Starker ${side === "long" ? "Long" : "Short"}-Einstieg` : "Kein Signal", valid: ok, rsiOk: ok, zoneOk: false, strongSignal: ok, score: ok ? 85 : 10, reasons: [] });
    const long = v("long", valid.long) as Signals["long"];
    const short = v("short", valid.short) as Signals["short"];
    return { long, short, best: long, checks: [{ closeAt: barOpenSec } as never], zone: null, at: NOW, cfg: DEFAULT_SIGNAL_CFG };
  }

  it("baseline first, then an edge that holds 60 s → one toast per bar; persisted", async () => {
    resetSignalNotifier();
    const bar = 1_790_000_100;
    noteSignals(sig({ long: true, short: false }, bar), NOW); // baseline: already valid → no toast
    noteSignals(sig({ long: false, short: false }, bar), NOW + 1000);
    noteSignals(sig({ long: true, short: false }, bar), NOW + 2000); // edge
    expect(useUi.getState().toasts).toHaveLength(0);
    noteSignals(sig({ long: true, short: false }, bar), NOW + 2000 + SIGNAL_HOLD_MS - 1);
    expect(useUi.getState().toasts).toHaveLength(0);
    noteSignals(sig({ long: true, short: false }, bar), NOW + 2000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toEqual([expect.objectContaining({ kind: "signal", title: "Starker Long-Einstieg", value: "Score 85", valueTone: "win", duration: 5200 })]);
    expect(JSON.parse(localStorage.getItem(SIGNAL_LAST_KEY)!).long).toMatchObject({ barOpen: bar * 1000, strength: 2 });
    // flicker in the same bar → no second toast
    noteSignals(sig({ long: false, short: false }, bar), NOW + 70_000);
    noteSignals(sig({ long: true, short: false }, bar), NOW + 71_000);
    noteSignals(sig({ long: true, short: false }, bar), NOW + 71_000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(1);
    // next bar, new edge → toast again; short side independently
    noteSignals(sig({ long: false, short: true }, bar + 1800), NOW + 200_000);
    noteSignals(sig({ long: true, short: true }, bar + 1800), NOW + 201_000);
    noteSignals(sig({ long: true, short: true }, bar + 1800), NOW + 201_000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts.map((t) => t.valueTone)).toEqual(["win", "win", "loss"]);
  });

  it("a flicker back to invalid restarts the wait; the hold also completes on its own timer", async () => {
    resetSignalNotifier();
    const bar = 1_790_003_700;
    noteSignals(sig({ long: false, short: false }, bar), NOW);
    noteSignals(sig({ long: false, short: true }, bar), NOW + 1000);
    noteSignals(sig({ long: false, short: false }, bar), NOW + 30_000);
    noteSignals(sig({ long: false, short: true }, bar), NOW + 40_000);
    noteSignals(sig({ long: false, short: true }, bar), NOW + 1000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(0);
    vi.setSystemTime(NOW + 40_000);
    await vi.advanceTimersByTimeAsync(SIGNAL_HOLD_MS + 10);
    expect(useUi.getState().toasts).toEqual([expect.objectContaining({ valueTone: "loss" })]);
  });

  it("notifyMinStrength: weaker entries stay silent, the edge fires once the minimum is reached", () => {
    resetSignalNotifier();
    const bar = 1_790_007_300;
    const cfg = { ...DEFAULT_SIGNAL_CFG, notifyMinStrength: 3 } as SignalCfg;
    const s = (valid: boolean, strength: number) => ({ ...sig({ long: valid, short: false }, bar, strength), cfg });
    noteSignals(s(false, 0), NOW); // baseline
    noteSignals(s(true, 2), NOW + 1000); // valid, but below the minimum → no edge
    noteSignals(s(true, 2), NOW + 1000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(0);
    noteSignals(s(true, 3), NOW + 100_000); // reaches the minimum → edge
    noteSignals(s(true, 3), NOW + 100_000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toEqual([expect.objectContaining({ valueTone: "win" })]);
    expect(signalNotifyMinStrength(DEFAULT_SIGNAL_CFG)).toBe(1);
    expect(signalNotifyMinStrength({ ...DEFAULT_SIGNAL_CFG, notifyMinStrength: 9 } as SignalCfg)).toBe(4);
    expect(signalNotifyMinStrength({ ...DEFAULT_SIGNAL_CFG, notifyMinStrength: "2" } as unknown as SignalCfg)).toBe(1);
  });

  it("system notification only when enabled, granted and the page is not in front", () => {
    resetSignalNotifier();
    const shown: string[] = [];
    class FakeNotification {
      static permission = "granted";
      constructor(title: string) {
        shown.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const s = (v: boolean, bar: number, notify: boolean) => ({ ...sig({ long: v, short: false }, bar), cfg: { ...DEFAULT_SIGNAL_CFG, notify } });
    noteSignals(s(false, 1, false), NOW);
    noteSignals(s(true, 1, false), NOW + 1);
    noteSignals(s(true, 1, false), NOW + 1 + SIGNAL_HOLD_MS);
    expect(shown).toEqual([]);
    noteSignals(s(false, 2, true), NOW + 100_000);
    noteSignals(s(true, 2, true), NOW + 100_001);
    noteSignals(s(true, 2, true), NOW + 100_001 + SIGNAL_HOLD_MS);
    expect(shown).toEqual(["Starker Long-Einstieg"]);
    hidden.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("v2: chart data with candle-close states, divergences, structure; notification per signal bar", () => {
  it("MCB markers carry their state: provisional on the running bar, confirmed / strong after closes", async () => {
    const feeds = liveFeeds();
    setPrice(feeds.kline_15m.at(-1)!.close);
    attachSignalEngine(fakeProvider(feeds).provider);
    await vi.advanceTimersByTimeAsync(0);
    for (const tf of ["30m", "1h"]) {
      const ms = getMcbSeries(tf, { minor: true });
      expect(ms.length).toBeGreaterThan(5);
      const lastBarTime = getSignalCandles(tf).at(-1)!.time;
      for (const m of ms) {
        expect(["provisional", "confirmed", "strong"]).toContain(m.state);
        expect(m.state === "provisional").toBe(m.time === lastBarTime);
        expect(m.live).toBe(m.state === "provisional");
      }
      expect(ms.some((m) => m.state === "strong")).toBe(true);
    }
  });

  it("divergences and structure with chart times (ms), the same computation as the check", async () => {
    const feeds = liveFeeds();
    setPrice(feeds.kline_15m.at(-1)!.close);
    attachSignalEngine(fakeProvider(feeds).provider);
    await vi.advanceTimersByTimeAsync(0);
    const ds = getDivergences("30m");
    expect(ds.length).toBeGreaterThan(3);
    for (const d of ds) {
      expect(d.from.time % 1_800_000).toBe(0);
      expect(d.from.time).toBeLessThan(d.to.time);
      // a live candidate on the newest bars is "confirmed at" the newest bar (it may be that bar itself)
      if (d.state === "provisional") expect(d.confirmedAt).toBeGreaterThanOrEqual(d.to.time);
      else expect(d.confirmedAt).toBeGreaterThan(d.to.time);
    }
    const check = getSignalSnapshot().snapshot!.checks[0]!;
    expect(ds.filter((d) => d.active).map((d) => `${d.osc}${d.kind}${d.dir}${d.to.time}`).sort()).toEqual(
      [...check.div!.long, ...check.div!.short].map((d) => `${d.osc}${d.kind}${d.dir}${d.to.t * 1000}`).sort(),
    );
    expect(getDivergences("30m", { recent: 20 }).every((d) => d.barsAgo <= 20)).toBe(true);
    const st = getStructure("1h")!;
    expect(st.swings.length).toBeGreaterThan(3);
    for (const l of st.supports) expect(l.btm).toBeLessThanOrEqual(st.close);
    for (const l of st.resistances) expect(l.top).toBeGreaterThanOrEqual(st.close);
    for (const l of [...st.supports, ...st.resistances]) expect(l.time === null).toBe(l.kind === "range");
    for (const b of st.breaks) expect(b.pivotTime).toBeLessThan(b.time);
    const zoneCheck = getSignalSnapshot().snapshot!.zone!;
    expect(st.support?.price).toBe(zoneCheck.structure!.support?.price);
    // switched off: no divergences; unknown timeframe / no provider: empty
    setSignalConfig({ div: { on: false } });
    expect(getDivergences("30m")).toEqual([]);
    expect(getStructure("7m")).toBeNull();
    __resetSignalEngine();
    expect(getDivergences("30m")).toEqual([]);
    expect(getStructure("1h")).toBeNull();
  });

  it("the dedupe key is the base signal's own bar; the text names the state and the parts that hold", () => {
    const bar = 1_790_010_000;
    const ev = { kind: "bottom" as const, barsAgo: 2 };
    const conf = { state: "confirmed" as const, event: ev, closes: 2, held: true, closed: ev, forming: null };
    const none = { state: "none" as const, event: null, closes: 0, held: false, closed: null, forming: null };
    const base = { tf: "30m", closeAt: bar, conf: { long: conf, short: none } } as unknown as TfCheck;
    const part = (id: "traders" | "div" | "sr", ok: boolean, extra: object = {}) => ({ id, side: "long", ok, label: id, grade: 1, points: 10, weight: 10, bonus: ok, state: "confirmed", data: true, items: [], detail: "", ...extra });
    const v = {
      side: "long",
      tiers: 2,
      strength: 3,
      label: "Sehr starker Long-Einstieg",
      valid: true,
      rsiOk: true,
      zoneOk: true,
      strongSignal: true,
      score: 90,
      reasons: [],
      state: "confirmed",
      parts: [part("traders", true, { met: 3 }), part("div", true, { tf: "1h" }), part("sr", false)],
    } as unknown as Signals["long"];
    const s = { long: v, short: { ...v, side: "short", valid: false, parts: [] }, best: v, checks: [base], zone: null, at: NOW, cfg: DEFAULT_SIGNAL_CFG } as unknown as Signals & { cfg: SignalCfg };
    expect(signalBarOpen(s, "long")).toBe((bar - 2 * 1800) * 1000);
    expect(signalBarOpen(s, "short")).toBe(bar * 1000);
    expect(signalNotifyDetail(s, "long")).toBe("Sehr stark · 2 von 4 Timeframes · bestätigt · Top-Trader 3/4 · Divergenz 1h");
    // a provisional entry is not valid → never an edge
    resetSignalNotifier();
    const prov = { ...s, long: { ...v, valid: false, strength: 0, state: "provisional" } } as unknown as Signals & { cfg: SignalCfg };
    noteSignals(prov, NOW);
    noteSignals(prov, NOW + 1000);
    noteSignals(prov, NOW + 1000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(0);
    // confirmed: one toast; the same signal bar one candle later (still lit, barsAgo 3 on a newer last bar) does not repeat
    noteSignals(s, NOW + 2000);
    noteSignals(s, NOW + 2000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(1);
    expect(useUi.getState().toasts[0]).toMatchObject({ title: "Sehr starker Long-Einstieg", detail: "Sehr stark · 2 von 4 Timeframes · bestätigt · Top-Trader 3/4 · Divergenz 1h" });
    const later = { ...s, checks: [{ ...base, closeAt: bar + 1800, conf: { long: { ...conf, closed: { kind: "bottom", barsAgo: 3 } }, short: none } }] } as unknown as Signals & { cfg: SignalCfg };
    noteSignals(prov, NOW + 200_000);
    noteSignals(later, NOW + 201_000);
    noteSignals(later, NOW + 201_000 + SIGNAL_HOLD_MS);
    expect(useUi.getState().toasts).toHaveLength(1);
  });
});

describe("frames on 1m closes (tv-check proposals 1–3): no per-tick flicker, intrabar memory, turn prices", () => {
  /** The next frame after `t` (ms): the minute boundary + grace. */
  const nextFrame = (t: number): number => (Math.floor((t - SIGNAL_FRAME_GRACE_MS) / SIGNAL_FRAME_MS) + 1) * SIGNAL_FRAME_MS + SIGNAL_FRAME_GRACE_MS;

  it("within a frame the price does not recompute the check (even a 3 % move); the next 1m close does", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    const p0 = feeds.kline_15m.at(-1)!.close;
    setPrice(p0);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const first = getSignalSnapshot();
    expect(first.snapshot!.price).toBe(p0);
    const computes = __signalStats().computes;
    // ticks inside the frame: price and the forming 15m candle move, nothing is recomputed or published
    for (let i = 0; i < 15; i++) {
      const px = p0 * (i % 2 ? 0.97 : 1.03);
      setPrice(px, Date.now());
      const k = [...feeds.kline_15m];
      k[k.length - 1] = { ...k.at(-1)!, close: px, high: Math.max(k.at(-1)!.high, px), low: Math.min(k.at(-1)!.low, px) };
      fake.publish("kline_15m", k);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(__signalStats().computes).toBe(computes);
    expect(getSignalSnapshot()).toBe(first);
    // the next 1m close: one evaluation with the price of that moment
    const p1 = p0 * 0.97;
    setPrice(p1, Date.now());
    await vi.advanceTimersByTimeAsync(nextFrame(Date.now()) - Date.now() + 5);
    expect(__signalStats().computes).toBe(computes + 1);
    const next = getSignalSnapshot().snapshot!;
    expect(next.price).toBe(p1);
    // the frame stands for the minute that just closed (its last ms)
    expect(next.frameAt! % SIGNAL_FRAME_MS).toBe(SIGNAL_FRAME_MS - 1);
    expect(next.frameAt!).toBeLessThan(Date.now());
    // the countdown target is unaffected (the candle close times)
    expect(next.checks[0]!.closesAt).toBe(first.snapshot!.checks[0]!.closesAt);
    // a frame every minute while attached, ≤ 1 evaluation per second in between
    const runs = __signalStats().runs;
    await vi.advanceTimersByTimeAsync(3 * SIGNAL_FRAME_MS);
    expect(__signalStats().runs - runs).toBeGreaterThanOrEqual(3);
    expect(__signalStats().computes).toBe(computes + 4);
  });

  it("a closed-history change mid-frame recomputes with the frame's price (not the tick's)", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    const p0 = feeds.kline_15m.at(-1)!.close;
    setPrice(p0);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const computes = __signalStats().computes;
    setPrice(p0 * 1.05, Date.now());
    // a gap fill corrects the newest closed 15m candle
    const k = [...feeds.kline_15m];
    k[k.length - 2] = { ...k.at(-2)!, close: k.at(-2)!.close + 1 };
    fake.publish("kline_15m", k);
    await vi.advanceTimersByTimeAsync(1100);
    expect(__signalStats().computes).toBe(computes + 1);
    expect(getSignalSnapshot().snapshot!.price).toBe(p0);
  });

  it("turn prices per forming rung; an event that came and went on the forming candle stays as intrabar memory (never counted)", async () => {
    const feeds = liveFeeds();
    const fake = fakeProvider(feeds);
    setPrice(feeds.kline_15m.at(-1)!.close);
    attachSignalEngine(fake.provider);
    await vi.advanceTimersByTimeAsync(0);
    const s0 = getSignalSnapshot().snapshot!;
    expect(Object.keys(s0.turns!)).toEqual(["30m", "45m", "1h", "4h"]);
    const t30 = s0.turns!["30m"]!;
    expect(t30.price).toBeGreaterThan(0);
    // the side whose cross counts at this level (long below the zero line, short above)
    const side = t30.level < 0 ? "long" : "short";
    const across = side === "long" ? t30.price * 1.002 : t30.price * 0.998;
    const back = side === "long" ? t30.price * 0.998 : t30.price * 1.002;
    // frame 1: the price is across the turn → the 30m forming candle crosses
    setPrice(across, Date.now());
    await vi.advanceTimersByTimeAsync(nextFrame(Date.now()) - Date.now() + 5);
    const s1 = getSignalSnapshot().snapshot!;
    expect(s1.price).toBe(across);
    expect(s1.checks[0]!.conf![side].forming).not.toBeNull();
    const frame1 = s1.frameAt!;
    // frame 2: back → the event is gone, the memory keeps it (greyed in the card), the verdict does not count it
    setPrice(back, Date.now());
    await vi.advanceTimersByTimeAsync(nextFrame(Date.now()) - Date.now() + 5);
    const s2 = getSignalSnapshot().snapshot!;
    expect(s2.checks[0]!.conf![side].forming).toBeNull();
    const ib = s2.intrabar!["30m"]![side]!;
    expect(ib).toMatchObject({ first: frame1, last: frame1, price: across, bar: s2.checks[0]!.closeAt });
    expect(s2.turns!["30m"]!.price).toBeCloseTo(t30.price, 6);
  });
});
