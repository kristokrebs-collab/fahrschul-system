/**
 * Network harness for provider reliability tests: a synthetic Binance (REST rows generated from the clock, so gap
 * fills, aligned polls and clock skew are observable), Bybit from fixtures, the same-origin proxy, a scripted
 * WebSocket that sends every stream with the SERVER clock, and a document/window pair whose listeners can be fired
 * (`visibilitychange`, `online`, `pageshow`, `focus`, Page Lifecycle `resume`). Use with `vi.useFakeTimers()`.
 */
import { vi } from "vitest";
import bybitKline from "../fixtures/bybit-kline.json";
import bybitTickers from "../fixtures/bybit-tickers.json";
import bybitRatio from "../fixtures/bybit-account-ratio.json";
import bybitOi from "../fixtures/bybit-open-interest.json";
import bybitFunding from "../fixtures/bybit-funding-history.json";
import bybitTime from "../fixtures/bybit-time.json";
import { createMarketProvider, type MarketProvider } from "@/market/provider";
import type { WsLike } from "@/market/sources/ws";
import { memoryKV } from "@/market/cache";
import { FEED_IDS } from "@/market/feeds";
import type { Candle } from "@/market/types";

export const SEC = 1000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
/** 2026-09-30 10:02 UTC */
export const T0 = 1790762400000 + 2 * MIN;

const IV: Record<string, number> = { "1m": MIN, "15m": 15 * MIN, "30m": 30 * MIN, "1h": HOUR, "2h": 2 * HOUR, "4h": 4 * HOUR, "1d": 24 * HOUR, "1w": 7 * 24 * HOUR };
const PERIOD: Record<string, number> = { "5m": 5 * MIN, "15m": 15 * MIN, "30m": 30 * MIN, "1h": HOUR, "2h": 2 * HOUR, "4h": 4 * HOUR };
/** Binance weeks start Monday 00:00 UTC (epoch was a Thursday). */
const WEEK_OFFSET = 4 * 24 * HOUR;

export function barOpen(t: number, iv: string): number {
  const ms = IV[iv]!;
  if (iv === "1w") return Math.floor((t - WEEK_OFFSET) / ms) * ms + WEEK_OFFSET;
  return Math.floor(t / ms) * ms;
}

export class FakeSocket implements WsLike {
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
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** server-side close (network drop) */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
  }
  static live(): FakeSocket | undefined {
    const s = FakeSocket.all.at(-1);
    return s && !s.closedByClient && s.readyState !== 3 ? s : undefined;
  }
}

export type Fail = "typeerror" | "timeout" | number | undefined;
export type Host = "binance" | "proxy" | "bybit";

export interface Net {
  log: { at: number; url: string }[];
  /** failure injection per request (direct Binance, proxy, Bybit) */
  fail: (u: URL, host: Host) => Fail;
  /** Binance server clock minus device clock (ms) */
  serverSkewMs: number;
  /** `/api/binance/*` serves Binance (else the SPA's HTML) */
  proxyUp: boolean;
  /** WS handshakes succeed (else the socket never opens) */
  wsUp: boolean;
  /** server time the `/futures/data/*` rows are generated for (default: the server clock) — freezes publishing */
  futuresAt?: () => number;
  /** `ticker/24hr` last price (default 84205.90) — a REST price that differs from the stream's 84206.1 */
  tickerLast?: () => number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function klineRows(iv: string, serverNow: number, limit: number, endTime?: number, startTime?: number) {
  const ms = IV[iv]!;
  const lastOpen = barOpen(Math.min(serverNow, endTime ?? serverNow), iv);
  const rows: (string | number)[][] = [];
  const n = Math.min(limit, 1500);
  let first = lastOpen - (n - 1) * ms;
  if (startTime !== undefined) first = Math.max(first, barOpen(startTime, iv) + (barOpen(startTime, iv) < startTime ? ms : 0));
  for (let t = first; t <= lastOpen; t += ms) {
    const c = 84_000 + 200 * Math.sin(t / 7_000_000);
    rows.push([t, String(c - 10), String(c + 30), String(c - 40), String(c), "100", t + ms - 1, "8400000", 1000, "50", "4200000", "0"]);
  }
  return rows;
}

function futuresRows(periodMs: number, serverNow: number, limit: number, kind: "ratio" | "taker" | "oi", endTime?: number) {
  const last = Math.floor((Math.min(serverNow, endTime ?? serverNow) - 50_000) / periodMs) * periodMs;
  const rows: Record<string, string | number>[] = [];
  for (let i = Math.min(limit, 500) - 1; i >= 0; i--) {
    const ts = last - i * periodMs;
    const x = 0.52 + 0.03 * Math.sin(ts / 3_000_000);
    if (kind === "ratio") rows.push({ symbol: "BTCUSDT", longShortRatio: String(x / (1 - x)), longAccount: String(x), shortAccount: String(1 - x), timestamp: ts });
    else if (kind === "taker") rows.push({ buySellRatio: "1.1", buyVol: "100", sellVol: "90", timestamp: ts });
    else rows.push({ symbol: "BTCUSDT", sumOpenInterest: "1000", sumOpenInterestValue: "1000000", timestamp: ts });
  }
  return rows;
}

export function makeFetch(net: Net) {
  const binanceAnswer = (u: URL): Response => {
    const sn = Date.now() + net.serverSkewMs;
    const path = u.pathname.replace(/^\/api\/binance/, "");
    const num = (k: string) => (u.searchParams.get(k) === null ? undefined : Number(u.searchParams.get(k)));
    if (path === "/fapi/v1/klines") return json(klineRows(u.searchParams.get("interval") ?? "1h", sn, num("limit") ?? 500, num("endTime"), num("startTime")));
    if (path === "/fapi/v1/premiumIndex")
      return json({ symbol: "BTCUSDT", markPrice: "84212.3", indexPrice: "84198.7", estimatedSettlePrice: "84190.1", lastFundingRate: "0.0001", interestRate: "0.0001", nextFundingTime: Math.ceil(sn / (8 * HOUR)) * 8 * HOUR, time: sn });
    if (path === "/fapi/v1/ticker/24hr")
      return json({ symbol: "BTCUSDT", priceChange: "-1123.40", priceChangePercent: "-1.316", weightedAvgPrice: "84650.12", lastPrice: String(net.tickerLast?.() ?? "84205.90"), lastQty: "0.012", openPrice: "85329.30", highPrice: "85710.00", lowPrice: "83650.10", volume: "182345.123", quoteVolume: "15435678901.23", openTime: sn - 24 * HOUR, closeTime: sn, firstId: 1, lastId: 2, count: 2 });
    if (path === "/fapi/v1/openInterest") return json({ openInterest: "78321.456", symbol: "BTCUSDT", time: sn });
    if (path === "/fapi/v1/fundingRate") {
      const last = Math.floor(sn / (8 * HOUR)) * 8 * HOUR;
      return json(Array.from({ length: 20 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: last - (19 - i) * 8 * HOUR, fundingRate: "0.0001", markPrice: "84000" })));
    }
    if (path === "/fapi/v1/time") return json({ serverTime: sn });
    if (path.startsWith("/futures/data/")) {
      const per = PERIOD[u.searchParams.get("period") ?? "1h"]!;
      const kind = path.includes("taker") ? "taker" : path.includes("openInterestHist") ? "oi" : "ratio";
      return json(futuresRows(per, net.futuresAt?.() ?? sn, num("limit") ?? 30, kind, num("endTime")));
    }
    return json({ code: -1, msg: "nf" }, 404);
  };
  const failed = (f: Fail): Response | null => {
    if (f === "typeerror") throw new TypeError("Failed to fetch");
    if (f === "timeout") throw new DOMException("The operation was aborted.", "AbortError");
    if (typeof f === "number") return json({ code: -1003, msg: "err" }, f);
    return null;
  };
  return async (url: string): Promise<Response> => {
    net.log.push({ at: Date.now(), url });
    const u = new URL(url, "https://site.invalid");
    if (u.hostname === "fapi.binance.com") return failed(net.fail(u, "binance")) ?? binanceAnswer(u);
    if (u.hostname === "api.bybit.com") {
      const r = failed(net.fail(u, "bybit"));
      if (r) return r;
      const routes: Record<string, unknown> = {
        "/v5/market/kline": bybitKline,
        "/v5/market/tickers": { ...bybitTickers, time: Date.now() },
        "/v5/market/account-ratio": bybitRatio,
        "/v5/market/open-interest": bybitOi,
        "/v5/market/funding/history": bybitFunding,
        "/v5/market/time": bybitTime,
      };
      const hit = routes[u.pathname];
      return hit ? json(hit) : json({ retCode: 10001, retMsg: "nf", result: {} });
    }
    if (u.pathname.startsWith("/api/binance/")) {
      if (!net.proxyUp) return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
      return failed(net.fail(u, "proxy")) ?? binanceAnswer(u);
    }
    throw new TypeError("unknown host");
  };
}

/** Event target with a fire() helper (only what the provider uses). */
function target<T extends object>(extra: T) {
  const map = new Map<string, Set<(ev: unknown) => void>>();
  return Object.assign(extra, {
    addEventListener: vi.fn((type: string, fn: (ev: unknown) => void) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (ev: unknown) => void) => void map.get(type)?.delete(fn)),
    fire(type: string, ev: unknown = { type }) {
      for (const fn of [...(map.get(type) ?? [])]) fn(ev);
    },
    listeners: (type: string) => map.get(type)?.size ?? 0,
  });
}

export interface SetupOpts {
  period?: string;
  proxy?: boolean;
  proxyUp?: boolean;
  preferProxy?: boolean;
  serverSkewMs?: number;
  fail?: Net["fail"];
  bookTop?: boolean;
  /** health tick interval (default 5 s) */
  tickMs?: number;
}

export function setup(o: SetupOpts = {}) {
  const net: Net = { log: [], fail: o.fail ?? (() => undefined), serverSkewMs: o.serverSkewMs ?? 0, proxyUp: o.proxyUp ?? false, wsUp: true };
  FakeSocket.all = [];
  const state = { online: true };
  const doc = target({ hidden: false });
  const win = target({});
  const provider = createMarketProvider({
    symbol: "BINANCE:BTCUSDT",
    period: o.period ?? "1h",
    preferProxy: o.preferProxy,
    bookTop: o.bookTop,
    deps: {
      fetch: makeFetch(net),
      wsFactory: (url) => new FakeSocket(url),
      kv: memoryKV(),
      documentRef: doc as unknown as Document,
      windowRef: win as unknown as Window,
      online: () => state.online,
      probeProxy: o.proxy ?? false,
      random: () => 0.5,
      timeZone: "UTC",
      tickMs: o.tickMs,
    },
  });
  /** tab hidden / visible (fires visibilitychange) */
  const setHidden = (h: boolean) => {
    doc.hidden = h;
    doc.fire("visibilitychange");
  };
  const setOnline = (on: boolean, fire = true) => {
    state.online = on;
    if (fire) win.fire(on ? "online" : "offline");
  };
  return { provider, net, doc, win, state, setHidden, setOnline };
}

export interface PumpOpts {
  /** streams that send nothing (a stalled subscription) */
  skip?: string[];
}

/**
 * One round of frames on the newest socket (opens it first when the "server" accepts handshakes): mark price, a
 * trade and every kline stream, all stamped with the SERVER clock.
 */
export function pumpWs(net: Net, o: PumpOpts = {}): void {
  const ws = FakeSocket.live();
  if (!ws) return;
  if (ws.readyState === 0) {
    if (!net.wsUp) return;
    ws.open();
  }
  const E = Date.now() + net.serverSkewMs;
  const skip = new Set(o.skip ?? []);
  if (!skip.has("markPrice"))
    ws.send({ stream: "btcusdt@markPrice@1s", data: { e: "markPriceUpdate", E, s: "BTCUSDT", p: "84212.3", i: "84198.7", P: "84190.1", r: "0.0001", T: Math.ceil(E / (8 * HOUR)) * 8 * HOUR } });
  if (!skip.has("aggTrade")) ws.send({ stream: "btcusdt@aggTrade", data: { e: "aggTrade", E, s: "BTCUSDT", a: E, p: "84206.1", q: "0.035", f: 1, l: 2, T: E - 2, m: false } });
  for (const iv of ["1m", "15m", "1h", "4h", "1w"]) {
    if (skip.has(`kline_${iv}`)) continue;
    const t = barOpen(E, iv);
    ws.send({
      stream: `btcusdt@kline_${iv}`,
      data: { e: "kline", E, s: "BTCUSDT", k: { t, T: t + IV[iv]! - 1, s: "BTCUSDT", i: iv, f: 1, L: 2, o: "84150", c: "84205.9", h: "84320", l: "84090.5", v: "12", n: 10, x: false, q: "1000000", V: "6", Q: "500000", B: "0" } },
    });
  }
}

/** Advances fake time in steps, pumping the socket before each step (`ws: false` = the stream is silent). */
export async function runFor(net: Net, ms: number, o: PumpOpts & { step?: number; ws?: boolean } = {}): Promise<void> {
  const step = o.step ?? 1_000;
  for (let t = 0; t < ms; t += step) {
    if (o.ws !== false) pumpWs(net, o);
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - t));
  }
}

export const flush = () => vi.advanceTimersByTimeAsync(0);

/** Requests whose URL contains `needle`, made at or after `since`. */
export function requests(net: Net, needle: string, since = -Infinity): URL[] {
  return net.log.filter((r) => r.at >= since && r.url.includes(needle)).map((r) => new URL(r.url, "https://site.invalid"));
}

/** Open time gaps (missing bars) in a kline series. */
export function holes(series: readonly Candle[], ivMs: number): number {
  let n = 0;
  for (let i = 1; i < series.length; i++) if (series[i]!.time - series[i - 1]!.time > ivMs) n += 1;
  return n;
}

/** REST feeds that have neither a pending poll nor (when parked) a pending probe. */
export function unarmed(p: MarketProvider): string[] {
  const h = p.getHealth();
  const now = Date.now();
  const out: string[] = [];
  for (const f of FEED_IDS) {
    if (p.specs[f].transport !== "rest") continue;
    const fh = h.feeds[f];
    const parked = fh.source === "cache" || fh.reason === "unsupported";
    if (parked ? !(h.primary.nextProbeAt !== undefined && h.primary.nextProbeAt > now - 1) : !(fh.nextRefreshAt !== undefined && fh.nextRefreshAt > now - 1)) out.push(f);
  }
  return out;
}
