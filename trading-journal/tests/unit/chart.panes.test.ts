import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import { alignToGrid, normalizeSeries } from "@/chart/panes";

const t = (n: number) => n as UTCTimestamp;

describe("alignToGrid", () => {
  const grid = [0, 14400, 28800, 43200].map(t); // 4h candles

  it("passes rows through without a grid", () => {
    const rows = [{ time: t(3600), value: 1 }];
    expect(alignToGrid(rows, null)).toBe(rows);
    expect(alignToGrid(rows, [])).toBe(rows);
  });

  it("snaps hourly points onto the candle grid, last point per candle wins, no whitespace slots", () => {
    const rows = [3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800].map((s, i) => ({ time: t(s), value: i }));
    const out = alignToGrid(rows, grid);
    expect(out.map((r) => [r.time, r.value])).toEqual([
      [0, 2],
      [14400, 6],
      [28800, 7],
    ]);
    // every output time is a candle time → the shared time scale gains no extra indices
    for (const r of out) expect(grid).toContain(r.time);
  });

  it("drops points older than the first candle and keeps points after the last one on the last candle", () => {
    const rows = [{ time: t(-100), value: 0 }, { time: t(50000), value: 9 }];
    expect(alignToGrid(rows, grid)).toEqual([{ time: 43200, value: 9 }]);
  });

  it("result stays strictly ascending after normalizeSeries", () => {
    const rows = normalizeSeries([{ time: t(20000), value: 1 }, { time: t(100), value: 2 }, { time: t(100), value: 3 }]);
    const out = alignToGrid(rows, grid);
    expect(out).toEqual([{ time: 0, value: 3 }, { time: 14400, value: 1 }]);
  });
});
