/**
 * F32 Ausgang je Signal gegen echte Kerzen: 24 15m-Kerzen von BINANCE:BTCUSDT.P (TradingView, abgerufen 2026-10-19, siehe die
 * Fixture-Datei). Die erwarteten Ergebnisse sind von Hand an diesen Kerzen nachgezählt, nicht aus der Funktion abgeleitet:
 * Höchstes Hoch der Reihe 83 103,8 (Kerze 1), tiefstes Tief 82 888,8 (Kerze 20, t = 1791672300).
 */
import { describe, expect, it } from "vitest";
import { evaluateSignal, type OutcomeBar } from "@/domain/missed";
import fixture from "./fixtures/tv-binance-btcusdt-perp-15m-2026-10-10.json";

const bars: OutcomeBar[] = fixture.bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c }));
const T0 = bars[0]!.time;
/** One minute before the first candle opens: the first candle is the entry candle. */
const AT = T0 - 60_000;
const ctx = { now: T0 + 24 * 3_600_000, atrPct: 0.1, intervalMs: 900_000 };
const base = { at: AT, symbol: "BTCUSDT", price: null as number | null };

describe("Ausgang gegen echte TradingView-Kerzen", () => {
  it("Long: Einstieg = Eröffnung der ersten Kerze, der Stopp in Kerze 20 kommt vor dem nie erreichten Ziel", () => {
    const o = evaluateSignal({ ...base, side: "long", stop: 82900, target: 83110 }, bars, ctx);
    expect(o).toMatchObject({ kind: "stop", entry: 83068.7, r: -1, sameBar: false, hitAt: 1791672300 * 1000, bars: 20 });
  });

  it("Long: das Ziel liegt schon in der ersten Kerze (Hoch 83 103,8)", () => {
    const o = evaluateSignal({ ...base, side: "long", stop: 82900, target: 83100 }, bars, ctx);
    expect(o).toMatchObject({ kind: "target", hitAt: T0, bars: 1 });
    expect(o.rr).toBeCloseTo((83100 - 83068.7) / (83068.7 - 82900), 9);
  });

  it("Long: Stopp in Kerze 2 (Tief 82 942,7), Ziel nie erreicht", () => {
    const o = evaluateSignal({ ...base, side: "long", stop: 82950, target: 83150 }, bars, ctx);
    expect(o).toMatchObject({ kind: "stop", hitAt: 1791656100 * 1000, sameBar: false, bars: 2 });
  });

  it("Short: das Ziel 82 900 fällt in Kerze 20 (Tief 82 888,8), der Stopp 83 110 wird nie berührt", () => {
    const o = evaluateSignal({ ...base, side: "short", stop: 83110, target: 82900 }, bars, ctx);
    expect(o).toMatchObject({ kind: "target", hitAt: 1791672300 * 1000 });
    expect(o.rr).toBeCloseTo((83068.7 - 82900) / (83110 - 83068.7), 9);
    expect(o.r).toBeCloseTo(4.0847, 3);
  });

  it("Stopp und Ziel in derselben Kerze 1 (Hoch 83 103,8, Tief 83 015,3): der Stopp zählt", () => {
    const o = evaluateSignal({ ...base, side: "long", stop: 83020, target: 83100 }, bars, ctx);
    expect(o).toMatchObject({ kind: "stop", sameBar: true, hitAt: T0, bars: 1 });
  });

  it("Standardmaß: ATR 0,1 % von 83 068,7 → Stopp 1,5 ATR, Ziel 2 R", () => {
    const o = evaluateSignal({ ...base, side: "long", stop: null, target: null }, bars, ctx);
    const dist = (1.5 * 0.1 * 83068.7) / 100; // 124,60
    expect(o.basis).toBe("standard");
    expect(o.stop).toBeCloseTo(83068.7 - dist, 6);
    expect(o.target).toBeCloseTo(83068.7 + 2 * dist, 6);
    // Stopp 82 944,1: Kerze 2 hat das Tief 82 942,7 → Stopp zuerst
    expect(o).toMatchObject({ kind: "stop", hitAt: 1791656100 * 1000 });
  });
});
