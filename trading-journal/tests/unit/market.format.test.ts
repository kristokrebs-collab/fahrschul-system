import { describe, expect, it } from "vitest";
import { ddmmHHmm, hhmm, hhmmss, mmss, n0, n1, n2, n4, signed } from "@/market/format";
import { date, dateTime, time } from "@/lib/format";

const T = Date.UTC(2026, 9, 1, 12, 5, 9); // 01.10.2026 12:05:09 UTC

describe("market/format (cached Intl formatters)", () => {
  it("numbers: de-DE grouping, fixed fractions, U+2212", () => {
    expect(n0(84206.4)).toBe("84.206");
    expect(n0(-1234.6)).toBe("−1.235");
    expect(n1(1.25)).toBe("1,3");
    expect(n2(-0.5)).toBe("−0,50");
    expect(n4(0.0001)).toBe("0,0001");
    expect(signed(1.234)).toBe("+1,2");
    expect(signed(-1.234, 2)).toBe("−1,23");
    expect(signed(0, 3)).toBe("+0,000");
  });

  it("dates: one cached formatter per time zone", () => {
    expect(hhmm(T, "UTC")).toBe("12:05");
    expect(hhmm(T, "Europe/Berlin")).toBe("14:05");
    expect(hhmm(T, "UTC")).toBe("12:05");
    expect(ddmmHHmm(T, "UTC")).toBe("01.10. 12:05");
    expect(ddmmHHmm(T, "Asia/Tokyo")).toBe("01.10. 21:05");
    expect(hhmm(T)).toBe(new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(T));
  });

  it("durations", () => {
    expect(hhmmss(6 * 3_600_000 - 1)).toBe("05:59:59");
    expect(hhmmss(-5)).toBe("00:00:00");
    expect(mmss(61_500)).toBe("01:01");
  });
});

describe("lib/format date helpers match toLocale*String", () => {
  it("date / time / dateTime are byte-identical to the per-call variants", () => {
    for (const ms of [T, Date.UTC(2025, 0, 1, 0, 0), Date.UTC(2030, 11, 31, 23, 59)]) {
      const d = new Date(ms);
      expect(date(d)).toBe(d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }));
      expect(time(d)).toBe(d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
      expect(dateTime(d)).toBe(d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));
    }
    expect(date(new Date(Number.NaN))).toBe("–");
    expect(time(new Date(Number.NaN))).toBe("");
    expect(dateTime(new Date(Number.NaN))).toBe("–");
  });
});
