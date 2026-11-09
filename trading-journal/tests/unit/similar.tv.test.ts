/**
 * F19 – the indicators behind the description against REAL TradingView values (fixture `similar.tvFixture.ts`, taken from
 * the TradingView MCP tools on 2026-10-19: BINANCE:BTCUSDT 1D, 400 daily closes and TradingView's own RSI / EMA on the same bar).
 *
 * The tolerances are not zero for two honest reasons: TradingView computes from the whole listing (the fixture holds 400 bars,
 * so the slowest EMA has not forgotten its seed), and its indicator snapshot and the price series were read a moment apart.
 */
import { describe, expect, it } from "vitest";
import { emaSma } from "@/domain/similar";
import { rsi } from "@/domain/signals/indicators";
import { BTC_1D_CLOSES, TV_PRICE, TV_VALUES } from "./similar.tvFixture";

describe("indicators vs TradingView (BINANCE:BTCUSDT 1D, 2026-10-19)", () => {
  const closes = [...BTC_1D_CLOSES];
  closes[closes.length - 1] = TV_PRICE;

  it("the fixture holds 400 daily closes", () => {
    expect(BTC_1D_CLOSES).toHaveLength(400);
  });

  it("Wilder RSI(14) is within 0,5 points of TradingView's", () => {
    expect(Math.abs(rsi(closes, 14).at(-1)! - TV_VALUES.rsi14)).toBeLessThan(0.5);
  });

  it("EMA 50 (SMA-seeded like ta.ema) is within 0,1 % of TradingView's", () => {
    const mine = emaSma(closes, 50).at(-1)!;
    expect(Math.abs(mine / TV_VALUES.ema50 - 1)).toBeLessThan(0.001);
  });

  it("EMA 200 is within 1,5 % (400 bars of history leave a small seed residue)", () => {
    const mine = emaSma(closes, 200).at(-1)!;
    expect(Math.abs(mine / TV_VALUES.ema200 - 1)).toBeLessThan(0.015);
  });
});
