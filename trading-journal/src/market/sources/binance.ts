/**
 * Binance USDⓈ-M futures (Plan 4.2). REST base `https://fapi.binance.com`, WS `wss://fstream.binance.com`.
 * Every response is validated with zod and mapped onto the `FeedValue` shapes. Numbers arrive as strings.
 */
import { z } from "zod";
import type { AggTrade, BookTop, Candle, FundingPoint, MarkPrice, OpenInterest, OpenInterestPoint, RatioPoint, Source, Stamped, TakerPoint, Ticker24h } from "../types";
import type { KlineInterval, Period } from "../period";
import { INTERVAL_MS } from "../period";
import { fetchJson, qs, type FetchLike } from "./http";

export const BINANCE_REST = "https://fapi.binance.com";
export const BINANCE_WS = "wss://fstream.binance.com/stream?streams=";

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const finite = num.refine((v) => Number.isFinite(v), "not a finite number");

// ------------------------------------------------------------------ schemas

export const klineTuple = z.tuple([z.number(), num, num, num, num, num, z.number(), num, z.number(), num, num, z.unknown()]);
export const klinesSchema = z.array(klineTuple);

export const premiumIndexSchema = z.object({
  symbol: z.string(),
  markPrice: finite,
  indexPrice: finite,
  lastFundingRate: num,
  nextFundingTime: z.number(),
  time: z.number(),
});

export const ticker24hSchema = z.object({
  symbol: z.string(),
  priceChangePercent: num,
  lastPrice: finite,
  highPrice: num,
  lowPrice: num,
  volume: num,
  quoteVolume: num,
  closeTime: z.number(),
});

export const openInterestSchema = z.object({ openInterest: finite, symbol: z.string(), time: z.number() });

export const ratioRowSchema = z.object({
  symbol: z.string().optional(),
  longShortRatio: num,
  longAccount: num,
  shortAccount: num,
  timestamp: num,
});
export const ratioSchema = z.array(ratioRowSchema);

export const takerRowSchema = z.object({ buySellRatio: num, buyVol: num, sellVol: num, timestamp: num });
export const takerSchema = z.array(takerRowSchema);

export const oiHistRowSchema = z.object({
  symbol: z.string().optional(),
  sumOpenInterest: num,
  sumOpenInterestValue: num,
  timestamp: num,
});
export const oiHistSchema = z.array(oiHistRowSchema);

export const fundingRowSchema = z.object({ symbol: z.string().optional(), fundingTime: z.number(), fundingRate: num, markPrice: num.optional() });
export const fundingSchema = z.array(fundingRowSchema);

export const serverTimeSchema = z.object({ serverTime: z.number() });

// ------------------------------------------------------------------ mappers

export function mapKline(t: z.infer<typeof klineTuple>, now: number): Candle {
  return {
    time: t[0],
    open: t[1],
    high: t[2],
    low: t[3],
    close: t[4],
    volume: t[5],
    closeTime: t[6],
    quoteVolume: t[7],
    trades: t[8],
    takerBuyBase: t[9],
    closed: t[6] < now,
  };
}

export function mapRatio(rows: z.infer<typeof ratioSchema>): RatioPoint[] {
  return rows.map((r) => ({ time: r.timestamp, longPct: r.longAccount * 100, shortPct: r.shortAccount * 100, ratio: r.longShortRatio })).sort((a, b) => a.time - b.time);
}
export function mapTaker(rows: z.infer<typeof takerSchema>): TakerPoint[] {
  return rows.map((r) => ({ time: r.timestamp, buyVol: r.buyVol, sellVol: r.sellVol, buySellRatio: r.buySellRatio })).sort((a, b) => a.time - b.time);
}
export function mapOiHist(rows: z.infer<typeof oiHistSchema>): OpenInterestPoint[] {
  return rows.map((r) => ({ time: r.timestamp, openInterest: r.sumOpenInterest, openInterestValue: r.sumOpenInterestValue })).sort((a, b) => a.time - b.time);
}
export function mapFunding(rows: z.infer<typeof fundingSchema>): FundingPoint[] {
  return rows.map((r) => ({ time: r.fundingTime, fundingRate: r.fundingRate })).sort((a, b) => a.time - b.time);
}
export function mapPremiumIndex(p: z.infer<typeof premiumIndexSchema>): MarkPrice {
  return { markPrice: p.markPrice, indexPrice: p.indexPrice, fundingRate: p.lastFundingRate, nextFundingTime: p.nextFundingTime, time: p.time };
}
export function mapTicker24h(t: z.infer<typeof ticker24hSchema>): Ticker24h {
  return { lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent, high: t.highPrice, low: t.lowPrice, volume: t.volume, quoteVolume: t.quoteVolume, time: t.closeTime };
}

// ------------------------------------------------------------------ REST client

export type RatioKind = "topPositionRatio" | "topAccountRatio" | "globalAccountRatio";
export const RATIO_PATH: Record<RatioKind, string> = {
  topPositionRatio: "/futures/data/topLongShortPositionRatio",
  topAccountRatio: "/futures/data/topLongShortAccountRatio",
  globalAccountRatio: "/futures/data/globalLongShortAccountRatio",
};

export interface BinanceRestOptions {
  base?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** provenance stamped onto results (`proxy` when routed through the Netlify function) */
  source?: Source;
  timeoutMs?: number;
}

function stamp<T>(data: T, asOf: number, now: number, source: Source): Stamped<T> {
  return { data, asOf, receivedAt: now, source, comparable: true };
}

export function binanceRest(opts: BinanceRestOptions = {}) {
  const base = opts.base ?? BINANCE_REST;
  const now = opts.now ?? (() => Date.now());
  const source: Source = opts.source ?? "binance";
  const io = { fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  const url = (path: string, params: Record<string, string | number | undefined>) => `${base}${path}${qs(params)}`;

  return {
    source,
    async serverTime(): Promise<number> {
      return (await fetchJson(url("/fapi/v1/time", {}), serverTimeSchema, io)).serverTime;
    },
    async klines(symbol: string, interval: KlineInterval, p: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Stamped<Candle[]>> {
      const rows = await fetchJson(url("/fapi/v1/klines", { symbol, interval, limit: p.limit ?? 499, startTime: p.startTime, endTime: p.endTime }), klinesSchema, io);
      const t = now();
      const data = rows.map((r) => mapKline(r, t));
      const last = data[data.length - 1];
      return stamp(data, last ? Math.min(t, last.closeTime ?? last.time + INTERVAL_MS[interval]) : t, t, source);
    },
    async premiumIndex(symbol: string): Promise<Stamped<MarkPrice>> {
      const p = await fetchJson(url("/fapi/v1/premiumIndex", { symbol }), premiumIndexSchema, io);
      return stamp(mapPremiumIndex(p), p.time, now(), source);
    },
    async ticker24h(symbol: string): Promise<Stamped<Ticker24h>> {
      const t = await fetchJson(url("/fapi/v1/ticker/24hr", { symbol }), ticker24hSchema, io);
      return stamp(mapTicker24h(t), t.closeTime, now(), source);
    },
    async openInterest(symbol: string): Promise<Stamped<OpenInterest>> {
      const o = await fetchJson(url("/fapi/v1/openInterest", { symbol }), openInterestSchema, io);
      return stamp({ openInterest: o.openInterest, time: o.time }, o.time, now(), source);
    },
    async openInterestHist(symbol: string, period: Period, p: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Stamped<OpenInterestPoint[]>> {
      const rows = await fetchJson(url("/futures/data/openInterestHist", { symbol, period, limit: p.limit ?? 30, startTime: p.startTime, endTime: p.endTime }), oiHistSchema, io);
      const data = mapOiHist(rows);
      return stamp(data, data[data.length - 1]?.time ?? now(), now(), source);
    },
    async ratio(kind: RatioKind, symbol: string, period: Period, p: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Stamped<RatioPoint[]>> {
      const rows = await fetchJson(url(RATIO_PATH[kind], { symbol, period, limit: p.limit ?? 30, startTime: p.startTime, endTime: p.endTime }), ratioSchema, io);
      const data = mapRatio(rows);
      return stamp(data, data[data.length - 1]?.time ?? now(), now(), source);
    },
    async takerRatio(symbol: string, period: Period, p: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Stamped<TakerPoint[]>> {
      const rows = await fetchJson(url("/futures/data/takerlongshortRatio", { symbol, period, limit: p.limit ?? 30, startTime: p.startTime, endTime: p.endTime }), takerSchema, io);
      const data = mapTaker(rows);
      return stamp(data, data[data.length - 1]?.time ?? now(), now(), source);
    },
    async fundingRate(symbol: string, p: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Stamped<FundingPoint[]>> {
      const rows = await fetchJson(url("/fapi/v1/fundingRate", { symbol, limit: p.limit ?? 200, startTime: p.startTime, endTime: p.endTime }), fundingSchema, io);
      const data = mapFunding(rows);
      return stamp(data, data[data.length - 1]?.time ?? now(), now(), source);
    },
  };
}
export type BinanceRest = ReturnType<typeof binanceRest>;

// ------------------------------------------------------------------ WebSocket messages
//
// Hot path (aggTrade at tens of frames per second, bookTicker faster): no zod here. The combined-stream name
// selects exactly ONE hand-written guard; a raw payload (no envelope) is dispatched by its event type `e`.
// Numbers arrive as strings and must be finite, otherwise the frame is reported as `unknown`.

export type WsEvent =
  | { kind: "kline"; interval: KlineInterval; candle: Candle; eventTime: number }
  | { kind: "markPrice"; value: MarkPrice }
  | { kind: "aggTrade"; value: AggTrade }
  | { kind: "bookTop"; value: BookTop }
  | { kind: "unknown"; stream?: string };

type WsKind = "kline" | "markPrice" | "aggTrade" | "bookTop";
type Rec = Record<string, unknown>;

const INTERVALS = new Set<string>(["1m", "1h", "4h", "1w"]);

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** Binance number field (string or number) → finite number, else `NaN`. */
const toNum = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `btcusdt@kline_1h` → kline, `@markPrice@1s` → markPrice, `@aggTrade`, `@bookTicker`; anything else → null. */
export function wsStreamKind(stream: string): WsKind | null {
  const at = stream.indexOf("@");
  if (at < 0) return null;
  const rest = stream.slice(at + 1);
  if (rest.startsWith("kline_")) return "kline";
  if (rest === "aggTrade") return "aggTrade";
  if (rest === "bookTicker") return "bookTop";
  if (rest === "markPrice" || rest.startsWith("markPrice@")) return "markPrice";
  return null;
}

function payloadKind(d: Rec): WsKind | null {
  switch (d.e) {
    case "kline":
      return "kline";
    case "aggTrade":
      return "aggTrade";
    case "markPriceUpdate":
      return "markPrice";
    case "bookTicker":
      return "bookTop";
    case undefined:
      // raw bookTicker frames may omit `e`
      return "u" in d && "b" in d && "a" in d ? "bookTop" : null;
    default:
      return null;
  }
}

function parseKline(d: Rec): WsEvent | null {
  const k = d.k;
  if (d.e !== "kline" || !isInt(d.E) || !isRec(k) || !isInt(k.t) || !isInt(k.T) || typeof k.i !== "string" || typeof k.x !== "boolean" || !isInt(k.n)) return null;
  if (!INTERVALS.has(k.i)) return null;
  const open = toNum(k.o);
  const close = toNum(k.c);
  const high = toNum(k.h);
  const low = toNum(k.l);
  const volume = toNum(k.v);
  const quoteVolume = toNum(k.q);
  const takerBuyBase = toNum(k.V);
  if (![open, close, high, low, volume, quoteVolume, takerBuyBase].every(Number.isFinite)) return null;
  return {
    kind: "kline",
    interval: k.i as KlineInterval,
    eventTime: d.E,
    candle: { time: k.t, open, high, low, close, volume, closed: k.x, closeTime: k.T, quoteVolume, trades: k.n, takerBuyBase },
  };
}

function parseMarkPrice(d: Rec): WsEvent | null {
  if (d.e !== "markPriceUpdate" || !isInt(d.E) || !isInt(d.T)) return null;
  const markPrice = toNum(d.p);
  const indexPrice = toNum(d.i);
  const fundingRate = toNum(d.r);
  if (!Number.isFinite(markPrice) || !Number.isFinite(indexPrice) || !Number.isFinite(fundingRate)) return null;
  return { kind: "markPrice", value: { markPrice, indexPrice, fundingRate, nextFundingTime: d.T, time: d.E } };
}

function parseAggTrade(d: Rec): WsEvent | null {
  if (d.e !== "aggTrade" || !isInt(d.T) || typeof d.m !== "boolean") return null;
  const price = toNum(d.p);
  const qty = toNum(d.q);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
  return { kind: "aggTrade", value: { price, qty, isBuyerMaker: d.m, time: d.T } };
}

function parseBookTicker(d: Rec): WsEvent | null {
  if ((d.e !== undefined && d.e !== "bookTicker") || !isInt(d.u)) return null;
  const bid = toNum(d.b);
  const ask = toNum(d.a);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  const time = isInt(d.T) ? d.T : isInt(d.E) ? d.E : 0;
  return { kind: "bookTop", value: { bid, ask, time } };
}

const PARSERS: Record<WsKind, (d: Rec) => WsEvent | null> = {
  kline: parseKline,
  markPrice: parseMarkPrice,
  aggTrade: parseAggTrade,
  bookTop: parseBookTicker,
};

/** Parses one combined-stream frame (`{stream, data}`) or a raw payload. Returns `null` for invalid JSON. */
export function parseWsMessage(raw: string): WsEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  let stream: string | undefined;
  let payload: unknown = json;
  if (isRec(json) && typeof json.stream === "string") {
    stream = json.stream;
    payload = json.data;
  }
  if (!isRec(payload)) return { kind: "unknown", stream };
  const kind = stream !== undefined ? wsStreamKind(stream) : payloadKind(payload);
  return (kind && PARSERS[kind](payload)) ?? { kind: "unknown", stream };
}

/** Static combined-stream URL: no SUBSCRIBE frames are ever sent. */
export function buildStreamUrl(symbol: string, opts: { bookTop?: boolean; base?: string } = {}): string {
  const s = symbol.toLowerCase();
  const streams = [`${s}@kline_1m`, `${s}@kline_1h`, `${s}@kline_4h`, `${s}@kline_1w`, `${s}@markPrice@1s`, `${s}@aggTrade`];
  if (opts.bookTop) streams.push(`${s}@bookTicker`);
  return `${opts.base ?? BINANCE_WS}${streams.join("/")}`;
}
