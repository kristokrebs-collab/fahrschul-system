/**
 * Bybit v5 REST fallback (Plan 4.5). Base `https://api.bybit.com`, `category=linear`.
 * Price/candles/funding of the BTCUSDT perp are `comparable:true`; ratios and OI are `comparable:false`
 * (different population). Top-trader ratios and taker volume do not exist on Bybit.
 */
import { z } from "zod";
import type { BookTop, Candle, FundingPoint, MarkPrice, OpenInterest, OpenInterestPoint, RatioPoint, Stamped, Ticker24h } from "../types";
import { BYBIT_KLINE_INTERVAL, INTERVAL_MS, toBybitPeriod, type KlineInterval, type Period } from "../period";
import { fetchJson, qs, type FetchLike } from "./http";

export const BYBIT_REST = "https://api.bybit.com";

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));

function envelope<T extends z.ZodTypeAny>(result: T) {
  return z.object({ retCode: z.number(), retMsg: z.string().optional(), result, time: z.number().optional() }).refine((r) => r.retCode === 0, "retCode != 0");
}

export const bybitKlineSchema = envelope(z.object({ symbol: z.string().optional(), list: z.array(z.tuple([num, num, num, num, num, num, num])) }));
export const bybitTickersSchema = envelope(
  z.object({
    list: z.array(
      z.object({
        symbol: z.string(),
        lastPrice: num,
        indexPrice: num,
        markPrice: num,
        price24hPcnt: num,
        highPrice24h: num,
        lowPrice24h: num,
        openInterest: num,
        turnover24h: num,
        volume24h: num,
        fundingRate: num,
        nextFundingTime: num,
        bid1Price: num,
        ask1Price: num,
      }),
    ),
  }),
);
export const bybitAccountRatioSchema = envelope(z.object({ list: z.array(z.object({ symbol: z.string().optional(), buyRatio: num, sellRatio: num, timestamp: num })) }));
export const bybitOpenInterestSchema = envelope(z.object({ list: z.array(z.object({ openInterest: num, timestamp: num })) }));
export const bybitFundingSchema = envelope(z.object({ list: z.array(z.object({ symbol: z.string().optional(), fundingRate: num, fundingRateTimestamp: num })) }));
export const bybitTimeSchema = envelope(z.object({ timeSecond: num, timeNano: num.optional() }));

export interface BybitTickerBundle {
  markPrice: MarkPrice;
  bookTop: BookTop;
  ticker24h: Ticker24h;
  openInterest: OpenInterest;
  lastPrice: number;
  time: number;
}

export interface BybitOptions {
  base?: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export function mapBybitKlines(list: [number, number, number, number, number, number, number][], interval: KlineInterval, now: number): Candle[] {
  const iv = INTERVAL_MS[interval];
  return list
    .map(([t, o, h, l, c, v, q]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v, quoteVolume: q, closeTime: t + iv - 1, closed: t + iv <= now }))
    .sort((a, b) => a.time - b.time);
}

export function bybitRest(opts: BybitOptions = {}) {
  const base = opts.base ?? BYBIT_REST;
  const now = opts.now ?? (() => Date.now());
  const io = { fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  const url = (path: string, params: Record<string, string | number | undefined>) => `${base}${path}${qs(params)}`;
  const stamp = <T>(data: T, asOf: number, comparable: boolean): Stamped<T> => ({ data, asOf, receivedAt: now(), source: "bybit", comparable });

  return {
    source: "bybit" as const,
    /** Probe used for blocked-primary detection (Plan 4.4). */
    async serverTime(): Promise<number> {
      const r = await fetchJson(url("/v5/market/time", {}), bybitTimeSchema, io);
      return r.result.timeSecond * 1000;
    },
    async klines(symbol: string, interval: KlineInterval, p: { limit?: number; start?: number; end?: number } = {}): Promise<Stamped<Candle[]>> {
      const r = await fetchJson(url("/v5/market/kline", { category: "linear", symbol, interval: BYBIT_KLINE_INTERVAL[interval], limit: p.limit ?? 200, start: p.start, end: p.end }), bybitKlineSchema, io);
      const t = now();
      const data = mapBybitKlines(r.result.list, interval, t);
      const last = data[data.length - 1];
      return stamp(data, last ? Math.min(t, last.closeTime ?? t) : t, true);
    },
    /** One call replaces premiumIndex + openInterest + ticker/24hr + bookTicker. */
    async tickers(symbol: string): Promise<Stamped<BybitTickerBundle>> {
      const r = await fetchJson(url("/v5/market/tickers", { category: "linear", symbol }), bybitTickersSchema, io);
      const row = r.result.list[0];
      if (!row) throw new Error("Bybit tickers: leer");
      const t = r.time ?? now();
      const bundle: BybitTickerBundle = {
        markPrice: { markPrice: row.markPrice, indexPrice: row.indexPrice, fundingRate: row.fundingRate, nextFundingTime: row.nextFundingTime, time: t },
        bookTop: { bid: row.bid1Price, ask: row.ask1Price, time: t },
        ticker24h: { lastPrice: row.lastPrice, priceChangePercent: row.price24hPcnt * 100, high: row.highPrice24h, low: row.lowPrice24h, volume: row.volume24h, quoteVolume: row.turnover24h, time: t },
        openInterest: { openInterest: row.openInterest, time: t },
        lastPrice: row.lastPrice,
        time: t,
      };
      return stamp(bundle, t, true);
    },
    /** All-account long/short share ≈ Binance `globalLongShortAccountRatio` (`comparable:false`). */
    async accountRatio(symbol: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<RatioPoint[]> & { detail?: string }> {
      const m = toBybitPeriod(period);
      const r = await fetchJson(url("/v5/market/account-ratio", { category: "linear", symbol, period: m.value, limit: p.limit ?? 50 }), bybitAccountRatioSchema, io);
      const data: RatioPoint[] = r.result.list
        .map((x) => ({ time: x.timestamp, longPct: x.buyRatio * 100, shortPct: x.sellRatio * 100, ratio: x.sellRatio > 0 ? x.buyRatio / x.sellRatio : 0 }))
        .sort((a, b) => a.time - b.time);
      return { ...stamp(data, data[data.length - 1]?.time ?? now(), false), detail: m.detail };
    },
    async openInterestHist(symbol: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<OpenInterestPoint[]> & { detail?: string }> {
      const m = toBybitPeriod(period);
      const r = await fetchJson(url("/v5/market/open-interest", { category: "linear", symbol, intervalTime: m.value, limit: p.limit ?? 50 }), bybitOpenInterestSchema, io);
      const data: OpenInterestPoint[] = r.result.list.map((x) => ({ time: x.timestamp, openInterest: x.openInterest, openInterestValue: NaN })).sort((a, b) => a.time - b.time);
      return { ...stamp(data, data[data.length - 1]?.time ?? now(), false), detail: m.detail };
    },
    async fundingHistory(symbol: string, p: { limit?: number } = {}): Promise<Stamped<FundingPoint[]>> {
      const r = await fetchJson(url("/v5/market/funding/history", { category: "linear", symbol, limit: p.limit ?? 200 }), bybitFundingSchema, io);
      const data: FundingPoint[] = r.result.list.map((x) => ({ time: x.fundingRateTimestamp, fundingRate: x.fundingRate })).sort((a, b) => a.time - b.time);
      return stamp(data, data[data.length - 1]?.time ?? now(), true);
    },
  };
}
export type BybitRest = ReturnType<typeof bybitRest>;
