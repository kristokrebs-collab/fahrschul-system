import { describe, expect, it } from "vitest";
import { fmt, n0, n1, n2, signed, pct, pct0, r, price, date, time, dateTime, pf, colorClass, toneClass, mio, minus, isFin } from "@/lib/format";
import {
  parseNumber,
  toInputString,
  sanitizeUrl,
  fractionToPercentInput,
  percentInputToFraction,
  toNonNegativeInt,
  rt,
  nt,
  XM,
} from "@/lib/parse";


describe("lib/format (bundle V)", () => {
  it("n0/n1/n2 use de-DE grouping and U+2212", () => {
    expect(n0(85900)).toBe("85.900");
    expect(n0(-1234.6)).toBe("−1.235");
    expect(n1(1.25)).toBe("1,3");
    expect(n1(-0.04)).toBe("−0,0");
    expect(n2(1.2)).toBe("1,20");
    expect(n2(-1234567.891)).toBe("−1.234.567,89");
  });
  it("null/undefined/NaN/Infinity → en dash", () => {
    for (const f of [n0, n1, n2, pct, pct0, r, price]) {
      expect(f(null)).toBe("–");
      expect(f(undefined)).toBe("–");
      expect(f(NaN)).toBe("–");
      expect(f(Infinity)).toBe("–");
    }
    expect(signed(null)).toBe("–");
  });
  it("signed with 0/1/2 decimals", () => {
    expect(signed(396)).toBe("+396,00");
    expect(signed(-100)).toBe("−100,00");
    expect(signed(0)).toBe("0,00");
    expect(signed(12.345, 1)).toBe("+12,3");
    expect(signed(-12.5, 0)).toBe("−13");
  });
  it("pct / pct0", () => {
    expect(pct(0.05)).toBe(`+5,0 %`);
    expect(pct(-0.0059)).toBe(`−0,6 %`);
    expect(pct(0.05, false)).toBe(`5,0 %`);
    expect(pct(0)).toBe(`0,0 %`);
    expect(pct0(0.4)).toBe(`40 %`);
    expect(pct0(0.6215)).toBe(`62 %`);
    // bundle quirk: pct0 has no U+2212 replacement
    expect(pct0(-0.1)).toBe(`-10 %`);
  });
  it("r multiple", () => {
    expect(r(3.96)).toBe(`+3,96 R`);
    expect(r(-2)).toBe(`−2,00 R`);
    expect(r(0)).toBe(`0,00 R`);
  });
  it("price: 4 decimals below 10, else 2", () => {
    expect(price(84000)).toBe("84.000");
    expect(price(84000.5)).toBe("84.000,5");
    expect(price(1.23456)).toBe("1,2346");
    expect(price(0.5)).toBe("0,5");
  });
  it("date/time/dateTime", () => {
    const d = new Date("2026-03-12T09:05");
    expect(date(d)).toBe("12.03.26");
    expect(time(d)).toBe("09:05");
    expect(dateTime(d)).toBe("12.03., 09:05");
    expect(date(new Date("nope"))).toBe("–");
    expect(time(new Date("nope"))).toBe("");
  });
  it("pf cell and helpers", () => {
    expect(pf(null)).toBe("–");
    expect(pf(Infinity)).toBe("∞");
    expect(pf(2.23)).toBe("2,23");
    expect(colorClass(0)).toBe("text-fg");
    expect(colorClass(null)).toBe("text-fg");
    expect(colorClass(3)).toBe("text-win");
    expect(colorClass(-3)).toBe("text-loss");
    expect(toneClass(null)).toBe("text-fg");
    expect(toneClass(-0.1)).toBe("text-loss");
    expect(mio(1_500_000)).toBe(`1,5 Mio`);
    expect(mio(25000)).toBe("25.000");
    expect(minus("-1-2")).toBe("−1-2");
    expect(isFin("1")).toBe(false);
    expect(fmt.n2).toBe(n2);
  });
});

describe("lib/parse (bundle rt/nt/XM)", () => {
  it("parses comma and point decimals", () => {
    expect(parseNumber("85.900,5")).toBe(85900.5);
    expect(parseNumber("85.900")).toBe(85.9);
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber(" 12,5 ")).toBe(12.5);
    expect(parseNumber("-4")).toBe(-4);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(NaN)).toBeNull();
    expect(parseNumber(Infinity)).toBeNull();
    expect(parseNumber(42)).toBe(42);
    expect(rt).toBe(parseNumber);
  });
  it("formats numbers for inputs", () => {
    expect(toInputString(1234.5)).toBe("1234,5");
    expect(toInputString(4)).toBe("4");
    expect(toInputString(null)).toBe("");
    expect(toInputString(undefined)).toBe("");
    expect(nt).toBe(toInputString);
    expect(fractionToPercentInput(0.6215)).toBe("62,15");
    expect(fractionToPercentInput(-0.0931)).toBe("-9,31");
    expect(fractionToPercentInput(null)).toBe("");
    expect(percentInputToFraction("62,15")).toBeCloseTo(0.6215, 10);
    expect(percentInputToFraction("")).toBeNull();
    expect(toNonNegativeInt(2.4)).toBe(2);
    expect(toNonNegativeInt(-3)).toBe(0);
    expect(toNonNegativeInt(null)).toBe(0);
  });
  it("sanitizes chart URLs", () => {
    expect(sanitizeUrl(" https://www.tradingview.com/x/abc ")).toBe("https://www.tradingview.com/x/abc");
    expect(sanitizeUrl("HTTP://x.y")).toBe("HTTP://x.y");
    expect(sanitizeUrl("www.tradingview.com")).toBe("");
    expect(sanitizeUrl(null)).toBe("");
    expect(XM).toBe(sanitizeUrl);
  });
});
