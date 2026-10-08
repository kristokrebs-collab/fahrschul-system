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
 * Request classes sharing a bucket. `live` = the feeds themselves (polls, WS gap fills, REST fallback, probes): may
 * use the whole bucket. `bulk` = one-off pages (chart history, retro signal checks, the lazily polled 1D rung): may
 * only take tokens while `BULK_RESERVE` of the bucket stays free for the live feeds, so a long history scroll or a
 * batch of retro checks can never starve a live feed.
 */
export type BudgetClass = "live" | "bulk";
/** Share of every bucket reserved for `live` requests. */
export const BULK_RESERVE = 0.4;

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
  constructor(
    readonly cfg: BucketConfig,
    now: number,
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

  /** Tokens a request class must leave in the bucket (`bulk` keeps `BULK_RESERVE` free for the live feeds). */
  private floor(cls: BudgetClass): number {
    return cls === "bulk" ? this.cfg.capacity * BULK_RESERVE : 0;
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
      (Object.keys(cfg) as CostBucket[]).map((k) => [k, new TokenBucket(cfg[k], now)]),
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
