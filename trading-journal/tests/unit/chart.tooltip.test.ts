import { describe, expect, it } from "vitest";
import { TickMarkType } from "lightweight-charts";
import { candleDelta, formatTooltip, placeTooltip, TOOLTIP_WIDTH } from "@/chart/tooltip";
import { formatChartTime, formatTickMark } from "@/chart/theme";
import { fmt } from "@/chart/format";

// 2026-09-03T10:30:00Z → 12:30 in Europe/Berlin (CEST)
const T = Date.UTC(2026, 8, 3, 10, 30) / 1000;

describe("formatTooltip", () => {
  it("formats OHLC de-DE with U+2212 and a signed Δ%", () => {
    const t = formatTooltip({ time: T, open: 85900, high: 86120.5, low: 85210, close: 85040.4 });
    expect(t.time).toBe("03.09., 12:30");
    expect(t.open).toBe("85.900");
    expect(t.high).toBe("86.120,5");
    expect(t.low).toBe("85.210");
    expect(t.close).toBe("85.040,4");
    expect(t.delta).toBe("−1,00 %");
    expect(t.tone).toBe("loss");
  });
  it("marks rising candles as win and flat as fg", () => {
    expect(formatTooltip({ time: T, open: 100, high: 110, low: 90, close: 101 })).toMatchObject({ delta: "+1,00 %", tone: "win" });
    expect(formatTooltip({ time: T, open: 100, high: 110, low: 90, close: 100 })).toMatchObject({ delta: "0,00 %", tone: "fg" });
    expect(candleDelta({ open: 0, close: 5 })).toBeNull();
  });
});

describe("placeTooltip", () => {
  const bounds = { width: 800, height: 400 };
  it("sits right of the cursor and flips near the right edge", () => {
    expect(placeTooltip({ x: 100, y: 200 }, bounds).x).toBe(114);
    expect(placeTooltip({ x: 700, y: 200 }, bounds).x).toBe(700 - 14 - TOOLTIP_WIDTH);
  });
  it("clamps vertically", () => {
    expect(placeTooltip({ x: 100, y: 0 }, bounds).y).toBe(4);
    expect(placeTooltip({ x: 100, y: 400 }, bounds).y).toBe(400 - 108 - 4);
  });
});

describe("theme time formatting", () => {
  it("formats axis ticks in Europe/Berlin", () => {
    expect(formatTickMark(T as never, TickMarkType.Time)).toBe("12:30");
    expect(formatTickMark(T as never, TickMarkType.DayOfMonth)).toBe("03.09.");
    expect(formatTickMark(T as never, TickMarkType.Month)).toMatch(/^Sept?$/);
    expect(formatTickMark(T as never, TickMarkType.Year)).toBe("2026");
    expect(formatChartTime({ year: 2026, month: 1, day: 5 })).toBe("05.01., 01:00");
  });
});

describe("fmt", () => {
  it("mirrors the bundle's V helpers", () => {
    expect(fmt.signed(-1234.5)).toBe("−1.234,50");
    expect(fmt.price(85900.5)).toBe("85.900,5");
    expect(fmt.price(9.1234)).toBe("9,1234");
    expect(fmt.price(85900.567)).toBe("85.900,57");
    expect(fmt.n0(null)).toBe("–");
    expect(fmt.pct0(0.6215)).toBe("62 %");
    expect(fmt.mio(1_250_000)).toBe("1,3 Mio");
    expect(fmt.mio(-42_000)).toBe("−42.000");
  });
});
