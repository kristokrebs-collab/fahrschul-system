/**
 * Provider integration with a routed fake fetch and a scripted fake WebSocket under fake timers.
 * Covers: bootstrap, WS live path, silent detection, reconnect gap-fill, blocked-451 → Bybit fallback,
 * unsupported top-trader feeds on Bybit, offline, history paging, symbol/period validation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import klines1m from "../fixtures/binance-klines-1m.json";
import klines15m from "../fixtures/binance-klines-15m.json";
import klines1h from "../fixtures/binance-klines-1h.json";
import klines4h from "../fixtures/binance-klines-4h.json";
import klines1w from "../fixtures/binance-klines-1w.json";
import premiumIndex from "../fixtures/binance-premiumIndex.json";
import ticker from "../fixtures/binance-ticker24hr.json";
import openInterest from "../fixtures/binance-openInterest.json";
import oiHist from "../fixtures/binance-openInterestHist.json";
import topPos from "../fixtures/binance-topLongShortPositionRatio.json";
import topAcc from "../fixtures/binance-topLongShortAccountRatio.json";
import globalAcc from "../fixtures/binance-globalLongShortAccountRatio.json";
import taker from "../fixtures/binance-takerlongshortRatio.json";
import funding from "../fixtures/binance-fundingRate.json";
import serverTime from "../fixtures/binance-time.json";
import wsMark from "../fixtures/binance-ws-markPrice.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsKline from "../fixtures/binance-ws-kline.json";
import bybitKline from "../fixtures/bybit-kline.json";
import bybitTickers from "../fixtures/bybit-tickers.json";
import bybitRatio from "../fixtures/bybit-account-ratio.json";
import bybitOi from "../fixtures/bybit-open-interest.json";
import bybitFunding from "../fixtures/bybit-funding-history.json";
import bybitTime from "../fixtures/bybit-time.json";
import { createMarketProvider, type MarketProvider } from "@/market/provider";
import type { WsLike } from "@/market/sources/ws";
import { memoryKV } from "@/market/cache";
import { deriveMarket, deriveTopTrader } from "@/market/mapping";

const T0 = 1790762400000;

type Mode = "ok" | "blocked" | "offline";
class FakeSocket implements WsLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closedByClient = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  serverClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
  }
}

function makeFetch(state: { binance: Mode; bybit: Mode; log: string[] }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const binanceRoutes: Record<string, unknown> = {
    "/fapi/v1/premiumIndex": premiumIndex,
    "/fapi/v1/ticker/24hr": ticker,
    "/fapi/v1/openInterest": openInterest,
    "/futures/data/openInterestHist": oiHist,
    "/futures/data/topLongShortPositionRatio": topPos,
    "/futures/data/topLongShortAccountRatio": topAcc,
    "/futures/data/globalLongShortAccountRatio": globalAcc,
    "/futures/data/takerlongshortRatio": taker,
    "/fapi/v1/fundingRate": funding,
    "/fapi/v1/time": serverTime,
  };
  const bybitRoutes: Record<string, unknown> = {
    "/v5/market/kline": bybitKline,
    "/v5/market/tickers": bybitTickers,
    "/v5/market/account-ratio": bybitRatio,
    "/v5/market/open-interest": bybitOi,
    "/v5/market/funding/history": bybitFunding,
    "/v5/market/time": bybitTime,
  };
  return async (url: string): Promise<Response> => {
    state.log.push(url);
    const u = new URL(url, "https://site.invalid");
    if (u.hostname === "fapi.binance.com") {
      if (state.binance !== "ok") throw new TypeError("Failed to fetch");
      if (u.pathname === "/fapi/v1/klines") {
        const iv = u.searchParams.get("interval");
        const limit = Number(u.searchParams.get("limit") ?? 500);
        const src = iv === "1m" ? klines1m : iv === "15m" ? klines15m : iv === "1h" ? klines1h : iv === "4h" ? klines4h : klines1w;
        if (u.searchParams.get("symbol") !== "BTCUSDT") return json({ code: -1121, msg: "Invalid symbol." }, 400);
        const endTime = u.searchParams.get("endTime");
        const rows = endTime ? src.filter((r) => (r[0] as number) <= Number(endTime)) : src;
        return json(rows.slice(-limit));
      }
      if (u.pathname === "/fapi/v1/premiumIndex") return json({ ...premiumIndex, time: Date.now() });
      if (u.pathname === "/fapi/v1/ticker/24hr") return json({ ...ticker, closeTime: Date.now() });
      const hit = binanceRoutes[u.pathname];
      return hit ? json(hit) : json({ code: -1, msg: "nf" }, 404);
    }
    if (u.hostname === "api.bybit.com") {
      if (state.bybit !== "ok") throw new TypeError("Failed to fetch");
      if (u.pathname === "/v5/market/tickers") return json({ ...bybitTickers, time: Date.now() });
      const hit = bybitRoutes[u.pathname];
      return hit ? json(hit) : json({ retCode: 10001, retMsg: "nf", result: {} });
    }
    if (u.pathname.startsWith("/api/binance")) return new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    throw new TypeError("unknown host");
  };
}

function setup(o: { binance?: Mode; bybit?: Mode; symbol?: string; period?: string; hidden?: boolean } = {}) {
  const state = { binance: o.binance ?? ("ok" as Mode), bybit: o.bybit ?? ("ok" as Mode), log: [] as string[] };
  FakeSocket.all = [];
  const doc = { hidden: o.hidden ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const provider = createMarketProvider({
    symbol: o.symbol ?? "BINANCE:BTCUSDT",
    period: o.period ?? "1h",
    deps: {
      fetch: makeFetch(state),
      wsFactory: (url) => new FakeSocket(url),
      kv: memoryKV(),
      documentRef: doc as unknown as Document,
      windowRef: win as unknown as Window,
      online: () => true,
      probeProxy: false,
      random: () => 0.5,
      timeZone: "UTC",
    },
  });
  return { provider, state, doc, win, sockets: () => FakeSocket.all };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("createMarketProvider", () => {
  let p: MarketProvider | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    p?.stop();
    p = null;
    vi.useRealTimers();
  });

  it("bootstraps every REST feed and goes live over the WebSocket", async () => {
    const { provider, state, sockets } = setup();
    p = provider;
    expect(provider.symbol).toBe("BTCUSDT");
    provider.start();
    await flush();
    await flush();
    const h = provider.getHealth();
    expect(h.feeds.ticker24h.state).toBe("live");
    expect(h.feeds.topAccountRatio).toMatchObject({ state: "live", source: "binance" });
    expect(h.feeds.kline_4h.state).toBe("live");
    expect(provider.get("kline_4h")!.data).toHaveLength(30);
    expect(provider.get("topAccountRatio")!.data).toHaveLength(30);
    expect(state.log.some((u) => u.includes("topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=500"))).toBe(true);
    expect(state.log.some((u) => u.includes("interval=1w&limit=200"))).toBe(true);
    // the signal check's 15m feed bootstraps 1500 bars (= 500 × 45m), the other klines 499
    expect(state.log.some((u) => u.includes("interval=15m&limit=1500"))).toBe(true);
    expect(state.log.some((u) => u.includes("interval=1h&limit=499"))).toBe(true);
    expect(h.feeds.kline_15m.state).toBe("live");
    expect(provider.get("kline_15m")!.data).toHaveLength(30);
    expect(provider.statusLabel("topAccountRatio").text).toBe("Live · stündlich");

    // WebSocket: one combined-stream socket, no bookTicker by default
    const ws = sockets()[0]!;
    expect(ws.url).toBe("wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/btcusdt@kline_15m/btcusdt@kline_1h/btcusdt@kline_4h/btcusdt@kline_1w/btcusdt@markPrice@1s/btcusdt@aggTrade");
    ws.open();
    const seen: number[] = [];
    provider.subscribe("aggTrade", (v) => seen.push(v.data.price));
    ws.send(wsMark);
    ws.send(wsAgg);
    ws.send(wsKline);
    expect(seen).toEqual([84206.1]);
    expect(provider.getHealth().ws.state).toBe("live");
    expect(provider.getHealth().feeds.aggTrade).toMatchObject({ state: "live", source: "binance" });
    expect(provider.statusLabel("markPrice").text).toBe("Live · 1 s");
    // kline upsert by open time keeps the series length and updates the running candle
    const k1h = provider.get("kline_1h")!.data;
    expect(k1h).toHaveLength(30);
    expect(k1h.at(-1)!.close).toBe(84205.9);

    const m = deriveMarket(provider.snapshot(), provider.getHealth(), { now: Date.now() });
    expect(m.status).toBe("live");
    expect(m.price).toBe(84206);
    expect(m.close4h).not.toBeNull();
    const tt = deriveTopTrader(provider.snapshot(), provider.getHealth());
    expect(tt.deltaCandles).toBe(3);
    expect(tt.liveReadingOk).toBe(true);
  });

  it("schedules the 5-min feeds aligned to the boundary and polls ticker every 30 s", async () => {
    const { provider, state } = setup();
    p = provider;
    provider.start();
    await flush();
    const next = provider.getHealth().feeds.topAccountRatio.nextRefreshAt!;
    const boundary = Math.floor(next / 300_000) * 300_000;
    expect(next - boundary).toBeGreaterThanOrEqual(60_000);
    expect(next - boundary).toBeLessThan(105_000);
    const tickerCalls = () => state.log.filter((u) => u.includes("/fapi/v1/ticker/24hr")).length;
    const before = tickerCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tickerCalls()).toBe(before + 1);
    // the aligned poll requests only limit=30 and upserts into the ring buffer
    await vi.advanceTimersByTimeAsync(next - Date.now() + 10);
    expect(state.log.some((u) => u.includes("topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=30"))).toBe(true);
    expect(provider.get("topAccountRatio")!.data).toHaveLength(30);
  });

  it("detects a silent socket after 10 s and reconnects with gap-fill", async () => {
    const { provider, state, sockets } = setup();
    p = provider;
    provider.start();
    await flush();
    const ws = sockets()[0]!;
    ws.open();
    ws.send(wsMark);
    await vi.advanceTimersByTimeAsync(5000);
    ws.send({ ...wsMark, data: { ...wsMark.data, E: Date.now() } });
    expect(provider.getHealth().ws.state).toBe("live");
    await vi.advanceTimersByTimeAsync(10_100);
    expect(ws.closedByClient).toBe(true);
    expect(provider.getHealth().feeds.markPrice).toMatchObject({ state: "stale", reason: "ws_silent" });
    expect(provider.statusLabel("markPrice").text).toMatch(/^Zuletzt \d\d:\d\d · veraltet$/);
    expect(sockets()).toHaveLength(2);
    const ws2 = sockets()[1]!;
    const klineCallsBefore = state.log.filter((u) => u.includes("/fapi/v1/klines") && u.includes("limit=2")).length;
    ws2.open();
    await flush();
    // reconnect: last 2 candles per interval are re-fetched (5 kline feeds)
    expect(state.log.filter((u) => u.includes("/fapi/v1/klines") && u.includes("limit=2")).length).toBe(klineCallsBefore + 5);
    ws2.send({ ...wsMark, data: { ...wsMark.data, E: Date.now() } });
    expect(provider.getHealth().feeds.markPrice.state).toBe("live");
  });

  it("falls back to REST polling on Binance after 3 failed WS connects and recovers when the socket returns", async () => {
    const { provider, state, sockets } = setup();
    p = provider;
    provider.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      sockets().at(-1)!.serverClose(1006);
      await vi.advanceTimersByTimeAsync(31_000); // > max backoff
    }
    const h = provider.getHealth();
    expect(h.ws.state).toBe("fallback");
    expect(h.feeds.markPrice).toMatchObject({ state: "fallback", source: "binance", reason: "ws_closed" });
    expect(provider.statusLabel("markPrice").text).toBe("Binance-Daten · alle 10 s");
    const premiumBefore = state.log.filter((u) => u.includes("premiumIndex")).length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.log.filter((u) => u.includes("premiumIndex")).length).toBeGreaterThan(premiumBefore);
    // price is still available through the ticker fallback
    expect(deriveMarket(provider.snapshot(), provider.getHealth(), { now: Date.now() }).price).toBe(84206);
    const ws = sockets().at(-1)!;
    ws.open();
    ws.send({ ...wsMark, data: { ...wsMark.data, E: Date.now() } });
    expect(provider.getHealth().feeds.markPrice).toMatchObject({ state: "live", source: "binance" });
  });

  it("blocked Binance (TypeError while Bybit answers) → whole chain on Bybit, top-trader feeds `Nur mit Binance`", async () => {
    const { provider, state } = setup({ binance: "blocked" });
    p = provider;
    provider.start();
    await vi.advanceTimersByTimeAsync(50);
    const h = provider.getHealth();
    expect(h.primary.blocked).toBe(true);
    expect(state.log.some((u) => u.includes("api.bybit.com/v5/market/time"))).toBe(true);
    expect(h.feeds.ticker24h).toMatchObject({ state: "fallback", source: "bybit" });
    expect(h.feeds.markPrice).toMatchObject({ state: "fallback", source: "bybit" });
    expect(h.feeds.globalAccountRatio).toMatchObject({ state: "fallback", source: "bybit" });
    expect(h.feeds.topAccountRatio).toMatchObject({ state: "fallback", source: "bybit", reason: "unsupported" });
    expect(provider.statusLabel("topAccountRatio")).toMatchObject({ text: "Nur mit Binance", tone: "muted" });
    expect(provider.statusLabel("markPrice").text).toBe("Bybit-Daten · alle 5 s");
    expect(provider.statusLabel("globalAccountRatio")).toEqual({ tone: "warn", text: "Bybit-Daten · stündlich", detail: "Binance nicht erreichbar (451/CORS)" });
    expect(provider.get("globalAccountRatio")!.comparable).toBe(false);
    expect(provider.get("markPrice")!.comparable).toBe(true);
    expect(provider.get("kline_1h")!.source).toBe("bybit");
    // one tickers call serves the five price feeds
    expect(state.log.filter((u) => u.includes("/v5/market/tickers")).length).toBe(1);
    const m = deriveMarket(provider.snapshot(), h, { now: Date.now() });
    expect(m.status).toBe("live");
    expect(m.sourceBadge).toBe("Ersatzquelle Bybit");
    expect(m.price).toBe(84211);
    const tt = deriveTopTrader(provider.snapshot(), h);
    expect(tt.onlyBinance).toBe(true);
    expect(tt.globalLongPct).not.toBeNull();
    expect(h.overall).toBe("fallback");
    // re-probe after 5 min succeeds → back to Binance
    state.binance = "ok";
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    await flush();
    await flush();
    expect(provider.getHealth().primary.blocked).toBe(false);
    expect(provider.getHealth().feeds.ticker24h).toMatchObject({ state: "live", source: "binance" });
    expect(provider.getHealth().feeds.topAccountRatio).toMatchObject({ state: "live", source: "binance", reason: undefined });
  });

  it("goes offline when nothing answers and serves the cache", async () => {
    const { provider } = setup({ binance: "offline", bybit: "offline" });
    p = provider;
    provider.start();
    await flush();
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(15_000);
    const h = provider.getHealth();
    expect(["fallback", "offline"]).toContain(h.feeds.ticker24h.state);
    expect(h.feeds.ticker24h.source).not.toBe("binance");
    expect(h.overall).not.toBe("live");
    expect(provider.get("ticker24h")).toBeUndefined();
    expect(deriveMarket(provider.snapshot(), h, { now: Date.now() }).status).not.toBe("live");
  });

  it("hydrates the first paint from the persisted snapshot", async () => {
    const kv = memoryKV();
    const first = createMarketProvider({ symbol: "BTCUSDT", deps: { fetch: makeFetch({ binance: "ok", bybit: "ok", log: [] }), wsFactory: (u) => new FakeSocket(u), kv, documentRef: null, windowRef: null, online: () => true, probeProxy: false, random: () => 0.5 } });
    first.start();
    await flush();
    first.stop();
    await flush();
    expect((await kv.keys()).length).toBeGreaterThan(0);
    const second = createMarketProvider({ symbol: "BTCUSDT", deps: { fetch: async () => { throw new TypeError("net"); }, wsFactory: (u) => new FakeSocket(u), kv, documentRef: null, windowRef: null, online: () => true, probeProxy: false, random: () => 0.5 } });
    p = second;
    second.start();
    await flush();
    expect(second.get("kline_4h")!.data).toHaveLength(30);
    expect(second.statusLabel("kline_4h").text).toMatch(/^Zuletzt \d\d:\d\d · veraltet$/);
  });

  it("gap-fills a long WS outage with as many bars as are missing (no holes for the signal check)", async () => {
    const { provider, state, sockets } = setup();
    p = provider;
    provider.start();
    await flush();
    sockets()[0]!.open();
    // 3 h 10 min without data, then the socket reconnects
    vi.setSystemTime(T0 + 3 * 3_600_000 + 600_000);
    sockets()[0]!.serverClose(1006);
    await vi.advanceTimersByTimeAsync(31_000);
    const ws2 = sockets().at(-1)!;
    const before = state.log.length;
    ws2.open();
    await flush();
    const calls = state.log.slice(before).filter((u) => u.includes("/fapi/v1/klines"));
    const limitOf = (iv: string) => Number(new URL(calls.find((u) => u.includes(`interval=${iv}&`))!).searchParams.get("limit"));
    expect(limitOf("15m")).toBe(Math.ceil((Date.now() - T0) / 900_000) + 1);
    expect(limitOf("1h")).toBe(Math.ceil((Date.now() - T0) / 3_600_000) + 1);
    expect(limitOf("1m")).toBe(Math.min(1500, Math.ceil((Date.now() - 1790762400000) / 60_000) + 1));
    expect(limitOf("1w")).toBe(2);
  });

  it("fetchKlines() pages by endTime through the budget without touching the live cache", async () => {
    const { provider, state } = setup();
    p = provider;
    provider.start();
    await flush();
    const live = provider.get("kline_1h");
    const page = await provider.fetchKlines("1h", { endTime: T0 - 10 * 3_600_000, limit: 5 });
    expect(page.data).toHaveLength(5);
    expect(page.data.at(-1)!.time).toBeLessThanOrEqual(T0 - 10 * 3_600_000);
    expect(state.log.at(-1)).toContain("interval=1h&limit=5&endTime=");
    expect(provider.get("kline_1h")).toBe(live);
    // 1d is REST-only (signal ladder rung 1D)
    await provider.fetchKlines("1d", { limit: 3 }).catch(() => undefined);
    expect(state.log.at(-1)).toContain("interval=1d&limit=3");
    // budget exhausted → rate_limited instead of hammering the exchange
    const many = Array.from({ length: 40 }, () => provider.fetchKlines("1h", { limit: 1500, maxWaitMs: 0 }).then(() => "ok", (e: { kind?: string }) => e.kind));
    const results = await Promise.all(many);
    expect(results).toContain("rate_limited");
  });

  it("history() pages backwards with limit=1500 and serves from the cache afterwards", async () => {
    const { provider, state } = setup();
    p = provider;
    provider.start();
    await flush();
    const from = T0 - 40 * 3_600_000;
    const r = await provider.history("kline_1h", { from, to: T0 });
    expect(state.log.filter((u) => u.includes("interval=1h") && u.includes("limit=1500")).length).toBe(1);
    expect(r.data.every((c) => c.time >= from)).toBe(true);
    const calls = state.log.length;
    await provider.history("kline_1h", { from: T0 - 20 * 3_600_000, to: T0 });
    expect(state.log.length).toBe(calls); // covered by cache
    const old = await provider.history("topAccountRatio", { from: T0 - 60 * 86_400_000, to: T0 - 40 * 86_400_000 });
    expect(old.data).toEqual([]);
    expect(provider.getHealth().feeds.topAccountRatio.reason).toBe("beyond_retention");
  });

  it("flags an unsupported period and keeps 1h for the ratio feeds", async () => {
    const { provider, state } = setup({ period: "1w" });
    p = provider;
    expect(provider.period).toMatchObject({ period: "1h", ok: false });
    provider.start();
    await flush();
    const h = provider.getHealth().feeds.topAccountRatio;
    expect(h).toMatchObject({ state: "live", reason: "bad_period" });
    expect(h.detail).toBe("Timeframe 1w wird von Binance nicht unterstützt, Ratios nutzen 1h");
    expect(state.log.some((u) => u.includes("period=1h"))).toBe(true);
    expect(provider.statusLabel("topAccountRatio")).toMatchObject({ text: "Live · stündlich", detail: h.detail });
  });

  it("rejects an invalid symbol without touching the network", async () => {
    const { provider, state, sockets } = setup({ symbol: "BINANCE:BTC" });
    p = provider;
    provider.start();
    await flush();
    expect(state.log).toEqual([]);
    expect(sockets()).toHaveLength(0);
    expect(provider.getHealth().feeds.aggTrade.reason).toBe("bad_symbol");
    expect(provider.statusLabel("aggTrade").text).toBe("Kein Live-Kurs");
    expect(deriveMarket(provider.snapshot(), provider.getHealth()).status).toBe("error");
  });

  it("reports bad_symbol from the exchange (-1121)", async () => {
    const { provider } = setup({ symbol: "BINANCE:XYZUSDT" });
    p = provider;
    provider.start();
    await flush();
    expect(provider.getHealth().feeds.kline_1h.reason).toBe("bad_symbol");
  });

  it("stop() closes the socket, clears timers and resets health; setBookTop rolls the socket over", async () => {
    const { provider, sockets, doc, win } = setup();
    p = provider;
    provider.start();
    await flush();
    expect(doc.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(win.addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    provider.setBookTop(true);
    expect(sockets().at(-1)!.url).toContain("@bookTicker");
    provider.stop();
    expect(sockets().every((s) => s.closedByClient)).toBe(true);
    expect(provider.getHealth().overall).toBe("connecting");
    expect(doc.removeEventListener).toHaveBeenCalled();
    const n = sockets().length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets().length).toBe(n); // no reconnects after stop
    p = null;
  });
});
