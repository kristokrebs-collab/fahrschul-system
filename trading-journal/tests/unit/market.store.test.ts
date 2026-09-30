import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import premiumIndex from "../fixtures/binance-premiumIndex.json";
import ticker from "../fixtures/binance-ticker24hr.json";
import klines1h from "../fixtures/binance-klines-1h.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsBook from "../fixtures/binance-ws-bookTicker.json";
import { __resetMarketStore, getPriceSnapshot, getProvider, HIGH_FREQUENCY_FEEDS, startMarket, stopMarket, useFeed, useHealth, useMarketVersion, useMarketView, usePriceSnapshot, useStatusLabel, useTopTrader } from "@/market/marketStore";
import { askMv, bidMv, flushMotionValues, priceMv } from "@/market/motionValues";
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

  it("hooks follow feed, health and label changes; MotionValues update without renders", async () => {
    startMarket(settings, { deps });
    const hook = renderHook(() => ({ agg: useFeed("aggTrade"), health: useHealth(), label: useStatusLabel("markPrice"), view: useMarketView({ now: Date.now() }), tt: useTopTrader("accounts") }));
    expect(hook.result.current.label.text).toBe("Verbinde …");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.health.feeds.markPrice.state).toBe("live");
    expect(hook.result.current.label.text).toBe("Live · 1 s");
    expect(hook.result.current.view.price).toBe(84206); // from ticker until the stream delivers
    const ws = FakeSocket.all[0]!;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: JSON.stringify(wsAgg) });
      ws.onmessage?.({ data: JSON.stringify(wsBook) });
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
      await vi.advanceTimersByTimeAsync(0);
    });
    const ws = FakeSocket.all[0]!;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: JSON.stringify(wsAgg) }); // first messages: ws health → live (legitimate slow changes)
      ws.onmessage?.({ data: JSON.stringify(wsBook) });
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
    const agg = (price: number) => JSON.stringify({ ...wsAgg, data: { ...(wsAgg as { data: Record<string, unknown> }).data, p: String(price) } });
    await act(async () => {
      for (let i = 1; i <= 10; i++) {
        ws.onmessage?.({ data: agg(84206 + i) });
        ws.onmessage?.({ data: JSON.stringify(wsBook) });
      }
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
      await vi.advanceTimersByTimeAsync(0);
    });
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return usePriceSnapshot();
    });
    expect(hook.result.current).toEqual({ price: 84206, source: "binance" });
    const first = hook.result.current;
    expect(getPriceSnapshot()).toBe(first);
    const ws = FakeSocket.all[0]!;
    const agg = (price: number) => JSON.stringify({ ...wsAgg, data: { ...(wsAgg as { data: Record<string, unknown> }).data, p: String(price) } });
    const r0 = renders;
    await act(async () => {
      ws.onopen?.({});
      ws.onmessage?.({ data: agg(84206.1) });
      ws.onmessage?.({ data: agg(84206.2) });
      ws.onmessage?.({ data: agg(84206.3) });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current).toBe(first); // same integer → same object, no re-render from the price
    expect(renders - r0).toBeLessThanOrEqual(1); // at most the health-driven lifecycle render
    await act(async () => {
      ws.onmessage?.({ data: agg(84300.4) });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(hook.result.current).toEqual({ price: 84300, source: "binance" });
    expect(hook.result.current).not.toBe(first);
    hook.unmount();
  });
});
