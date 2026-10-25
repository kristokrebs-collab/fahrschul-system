/**
 * Market data of the e-mail alarm: Binance USDⓈ-M futures, PUBLIC REST only (no key, GET only) – the same client the app
 * uses in the browser (`src/market/sources/binance.ts`). Per run: ONE request for the prices of all symbols
 * (`/fapi/v1/ticker/price` without a symbol) and one candle request per symbol and source feed – never per level or
 * per account.
 *
 * Geo-block: Binance answers 451 to some data-centre regions. The first base is `https://fapi.binance.com`; on 451 / a
 * network failure the run falls back to the app's own same-origin proxy (`SITE_ORIGIN/api/binance`, the rewrites of
 * `netlify.toml`) and keeps using whichever worked. When both fail the run says so (`binance_451` / `binance_down`) and
 * changes nothing – a level without candles is never evaluated, never guessed.
 */
import { z } from "zod";
import { KEY_TF_SOURCE, type TfFeed } from "../../../../src/domain/keylevels/timeframes";
import { KEY_TF_MS, type KeyTf } from "../../../../src/domain/keylevels/types";
import { BINANCE_REST, binanceRest } from "../../../../src/market/sources/binance";
import { fetchJson, RestError, type FetchLike } from "../../../../src/market/sources/http";
import type { FetchInterval } from "../../../../src/market/period";
import type { Candle, Source } from "../../../../src/market/types";

const INTERVAL_OF: Readonly<Record<TfFeed, FetchInterval>> = { kline_15m: "15m", kline_1h: "1h", kline_4h: "4h", kline_1d: "1d", kline_1w: "1w" };
/** The most source candles a feed asks for – the rings of the browser's provider (`src/market/README.md`). */
export const FEED_BAR_CAP: Readonly<Record<TfFeed, number>> = { kline_15m: 1500, kline_1h: 499, kline_4h: 499, kline_1d: 1000, kline_1w: 200 };
/** The fewest: enough for the ATR(14), `closes` ≤ 10 and a retest. */
export const FEED_BAR_MIN = 60;

const priceRows = z.array(z.object({ symbol: z.string(), price: z.union([z.number(), z.string()]).transform(Number) }));

export type MarketErrorCode = "binance_451" | "binance_down";

/** The code of a failed request (what the log and the status show – no URL, no body). */
export function marketErrorCode(e: unknown): MarketErrorCode {
  return e instanceof RestError && e.kind === "blocked_451" ? "binance_451" : "binance_down";
}

export interface MarketOptions {
  fetch?: FetchLike;
  /** the run's clock (candles are `closed` relative to it) */
  now: () => number;
  /** absolute base of the app's own proxy (`https://site/api/binance`), or `null` */
  proxyBase?: string | null;
  timeoutMs?: number;
}

export interface Market {
  /** last price of every futures symbol */
  prices(): Promise<Map<string, number>>;
  /** the newest `limit` candles of the source feed (the last may be forming) */
  sourceBars(symbol: string, feed: TfFeed, limit: number): Promise<Candle[]>;
  /** which base answered last (`null` before the first answer) */
  source(): Source | null;
  /** HTTP requests made so far */
  requests(): number;
}

export function createMarket(opts: MarketOptions): Market {
  const bases: { base: string; source: Source }[] = [{ base: BINANCE_REST, source: "binance" }];
  if (opts.proxyBase) bases.push({ base: opts.proxyBase.replace(/\/+$/, ""), source: "proxy" });
  let active = 0;
  let used: Source | null = null;
  let count = 0;
  const f: FetchLike = (input, init) => {
    count += 1;
    return (opts.fetch ?? ((i, n) => fetch(i, n)))(input, init);
  };
  const timeoutMs = opts.timeoutMs ?? 7_000;

  /** Runs `fn` against the active base; a blocked / unreachable base moves on to the next one. */
  async function viaBase<T>(fn: (b: (typeof bases)[number]) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < bases.length; i++) {
      const at = (active + i) % bases.length;
      try {
        const out = await fn(bases[at]!);
        active = at;
        used = bases[at]!.source;
        return out;
      } catch (e) {
        last = e;
        // a symbol Binance does not know or a rate limit is no reason to try another door
        if (e instanceof RestError && (e.kind === "bad_symbol" || e.kind === "bad_period" || e.kind === "rate_limited")) throw e;
      }
    }
    throw last;
  }

  return {
    async prices() {
      const rows = await viaBase((b) => fetchJson(`${b.base}/fapi/v1/ticker/price`, priceRows, { fetch: f, timeoutMs }));
      const out = new Map<string, number>();
      for (const r of rows) if (Number.isFinite(r.price) && r.price > 0) out.set(r.symbol, r.price);
      return out;
    },
    async sourceBars(symbol, feed, limit) {
      const res = await viaBase((b) => binanceRest({ base: b.base, fetch: f, now: opts.now, source: b.source, timeoutMs }).klines(symbol, INTERVAL_OF[feed], { limit }));
      return res.data;
    },
    source: () => used,
    requests: () => count,
  };
}

/** Source candles a level of `tf` needs when it counts from `since`: everything since then plus the ATR run-up, within the feed's cap. */
export function barsNeeded(tf: KeyTf, since: number | null, now: number): number {
  const src = KEY_TF_SOURCE[tf];
  const perBar = Math.max(1, Math.round(KEY_TF_MS[tf] / src.srcMs));
  const span = since == null ? 50 * perBar : Math.ceil((now - since) / src.srcMs) + perBar;
  return Math.min(FEED_BAR_CAP[src.feed], Math.max(FEED_BAR_MIN, span + 30));
}
