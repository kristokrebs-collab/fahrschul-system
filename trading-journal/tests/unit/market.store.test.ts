import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import premiumIndex from "../fixtures/binance-premiumIndex.json";
import ticker from "../fixtures/binance-ticker24hr.json";
import klines1h from "../fixtures/binance-klines-1h.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsBook from "../fixtures/binance-ws-bookTicker.json";
import { __resetMarketStore, getProvider, startMarket, stopMarket, useFeed, useHealth, useMarketView, useStatusLabel, useTopTrader } from "@/market/marketStore";
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
});
