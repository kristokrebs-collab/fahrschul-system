/**
 * OKX adapter (Plan 4.5 / 4.10). Written and unit-tested but NOT in the default chain (M0): OKX CORS
 * is unverified — the provider adds `okx` only after a successful `GET /api/v5/public/time` probe.
 * All values are strings, arrays newest-first. Top-trader cohort = top 5 % by open position value
 * (`comparable:false` vs Binance top 20 % by margin balance).
 */
import { z } from "zod";
import type { Candle, RatioPoint, Stamped, TakerPoint } from "../types";
import { FETCH_INTERVAL_MS, OKX_KLINE_BAR, toOkxPeriod, type FetchInterval, type Period } from "../period";
import { fetchJson, qs, type FetchLike } from "./http";

export const OKX_REST = "https://www.okx.com";

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));

function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ code: z.string(), msg: z.string().optional(), data }).refine((r) => r.code === "0", "code != 0");
}

export const okxCandlesSchema = envelope(z.array(z.tuple([num, num, num, num, num, num, num, num, z.string()]).rest(z.unknown())));
export const okxRatioSchema = envelope(z.array(z.tuple([num, num]).rest(z.unknown())));
export const okxTakerSchema = envelope(z.array(z.tuple([num, num, num]).rest(z.unknown())));
export const okxTimeSchema = envelope(z.array(z.object({ ts: num })));

export interface OkxOptions {
  base?: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

/** OKX gives `longShortRatio` = longs / shorts; `longPct = ratio / (1 + ratio) · 100`. */
export function ratioToLongPct(ratio: number): number {
  return (ratio / (1 + ratio)) * 100;
}

export function mapOkxCandles(rows: [number, number, number, number, number, number, number, number, string, ...unknown[]][], interval: FetchInterval): Candle[] {
  const iv = FETCH_INTERVAL_MS[interval];
  return rows
    .map(([ts, o, h, l, c, , volCcy, volQuote, confirm]) => ({ time: ts, open: o, high: h, low: l, close: c, volume: volCcy, quoteVolume: volQuote, closeTime: ts + iv - 1, closed: confirm === "1" }))
    .sort((a, b) => a.time - b.time);
}

export function mapOkxRatio(rows: [number, number, ...unknown[]][]): RatioPoint[] {
  return rows
    .map(([ts, ratio]) => {
      const longPct = ratioToLongPct(ratio);
      return { time: ts, longPct, shortPct: 100 - longPct, ratio };
    })
    .sort((a, b) => a.time - b.time);
}

export function okxRest(opts: OkxOptions = {}) {
  const base = opts.base ?? OKX_REST;
  const now = opts.now ?? (() => Date.now());
  const io = { fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  const url = (path: string, params: Record<string, string | number | undefined>) => `${base}${path}${qs(params)}`;
  const stamp = <T>(data: T, asOf: number, comparable: boolean): Stamped<T> => ({ data, asOf, receivedAt: now(), source: "okx", comparable });

  return {
    source: "okx" as const,
    async serverTime(): Promise<number> {
      const r = await fetchJson(url("/api/v5/public/time", {}), okxTimeSchema, io);
      return r.data[0]?.ts ?? now();
    },
    async candles(instId: string, interval: FetchInterval, p: { limit?: number; bar?: string } = {}): Promise<Stamped<Candle[]>> {
      const bar = p.bar ?? OKX_KLINE_BAR[interval];
      const r = await fetchJson(url("/api/v5/market/candles", { instId, bar, limit: p.limit ?? 100 }), okxCandlesSchema, io);
      const data = mapOkxCandles(r.data, interval);
      const t = now();
      const last = data[data.length - 1];
      // plain `1W` (Hong Kong aligned) is not comparable to Binance weekly candles
      return stamp(data, last ? Math.min(t, last.closeTime ?? t) : t, interval !== "1w" || bar === "1Wutc");
    },
    async globalAccountRatio(instId: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<RatioPoint[]>> {
      const r = await fetchJson(url("/api/v5/rubik/stat/contracts/long-short-account-ratio-contract", { instId, period: toOkxPeriod(period), limit: p.limit ?? 100 }), okxRatioSchema, io);
      const data = mapOkxRatio(r.data);
      return stamp(data, data[data.length - 1]?.time ?? now(), false);
    },
    async topAccountRatio(instId: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<RatioPoint[]>> {
      const r = await fetchJson(url("/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader", { instId, period: toOkxPeriod(period), limit: p.limit ?? 100 }), okxRatioSchema, io);
      const data = mapOkxRatio(r.data);
      return stamp(data, data[data.length - 1]?.time ?? now(), false);
    },
    async topPositionRatio(instId: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<RatioPoint[]>> {
      const r = await fetchJson(url("/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader", { instId, period: toOkxPeriod(period), limit: p.limit ?? 100 }), okxRatioSchema, io);
      const data = mapOkxRatio(r.data);
      return stamp(data, data[data.length - 1]?.time ?? now(), false);
    },
    /** `[ts, sellVol, buyVol]` per the docs mirror. */
    async takerVolume(instId: string, period: Period, p: { limit?: number } = {}): Promise<Stamped<TakerPoint[]>> {
      const r = await fetchJson(url("/api/v5/rubik/stat/taker-volume-contract", { instId, period: toOkxPeriod(period), limit: p.limit ?? 100 }), okxTakerSchema, io);
      const data: TakerPoint[] = r.data
        .map(([ts, sellVol, buyVol]) => ({ time: ts, buyVol, sellVol, buySellRatio: sellVol > 0 ? buyVol / sellVol : 0 }))
        .sort((a, b) => a.time - b.time);
      return stamp(data, data[data.length - 1]?.time ?? now(), false);
    },
  };
}
export type OkxRest = ReturnType<typeof okxRest>;
