import { describe, expect, it, vi } from "vitest";
import {
  tradeTime,
  nowLocalInput,
  monthKey,
  monthLabel,
  weekKey,
  weekLabel,
  weekStart,
  isoWeek,
  weekdayName,
  localDateKey,
  startOfLocalDay,
  daysBetween,
  bucketBy,
  MONTHS_SHORT,
  WEEKDAYS,
} from "@/lib/dates";
import { newId, newTradeId, newSetupId, newChecklistItemId } from "@/lib/ids";

describe("lib/dates", () => {
  it("tradeTime prefers date, falls back to createdAt, then epoch 0", () => {
    expect(+tradeTime({ date: "2026-01-05T10:00" })).toBe(+new Date("2026-01-05T10:00"));
    expect(+tradeTime({ date: "", createdAt: "2026-01-05T09:10:00.000Z" })).toBe(+new Date("2026-01-05T09:10:00.000Z"));
    expect(+tradeTime({})).toBe(0);
  });
  it("nowLocalInput produces a datetime-local value in local wall clock", () => {
    const d = new Date(2026, 2, 12, 9, 5);
    expect(nowLocalInput(d)).toBe("2026-03-12T09:05");
    expect(nowLocalInput()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it("month buckets", () => {
    const d = new Date("2026-03-01T16:45");
    expect(monthKey(d)).toBe("2026-03");
    expect(monthLabel("2026-03")).toBe("Mär 26");
    expect(monthLabel("2025-12")).toBe("Dez 25");
    expect(MONTHS_SHORT[0]).toBe("Jan");
    expect(localDateKey(d)).toBe("2026-03-01");
    expect(+startOfLocalDay("2026-03-01")).toBe(+new Date("2026-03-01T00:00"));
  });
  it("ISO week (Monday start, local time)", () => {
    expect(isoWeek(new Date("2026-01-01T12:00"))).toEqual({ year: 2026, week: 1 }); // Thursday
    expect(isoWeek(new Date("2027-01-01T12:00"))).toEqual({ year: 2026, week: 53 }); // Friday → week 53 of 2026
    expect(weekKey(new Date("2026-03-01T16:45"))).toBe("2026-W09"); // Sunday belongs to the week starting Mon 23 Feb
    expect(weekKey(new Date("2026-03-02T00:00"))).toBe("2026-W10");
    expect(weekLabel("2026-W09")).toBe("KW 9");
    const ws = weekStart(new Date("2026-03-01T16:45"));
    expect(localDateKey(ws)).toBe("2026-02-23");
    expect(ws.getHours()).toBe(0);
    expect(weekdayName(new Date("2026-03-01T16:45"))).toBe("Sonntag");
    expect(WEEKDAYS[1]).toBe("Montag");
  });
  it("daysBetween and bucketBy", () => {
    expect(daysBetween(new Date("2026-01-01T00:00"), new Date("2026-01-02T12:00"))).toBe(1.5);
    const m = bucketBy([{ k: "a" }, { k: "b" }, { k: "a" }, { k: null }], (x) => x.k);
    expect([...m.keys()]).toEqual(["a", "b"]);
    expect(m.get("a")?.length).toBe(2);
  });
});

describe("lib/ids", () => {
  it("newId = prefix + 7 base36 + 4 base36 (deterministic clock/random)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T09:05:00.000Z"));
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    try {
      const expected = "t_" + (0.123456789).toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
      expect(newId("t_")).toBe(expected);
      expect(newId("t_")).toMatch(/^t_[0-9a-z]{7}[0-9a-z]{4}$/);
    } finally {
      rnd.mockRestore();
      vi.useRealTimers();
    }
  });
  it("prefix helpers and uniqueness", () => {
    // Math.random().toString(36) may yield fewer than 7 chars for "round" values, so allow 5–11 like the bundle
    expect(newTradeId()).toMatch(/^t_[0-9a-z]{5,11}$/);
    expect(newSetupId()).toMatch(/^s_[0-9a-z]{5,11}$/);
    expect(newChecklistItemId()).toMatch(/^c[0-9a-z]{5,11}$/);
    expect(new Set(Array.from({ length: 50 }, () => newId("h_"))).size).toBe(50);
  });
});
