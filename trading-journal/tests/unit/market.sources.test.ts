import { describe, expect, it } from "vitest";
import klines1h from "../fixtures/binance-klines-1h.json";
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
import err451 from "../fixtures/binance-error-451.json";
import errSymbol from "../fixtures/binance-error-invalidSymbol.json";
import wsKline from "../fixtures/binance-ws-kline.json";
import wsMark from "../fixtures/binance-ws-markPrice.json";
import wsAgg from "../fixtures/binance-ws-aggTrade.json";
import wsBook from "../fixtures/binance-ws-bookTicker.json";
import bybitKline from "../fixtures/bybit-kline.json";
import bybitTickers from "../fixtures/bybit-tickers.json";
import bybitRatio from "../fixtures/bybit-account-ratio.json";
import bybitOi from "../fixtures/bybit-open-interest.json";
import bybitFunding from "../fixtures/bybit-funding-history.json";
import bybitTime from "../fixtures/bybit-time.json";
import { binanceRest, parseWsMessage, buildStreamUrl, klinesSchema, ratioSchema, premiumIndexSchema } from "@/market/sources/binance";
import { bybitRest } from "@/market/sources/bybit";
import { okxRest, ratioToLongPct } from "@/market/sources/okx";
import { probeProxy, proxyRest } from "@/market/sources/proxy";
import { RestError, classifyStatus, fetchJson } from "@/market/sources/http";
import { z } from "zod";

const T0 = 1790762400000;
const now = () => T0 + 5000;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...init.headers } });
}

/** Routes by URL path → fixture. */
function router(routes: Record<string, unknown | (() => Response)>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    calls.push(url);
    const u = new URL(url, "https://x.invalid");
    const hit = Object.entries(routes).find(([p]) => u.pathname === p);
    if (!hit) return new Response("not found", { status: 404 });
    const v = hit[1];
    return typeof v === "function" ? (v as () => Response)() : jsonResponse(v);
  };
  return { fetchImpl, calls };
}

describe("binance REST parsers", () => {
  const { fetchImpl, calls } = router({
    "/fapi/v1/klines": klines1h,
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
  });
  const api = binanceRest({ fetch: fetchImpl, now });

  it("parses klines into candles (strings → numbers, closed flag)", async () => {
    const r = await api.klines("BTCUSDT", "1h", { limit: 30 });
    expect(r.source).toBe("binance");
    expect(r.comparable).toBe(true);
    expect(r.data).toHaveLength(30);
    const last = r.data[r.data.length - 1]!;
    expect(typeof last.close).toBe("number");
    expect(last.closed).toBe(false); // running candle
    expect(r.data[0]!.closed).toBe(true);
    expect(last.closeTime).toBe(last.time + 3_600_000 - 1);
    expect(calls.at(-1)).toContain("symbol=BTCUSDT&interval=1h&limit=30");
    expect(klinesSchema.parse(klines1w)).toHaveLength(20);
  });
  it("parses premiumIndex", async () => {
    const r = await api.premiumIndex("BTCUSDT");
    expect(r.data).toEqual({ markPrice: 84212.3, indexPrice: 84198.754321, fundingRate: 0.0001, nextFundingTime: 1790784000000, time: T0 });
    expect(r.asOf).toBe(T0);
    expect(premiumIndexSchema.safeParse({ ...premiumIndex, markPrice: "abc" }).success).toBe(false);
  });
  it("parses ticker/24hr", async () => {
    const r = await api.ticker24h("BTCUSDT");
    expect(r.data.lastPrice).toBe(84205.9);
    expect(r.data.priceChangePercent).toBeCloseTo(-1.316);
    expect(r.data.high).toBe(85710);
  });
  it("parses openInterest", async () => {
    const r = await api.openInterest("BTCUSDT");
    expect(r.data).toEqual({ openInterest: 78321.456, time: T0 });
  });
  it("parses /futures/data ratios with string timestamps and longPct 0–100", async () => {
    const r = await api.ratio("topPositionRatio", "BTCUSDT", "1h", { limit: 30 });
    expect(r.data).toHaveLength(30);
    const last = r.data.at(-1)!;
    expect(last.time).toBe(Number(topPos.at(-1)!.timestamp));
    expect(last.longPct).toBeCloseTo(Number(topPos.at(-1)!.longAccount) * 100, 6);
    expect(last.longPct + last.shortPct).toBeCloseTo(100, 6);
    expect(r.asOf).toBe(last.time);
    expect(calls.at(-1)).toContain("/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=30");
    expect(ratioSchema.safeParse([{ longShortRatio: "1", timestamp: "1" }]).success).toBe(false);
  });
  it("parses account and global ratios", async () => {
    const a = await api.ratio("topAccountRatio", "BTCUSDT", "1h");
    const g = await api.ratio("globalAccountRatio", "BTCUSDT", "1h");
    expect(a.data.at(-1)!.longPct).toBeCloseTo(Number(topAcc.at(-1)!.longAccount) * 100, 6);
    expect(g.data.at(-1)!.longPct).toBeCloseTo(Number(globalAcc.at(-1)!.longAccount) * 100, 6);
  });
  it("parses taker ratio", async () => {
    const r = await api.takerRatio("BTCUSDT", "1h");
    const last = r.data.at(-1)!;
    expect(last.buyVol).toBeGreaterThan(0);
    expect(last.buySellRatio).toBeCloseTo(last.buyVol / last.sellVol, 3);
  });
  it("parses openInterestHist", async () => {
    const r = await api.openInterestHist("BTCUSDT", "1h", { limit: 500 });
    expect(r.data).toHaveLength(30);
    expect(r.data[0]!.time).toBeLessThan(r.data.at(-1)!.time);
    expect(r.data.at(-1)!.openInterestValue).toBeGreaterThan(r.data.at(-1)!.openInterest);
    expect(calls.at(-1)).toContain("limit=500");
  });
  it("parses funding history", async () => {
    const r = await api.fundingRate("BTCUSDT");
    expect(r.data).toHaveLength(12);
    expect(r.data.at(-1)!.time).toBe(1790755200000);
    expect(typeof r.data[0]!.fundingRate).toBe("number");
  });
  it("reads server time", async () => {
    expect(await api.serverTime()).toBe(T0);
  });
});

describe("binance error classification", () => {
  it("maps HTTP statuses", () => {
    expect(classifyStatus(451, err451)).toBe("blocked_451");
    expect(classifyStatus(429)).toBe("rate_limited");
    expect(classifyStatus(418)).toBe("rate_limited");
    expect(classifyStatus(503)).toBe("http_5xx");
    expect(classifyStatus(400, errSymbol)).toBe("bad_symbol");
    expect(classifyStatus(400, { code: -1120 })).toBe("bad_period");
  });
  it("throws RestError with kind from the response", async () => {
    const f = async () => jsonResponse(errSymbol, { status: 400 });
    await expect(fetchJson("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=XYZ", z.unknown(), { fetch: f })).rejects.toMatchObject({ kind: "bad_symbol", status: 400 });
  });
  it("classifies a TypeError (CORS-less 451) as network", async () => {
    const f = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(fetchJson("https://fapi.binance.com/fapi/v1/time", z.unknown(), { fetch: f })).rejects.toMatchObject({ kind: "network" });
  });
  it("treats an unexpected shape as http_5xx", async () => {
    const f = async () => jsonResponse({ nope: true });
    const err = await fetchJson("https://x/fapi/v1/time", z.object({ serverTime: z.number() }), { fetch: f }).catch((e) => e);
    expect(err).toBeInstanceOf(RestError);
    expect(err.kind).toBe("http_5xx");
  });
});

describe("binance WS messages", () => {
  it("parses kline frames", () => {
    const ev = parseWsMessage(JSON.stringify(wsKline));
    expect(ev?.kind).toBe("kline");
    if (ev?.kind !== "kline") throw new Error();
    expect(ev.interval).toBe("1h");
    expect(ev.candle).toMatchObject({ time: wsKline.data.k.t, close: 84205.9, closed: false, closeTime: wsKline.data.k.T, trades: 15234 });
    expect(ev.eventTime).toBe(wsKline.data.E);
  });
  it("parses markPrice frames", () => {
    const ev = parseWsMessage(JSON.stringify(wsMark));
    expect(ev).toEqual({ kind: "markPrice", value: { markPrice: 84212.3, indexPrice: 84198.754321, fundingRate: 0.0001, nextFundingTime: 1790784000000, time: wsMark.data.E } });
  });
  it("parses aggTrade frames", () => {
    const ev = parseWsMessage(JSON.stringify(wsAgg));
    expect(ev).toEqual({ kind: "aggTrade", value: { price: 84206.1, qty: 0.035, isBuyerMaker: false, time: wsAgg.data.T } });
  });
  it("parses bookTicker frames", () => {
    const ev = parseWsMessage(JSON.stringify(wsBook));
    expect(ev).toEqual({ kind: "bookTop", value: { bid: 84205.9, ask: 84206, time: wsBook.data.T } });
  });
  it("returns null for invalid JSON and unknown for unknown payloads", () => {
    expect(parseWsMessage("{oops")).toBeNull();
    expect(parseWsMessage(JSON.stringify({ stream: "x", data: { e: "foo" } }))).toEqual({ kind: "unknown", stream: "x" });
    expect(parseWsMessage(JSON.stringify({ result: null, id: 1 }))).toEqual({ kind: "unknown", stream: undefined });
  });
  it("builds the static combined-stream URL", () => {
    expect(buildStreamUrl("BTCUSDT")).toBe("wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/btcusdt@kline_1h/btcusdt@kline_4h/btcusdt@kline_1w/btcusdt@markPrice@1s/btcusdt@aggTrade");
    expect(buildStreamUrl("BTCUSDT", { bookTop: true })).toContain("/btcusdt@bookTicker");
  });
});

describe("bybit v5 parsers", () => {
  const { fetchImpl, calls } = router({
    "/v5/market/kline": bybitKline,
    "/v5/market/tickers": bybitTickers,
    "/v5/market/account-ratio": bybitRatio,
    "/v5/market/open-interest": bybitOi,
    "/v5/market/funding/history": bybitFunding,
    "/v5/market/time": bybitTime,
  });
  const api = bybitRest({ fetch: fetchImpl, now });

  it("reverses newest-first klines and marks comparable", async () => {
    const r = await api.klines("BTCUSDT", "1h", { limit: 200 });
    expect(r.source).toBe("bybit");
    expect(r.comparable).toBe(true);
    expect(r.data[0]!.time).toBeLessThan(r.data.at(-1)!.time);
    expect(r.data.at(-1)!.closed).toBe(false);
    expect(calls.at(-1)).toContain("category=linear&symbol=BTCUSDT&interval=60&limit=200");
  });
  it("splits tickers into mark/book/ticker/OI", async () => {
    const r = await api.tickers("BTCUSDT");
    expect(r.data.lastPrice).toBe(84210.5);
    expect(r.data.markPrice).toMatchObject({ markPrice: 84213, indexPrice: 84199.12, fundingRate: 0.00012, nextFundingTime: 1790784000000 });
    expect(r.data.bookTop).toMatchObject({ bid: 84210.4, ask: 84210.6 });
    expect(r.data.ticker24h.priceChangePercent).toBeCloseTo(-1.3119, 4);
    expect(r.data.openInterest.openInterest).toBe(61234.567);
  });
  it("maps account-ratio to longPct with comparable:false and Bybit period detail", async () => {
    const r = await api.accountRatio("BTCUSDT", "2h");
    expect(r.comparable).toBe(false);
    expect(r.detail).toBe("Bybit: 2h → 1h");
    expect(calls.at(-1)).toContain("period=1h");
    expect(r.data[0]!.time).toBeLessThan(r.data.at(-1)!.time);
    expect(r.data.at(-1)!.longPct).toBeCloseTo(Number(bybitRatio.result.list[0]!.buyRatio) * 100, 6);
  });
  it("maps open-interest history", async () => {
    const r = await api.openInterestHist("BTCUSDT", "1h");
    expect(r.comparable).toBe(false);
    expect(r.data).toHaveLength(30);
    expect(calls.at(-1)).toContain("intervalTime=1h");
  });
  it("maps funding history", async () => {
    const r = await api.fundingHistory("BTCUSDT");
    expect(r.comparable).toBe(true);
    expect(r.data.at(-1)!.time).toBe(1790755200000);
  });
  it("reads server time in ms and rejects retCode != 0", async () => {
    expect(await api.serverTime()).toBe(T0);
    const bad = bybitRest({ fetch: async () => jsonResponse({ retCode: 10001, retMsg: "params error", result: {} }), now });
    await expect(bad.serverTime()).rejects.toBeInstanceOf(RestError);
  });
});

describe("okx adapter", () => {
  const candles = { code: "0", msg: "", data: [[String(T0 - 0), "84100", "84300", "84000", "84200", "1200", "12.5", "1052500", "0"], [String(T0 - 3_600_000), "84000", "84150", "83900", "84100", "1500", "15.1", "1270000", "1"]] };
  const ratio = { code: "0", msg: "", data: [[String(T0), "1.5"], [String(T0 - 3_600_000), "1.0"]] };
  const takerV = { code: "0", msg: "", data: [[String(T0), "900", "1100"], [String(T0 - 3_600_000), "1000", "1000"]] };
  const time = { code: "0", msg: "", data: [{ ts: String(T0) }] };
  const { fetchImpl, calls } = router({
    "/api/v5/market/candles": candles,
    "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract": ratio,
    "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader": ratio,
    "/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader": ratio,
    "/api/v5/rubik/stat/taker-volume-contract": takerV,
    "/api/v5/public/time": time,
  });
  const api = okxRest({ fetch: fetchImpl, now });

  it("parses candles (newest-first, confirm flag)", async () => {
    const r = await api.candles("BTC-USDT-SWAP", "1h");
    expect(r.source).toBe("okx");
    expect(r.data).toHaveLength(2);
    expect(r.data[0]!.closed).toBe(true);
    expect(r.data[1]!.closed).toBe(false);
    expect(r.data[1]!.close).toBe(84200);
    expect(calls.at(-1)).toContain("instId=BTC-USDT-SWAP&bar=1H");
  });
  it("uses 1Wutc for weekly candles and flags plain 1W as not comparable", async () => {
    const utc = await api.candles("BTC-USDT-SWAP", "1w");
    expect(calls.at(-1)).toContain("bar=1Wutc");
    expect(utc.comparable).toBe(true);
    const hk = await api.candles("BTC-USDT-SWAP", "1w", { bar: "1W" });
    expect(hk.comparable).toBe(false);
  });
  it("converts long/short ratios to longPct and flags comparable:false", async () => {
    expect(ratioToLongPct(1.5)).toBeCloseTo(60);
    expect(ratioToLongPct(1)).toBe(50);
    const r = await api.topAccountRatio("BTC-USDT-SWAP", "1h");
    expect(r.comparable).toBe(false);
    expect(r.data.at(-1)!.longPct).toBeCloseTo(60);
    expect(r.data[0]!.longPct).toBe(50);
    expect(calls.at(-1)).toContain("long-short-account-ratio-contract-top-trader?instId=BTC-USDT-SWAP&period=1H");
    const p = await api.topPositionRatio("BTC-USDT-SWAP", "4h");
    expect(calls.at(-1)).toContain("period=4H");
    expect(p.data).toHaveLength(2);
    const g = await api.globalAccountRatio("BTC-USDT-SWAP", "1d");
    expect(calls.at(-1)).toContain("long-short-account-ratio-contract?instId");
    expect(g.data.at(-1)!.ratio).toBe(1.5);
  });
  it("parses taker volume [ts, sell, buy]", async () => {
    const r = await api.takerVolume("BTC-USDT-SWAP", "1h");
    expect(r.data.at(-1)).toEqual({ time: T0, buyVol: 1100, sellVol: 900, buySellRatio: 1100 / 900 });
  });
  it("reads server time and rejects code != 0", async () => {
    expect(await api.serverTime()).toBe(T0);
    const bad = okxRest({ fetch: async () => jsonResponse({ code: "50011", msg: "rate limit", data: [] }), now });
    await expect(bad.serverTime()).rejects.toBeInstanceOf(RestError);
  });
});

describe("proxy probe", () => {
  it("is usable only with JSON body, x-upstream-status and serverTime", async () => {
    const ok = await probeProxy(async () => jsonResponse(serverTime, { headers: { "x-upstream-status": "200" } }));
    expect(ok).toEqual({ usable: true, blocked: false, upstreamStatus: 200 });
    const spa = await probeProxy(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(spa.usable).toBe(false);
    const noHeader = await probeProxy(async () => jsonResponse(serverTime));
    expect(noHeader.usable).toBe(false);
    const blocked = await probeProxy(async () => jsonResponse(err451, { status: 451, headers: { "x-upstream-status": "451" } }));
    expect(blocked).toEqual({ usable: true, blocked: true, upstreamStatus: 451 });
    const thrown = await probeProxy(async () => {
      throw new TypeError("net");
    });
    expect(thrown.usable).toBe(false);
  });
  it("routes REST through /api/binance and stamps source proxy", async () => {
    const calls: string[] = [];
    const api = proxyRest({
      fetch: async (u) => {
        calls.push(u);
        return jsonResponse(premiumIndex);
      },
      now,
    });
    const r = await api.premiumIndex("BTCUSDT");
    expect(calls[0]).toBe("/api/binance/fapi/v1/premiumIndex?symbol=BTCUSDT");
    expect(r.source).toBe("proxy");
  });
});
