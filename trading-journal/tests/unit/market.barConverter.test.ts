/** The engine's memoised candle → bar conversion (`BarConverter`) on the feed's real upsert paths. */
import { describe, expect, it } from "vitest";
import { RING_CAPACITY, upsertBar, upsertSeries } from "@/market/cache";
import { BarConverter, candleToBar } from "@/market/signals/bars";
import type { Candle } from "@/market/types";

const T0 = 1_760_000_000_000;
const c = (i: number, close: number, closed = true): Candle => ({ time: T0 + i * 900_000, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 1, closed, closeTime: T0 + (i + 1) * 900_000 - 1 });
const ringOf = (n: number): Candle[] => Array.from({ length: n }, (_, i) => c(i, 100 + (i % 7)));

describe("BarConverter", () => {
  it("a REST gap fill that corrects bar k after the socket appended k+1 reaches the engine (reconnect across a close)", () => {
    const cap = RING_CAPACITY.kline_15m;
    let ring = upsertBar(ringOf(1500), c(1500, 111, false), cap); // bar k forming, last tick before the socket dropped
    const conv = new BarConverter();
    conv.convert(ring);
    ring = upsertBar(ring, c(1501, 95, false), cap); // reconnect: the socket delivers bar k+1 first
    conv.convert(ring);
    ring = upsertSeries(ring, [c(1500, 90, true), c(1501, 95, false)], cap); // the REST page: bar k closed at 90
    const bars = conv.convert(ring);
    expect(ring[1500]!.close).toBe(90);
    expect(bars[1500]).toEqual(candleToBar(ring[1500]!));
    expect(bars).toEqual(ring.map(candleToBar));
  });

  it("ticks re-convert only the tail; an older correction far back converts the whole series", () => {
    const cap = RING_CAPACITY.kline_15m;
    let ring = ringOf(400);
    const conv = new BarConverter();
    const first = conv.convert(ring);
    ring = upsertBar(ring, c(399, 120, false), cap); // forming bar updated
    const second = conv.convert(ring);
    expect(second[398]).toBe(first[398]); // the prefix is reused
    expect(second[399]!.c).toBe(120);
    // a page that rewrites 100 bars of the overlap (beyond the tail scan): every bar re-read
    ring = upsertSeries(ring, Array.from({ length: 100 }, (_, i) => c(300 + i, 50)), cap);
    expect(conv.convert(ring)).toEqual(ring.map(candleToBar));
    // same array again: the memo
    expect(conv.convert(ring)).toBe(conv.convert(ring));
  });
});
