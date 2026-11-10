import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { addMonths, adjacentTradedDays, calendarMonth, compact, dayKeyOf, dayView, initialMonth, monthRange, p90, piecewise, unitValue, wilson } from "@/domain/insights";
import { closedOf, enrich, qt, settingsWith } from "./insights.fixtures";

describe("shared helpers", () => {
  it("piecewise is continuous and holds the ends", () => {
    const a = [
      [0, 0],
      [1, 20],
      [2, 100],
    ] as const;
    expect(piecewise(-5, a)).toBe(0);
    expect(piecewise(0.5, a)).toBe(10);
    expect(piecewise(1, a)).toBe(20);
    expect(piecewise(1.5, a)).toBe(60);
    expect(piecewise(9, a)).toBe(100);
  });
  it("wilson interval contains p and narrows with n", () => {
    const small = wilson(3, 5);
    const big = wilson(300, 500);
    expect(small.lo).toBeLessThan(0.6);
    expect(small.hi).toBeGreaterThan(0.6);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
  it("compact keeps cells short", () => {
    expect(compact(0)).toBe("0");
    expect(compact(42)).toBe("+42");
    expect(compact(-999)).toBe("−999");
    expect(compact(1234)).toBe("+1,2k");
    expect(compact(-12_345)).toBe("−12k");
    expect(compact(999_999)).toBe("+1,0M");
    expect(compact(2_500_000, false)).toBe("2,5M");
    expect(compact(null)).toBe("–");
    for (const v of [1, 99, 999.4, 9_949, 9_951, 99_999, 999_499, 12_345_678]) expect(compact(-v).length).toBeLessThanOrEqual(6);
  });
  it("day key is the local date of the entry", () => {
    expect(dayKeyOf({ date: "2026-10-07T23:59" })).toBe("2026-10-07");
    expect(dayKeyOf({ date: "", createdAt: "2026-10-01T00:00" })).toBe("2026-10-01");
  });
});

describe("calendarMonth", () => {
  const s = settingsWith();
  const list = enrich([
    qt("2026-10-01T09:00", { p: 100, risk: 50 }),
    qt("2026-10-01T15:00", { p: -40, risk: 40 }),
    qt("2026-10-05T10:00", { p: -200, risk: 100 }),
    qt("2026-10-07T10:00", { p: 50 }),
    qt("2026-10-31T10:00", { p: 300, risk: 100 }),
    qt("2026-09-30T10:00", { p: 999 }),
    qt("2026-11-01T10:00", { p: 777 }),
    qt("2026-10-08T10:00", { p: 0, status: "open", pnlManual: null }),
  ]);
  const closed = closedOf(list);
  const m = calendarMonth(closed, { y: 2026, m: 9 }, { today: new Date(2026, 9, 7, 12), notes: { "2026-10-02": { note: "x" } } });

  it("is a Monday-first grid of six weeks", () => {
    expect(m.weeks).toHaveLength(6);
    // 1 Oct 2026 is a Thursday → three leading days of September
    expect(m.weeks[0]!.cells.map((c) => c.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(m.weeks[0]!.cells.slice(0, 3).every((c) => !c.inMonth)).toBe(true);
    expect(m.weeks[5]!.cells.every((c) => !c.inMonth)).toBe(true);
  });
  it("neighbour-month trades never count", () => {
    expect(m.weeks[0]!.cells[2]!.trades).toHaveLength(0);
    expect(m.g.n).toBe(5);
  });
  it("cells, weeks and month add up", () => {
    const weekSum = m.weeks.reduce((s, w) => s + w.g.net, 0);
    expect(weekSum).toBeCloseTo(m.g.net, 10);
    expect(m.g.net).toBe(210);
    const oct1 = m.weeks[0]!.cells[3]!;
    expect(oct1.g!.n).toBe(2);
    expect(oct1.g!.net).toBe(60);
    expect(oct1.rSum).toBeCloseTo(2 - 1, 10);
    expect(m.weeks[0]!.days).toBe(1);
  });
  it("agrees with the account view's month bucket (MonthlyCard)", () => {
    const view = accountView(list, s, "all");
    const bucket = view.months.find((b) => b.key === "2026-10")!;
    expect(bucket.net).toBe(m.g.net);
    expect(bucket.n).toBe(m.g.n);
  });
  it("day win rate, best and worst day", () => {
    expect(m.tradingDays).toBe(4);
    expect(m.winDays).toBe(3);
    expect(m.lossDays).toBe(1);
    expect(m.dayWinRate).toBe(0.75);
    expect(m.best!.key).toBe("2026-10-31");
    expect(m.worst!.key).toBe("2026-10-05");
  });
  it("intensity is relative to the 90th percentile", () => {
    expect(m.p90).toBe(300);
    const oct5 = m.weeks[1]!.cells[0]!;
    expect(oct5.key).toBe("2026-10-05");
    expect(oct5.intensity).toBeCloseTo(200 / 300, 10);
    expect(p90([])).toBe(1);
    expect(p90([0, 0])).toBe(1);
  });
  it("flags notes, today and the future", () => {
    const oct2 = m.weeks[0]!.cells[4]!;
    expect(oct2.hasNote).toBe(true);
    const today = m.weeks[1]!.cells[2]!;
    expect(today.key).toBe("2026-10-07");
    expect(today.isToday).toBe(true);
    expect(m.weeks[1]!.cells[3]!.future).toBe(true);
  });
  it("unit values: money, Σ R, % of capital", () => {
    const oct1 = m.weeks[0]!.cells[3]!;
    expect(unitValue(oct1.g, oct1.rSum, "money", 1000)).toBe(60);
    expect(unitValue(oct1.g, oct1.rSum, "r", 1000)).toBeCloseTo(1, 10);
    expect(unitValue(oct1.g, oct1.rSum, "pct", 1000)).toBeCloseTo(0.06, 10);
    expect(unitValue(oct1.g, oct1.rSum, "pct", 0)).toBeNull();
    expect(unitValue(null, null, "money", 1)).toBeNull();
  });
  it("month range and start month", () => {
    expect(initialMonth(closed)).toEqual({ y: 2026, m: 10 });
    expect(initialMonth([], new Date(2026, 3, 2))).toEqual({ y: 2026, m: 3 });
    const r = monthRange(closed, new Date(2026, 9, 7));
    expect(r.min).toEqual({ y: 2026, m: 8 });
    expect(r.max).toEqual({ y: 2026, m: 10 });
    expect(addMonths({ y: 2026, m: 0 }, -1)).toEqual({ y: 2025, m: 11 });
    expect(addMonths({ y: 2026, m: 11 }, 1)).toEqual({ y: 2027, m: 0 });
  });
  it("day view: trades in time order, open trades listed apart, cumulative curve", () => {
    const d = dayView(list, "2026-10-01");
    expect(d.trades.map((t) => t.pnl)).toEqual([100, -40]);
    expect(d.curve).toEqual([0, 100, 60]);
    expect(d.g.net).toBe(60);
    const open = dayView(list, "2026-10-08");
    expect(open.trades).toHaveLength(0);
    expect(open.open).toHaveLength(1);
  });
  it("adjacent traded days", () => {
    expect(adjacentTradedDays(closed, "2026-10-05")).toEqual({ prev: "2026-10-01", next: "2026-10-07" });
    expect(adjacentTradedDays(closed, "2026-09-30")).toEqual({ prev: null, next: "2026-10-01" });
  });
});
