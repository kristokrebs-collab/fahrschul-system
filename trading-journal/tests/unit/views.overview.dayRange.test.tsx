/** `24 Stunden` in the market panel (design pass v3): last-24-h bar selection and the line geometry. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Candle } from "@/market";
import { DAY_RANGE_TITLE, DayRange, dayGeometry, lastDayBars } from "@/views/overview/DayRange";

const M15 = 15 * 60_000;
const bar = (i: number, close: number, closed = true): Candle => ({ time: i * M15, open: close, high: close + 1, low: close - 1, close, volume: 1, closed });

describe("DayRange", () => {
  it("lastDayBars: the closed 15m bars of the last 24 h (96), oldest first, without the forming bar", () => {
    const data = Array.from({ length: 120 }, (_, i) => bar(i, 100 + i));
    data.push(bar(120, 999, false));
    const out = lastDayBars(data);
    expect(out).toHaveLength(96);
    expect(out[0]!.time).toBe(24 * M15);
    expect(out[out.length - 1]!.time).toBe(119 * M15);
    expect(lastDayBars([bar(0, 1, false)])).toEqual([]);
  });

  it("dayGeometry: closes span the inner box (low at the bottom pad, high at the top pad); too few bars → null", () => {
    const g = dayGeometry([bar(0, 10), bar(1, 20), bar(2, 15)], 106, 112)!;
    expect(g.lo).toBe(9);
    expect(g.hi).toBe(21);
    // first point x 0, last x = width − right pad (100); the area closes along the bottom
    expect(g.line.startsWith("M0.0,")).toBe(true);
    expect(g.line).toContain("L100.0,");
    expect(g.area.endsWith("L100.0,112L0,112Z")).toBe(true);
    expect(dayGeometry([bar(0, 1)], 100, 100)).toBeNull();
  });

  it("renders its title without market data (no line, no dot)", () => {
    render(<DayRange />);
    expect(screen.getByText(DAY_RANGE_TITLE)).toBeTruthy();
    expect(screen.getByTestId("day-range").querySelector("svg")).toBeNull();
  });
});
