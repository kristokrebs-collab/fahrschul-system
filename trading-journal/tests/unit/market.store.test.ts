import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import premiumIndex from "../fixtures/binance-premiumIndex.json";
import ticker from "../fixtures/binance-ticker24hr.json";
import klines1h from "../fixtures/binance-klines-1h.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsBook from "../fixtures/binance-ws-bookTicker.json";
import wsKline from "../fixtures/binance-ws-kline.json";
import {
  __resetMarketStore,
  flushMarketNotifications,
  getFeed,
  getPriceSnapshot,
  getProvider,
  HIGH_FREQUENCY_FEEDS,
  klineBarKey,
  PRICE_SNAPSHOT_INTERVAL_MS,
  startMarket,
  stopMarket,
  subscribeFeed,
  useFeed,
  useFeedSelect,
  useHealth,
  useMarketVersion,
  useMarketView,
  usePriceSnapshot,
  useProvider,
  useStatusLabel,
  useTopTrader,
} from "@/market/marketStore";
import { askMv, bidMv, flushMotionValues, open24hMv, priceMv, tickDirMv } from "@/market/motionValues";
import type { Candle, Stamped } from "@/market/types";
import type { WsLike } from "@/market/sources/ws";
import type { Settings } from "@/domain/types";

const T0 = 1790762400000;

class FakeSocket implements WsLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.readyState = 3;
  }
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const fetchImpl = async (url: string): Promise<Response> => {
  const u = new URL(url);
  if (u.pathname.includes("premiumIndex")) return json({ ...premiumIndex, time: Date.now() });
  if (u.pathname.includes("ticker/24hr")) return json({ ...ticker, closeTime: Date.now() });
  if (u.pathname.includes("klines")) return json(klines1h);
  if (u.pathname.includes("/v5/")) return json({ retCode: 0, result: { list: [] } });
  return json([]);
};

/** Feed/health notifications are delivered once per animation frame; tests run that frame explicitly. */
const nextFrame = () => {
  flushMarketNotifications();
  flushMotionValues();
};
/** Advances fake time (REST promises, timers) and then runs the notification frame. */
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  nextFrame();
};

const aggFrame = (price: number) => JSON.stringify({ ...wsAgg, data: { ...(wsAgg as { data: Record<string, unknown> }).data, p: String(price) } });
type KlinePatch = { t?: number; c?: string; x?: boolean; E?: number };
const klineFrame = (patch: KlinePatch = {}) => {
  const d = (wsKline as { data: { E: number; k: Record<string, unknown> } }).data;
  return JSON.stringify({ ...wsKline, data: { ...d, E: patch.E ?? d.E, k: { ...d.k, t: patch.t ?? d.k.t, T: (patch.t ?? (d.k.t as number)) + 3_599_999, c: patch.c ?? d.k.c, x: patch.x ?? d.k.x } } });
};
const closedCount = (v: Stamped<Candle[]> | undefined): number => (v ? v.data.filter((c) => c.closed).length : -1);

const settings = { market: { symbol: "BINANCE:BTCUSDT" }, hyblock: { timeframe: "1h" } } as Pick<Settings, "market" | "hyblock">;
const deps = { fetch: fetchImpl, wsFactory: (u: string) => new FakeSocket(u), kv: null, documentRef: null, windowRef: null, online: () => true, probeProxy: false, random: () => 0.5 };

describe("marketStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    FakeSocket.all = [];
  });
  afterEach(() => {
    __resetMarketStore();
    vi.useRealTimers();
  });

  it("startMarket is idempotent and setSymbol swaps the provider", async () => {
    const a = startMarket(settings, { deps });
    expect(startMarket(settings, { deps })).toBe(a);
    expect(a.symbol).toBe("BTCUSDT");
    const { setSymbol } = await import("@/market/marketStore");
    const b = setSymbol("BINANCE:ETHUSDT");
    expect(b).not.toBe(a);
    expect(b.symbol).toBe("ETHUSDT");
    expect(a.started).toBe(false);
    expect(getProvider()).toBe(b);
    stopMarket();
    expect(getProvider()).toBeNull();
  });

  it("the `EU-Proxy verwenden` preference (tj2-ui.useProxy) reaches the running provider and stops with it", async () => {
    const { useUi } = await import("@/store/uiStore");
    useUi.setState({ useProxy: false });
    const p = startMarket(settings, { deps });
    const spy = vi.spyOn(p, "setPreferProxy");
    useUi.setState({ useProxy: true });
    expect(spy).toHaveBeenLastCalledWith(true);
    useUi.setState({ theme: useUi.getState().theme }); // unrelated pref: no call
    expect(spy).toHaveBeenCalledTimes(1);
    stopMarket();
    useUi.setState({ useProxy: false });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("hooks follow feed, health and label changes; MotionValues update without renders", async () => {
    startMarket(settings, { deps });
    const hook = renderHook(() => ({ agg: useFeed("aggTrade"), health: useHealth(), label: useStatusLabel("markPrice"), view: useMarketView({ now: Date.now() }), tt: useTopTrader("accounts") }));
    expect(hook.result.current.label.text).toBe("Verbinde …");
    await act(async () => {
      await settle();
    });
    expect(hook.result.current.health.feeds.markPrice.state).toBe("live");
    expect(hook.result.current.label.text).toBe("Live · 1 s");
    expect(hook.result.current.view.price).toBe(84206); // from ticker until the stream delivers
    const ws = FakeSocket.all[0]!;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: JSON.stringify(wsAgg) });
      ws.onmessage?.({ data: JSON.stringify(wsBook) });
      nextFrame();
    });
    expect(hook.result.current.agg?.data.price).toBe(84206.1);
    expect(hook.result.current.health.ws.state).toBe("live");
    flushMotionValues();
    expect(priceMv.get()).toBe(84206.1);
    expect(bidMv.get()).toBe(84205.9);
    expect(askMv.get()).toBe(84206);
    expect(hook.result.current.tt.base).toBe("accounts");
    hook.unmount();
  });

  it("finding 8: aggTrade/bookTop/markPrice publishes do not bump the version or re-render slow hooks", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    const ws = FakeSocket.all[0]!;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: JSON.stringify(wsAgg) }); // first messages: ws health → live (legitimate slow changes)
      ws.onmessage?.({ data: JSON.stringify(wsBook) });
      nextFrame();
    });
    let slowRenders = 0;
    const slow = renderHook(() => {
      slowRenders += 1;
      return { v: useMarketVersion(), tt: useTopTrader("accounts"), view: useMarketView({ now: T0 }) };
    });
    let fastRenders = 0;
    const fast = renderHook(() => {
      fastRenders += 1;
      return useFeed("aggTrade");
    });
    const v0 = slow.result.current.v;
    const tt0 = slow.result.current.tt;
    const slow0 = slowRenders;
    const fast0 = fastRenders;
    await act(async () => {
      for (let i = 1; i <= 10; i++) {
        ws.onmessage?.({ data: aggFrame(84206 + i) });
        ws.onmessage?.({ data: JSON.stringify(wsBook) });
      }
      nextFrame();
    });
    expect(slow.result.current.v).toBe(v0);
    expect(slow.result.current.tt).toBe(tt0);
    expect(slowRenders).toBe(slow0);
    expect(fastRenders).toBeGreaterThan(fast0);
    expect(fast.result.current?.data.price).toBe(84216);
    expect(HIGH_FREQUENCY_FEEDS.has("aggTrade")).toBe(true);
    expect(HIGH_FREQUENCY_FEEDS.has("ticker24h")).toBe(false);
    slow.unmount();
    fast.unmount();
  });

  it("finding 8: usePriceSnapshot returns primitives, a stable object and re-renders only when the integer changes", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    expect(PRICE_SNAPSHOT_INTERVAL_MS).toBe(100);
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return usePriceSnapshot();
    });
    expect(hook.result.current).toEqual({ price: 84206, source: "binance" });
    const first = hook.result.current;
    expect(getPriceSnapshot()).toBe(first);
    const ws = FakeSocket.all[0]!;
    const r0 = renders;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: aggFrame(84206.1) });
      ws.onmessage?.({ data: aggFrame(84206.2) });
      ws.onmessage?.({ data: aggFrame(84206.3) });
      nextFrame();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current).toBe(first); // same integer → same object, no re-render from the price
    expect(renders - r0).toBeLessThanOrEqual(1); // at most the health-driven lifecycle render
    await act(async () => {
      ws.onmessage?.({ data: aggFrame(84300.4) });
      nextFrame();
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current).toEqual({ price: 84300, source: "binance" });
    expect(hook.result.current).not.toBe(first);
    hook.unmount();
  });
  it("kline ticks of the forming bar stay on the fast channel; only bar changes are slow", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    const ws = FakeSocket.all[0]!;
    const E0 = (wsKline as { data: { E: number } }).data.E;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: klineFrame({ E: E0 }) }); // first WS kline: health → live (legitimate slow change)
      ws.onmessage?.({ data: JSON.stringify(wsAgg) });
      nextFrame();
    });
    const key0 = klineBarKey(getFeed("kline_1h"));
    let slowRenders = 0;
    const slow = renderHook(() => {
      slowRenders += 1;
      return { v: useMarketVersion(), tt: useTopTrader("accounts"), view: useMarketView({ now: T0 }), health: useHealth() };
    });
    let feedRenders = 0;
    const feed = renderHook(() => {
      feedRenders += 1;
      return useFeed("kline_1h");
    });
    let selectRenders = 0;
    const select = renderHook(() => {
      selectRenders += 1;
      return useFeedSelect("kline_1h", closedCount);
    });
    let labelRenders = 0;
    const label = renderHook(() => {
      labelRenders += 1;
      return useStatusLabel("kline_1h");
    });
    const v0 = slow.result.current.v;
    const [slow0, feed0, select0, label0] = [slowRenders, feedRenders, selectRenders, labelRenders];
    const closed0 = select.result.current;

    // forming-bar ticks (same open time, still open; event times inside the 1-s health throttle)
    await act(async () => {
      for (let i = 1; i <= 5; i++) {
        ws.onmessage?.({ data: klineFrame({ E: E0 + i * 100, c: String(84210 + i) }) });
        nextFrame();
      }
    });
    expect(klineBarKey(getFeed("kline_1h"))).toBe(key0);
    expect(slow.result.current.v).toBe(v0);
    expect(slowRenders).toBe(slow0);
    expect(selectRenders).toBe(select0);
    expect(labelRenders).toBe(label0);
    expect(feedRenders).toBeGreaterThan(feed0);
    expect(feed.result.current?.data.at(-1)?.close).toBe(84215);

    // the forming bar closes → slow change, the closed-bar selection moves
    await act(async () => {
      ws.onmessage?.({ data: klineFrame({ E: E0 + 700, c: "84220", x: true }) });
      nextFrame();
    });
    expect(slow.result.current.v).toBeGreaterThan(v0);
    expect(select.result.current).toBe(closed0 + 1);
    const v1 = slow.result.current.v;

    // the next bar opens → appended (no re-sort of the ring), slow again
    const t0 = (wsKline as { data: { k: { t: number } } }).data.k.t;
    await act(async () => {
      ws.onmessage?.({ data: klineFrame({ t: t0 + 3_600_000, E: E0 + 800, c: "84221", x: false }) });
      nextFrame();
    });
    const series = getFeed("kline_1h")!.data;
    expect(series.at(-1)).toMatchObject({ time: t0 + 3_600_000, close: 84221, closed: false });
    expect(series.at(-2)).toMatchObject({ time: t0, close: 84220, closed: true });
    expect(series.every((c, i) => i === 0 || c.time > series[i - 1]!.time)).toBe(true);
    expect(slow.result.current.v).toBeGreaterThan(v1);
    for (const h of [slow, feed, select, label]) h.unmount();
  });

  it("coalesces every publish of a frame into one delivery with the latest value", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    const ws = FakeSocket.all[0]!;
    ws.onopen?.({});
    const seen: number[] = [];
    const off = subscribeFeed("aggTrade", (v) => seen.push(v?.data.price ?? -1));
    for (let i = 1; i <= 10; i++) ws.onmessage?.({ data: aggFrame(84200 + i) });
    expect(seen).toEqual([]); // nothing until the frame runs
    flushMarketNotifications();
    expect(seen).toEqual([84210]);
    flushMarketNotifications(); // nothing pending → no repeat
    expect(seen).toEqual([84210]);
    off();
    ws.onmessage?.({ data: aggFrame(84300) });
    flushMarketNotifications();
    expect(seen).toEqual([84210]);
  });

  it("lifecycle changes are delivered synchronously, also to feed subscribers", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    const seen: Array<number | undefined> = [];
    const off = subscribeFeed("ticker24h", (v) => seen.push(v?.data.lastPrice));
    const hook = renderHook(() => useProvider());
    expect(hook.result.current).toBe(getProvider());
    act(() => stopMarket());
    expect(hook.result.current).toBeNull();
    expect(seen).toEqual([undefined]);
    off();
    hook.unmount();
  });

  it("useFeedSelect re-renders only when the selection changes", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    const ws = FakeSocket.all[0]!;
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useFeedSelect("aggTrade", (v) => (v ? Math.round(v.data.price) : null));
    });
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: aggFrame(84206.1) });
      nextFrame();
    });
    expect(hook.result.current).toBe(84206);
    const r0 = renders;
    await act(async () => {
      ws.onmessage?.({ data: aggFrame(84206.2) });
      nextFrame();
      ws.onmessage?.({ data: aggFrame(84205.9) });
      nextFrame();
    });
    expect(renders).toBe(r0);
    await act(async () => {
      ws.onmessage?.({ data: aggFrame(84250.4) });
      nextFrame();
    });
    expect(hook.result.current).toBe(84250);
    expect(renders).toBe(r0 + 1);
    hook.unmount();
  });

  it("binds the live MotionValues: 24 h open from the ticker, tick direction per frame", async () => {
    startMarket(settings, { deps });
    await act(async () => {
      await settle();
    });
    // ticker fixture: lastPrice 84205.9, −1.316 % → open = 84205.9 / 0.98684
    expect(open24hMv.get()).toBeCloseTo(84205.9 / (1 - 0.01316), 6);
    const ws = FakeSocket.all[0]!;
    ws.onopen?.({});
    ws.onmessage?.({ data: aggFrame(84300) });
    nextFrame();
    ws.onmessage?.({ data: aggFrame(84290) });
    nextFrame();
    expect(priceMv.get()).toBe(84290);
    expect(tickDirMv.get()).toBe(-1);
    ws.onmessage?.({ data: aggFrame(84290) }); // zero-tick keeps the direction
    nextFrame();
    expect(tickDirMv.get()).toBe(-1);
    ws.onmessage?.({ data: aggFrame(84280) });
    ws.onmessage?.({ data: aggFrame(84295) }); // net move of the frame: up
    nextFrame();
    expect(tickDirMv.get()).toBe(1);
  });
});
