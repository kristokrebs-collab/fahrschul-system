/**
 * F29 comma / point and time zone handling of screenshot readings (`src/journal/extract/numbers.ts`, `time.ts`).
 */
import { describe, expect, it } from "vitest";
import { detectNumberStyle, parseLeverage, parseShotNumber } from "@/journal/extract/numbers";
import { minutesBetween, parseShotTime, parseZone, toLocalWall } from "@/journal/extract/time";

describe("parseShotNumber – clear formats", () => {
  const table: [string, number, "point" | "comma" | null][] = [
    ["67.432,5", 67432.5, "comma"],
    ["1,234.50", 1234.5, "point"],
    ["1.234,50", 1234.5, "comma"],
    ["0,5", 0.5, "comma"],
    ["0.5", 0.5, "point"],
    ["12.3456", 12.3456, "point"],
    ["12,3456", 12.3456, "comma"],
    ["0.123", 0.123, "point"],
    ["0,123", 0.123, "comma"],
    ["1234.567", 1234.567, "point"],
    ["1.234.567", 1234567, null],
    ["1,234,567", 1234567, null],
    ["1 234,5", 1234.5, "comma"],
    ["1 234,5", 1234.5, "comma"],
    ["1'234.5", 1234.5, "point"],
    ["67432", 67432, null],
    ["−12.40", -12.4, "point"],
    ["-1,35", -1.35, "comma"],
    ["+27,48 USDT", 27.48, "comma"],
    ["(12.5)", -12.5, "point"],
    ["12.5-", -12.5, "point"],
    ["$ 1,234.5", 1234.5, "point"],
    ["10x", 10, null],
    ["0.05 BTC", 0.05, "point"],
    ["12.", 12, null],
  ];
  it.each(table)("%s → %s", (raw, value, style) => {
    const p = parseShotNumber(raw);
    expect(p).not.toBeNull();
    expect(p!.value).toBeCloseTo(value, 9);
    expect(p!.ambiguous).toBe(false);
    expect(p!.style).toBe(style);
  });

  it.each(["", "abc", "-", "—", "1.2.3", "1,234.567.8"])("%j is not a number", (raw) => {
    expect(parseShotNumber(raw)).toBeNull();
  });
  it("null / undefined", () => {
    expect(parseShotNumber(null)).toBeNull();
    expect(parseShotNumber(undefined)).toBeNull();
  });
});

describe("parseShotNumber – ambiguous three-digit groups", () => {
  it("without a style: the point is a decimal, the comma a thousands separator – and it says so", () => {
    expect(parseShotNumber("1.234")).toMatchObject({ value: 1.234, ambiguous: true, alt: 1234 });
    expect(parseShotNumber("1,234")).toMatchObject({ value: 1234, ambiguous: true, alt: 1.234 });
    expect(parseShotNumber("-1,234")).toMatchObject({ value: -1234, ambiguous: true, alt: -1.234 });
  });
  it("the screenshot's own style settles it", () => {
    expect(parseShotNumber("1.234", "comma")).toMatchObject({ value: 1234, ambiguous: false });
    expect(parseShotNumber("1,234", "comma")).toMatchObject({ value: 1.234, ambiguous: false });
    expect(parseShotNumber("1.234", "point")).toMatchObject({ value: 1.234, ambiguous: false });
    expect(parseShotNumber("1,234", "point")).toMatchObject({ value: 1234, ambiguous: false });
  });
  it("a leading zero or a long integer part is never a thousands group", () => {
    expect(parseShotNumber("0.250", "comma")).toMatchObject({ value: 0.25, ambiguous: false });
    expect(parseShotNumber("12345.678", "comma")).toMatchObject({ value: 12345.678, ambiguous: false });
  });
});

describe("detectNumberStyle", () => {
  it("takes the style the numbers prove, majority wins", () => {
    expect(detectNumberStyle(["67.432,5", "0,05", "1.234"])).toBe("comma");
    expect(detectNumberStyle(["1,234.50", "12.5", "3,100"])).toBe("point");
  });
  it("no proof or a tie → null", () => {
    expect(detectNumberStyle(["1.234", "5,678", "100"])).toBeNull();
    expect(detectNumberStyle(["0,5", "0.5"])).toBeNull();
    expect(detectNumberStyle([])).toBeNull();
  });
});

describe("parseLeverage", () => {
  it.each([
    ["10x", 10],
    ["x10", 10],
    ["10.0X", 10],
    ["25 x", 25],
    ["Isolated 5x", 5],
  ])("%s → %s", (raw, v) => expect(parseLeverage(raw)).toBe(v));
  it("rejects zero and non-numbers", () => {
    expect(parseLeverage("0x")).toBeNull();
    expect(parseLeverage("Cross")).toBeNull();
  });
});

describe("parseShotTime", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ctx = { now };
  const full: [string, string, string, number | null][] = [
    ["2026-10-17 14:32:08", "2026-10-17", "14:32", 8],
    ["2026-10-17T14:32", "2026-10-17", "14:32", null],
    ["2026/10/17 14:32", "2026-10-17", "14:32", null],
    ["17.10.2026 14:32", "2026-10-17", "14:32", null],
    ["17.10.26, 14:32:59", "2026-10-17", "14:32", 59],
    ["17.10.2026 um 14:32", "2026-10-17", "14:32", null],
    ["10/17/2026 02:32:08 PM", "2026-10-17", "14:32", 8],
    ["17/10/2026 14:32", "2026-10-17", "14:32", null],
    ["Oct 17, 2026 2:32 PM", "2026-10-17", "14:32", null],
    ["17 Okt 2026 14:32", "2026-10-17", "14:32", null],
    ["12/31/2026 12:05 AM", "2026-12-31", "00:05", null],
    ["12/31/2026 12:05 PM", "2026-12-31", "12:05", null],
  ];
  it.each(full)("%s", (raw, date, time, sec) => {
    const t = parseShotTime(raw, ctx)!;
    expect(t).toMatchObject({ date, time, seconds: sec });
    expect(t.assumed).not.toContain("year");
  });

  it("an ambiguous numeric date follows the context order and says it assumed", () => {
    expect(parseShotTime("05/06/2026 10:00", ctx)).toMatchObject({ date: "2026-06-05", assumed: ["order"] });
    expect(parseShotTime("05/06/2026 10:00", { now, order: "mdy" })).toMatchObject({ date: "2026-05-06", assumed: ["order"] });
    expect(parseShotTime("13/06/2026 10:00", ctx)?.assumed).toEqual([]);
    expect(parseShotTime("06/13/2026 10:00", ctx)).toMatchObject({ date: "2026-06-13", assumed: [] });
  });

  it("a date without a year assumes the current one (previous when it would lie in the future)", () => {
    expect(parseShotTime("10-17 14:32", ctx)).toMatchObject({ date: "2026-10-17", time: "14:32", assumed: ["year"] });
    expect(parseShotTime("17.10. 14:32", ctx)).toMatchObject({ date: "2026-10-17", assumed: ["year"] });
    expect(parseShotTime("17. Okt. 14:32", ctx)).toMatchObject({ date: "2026-10-17", assumed: ["year"] });
    expect(parseShotTime("Oct 17 14:32", ctx)).toMatchObject({ date: "2026-10-17", assumed: ["year"] });
    expect(parseShotTime("12-30 14:32", ctx)).toMatchObject({ date: "2025-12-30", assumed: ["year"] });
    expect(parseShotTime("10-17 14:32", ctx)?.assumed).not.toContain("order");
  });

  it("no-year dash dates read month first unless a value above 12 says otherwise", () => {
    expect(parseShotTime("03-04 09:00", ctx)).toMatchObject({ date: "2026-03-04", assumed: expect.arrayContaining(["order", "year"]) });
    expect(parseShotTime("17-10 09:00", ctx)).toMatchObject({ date: "2026-10-17" });
  });

  it("a time of day alone has no date", () => {
    expect(parseShotTime("14:32:08", ctx)).toEqual({ date: null, time: "14:32", seconds: 8, assumed: [] });
    expect(parseShotTime("2:05 PM", ctx)).toMatchObject({ date: null, time: "14:05" });
  });

  it.each(["", "gestern", "32.13.2026 10:00", "2026-02-30 10:00", "17.10.2026 25:00", "17.10."])("%j is not a time", (raw) => {
    expect(parseShotTime(raw, ctx)).toBeNull();
  });
});

describe("zones", () => {
  it.each([
    ["UTC", 0],
    ["UTC+8", 480],
    ["UTC +8", 480],
    ["UTC+08:00", 480],
    ["GMT−5", -300],
    ["UTC+5:30", 330],
    ["CET", 60],
    ["MESZ", 120],
    ["EST", -300],
  ])("%s → %s min", (text, minutes) => {
    expect(parseZone(text)).toMatchObject({ kind: "offset", minutes });
  });
  it("IANA ids, and nothing else", () => {
    expect(parseZone("Europe/Berlin")).toMatchObject({ kind: "iana", id: "Europe/Berlin" });
    expect(parseZone("Mars/Olympus")).toBeNull();
    expect(parseZone("Mittagszeit")).toBeNull();
    expect(parseZone("UTC+20")).toBeNull();
    expect(parseZone(null)).toBeNull();
  });

  const utc8 = parseZone("UTC+8")!;
  it("converts a fixed offset into the journal's zone (summer time)", () => {
    expect(toLocalWall("2026-10-17", "14:32", 8, utc8, "Europe/Berlin")).toBe("2026-10-17T08:32:08");
    expect(toLocalWall("2026-10-17", "14:32", null, utc8, "Europe/Berlin")).toBe("2026-10-17T08:32");
  });
  it("crosses midnight and uses the offset of the day (winter time)", () => {
    expect(toLocalWall("2026-10-18", "01:30", null, utc8, "Europe/Berlin")).toBe("2026-10-17T19:30");
    expect(toLocalWall("2026-12-01", "01:30", null, utc8, "Europe/Berlin")).toBe("2026-11-30T18:30");
  });
  it("IANA → IANA honours differing daylight-saving dates (US started 8 March, EU 29 March)", () => {
    const ny = parseZone("America/New_York")!;
    expect(toLocalWall("2026-03-10", "09:00", null, ny, "Europe/Berlin")).toBe("2026-03-10T14:00");
    expect(toLocalWall("2026-04-10", "09:00", null, ny, "Europe/Berlin")).toBe("2026-04-10T15:00");
  });
  it("the same zone keeps the wall clock", () => {
    expect(toLocalWall("2026-10-17", "14:32", 8, parseZone("Europe/Berlin")!, "Europe/Berlin")).toBe("2026-10-17T14:32:08");
  });
  it("minutesBetween", () => {
    expect(minutesBetween("2026-10-17T14:32", "2026-10-17T14:42")).toBe(10);
    expect(minutesBetween("2026-10-17T14:32:00", "2026-10-17T14:31:00")).toBe(-1);
    expect(minutesBetween("x", "2026-10-17T14:31")).toBeNaN();
  });
});
