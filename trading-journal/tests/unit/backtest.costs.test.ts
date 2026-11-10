import { describe, expect, it } from "vitest";
import { feeFor, feePreset, FEE_PRESETS, fundingCost, rateAt, settlementsBetween, slipDistance, slipped, slippageText, aggregateBars, toDaily, toWeekly, weekOpenS, closedCount, gapsOf, cleanBars, type Bar } from "@/domain/backtest/index";

const HOUR = 3_600_000;

describe("Gebühren", () => {
  it("rechnet Maker / Taker in Basispunkten vom Notional", () => {
    const m = { exchange: "binance", makerBps: 2, takerBps: 5 };
    expect(feeFor(10_000, false, m)).toBeCloseTo(5, 9);
    expect(feeFor(10_000, true, m)).toBeCloseTo(2, 9);
    expect(feeFor(-10_000, true, m)).toBeCloseTo(2, 9);
  });
  it("hat Voreinstellungen je Börse und fällt sonst auf Binance zurück", () => {
    expect(FEE_PRESETS.map((p) => p.exchange)).toEqual(["binance", "bitunix", "bybit", "okx"]);
    expect(feePreset("bitunix").takerBps).toBe(6);
    expect(feePreset("unbekannt").exchange).toBe("binance");
  });
});

describe("Funding", () => {
  it("kennt die Abrechnungen alle 8 h im UTC-Raster (from exklusiv, to inklusiv)", () => {
    const d = Date.UTC(2026, 0, 1);
    expect(settlementsBetween(d, d + 24 * HOUR)).toEqual([d + 8 * HOUR, d + 16 * HOUR, d + 24 * HOUR]);
    expect(settlementsBetween(d + HOUR, d + 7 * HOUR)).toEqual([]);
    expect(settlementsBetween(d + 9 * HOUR, d + 9 * HOUR)).toEqual([]);
  });
  it("nimmt den echten Satz der Abrechnung, sonst den Ersatzwert", () => {
    const d = Date.UTC(2026, 0, 1);
    const model = { kind: "history" as const, points: [{ t: d + 8 * HOUR + 2, rate: 0.0003 }, { t: d + 16 * HOUR, rate: -0.0002 }], fallbackRate: 0.0001 };
    expect(rateAt(model, d)).toBe(0.0001); // before the history
    expect(rateAt(model, d + 8 * HOUR)).toBe(0.0003);
    expect(rateAt(model, d + 16 * HOUR)).toBe(-0.0002);
    const cost = fundingCost(model, "long", 2, d + HOUR, d + 17 * HOUR, () => 100);
    expect(cost).toBeCloseTo(2 * 100 * (0.0003 - 0.0002), 9);
    expect(fundingCost({ kind: "none" }, "long", 2, d, d + 48 * HOUR, () => 100)).toBe(0);
  });
});

describe("Slippage", () => {
  it("rechnet fix, Spread, ATR-Anteil und keine – immer gegen den Trader", () => {
    expect(slipDistance({ kind: "fixed", bps: 10 }, 1000, null)).toBeCloseTo(1, 9);
    expect(slipDistance({ kind: "spread", bps: 10 }, 1000, null)).toBeCloseTo(0.5, 9);
    expect(slipDistance({ kind: "atr", frac: 0.1 }, 1000, 20)).toBeCloseTo(2, 9);
    expect(slipDistance({ kind: "atr", frac: 0.1 }, 1000, null)).toBe(0);
    expect(slipped({ kind: "fixed", bps: 10 }, 1000, true, null)).toBeCloseTo(1001, 9);
    expect(slipped({ kind: "fixed", bps: 10 }, 1000, false, null)).toBeCloseTo(999, 9);
    expect(slipped({ kind: "none" }, 1000, true, null)).toBe(1000);
    expect(slippageText({ kind: "fixed", bps: 2.5 })).toContain("2,5 bp");
  });
});

describe("Kerzen-Helfer", () => {
  const day0 = Date.UTC(2026, 0, 5) / 1000; // a Monday
  const h4: Bar[] = Array.from({ length: 6 * 9 + 3 }, (_, i) => ({ t: day0 + i * 14_400, o: i, h: i + 2, l: i - 1, c: i + 1, v: 1 }));
  it("baut nur vollständige UTC-Tage und Montags-Wochen", () => {
    const d = toDaily(h4);
    expect(d).toHaveLength(9); // the tenth day has 3 of 6 bars
    expect(d[0]).toMatchObject({ t: day0, o: 0, h: 7, l: -1, c: 6, v: 6 });
    const w = toWeekly(d);
    expect(w).toHaveLength(1);
    expect(w[0]!.t).toBe(weekOpenS(day0));
    expect(aggregateBars([], (t) => t, 2)).toEqual([]);
  });
  it("zählt geschlossene Kerzen per Binärsuche und findet Lücken", () => {
    expect(closedCount(h4, 14_400, day0 + 14_400)).toBe(1);
    expect(closedCount(h4, 14_400, day0 + 14_399)).toBe(0);
    const holey = [h4[0]!, h4[1]!, h4[4]!];
    expect(gapsOf(holey, 14_400)).toEqual({ gaps: 1, missing: 2 });
    expect(cleanBars([h4[1]!, h4[0]!, { ...h4[1]!, c: 99 }, { ...h4[2]!, h: NaN }]).map((b) => b.c)).toEqual([1, 99]);
  });
});
