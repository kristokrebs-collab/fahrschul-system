/**
 * Where the scanner's candles come from (`ScanSource` of `@/domain/scanner`):
 *  - US stocks: the stock data contract (`client.ts`) – daily candles for the flag and the RSI recovery, 5-minute candles of
 *    the last session for the opening range;
 *  - crypto: Binance USDⓈ-M klines straight from the browser (the same public REST the live feeds use, via the same-origin
 *    proxy when the direct route is blocked) – 1-day candles, or 15-minute candles of the current UTC day for the opening
 *    range ("Tagesbeginn 00:00 UTC", crypto has no exchange opening). The crypto universe is the top N USDT perpetuals by
 *    24 h quote volume.
 *
 * The crypto requests have their own token bucket (≤ 100 weight per minute, a kline page of ≤ 99 bars weighs 1, the
 * all-symbols ticker 40) – separate from the live feeds' buckets, so a scan never starves the price.
 */
import { z } from "zod";
import { cryptoTargets, type CryptoTicker, type ScanMode } from "@/domain/scanner/universe";
import type { LoadOutcome, ScanSource, ScanTarget } from "@/domain/scanner/run";
import type { SessionCtx } from "@/domain/scanner/setups";
import type { ScanCandle, Stand } from "@/domain/scanner/types";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { TokenBucket } from "../budget";
import { BINANCE_REST, binanceRest, ticker24hSchema, type BinanceRest } from "../sources/binance";
import { fetchJson, RestError, toRestError, type FetchLike } from "../sources/http";
import { PROXY_BASE, proxyRest } from "../sources/proxy";
import type { Candle } from "../types";
import { stockData } from "./client";
import { REASON_TEXT } from "./result";
import { nyParts, sessionOf } from "./session";
import type { Stamp, StockDataContract, UnavailableReason } from "./types";
import { STOCK_INTERVAL_MS, STOCK_LIMITS } from "./types";

const DAY = 86_400_000;

/* ------------------------------------------------------------------ stocks */

export const NY_SESSION = (openMs: number, closeMs: number): SessionCtx => ({ openMs, closeMs, timeZone: "America/New_York", zoneLabel: "NY", noun: "Handelssitzung" });

/** The New York session the newest candle belongs to (`undefined` for a holiday date – nothing to read). */
export function nySessionOf(candles: readonly ScanCandle[]): SessionCtx | undefined {
  const last = candles[candles.length - 1];
  if (!last) return undefined;
  const s = sessionOf(nyParts(last.time).date);
  return s ? NY_SESSION(s.openMs, s.closeMs) : undefined;
}

export function stockScanSource(mode: ScanMode, data: StockDataContract = stockData()): ScanSource {
  const interval = mode === "orb" ? "5m" : "1d";
  return {
    kind: "stock",
    interval,
    barMs: STOCK_INTERVAL_MS[interval],
    batchSize: STOCK_LIMITS.barsPerRequest * 2,
    async load(batch, signal): Promise<Record<string, LoadOutcome>> {
      const res = await data.barsMany(
        batch.map((t) => t.symbol),
        interval,
        { signal },
      );
      const out: Record<string, LoadOutcome> = {};
      for (const t of batch) {
        const r = res[t.symbol];
        if (!r) continue;
        if (r.status === "unavailable") out[t.symbol] = { ok: false, reason: r.reason, message: r.message };
        else {
          const stand: Omit<Stand, "lastBar"> = { source: r.source, receivedAt: r.receivedAt, ...(r.fetchedAt != null ? { fetchedAt: r.fetchedAt } : {}), ...(r.status === "stale" ? { stale: { reason: r.reason, message: r.message } } : {}) };
          out[t.symbol] = { ok: true, candles: r.data.candles, stand };
        }
      }
      return out;
    },
    sessionFor: mode === "orb" ? (candles) => nySessionOf(candles) : undefined,
  };
}

/* ------------------------------------------------------------------ crypto */

/** The crypto scan's own budget: ≤ 100 weight per minute. */
export const CRYPTO_BUDGET = { capacity: 100, windowMs: 60_000 } as const;

export interface CryptoDeps {
  /** direct REST client */
  rest?: () => BinanceRest;
  /** same-origin proxy client (`null` = none, e.g. the file build) */
  proxy?: () => BinanceRest | null;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const REASON_OF: Readonly<Record<string, UnavailableReason>> = {
  rate_limited: "rate-limited",
  blocked_451: "blocked",
  network: "network",
  cors: "network",
  offline: "offline",
  timeout: "timeout",
  bad_symbol: "bad-symbol",
  bad_period: "bad-response",
  http_5xx: "upstream",
};
const reasonOf = (e: RestError): UnavailableReason => REASON_OF[e.kind] ?? "upstream";

const toScan = (c: Candle): ScanCandle => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, closed: c.closed });

/** UTC day of `asOf` as the "session" of the opening range. */
export const utcDaySession = (asOf: number): SessionCtx => {
  const openMs = Math.floor(asOf / DAY) * DAY;
  return { openMs, closeMs: openMs + DAY, timeZone: "UTC", zoneLabel: "UTC", noun: "UTC-Tag" };
};

export interface CryptoQuote {
  symbol: string;
  price: number;
  /** 24 h change in percent */
  changePct: number;
  quoteVolume: number;
}

type CryptoAnswer<T> = { ok: true; data: T; stamp: Stamp } | { ok: false; reason: UnavailableReason; message: string };
type TickerRow = z.infer<typeof ticker24hSchema>;

export interface CryptoClient {
  /** the top `n` USDT perpetuals by 24 h quote volume */
  top(n: number, signal?: AbortSignal): Promise<{ ok: true; targets: ScanTarget[]; stamp: Stamp } | { ok: false; reason: UnavailableReason; message: string }>;
  /** last price and 24 h change of the given pairs (one request for all markets, reused for 15 s) */
  quotes(symbols: readonly string[], signal?: AbortSignal): Promise<CryptoAnswer<Record<string, CryptoQuote>>>;
  source(mode: ScanMode): ScanSource;
}

export function createCryptoClient(deps: CryptoDeps = {}): CryptoClient {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const direct = deps.rest ?? ((): BinanceRest => binanceRest({ ...(deps.fetch ? { fetch: deps.fetch } : {}), now }));
  const proxy = deps.proxy ?? ((): BinanceRest | null => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest({ ...(deps.fetch ? { fetch: deps.fetch } : {}), now })));
  const bucket = new TokenBucket(CRYPTO_BUDGET, now());
  let viaProxy = false;

  const take = async (units: number, signal?: AbortSignal): Promise<void> => {
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const t = now();
      if (bucket.take(units, t, "price")) return;
      await sleep(Math.max(250, bucket.waitFor(units, t, "price")));
    }
  };

  /** runs `fn` on the direct route, then on the proxy for the rest of the session when the direct route is blocked / unreadable */
  async function route<T>(fn: (c: BinanceRest) => Promise<T>): Promise<T> {
    const client = viaProxy ? proxy() : direct();
    if (!client) throw new RestError("network", "Kein Zugang zu Binance.");
    try {
      return await fn(client);
    } catch (err) {
      const e = toRestError(err);
      if (e.kind === "rate_limited") bucket.backoff(60_000, now());
      if (!viaProxy && (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors") && proxy()) {
        viaProxy = true;
        return route(fn);
      }
      throw e;
    }
  }

  const tickerFetch: FetchLike = deps.fetch ?? ((u, i) => fetch(u, i));

  let memo: { at: number; rows: TickerRow[]; via: string } | null = null;
  /** the exchange's 24 h tickers of all markets: one request (weight 40), reused for 15 s */
  const tickers = async (signal?: AbortSignal): Promise<CryptoAnswer<TickerRow[]>> => {
    const t0 = now();
    if (memo && t0 - memo.at < 15_000) return { ok: true, data: memo.rows, stamp: { source: memo.via, asOf: memo.at, receivedAt: memo.at } };
    try {
      await take(40, signal);
      const rows = await route(async () => fetchJson(`${viaProxy ? PROXY_BASE : BINANCE_REST}/fapi/v1/ticker/24hr`, z.array(ticker24hSchema), { fetch: tickerFetch, timeoutMs: 15_000, ...(signal ? { signal } : {}) }));
      const t = now();
      const via = viaProxy ? "proxy" : "binance";
      memo = { at: t, rows, via };
      return { ok: true, data: rows, stamp: { source: via, asOf: t, receivedAt: t } };
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError") return { ok: false, reason: "aborted", message: REASON_TEXT.aborted };
      const e = toRestError(err);
      const reason = reasonOf(e);
      return { ok: false, reason, message: e.kind === "blocked_451" ? "Binance ist von hier aus nicht erreichbar (HTTP 451)." : e.kind === "rate_limited" ? "Binance begrenzt die Abrufe gerade." : REASON_TEXT[reason] };
    }
  };

  return {
    async top(n, signal) {
      const r = await tickers(signal);
      if (!r.ok) return r;
      const rows: CryptoTicker[] = r.data.map((x) => ({ symbol: x.symbol, quoteVolume: x.quoteVolume }));
      const targets = cryptoTargets(rows, n);
      if (!targets.length) return { ok: false, reason: "no-data", message: "Binance hat keine USDT-Kontrakte mit Handelsvolumen gemeldet." };
      return { ok: true, targets, stamp: r.stamp };
    },
    async quotes(symbols, signal) {
      const r = await tickers(signal);
      if (!r.ok) return r;
      const want = new Set(symbols);
      const data: Record<string, CryptoQuote> = {};
      for (const x of r.data) if (want.has(x.symbol)) data[x.symbol] = { symbol: x.symbol, price: x.lastPrice, changePct: x.priceChangePercent, quoteVolume: x.quoteVolume };
      return { ok: true, data, stamp: r.stamp };
    },
    source(mode) {
      const interval = mode === "orb" ? "15m" : "1d";
      return {
        kind: "crypto",
        interval,
        barMs: interval === "15m" ? 900_000 : DAY,
        batchSize: 6,
        async load(batch, signal): Promise<Record<string, LoadOutcome>> {
          const out: Record<string, LoadOutcome> = {};
          for (const t of batch) {
            if (signal.aborted) break;
            try {
              await take(1, signal);
              const r = await route((c) => c.klines(t.symbol, interval, { limit: 99 }));
              const receivedAt = now();
              out[t.symbol] = { ok: true, candles: r.data.map(toScan), stand: { source: r.source, receivedAt, fetchedAt: receivedAt } };
            } catch (err) {
              if (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError") break;
              const e = toRestError(err);
              const reason = reasonOf(e);
              out[t.symbol] = { ok: false, reason, message: REASON_TEXT[reason] };
            }
          }
          return out;
        },
        sessionFor: mode === "orb" ? (_candles, asOf) => utcDaySession(asOf) : undefined,
      };
    },
  };
}

let sharedCrypto: CryptoClient | null = null;
export function cryptoClient(): CryptoClient {
  sharedCrypto ??= createCryptoClient();
  return sharedCrypto;
}
export function resetCryptoClientForTests(): void {
  sharedCrypto = null;
}
