/**
 * Ausführbarkeit (F44), the pure part: spread, depth bands, the walk of a market order through the book, and the check against
 * the plan's assumed slippage – numbers worked out by hand on a small book.
 *
 *   bids 100,0 × 2 · 99,9 × 3 · 99,5 × 5          asks 100,2 × 1 · 100,3 × 4 · 101,0 × 10
 */
import { describe, expect, it } from "vitest";
import { bandOf, bookOf, checkExecution, marketImpact, spreadWord, touchOf, walk } from "@/domain/execution";

const BOOK = bookOf(
  [[99.9, 3], [100, 2], [99.5, 5]], // unsorted on purpose
  [[101, 10], [100.2, 1], [100.3, 4]],
  1_000,
);

describe("the book", () => {
  it("sorts both sides best first and drops invalid levels", () => {
    expect(BOOK.bids.map((l) => l.price)).toEqual([100, 99.9, 99.5]);
    expect(BOOK.asks.map((l) => l.price)).toEqual([100.2, 100.3, 101]);
    const dirty = bookOf([[100, 0], [Number.NaN, 1], [-1, 1], [99, 2]], [[101, 1], [101, -3]], 1);
    expect(dirty.bids).toEqual([{ price: 99, qty: 2 }]);
    expect(dirty.asks).toEqual([{ price: 101, qty: 1 }]);
  });

  it("touch: mid = 100,1, spread = 0,2 = 19,98 bp", () => {
    const t = touchOf(BOOK)!;
    expect(t).toMatchObject({ bid: 100, ask: 100.2, mid: 100.1 });
    expect(t.spread).toBeCloseTo(0.2, 12);
    expect(t.spreadBps).toBeCloseTo((0.2 / 100.1) * 10_000, 9); // 19,98
  });

  it("no spread for a one-sided or crossed book", () => {
    expect(touchOf(bookOf([[100, 1]], [], 0))).toBeNull();
    expect(touchOf(bookOf([], [[100, 1]], 0))).toBeNull();
    expect(touchOf(bookOf([[100, 1]], [[100, 1]], 0))).toBeNull(); // bid = ask
    expect(touchOf(bookOf([[101, 1]], [[100, 1]], 0))).toBeNull(); // crossed
  });

  it("spread words: ≤ 2 bp eng, ≤ 10 normal, ≤ 30 weit, beyond sehr weit", () => {
    expect(spreadWord(0.12)).toEqual({ word: "eng", tone: "ok" });
    expect(spreadWord(2)).toEqual({ word: "eng", tone: "ok" });
    expect(spreadWord(2.01)).toEqual({ word: "normal", tone: "ok" });
    expect(spreadWord(10)).toEqual({ word: "normal", tone: "ok" });
    expect(spreadWord(19.98)).toEqual({ word: "weit", tone: "warn" });
    expect(spreadWord(30.01)).toEqual({ word: "sehr weit", tone: "bad" });
  });
});

describe("depth bands around the middle (100,1)", () => {
  it("±0,1 %: edge 99,9999 / 100,2001 → bid 100,0 × 2, ask 100,2 × 1; the book reaches beyond both edges", () => {
    const b = bandOf(BOOK, 100.1, 0.001);
    expect(b).toMatchObject({ bidQty: 2, askQty: 1, bidCovered: true, askCovered: true });
    expect(b.bidValue).toBeCloseTo(200, 9);
    expect(b.askValue).toBeCloseTo(100.2, 9);
  });

  it("±0,5 %: edge 99,5995 / 100,6005 → bids 2 + 3 = 5 (499,7), asks 1 + 4 = 5 (501,4)", () => {
    const b = bandOf(BOOK, 100.1, 0.005);
    expect(b).toMatchObject({ bidQty: 5, askQty: 5, bidCovered: true, askCovered: true });
    expect(b.bidValue).toBeCloseTo(499.7, 9);
    expect(b.askValue).toBeCloseTo(501.4, 9);
  });

  it("±1 %: the snapshot stops at 99,5 / 101,0 – short of the edges 99,099 / 101,101 → the numbers are a lower bound", () => {
    const b = bandOf(BOOK, 100.1, 0.01);
    expect(b).toMatchObject({ bidQty: 10, askQty: 15, bidCovered: false, askCovered: false });
  });
});

describe("a market order walks the book", () => {
  it("walk: 3 on the asks = 1 × 100,2 + 2 × 100,3 → Ø 100,26667 over 2 levels, complete", () => {
    const f = walk(BOOK.asks, 3);
    expect(f).toMatchObject({ filled: 3, complete: true, levels: 2, worst: 100.3 });
    expect(f.avg).toBeCloseTo(300.8 / 3, 9);
  });

  it("a size beyond the book fills what is there and says it is not complete: 20 → 15 filled, Ø 100,76", () => {
    const f = walk(BOOK.asks, 20);
    expect(f).toMatchObject({ filled: 15, complete: false, levels: 3, worst: 101 });
    expect(f.avg).toBeCloseTo(1511.4 / 15, 9);
  });

  it("buy 3: impact = (100,26667 − 100,2) ÷ 100,2 = 6,65 bp over the best price, 16,65 bp from the middle", () => {
    const i = marketImpact(BOOK, "buy", 3)!;
    expect(i).toMatchObject({ action: "buy", touch: 100.2, complete: true });
    expect(i.impactBps).toBeCloseTo((300.8 / 3 - 100.2) / 100.2 * 10_000, 9);
    expect(i.impactBps).toBeCloseTo(6.653, 2);
    expect(i.fromMidBps).toBeCloseTo((300.8 / 3 - 100.1) / 100.1 * 10_000, 9);
    expect(i.fromMidBps).toBeCloseTo(16.65, 2);
  });

  it("sell 4: 2 × 100,0 + 2 × 99,9 → Ø 99,95; impact 5,00 bp, 14,99 bp from the middle", () => {
    const i = marketImpact(BOOK, "sell", 4)!;
    expect(i.avg).toBeCloseTo(99.95, 9);
    expect(i.impactBps).toBeCloseTo(5, 9);
    expect(i.fromMidBps).toBeCloseTo((0.15 / 100.1) * 10_000, 9);
  });

  it("nothing without a valid touch or size", () => {
    expect(marketImpact(bookOf([], [[1, 1]], 0), "buy", 1)).toBeNull();
    expect(marketImpact(BOOK, "buy", 0)).toBeNull();
    expect(marketImpact(BOOK, "buy", Number.NaN)).toBeNull();
  });

  it("an empty side that is hit gives no price", () => {
    const i = marketImpact(bookOf([[100, 1]], [[100.5, 0.0000001]], 0), "buy", 5)!;
    expect(i.complete).toBe(false);
    expect(i.filled).toBeCloseTo(0.0000001, 12);
  });
});

describe("checkExecution", () => {
  const base = { book: BOOK, side: "long" as const, qty: 3, assumedSlippage: 0.0005, quoteVolume24h: 1_000_000 };

  it("long 3 with 5 bp assumed: spread 19,98 bp is 'weit' (warn); the stop fill is 13,32 bp from the middle – above the assumption → warn; depth and turnover fine", () => {
    const c = checkExecution(base);
    expect(c.spread).toEqual({ word: "weit", tone: "warn" });
    expect(c.entry!.action).toBe("buy");
    expect(c.stop!.action).toBe("sell");
    // sell 3: 2 × 100,0 + 1 × 99,9 = 299,9 → Ø 99,96667; from the middle (100,1): 0,13333 ÷ 100,1 = 13,32 bp
    expect(c.measuredBps).toBeCloseTo(((100.1 - 299.9 / 3) / 100.1) * 10_000, 9);
    expect(c.measuredBps).toBeCloseTo(13.32, 2);
    expect(c.assumedBps).toBeCloseTo(5, 9);
    expect(c.assumption).toBe("low");
    // value 3 × 100,1 = 300,3 of 1 000 000 = 0,03 %
    expect(c.turnover).toBeCloseTo(0.0003003, 9);
    expect(Object.fromEntries(c.findings.map((f) => [f.id, f.tone]))).toEqual({ spread: "warn", depth: "ok", assumption: "warn", turnover: "ok" });
    expect(c.tone).toBe("warn");
    expect(c.bands.map((b) => b.pct)).toEqual([0.001, 0.005, 0.01]);
  });

  it("a generous assumption (20 bp) is covered", () => {
    const c = checkExecution({ ...base, assumedSlippage: 0.002 });
    expect(c.assumption).toBe("covered");
    expect(c.findings.find((f) => f.id === "assumption")!.tone).toBe("ok");
  });

  it("a short buys to close and sells to open", () => {
    const c = checkExecution({ ...base, side: "short" });
    expect(c.entry!.action).toBe("sell");
    expect(c.stop!.action).toBe("buy");
  });

  it("a size the book cannot carry is a problem; the assumption cannot be judged then", () => {
    const c = checkExecution({ ...base, qty: 20 });
    expect(c.entry!.complete).toBe(false);
    expect(c.stop!.complete).toBe(false);
    expect(c.assumption).toBe("unknown");
    expect(c.findings.find((f) => f.id === "depth")!.tone).toBe("bad");
    expect(c.tone).toBe("bad");
  });

  it("turnover: above 0,5 % of the day is large (warn), above 2 % very large (bad); without a volume it is unknown", () => {
    // 300,3 value
    expect(checkExecution({ ...base, quoteVolume24h: 300.3 / 0.006 }).findings.find((f) => f.id === "turnover")!.tone).toBe("warn");
    expect(checkExecution({ ...base, quoteVolume24h: 300.3 / 0.03 }).findings.find((f) => f.id === "turnover")!.tone).toBe("bad");
    const none = checkExecution({ ...base, quoteVolume24h: null });
    expect(none.turnover).toBeNull();
    expect(none.findings.find((f) => f.id === "turnover")!.tone).toBe("unknown");
  });

  it("an unreadable book says nothing: every finding unknown, no tone – never a green light", () => {
    const c = checkExecution({ ...base, book: bookOf([[101, 1]], [[100, 1]], 0) });
    expect(c.touch).toBeNull();
    expect(c.spread).toBeNull();
    expect(c.bands).toEqual([]);
    expect(c.entry).toBeNull();
    expect(c.findings.every((f) => f.tone === "unknown")).toBe(true);
    expect(c.tone).toBe("unknown");
  });

  it("a tight, deep book is all ok", () => {
    const deep = bookOf([[100, 50], [99.99, 50]], [[100.01, 50], [100.02, 50]], 0);
    const c = checkExecution({ book: deep, side: "long", qty: 10, assumedSlippage: 0.0005, quoteVolume24h: 1e9 });
    expect(c.spread!.word).toBe("eng"); // 0,01 ÷ 100,005 = 1,0 bp
    expect(c.assumption).toBe("covered");
    expect(c.tone).toBe("ok");
  });
});
