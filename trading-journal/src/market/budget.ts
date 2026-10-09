/**
 * Client-side rate budgets (Plan 4.2 "Budgets"). Rate-limit headers are not readable cross-origin,
 * so every host gets a token bucket sized to the app's *reserve* (≈10 % of the real limit — the user may
 * run the exchange in another tab on the same IP).
 */
import type { CostBucket } from "./types";

export interface BucketConfig {
  /** tokens available to this app per window */
  capacity: number;
  /** window length in ms; the bucket refills continuously at capacity / windowMs */
  windowMs: number;
}

export const BUCKETS: Record<CostBucket, BucketConfig> = {
  "binance.weight": { capacity: 240, windowMs: 60_000 }, // 2400/min, reserve 240
  "binance.futuresData": { capacity: 100, windowMs: 300_000 }, // 1000/5 min, reserve 100
  "binance.funding": { capacity: 20, windowMs: 300_000 }, // 500/5 min, reserve 20
  "bybit.ip": { capacity: 60, windowMs: 5_000 }, // 600/5 s, reserve 60
  "okx.rubik": { capacity: 2, windowMs: 2_000 }, // 5/2 s, reserve 2
  "okx.market": { capacity: 10, windowMs: 2_000 }, // 40/2 s, reserve 10
  proxy: { capacity: 60, windowMs: 60_000 },
};

/**
 * Request classes sharing a bucket. `price` = the REST stand-in for the last price while the socket is down (one
 * `ticker/24hr` every 5 s): may use the whole bucket. `live` = the other feeds (polls, WS gap fills, REST fallback,
 * probes): keep `PRICE_RESERVE` of the `PRICE_BUCKETS` free, so the price poll always finds its tokens. `bulk` = one-off pages
 * (chart history, retro signal checks, the lazily polled 1D rung): may only take tokens while `BULK_RESERVE` of the
 * bucket stays free for the live feeds, so a long history scroll or a batch of retro checks can never starve a live feed.
 */
export type BudgetClass = "price" | "live" | "bulk";
/** Share of every bucket reserved for `live` requests. */
export const BULK_RESERVE = 0.4;
/** Share of a price bucket the `live` feeds leave for the price poll (`binance.weight`: 12 of 240 = one ticker per 5 s for a minute). */
export const PRICE_RESERVE = 0.05;
/**
 * The buckets the price stand-in draws from (`ticker/24hr` on Binance, or through the EU proxy). Only these keep
 * `PRICE_RESERVE` free of `live` requests; every other bucket (OKX with 2 tokens, funding, futures data) stays whole.
 */
export const PRICE_BUCKETS: readonly CostBucket[] = ["binance.weight", "proxy"];

/** Backoff applied to a bucket after a 429 or a TypeError burst. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Binance kline weight by `limit` (Plan: 1/2/5/10). */
export function klineWeight(limit: number): number {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  private blockedUntil = 0;
  /**
   * @param priceReserve share of the bucket `live` requests leave for the `price` class (0 = none; `Budget` passes
   *   `PRICE_RESERVE` for the `PRICE_BUCKETS`)
   */
  constructor(
    readonly cfg: BucketConfig,
    now: number,
    private readonly priceReserve = 0,
  ) {
    this.tokens = cfg.capacity;
    this.last = now;
  }

  private refill(now: number): void {
    if (now <= this.last) return;
    const perMs = this.cfg.capacity / this.cfg.windowMs;
    this.tokens = Math.min(this.cfg.capacity, this.tokens + (now - this.last) * perMs);
    this.last = now;
  }

  available(now: number): number {
    this.refill(now);
    return now < this.blockedUntil ? 0 : this.tokens;
  }

  /** Tokens a request class must leave in the bucket (`bulk` keeps `BULK_RESERVE` free for the live feeds, `live` keeps `PRICE_RESERVE` for the price poll). */
  private floor(cls: BudgetClass): number {
    if (cls === "bulk") return this.cfg.capacity * BULK_RESERVE;
    if (cls === "live") return this.cfg.capacity * this.priceReserve;
    return 0;
  }

  /** Consumes `units` when possible; returns false (and consumes nothing) otherwise. */
  take(units: number, now: number, cls: BudgetClass = "live"): boolean {
    this.refill(now);
    if (now < this.blockedUntil) return false;
    if (this.tokens - units < this.floor(cls)) return false;
    this.tokens -= units;
    return true;
  }

  /** ms until `units` are available (0 when available now). */
  waitFor(units: number, now: number, cls: BudgetClass = "live"): number {
    this.refill(now);
    const block = Math.max(0, this.blockedUntil - now);
    const need = units + this.floor(cls);
    if (this.tokens >= need) return block;
    const perMs = this.cfg.capacity / this.cfg.windowMs;
    return Math.max(block, Math.ceil((need - this.tokens) / perMs));
  }

  backoff(ms: number, now: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, now + ms);
  }

  isBackingOff(now: number): boolean {
    return now < this.blockedUntil;
  }
}

export class Budget {
  private buckets: Record<CostBucket, TokenBucket>;
  constructor(now: number, cfg: Record<CostBucket, BucketConfig> = BUCKETS) {
    this.buckets = Object.fromEntries(
      (Object.keys(cfg) as CostBucket[]).map((k) => [k, new TokenBucket(cfg[k], now, PRICE_BUCKETS.includes(k) ? PRICE_RESERVE : 0)]),
    ) as Record<CostBucket, TokenBucket>;
  }
  bucket(id: CostBucket): TokenBucket {
    return this.buckets[id];
  }
  take(id: CostBucket, units: number, now: number, cls: BudgetClass = "live"): boolean {
    return this.buckets[id].take(units, now, cls);
  }
  waitFor(id: CostBucket, units: number, now: number, cls: BudgetClass = "live"): number {
    return this.buckets[id].waitFor(units, now, cls);
  }
  backoff(id: CostBucket, now: number, ms = RATE_LIMIT_BACKOFF_MS): void {
    this.buckets[id].backoff(ms, now);
  }
  isBackingOff(id: CostBucket, now: number): boolean {
    return this.buckets[id].isBackingOff(now);
  }
}
