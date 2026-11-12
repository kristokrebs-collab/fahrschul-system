// @vitest-environment node
/// <reference types="node" />
/**
 * The RSI the scanner's "oversold recovery" rule reads, held against TradingView's own RSI(14) on 250 real daily closes of AAPL
 * (fixture `tests/fixtures/stocks/tv-aapl-1d-rsi.json`, fetched 2026-10-26 through the TradingView connector, its README row says where
 * it comes from). The scanner computes with `rsi` of `domain/signals/indicators` (Wilder / RMA); with 250 bars the start-up
 * difference between implementations is gone, so the two numbers must agree to a few hundredths.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rsi } from "@/domain/signals/indicators";
import { DEFAULT_PARAMS, scanSymbol, type ScanCandle } from "@/domain/scanner";

interface Reference {
  tvRsi: number;
  tvRsiPrev: number;
  closes: number[];
}
const ref = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/stocks/tv-aapl-1d-rsi.json"), "utf8")) as Reference;

describe("RSI against TradingView", () => {
  it("matches TradingView's RSI(14) of the last two daily bars of AAPL to 0.05", () => {
    expect(ref.closes).toHaveLength(250);
    const r = rsi(ref.closes, 14);
    expect(r[r.length - 1]).toBeCloseTo(ref.tvRsi, 1);
    expect(Math.abs(r[r.length - 1]! - ref.tvRsi)).toBeLessThan(0.05);
    expect(Math.abs(r[r.length - 2]! - ref.tvRsiPrev)).toBeLessThan(0.05);
  });

  it("the scanner's rule says 'not oversold' for it (RSI 63.9 is far from the level 30) and lists nothing", () => {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2025, 9, 27, 13, 30);
    const candles: ScanCandle[] = ref.closes.map((c, i) => ({ time: t0 + i * DAY, open: c, high: c, low: c, close: c, volume: 50_000_000, closed: true }));
    const asOf = candles[candles.length - 1]!.time + DAY + 3_600_000;
    const out = scanSymbol({ symbol: "AAPL", fin: "N", interval: "1d", barMs: DAY, candles, asOf, stand: { source: "tradingview", lastBar: candles[candles.length - 1]!.time, receivedAt: asOf } }, DEFAULT_PARAMS, ["rsi"]);
    expect(out.skipped).toBeNull();
    expect(out.hits).toEqual([]);
  });
});
