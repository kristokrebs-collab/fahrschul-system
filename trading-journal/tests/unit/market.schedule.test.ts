import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextAlignedAt, currentBoundary, wsBackoffMs, probeBackoffMs, failureRetryMs, nonAdvanceRetries, Scheduler, type TimerHost } from "@/market/schedule";
import { buildFeedSpecs } from "@/market/feeds";
import { Budget, TokenBucket, BUCKETS, klineWeight } from "@/market/budget";
import { upsertSeries, MarketCache, memoryKV, cacheKey } from "@/market/cache";
import type { Candle, RatioPoint } from "@/market/types";

const FIVE = 300_000;

describe("aligned schedule", () => {
  const spec = { alignMs: FIVE, lagMs: 60_000, jitterMs: 45_000 };
  it("lands 60–105 s after the current boundary when that is still ahead", () => {
    const boundary = 1790762400000; // 10:00:00
    const now = boundary + 10_000;
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const at = nextAlignedAt(now, spec, () => r);
      expect(at - boundary).toBeGreaterThanOrEqual(60_000);
      expect(at - boundary).toBeLessThan(105_000);
      expect(at).toBeGreaterThan(now);
    }
  });
  it("moves to the next boundary when the slot already passed", () => {
    const boundary = 1790762400000;
    const now = boundary + 200_000; // 10:03:20
    const at = nextAlignedAt(now, spec, () => 0);
    expect(at).toBe(boundary + FIVE + 60_000);
  });
  it("is strictly in the future at the exact slot", () => {
    const boundary = 1790762400000;
    expect(nextAlignedAt(boundary + 60_000, spec, () => 0)).toBe(boundary + FIVE + 60_000);
    expect(currentBoundary(boundary + 123_456, FIVE)).toBe(boundary);
  });
  it("works without lag/jitter", () => {
    expect(nextAlignedAt(1000, { alignMs: 500 })).toBe(1500);
  });
});

describe("backoff math", () => {
  it("ws backoff grows 1, 2, 4 … s, is capped at 30 s, and its small jitter never retries at once", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map((n) => wsBackoffMs(n, () => 0))).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(wsBackoffMs(0, () => 0.5)).toBe(1125); // + ≤ 25 % of the step
    expect(wsBackoffMs(3, () => 0.999)).toBe(8999); // + ≤ 1 s
    expect(wsBackoffMs(4, () => 0.999)).toBe(16_999);
    expect(wsBackoffMs(10, () => 0.999)).toBe(30_000); // never above the cap
    expect(wsBackoffMs(-1, () => 0)).toBe(1000);
  });
  it("probe backoff doubles from 5 min and caps at 60 min", () => {
    expect(probeBackoffMs(0)).toBe(5 * 60_000);
    expect(probeBackoffMs(1)).toBe(10 * 60_000);
    expect(probeBackoffMs(3)).toBe(40 * 60_000);
    expect(probeBackoffMs(4)).toBe(60 * 60_000);
    expect(probeBackoffMs(9)).toBe(60 * 60_000);
  });
});

describe("ratio polling cadence", () => {
  it("soft failures back off 15 s → 30 s → 60 s → 2 min, then every 5 min", () => {
    expect([1, 2, 3, 4, 5, 9].map(failureRetryMs)).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 300_000]);
    expect(failureRetryMs(0)).toBe(15_000);
  });
  it("futures-data feeds align to their period (a 1h series is polled hourly, retried up to 3× when late)", () => {
    const s1h = buildFeedSpecs("1h");
    expect(s1h.topAccountRatio).toMatchObject({ alignMs: 3_600_000, period: "1h", cadenceMs: 3_600_000 });
    expect(s1h.topAccountRatio5m).toMatchObject({ alignMs: 300_000, period: "5m", sources: ["binance", "proxy", "cache"] });
    expect(nonAdvanceRetries(3_600_000)).toBe(3);
    expect(nonAdvanceRetries(300_000)).toBe(1);
    expect(buildFeedSpecs("5m").topAccountRatio.alignMs).toBe(300_000);
    expect(buildFeedSpecs("15m").takerRatio.alignMs).toBe(900_000);
  });
});

describe("token buckets", () => {
  it("consumes and refills continuously", () => {
    const b = new TokenBucket({ capacity: 10, windowMs: 10_000 }, 0);
    expect(b.take(10, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.waitFor(1, 0)).toBe(1000);
    expect(b.take(1, 1000)).toBe(true);
    expect(b.available(11_000)).toBeCloseTo(10);
  });
  it("backs off for 60 s on rate limit", () => {
    const budget = new Budget(0);
    expect(budget.take("binance.weight", 1, 0)).toBe(true);
    budget.backoff("binance.weight", 0);
    expect(budget.take("binance.weight", 1, 30_000)).toBe(false);
    expect(budget.isBackingOff("binance.weight", 59_999)).toBe(true);
    expect(budget.take("binance.weight", 1, 60_000)).toBe(true);
  });
  it("uses the documented reserves", () => {
    expect(BUCKETS["binance.weight"]).toEqual({ capacity: 240, windowMs: 60_000 });
    expect(BUCKETS["binance.futuresData"]).toEqual({ capacity: 100, windowMs: 300_000 });
    expect(BUCKETS["bybit.ip"]).toEqual({ capacity: 60, windowMs: 5_000 });
    expect(BUCKETS["okx.rubik"].capacity).toBe(2);
  });
  it("prices klines by limit", () => {
    expect(klineWeight(2)).toBe(1);
    expect(klineWeight(499)).toBe(2);
    expect(klineWeight(500)).toBe(5);
    expect(klineWeight(1500)).toBe(10);
  });
});

describe("Scheduler", () => {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const host: TimerHost = {
    now: () => t,
    setTimeout: (fn, ms) => {
      id += 1;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    const target = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, j]) => j.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      t = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    t = target;
  };
  beforeEach(() => {
    t = 0;
    timers.clear();
  });

  it("fires keyed one-shots and replaces duplicates", () => {
    const s = new Scheduler(host);
    const fired: string[] = [];
    s.in("a", 100, () => fired.push("a1"));
    s.in("a", 200, () => fired.push("a2"));
    s.in("b", 50, () => fired.push("b"));
    expect(s.has("a")).toBe(true);
    advance(300);
    expect(fired).toEqual(["b", "a2"]);
    expect(s.has("a")).toBe(false);
  });
  it("pause keeps due times and resume catches up", () => {
    const s = new Scheduler(host);
    const fired: number[] = [];
    s.in("a", 100, () => fired.push(t));
    s.in("b", 5000, () => fired.push(t));
    s.pause();
    advance(1000);
    expect(fired).toEqual([]);
    s.resume();
    advance(0);
    expect(fired).toEqual([1000]); // overdue job fired immediately on resume
    advance(4000);
    expect(fired).toEqual([1000, 5000]);
  });
  it("reschedule moves a pending job (paused or not) and pending() lists due times", () => {
    const s = new Scheduler(host);
    const fired: number[] = [];
    s.in("a", 100, () => fired.push(t));
    expect(s.reschedule("a", 500)).toBe(true);
    expect(s.reschedule("missing", 1)).toBe(false);
    advance(200);
    expect(fired).toEqual([]);
    s.pause();
    s.reschedule("a", 900);
    expect(s.pending()).toEqual([["a", 900]]);
    advance(600);
    s.resume();
    expect(fired).toEqual([]);
    advance(100);
    expect(fired).toEqual([900]);
  });
  it("cancelAll clears everything", () => {
    const s = new Scheduler(host);
    s.in("a", 10, () => {
      throw new Error("must not fire");
    });
    s.cancelAll();
    advance(100);
    expect(s.dueAt("a")).toBeUndefined();
  });
});

describe("cache", () => {
  const c = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1, closed: true });
  it("upserts by time, sorts and trims to capacity", () => {
    const merged = upsertSeries([c(1, 1), c(2, 2), c(3, 3)], [c(3, 33), c(4, 4), c(0, 0)], 4);
    expect(merged.map((x) => x.time)).toEqual([1, 2, 3, 4]);
    expect(merged[2]!.close).toBe(33);
    expect(upsertSeries([c(1, 1)], [], 5)).toEqual([c(1, 1)]);
  });
  it("persists and hydrates with the `${source}:${symbol}:${feed}` key", async () => {
    const kv = memoryKV();
    const cache = new MarketCache("BTCUSDT", kv);
    const points: RatioPoint[] = [{ time: 1, longPct: 60, shortPct: 40, ratio: 1.5 }];
    cache.set("topAccountRatio", { data: points, asOf: 1, receivedAt: 2, source: "binance", comparable: true });
    cache.set("topAccountRatio", { data: [{ time: 2, longPct: 61, shortPct: 39, ratio: 1.56 }], asOf: 2, receivedAt: 3, source: "binance", comparable: true });
    expect(cache.get("topAccountRatio")!.data).toHaveLength(2); // ring buffer upsert, not replace
    await cache.persist("topAccountRatio");
    expect(await kv.keys()).toEqual([cacheKey("binance", "BTCUSDT", "topAccountRatio")]);
    const other = new MarketCache("BTCUSDT", kv);
    const loaded = await other.hydrate(["topAccountRatio", "ticker24h"]);
    expect(loaded).toEqual(["topAccountRatio"]);
    expect(other.get("topAccountRatio")!.asOf).toBe(2);
    const otherSymbol = new MarketCache("ETHUSDT", kv);
    expect(await otherSymbol.hydrate(["topAccountRatio"])).toEqual([]);
    await other.clear();
    expect(await kv.keys()).toEqual([]);
  });
  it("futures-data feeds persist per period (a 1h ring never hydrates the 4h series)", async () => {
    const kv = memoryKV();
    const pt = (time: number): RatioPoint => ({ time, longPct: 60, shortPct: 40, ratio: 1.5 });
    const h1 = new MarketCache("BTCUSDT", kv, (f) => (f === "topAccountRatio" ? "1h" : undefined));
    h1.set("topAccountRatio", { data: [pt(3_600_000)], asOf: 3_600_000, receivedAt: 1, source: "binance", comparable: true });
    await h1.persist("topAccountRatio");
    expect(await kv.keys()).toEqual(["binance:BTCUSDT:1h:topAccountRatio"]);
    expect(cacheKey("binance", "BTCUSDT", "topAccountRatio", "4h")).toBe("binance:BTCUSDT:4h:topAccountRatio");
    const h4 = new MarketCache("BTCUSDT", kv, (f) => (f === "topAccountRatio" ? "4h" : undefined));
    expect(await h4.hydrate(["topAccountRatio"])).toEqual([]);
    const again = new MarketCache("BTCUSDT", kv, () => "1h");
    expect(await again.hydrate(["topAccountRatio"])).toEqual(["topAccountRatio"]);
  });
  it("replaces the buffer when the source changes", () => {
    const cache = new MarketCache("BTCUSDT", null);
    cache.set("kline_1h", { data: [c(1, 1)], asOf: 1, receivedAt: 1, source: "binance", comparable: true });
    cache.set("kline_1h", { data: [c(2, 2)], asOf: 2, receivedAt: 2, source: "bybit", comparable: true });
    expect(cache.get("kline_1h")!.data.map((x) => x.time)).toEqual([2]);
  });
});

describe("fake-timer sanity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("real host follows fake timers", async () => {
    const { realTimerHost } = await import("@/market/schedule");
    const s = new Scheduler(realTimerHost);
    let fired = false;
    s.in("x", 1000, () => (fired = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(fired).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toBe(true);
  });
});
