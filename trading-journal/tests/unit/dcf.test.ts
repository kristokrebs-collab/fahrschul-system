/**
 * DCF (`/dcf`): the arithmetic of the user's skill rebuilt and checked by hand (numbers worked out on paper, see the comments),
 * the honest edge cases (WACC ≤ g, negative free cash flow, negative equity), the sensitivity table and its range, the reverse
 * DCF, and the starting values from SEC numbers (which never contain a forecast).
 */
import { describe, expect, it } from "vitest";
import { analyse } from "@/domain/analyst";
import { buildAssumptions, checkAssumptions, EMPTY_SIMPLE, EXAMPLE_RATES, impliedGrowth, linearPath, rangeOf, runDcf, seedFromAnalyst, sensitivity, simpleFromSeed, valueFromFcf, type DcfAssumptions, type SimpleAssumptions } from "@/domain/dcf";
import { factsPayload } from "../fixtures/sec";

const NOW = Date.UTC(2026, 9, 25);

/**
 * By hand: revenue 1,000 grows 10 % a year for 3 years (1,100 / 1,210 / 1,331), EBIT margin 20 % (220 / 242 / 266.2), tax 25 %
 * (NOPAT 165 / 181.5 / 199.65), reinvestment 40 % → FCF 99 / 108.9 / 119.79. At WACC 10 % each year's present value is exactly 90
 * (99/1.1 = 108.9/1.21 = 119.79/1.331), so the explicit part is 270. Terminal value 119.79 × 1.02 / 0.08 = 1,527.3225, discounted
 * by 1.331 = 1,147.5. Enterprise value 1,417.5, terminal share 1,147.5 / 1,417.5 = 80.95 %, minus net debt 200 = 1,217.5, over 50
 * shares = 24.35 per share.
 */
const HAND: DcfAssumptions = { baseRevenue: 1000, growth: [0.1, 0.1, 0.1], ebitMargin: [0.2, 0.2, 0.2], taxRate: 0.25, reinvestmentRate: [0.4, 0.4, 0.4], wacc: 0.1, terminalGrowth: 0.02, netDebt: 200, shares: 50 };

describe("value", () => {
  it("matches the hand calculation", () => {
    const r = runDcf(HAND);
    expect(r.status).toBe("ok");
    expect(r.years.map((y) => y.revenue)).toEqual([1100, 1210, 1331].map((x) => expect.closeTo(x, 9)));
    expect(r.years.map((y) => y.fcf)).toEqual([99, 108.9, 119.79].map((x) => expect.closeTo(x, 9)));
    expect(r.years.map((y) => y.presentValue)).toEqual([90, 90, 90].map((x) => expect.closeTo(x, 9)));
    const v = r.value!;
    expect(v.explicit).toBeCloseTo(270, 9);
    expect(v.terminalValue).toBeCloseTo(1527.3225, 9);
    expect(v.terminalPv).toBeCloseTo(1147.5, 9);
    expect(v.enterpriseValue).toBeCloseTo(1417.5, 9);
    expect(v.terminalShare).toBeCloseTo(1147.5 / 1417.5, 12);
    expect(v.equityValue).toBeCloseTo(1217.5, 9);
    expect(v.perShare).toBeCloseTo(24.35, 9);
  });

  it("is the formula of the skill's script: perpetuity of 100 at 10 % is worth 1,000; the skill's example gives 1,963.21", () => {
    // 100 a year for ever at 10 %: explicit 173.5537 + terminal 826.4463 = 1,000
    const p = valueFromFcf([100, 100], 0.1, 0)!;
    expect(p.explicit).toBeCloseTo(173.553719, 6);
    expect(p.terminalPv).toBeCloseTo(826.446281, 6);
    expect(p.enterpriseValue).toBeCloseTo(1000, 9);
    // the example of the skill: --fcf 100,110,121,133,146 --wacc 0.09 --g 0.025 --net-debt 300 --shares 50 (worked out by hand: EV 1,963.21)
    const e = valueFromFcf([100, 110, 121, 133, 146], 0.09, 0.025)!;
    expect(e.enterpriseValue).toBeCloseTo(1963.2147, 3);
    expect((e.enterpriseValue - 300) / 50).toBeCloseTo(33.2643, 3);
    expect(e.terminalPv / e.enterpriseValue).toBeCloseTo(0.7622, 3);
  });

  it("shows how much of the value is terminal value (the largest part) and warns when the debt eats the equity", () => {
    expect(runDcf(HAND).value!.terminalShare!).toBeGreaterThan(0.5);
    const deep = runDcf({ ...HAND, netDebt: 5000 });
    expect(deep.status).toBe("ok");
    expect(deep.value!.perShare).toBeLessThan(0);
    expect(deep.issues.some((i) => i.field === "netDebt" && i.level === "warn")).toBe(true);
  });

  it("net cash (negative net debt) adds to the equity value", () => {
    expect(runDcf({ ...HAND, netDebt: -100 }).value!.perShare).toBeCloseTo((1417.5 + 100) / 50, 9);
  });

  it("handles a one-year horizon and a long one", () => {
    const one = runDcf({ ...HAND, growth: [0.1], ebitMargin: [0.2], reinvestmentRate: [0.4] });
    expect(one.status).toBe("ok");
    expect(one.years).toHaveLength(1);
    expect(one.value!.explicit).toBeCloseTo(99 / 1.1, 9);
    const long = runDcf({ ...HAND, growth: Array(15).fill(0.05), ebitMargin: Array(15).fill(0.2), reinvestmentRate: Array(15).fill(0.3) });
    expect(long.status).toBe("ok");
    expect(runDcf({ ...HAND, growth: Array(16).fill(0.05), ebitMargin: Array(16).fill(0.2), reinvestmentRate: Array(16).fill(0.3) }).status).toBe("invalid");
  });
});

describe("edge cases are caught, not computed", () => {
  it("WACC ≤ terminal growth: no value, with the reason", () => {
    for (const wacc of [0.02, 0.01]) {
      const r = runDcf({ ...HAND, wacc, terminalGrowth: 0.02 });
      expect(r.status).toBe("invalid");
      expect(r.value).toBeNull();
      expect(r.issues.find((i) => i.level === "error")!.text).toContain("WACC muss größer sein als das Endwachstum");
    }
    expect(valueFromFcf([1, 2], 0.05, 0.05)).toBeNull();
  });

  it("negative free cash flow in the last year: no terminal value, explained", () => {
    const r = runDcf({ ...HAND, ebitMargin: [0.2, 0.2, -0.1] });
    expect(r.status).toBe("no-terminal");
    expect(r.value).toBeNull();
    expect(r.years).toHaveLength(3);
    expect(r.issues.map((i) => i.text).join(" ")).toContain("Endwert nach dem Gordon-Modell ist dann nicht sinnvoll");
  });

  it("negative free cash flow in early years is allowed and warned about", () => {
    const r = runDcf({ ...HAND, ebitMargin: [-0.05, 0.1, 0.25] });
    expect(r.status).toBe("ok");
    expect(r.years[0]!.fcf).toBeLessThan(0);
    expect(r.issues.find((i) => i.field === "fcf" && i.level === "warn")!.text).toContain("Jahr 1");
  });

  it("rejects impossible inputs one by one", () => {
    const err = (patch: Partial<DcfAssumptions>) => checkAssumptions({ ...HAND, ...patch }).filter((i) => i.level === "error").map((i) => i.field);
    expect(err({ shares: 0 })).toEqual(["shares"]);
    expect(err({ baseRevenue: -5 })).toEqual(["baseRevenue"]);
    expect(err({ taxRate: 1 })).toEqual(["tax"]);
    expect(err({ wacc: 0, terminalGrowth: -0.01 })).toContain("wacc");
    expect(err({ growth: [0.1, -1, 0.1] })).toEqual(["growth"]);
    expect(err({ growth: [0.1, 0.1] })).toEqual(["horizon"]);
    expect(err({ growth: [] , ebitMargin: [], reinvestmentRate: [] })).toEqual(["horizon"]);
    expect(err({ wacc: Number.NaN })).toEqual(["inputs"]);
    expect(runDcf({ ...HAND, shares: 0 }).status).toBe("invalid");
  });

  it("warns about rates that look wrong without stopping", () => {
    const w = (patch: Partial<DcfAssumptions>) => checkAssumptions({ ...HAND, ...patch }).filter((i) => i.level === "warn").map((i) => i.field);
    expect(w({ terminalGrowth: 0.05, wacc: 0.1 })).toContain("terminalGrowth");
    expect(w({ terminalGrowth: -0.01 })).toContain("terminalGrowth");
    expect(w({ wacc: 0.04 })).toContain("wacc");
    expect(w({ wacc: 0.25 })).toContain("wacc");
    expect(w({ growth: [0.8, 0.1, 0.1] })).toContain("growth");
    expect(w({ ebitMargin: [0.7, 0.2, 0.2] })).toContain("margin");
    expect(w({ reinvestmentRate: [2, 0.4, 0.4] })).toContain("reinvestment");
  });
});

describe("sensitivity and range", () => {
  const s = sensitivity(HAND)!;

  it("is a 5 × 5 table, WACC down the side, terminal growth across, the base case in the middle", () => {
    expect(s.cells).toHaveLength(5);
    expect(s.cells[0]).toHaveLength(5);
    expect(s.waccs.map((w) => Math.round(w * 1000) / 1000)).toEqual([0.08, 0.09, 0.1, 0.11, 0.12]);
    expect(s.growths.map((g) => Math.round(g * 10000) / 10000)).toEqual([0.01, 0.015, 0.02, 0.025, 0.03]);
    expect(s.center).toEqual({ row: 2, col: 2 });
    expect(s.cells[2]![2]!.perShare).toBeCloseTo(runDcf(HAND).value!.perShare, 9);
  });

  it("matches the hand-worked values of the inner block (WACC 9 / 10 / 11 %, g 1,5 / 2 / 2,5 %)", () => {
    const inner = [1, 2, 3].map((i) => [1, 2, 3].map((j) => s.cells[i]![j]!.perShare!));
    const want = [
      [26.5363, 28.4568, 30.6727],
      [22.8941, 24.35, 26.0],
      [20.0198, 21.1569, 22.4278],
    ];
    inner.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(want[i]![j]!, 3)));
  });

  it("states the result as a range over the inner block, with the base value inside", () => {
    const r = rangeOf(s)!;
    expect(r.low).toBeCloseTo(20.0198, 3);
    expect(r.high).toBeCloseTo(30.6727, 3);
    expect(r.mid).toBeCloseTo(24.35, 9);
    expect(r.low).toBeLessThan(r.mid!);
    expect(r.high).toBeGreaterThan(r.mid!);
    expect(r.waccSpan.map((x) => Math.round(x * 1000) / 1000)).toEqual([0.09, 0.11]);
    expect(r.growthSpan.map((x) => Math.round(x * 10000) / 10000)).toEqual([0.015, 0.025]);
  });

  it("leaves cells empty where WACC ≤ g instead of inventing a value", () => {
    const tight = sensitivity({ ...HAND, wacc: 0.03, terminalGrowth: 0.025 })!;
    expect(tight.cells[2]![2]!.perShare).not.toBeNull(); // 3 % vs 2,5 % is still valid
    expect(tight.cells[2]![3]!.perShare).toBeNull(); // 3 % vs 3 %
    expect(tight.cells[2]![4]!.perShare).toBeNull(); // 3 % vs 3,5 %
    expect(tight.cells[0]![0]!.perShare).toBeNull(); // 1 % vs 1,5 %
    const bad = sensitivity({ ...HAND, shares: 0 });
    expect(bad).toBeNull();
    // the last year's free cash flow is negative: no terminal value anywhere
    const none = sensitivity({ ...HAND, ebitMargin: [0.2, 0.2, -0.1] })!;
    expect(none.cells.flat().every((c) => c.perShare === null)).toBe(true);
    expect(rangeOf(none)).toBeNull();
  });
});

describe("form values → assumptions", () => {
  it("builds straight-line paths between the first and the last year", () => {
    expect(linearPath(0.1, 0.02, 5).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.1, 0.08, 0.06, 0.04, 0.02]);
    expect(linearPath(0.1, 0.02, 1)).toEqual([0.1]);
  });

  const FULL: SimpleAssumptions = { years: 3, baseRevenue: 1000, growthStart: 0.1, growthEnd: 0.1, marginStart: 0.2, marginEnd: 0.2, reinvestStart: 0.4, reinvestEnd: 0.4, taxRate: 0.25, wacc: 0.1, terminalGrowth: 0.02, netDebt: 200, shares: 50 };

  it("builds the same assumptions as the hand case", () => {
    const b = buildAssumptions(FULL);
    expect(b.missing).toEqual([]);
    expect(runDcf(b.assumptions!).value!.perShare).toBeCloseTo(24.35, 9);
  });

  it("names every missing input and builds nothing", () => {
    const b = buildAssumptions(EMPTY_SIMPLE);
    expect(b.assumptions).toBeNull();
    expect(b.missing).toContain("WACC");
    expect(b.missing).toContain("Endwachstum");
    expect(b.missing).toContain("Aktienzahl");
    expect(buildAssumptions({ ...FULL, wacc: null }).missing).toEqual(["WACC"]);
    expect(buildAssumptions({ ...FULL, years: 0 }).missing).toEqual(["Zeitraum (1 bis 15 Jahre)"]);
  });
});

describe("reverse DCF – what would have to be true", () => {
  const FORM: SimpleAssumptions = { years: 5, baseRevenue: 1000, growthStart: 0.05, growthEnd: 0.05, marginStart: 0.2, marginEnd: 0.2, reinvestStart: 0.3, reinvestEnd: 0.3, taxRate: 0.25, wacc: 0.09, terminalGrowth: 0.025, netDebt: 100, shares: 50 };
  const at = (g: number): number => {
    const r = runDcf(buildAssumptions({ ...FORM, growthStart: g, growthEnd: g }).assumptions!);
    return r.value!.perShare;
  };

  it("finds the constant growth that reaches a target value (round trip)", () => {
    const target = at(0.12);
    const r = impliedGrowth(FORM, target);
    expect(r.reason).toBe("ok");
    expect(r.growth!).toBeCloseTo(0.12, 6);
    // a target of 1.5 × and 3 × the base value needs more growth, in that order
    const base = at(0.05);
    const g15 = impliedGrowth(FORM, base * 1.5).growth!;
    const g3 = impliedGrowth(FORM, base * 3).growth!;
    expect(g15).toBeGreaterThan(0.05);
    expect(g3).toBeGreaterThan(g15);
    expect(at(g3)).toBeCloseTo(base * 3, 4);
  });

  it("says when the target cannot be reached in the search range, and when inputs are missing", () => {
    expect(impliedGrowth(FORM, at(1.0) * 2).reason).toBe("above-range");
    expect(impliedGrowth(FORM, at(-0.3) / 2).reason).toBe("below-range");
    const m = impliedGrowth({ ...FORM, wacc: null }, 10);
    expect(m.reason).toBe("missing");
    expect(m.missing).toEqual(["WACC"]);
    expect(impliedGrowth({ ...FORM, marginStart: -0.1, marginEnd: -0.1 }, 10).reason).toBe("no-value");
  });
});

describe("starting values from SEC numbers – filed numbers only, no forecast", () => {
  const aapl = seedFromAnalyst(analyse(factsPayload("AAPL"), { now: NOW }));
  const nwin = seedFromAnalyst(analyse(factsPayload("NWIN"), { now: NOW }));

  it("takes revenue of the last four quarters and says so", () => {
    expect(aapl.baseRevenue).toBe(466_823e6);
    expect(aapl.sources.baseRevenue).toContain("Summe der letzten vier Quartale bis 27.06.2026");
    expect(aapl.currency).toBe("USD");
    expect(aapl.asOf).toBe("2026-06-27");
    expect(aapl.stamp.source).toBe("SEC EDGAR (XBRL)");
  });

  it("leaves out what the data does not have (AAPL here: no operating income, tax, debt) and states why", () => {
    expect(aapl.ebitMargin).toBeNull();
    expect(aapl.taxRate).toBeNull();
    expect(aapl.reinvestmentRate).toBeNull();
    expect(aapl.netDebt).toBeNull();
    expect(aapl.sources.ebitMargin).toContain("keine Daten");
    expect(aapl.sources.netDebt).toContain("keine Daten");
    expect(aapl.shares).toBe(14_715e6);
  });

  it("computes margin, net debt and shares from filed numbers (NWIN) and keeps the growth only as a hint", () => {
    expect(nwin.baseRevenue).toBe(495e6);
    expect(nwin.ebitMargin).toBeCloseTo(65 / 495, 9);
    expect(nwin.netDebt).toBe(130e6);
    expect(nwin.shares).toBe(10e6);
    expect(nwin.growthHint).toBeCloseTo(0.125, 9);
    expect(nwin.sources.growthHint).toContain("ein Hinweis, keine Annahme");
    expect(nwin.taxRate).toBeNull(); // no tax concepts in this company's facts
  });

  it("fills the form with the filed values only – growth, WACC and terminal growth stay empty", () => {
    const f = simpleFromSeed(nwin, 7);
    expect(f).toMatchObject({ years: 7, baseRevenue: 495e6, netDebt: 130e6, shares: 10e6, growthStart: null, growthEnd: null, wacc: null, terminalGrowth: null });
    expect(buildAssumptions(f).assumptions).toBeNull();
    expect(EXAMPLE_RATES).toEqual({ wacc: 0.09, terminalGrowth: 0.025 });
  });

  it("takes tax and reinvestment from filed numbers when the facts have them", () => {
    const p = structuredClone(factsPayload("NWIN"));
    const mk = (concept: string, per: Record<string, number>) => {
      p.facts[concept] = { unit: "USD", rows: Object.entries(per).map(([end, v]) => ({ start: addQ(end), end, val: v * 1e6, form: "10-Q", filed: "2025-11-04", accn: "z-1", fy: 2025, fp: "Q3" })) };
    };
    const addQ = (end: string): string => ({ "2025-09-30": "2025-07-01", "2025-06-30": "2025-04-01", "2025-03-31": "2025-01-01", "2024-12-31": "2024-10-01" })[end]!;
    const ends = { "2025-09-30": 1, "2025-06-30": 1, "2025-03-31": 1, "2024-12-31": 1 };
    mk("us-gaap:IncomeTaxExpenseBenefit", Object.fromEntries(Object.keys(ends).map((k) => [k, 3])));
    mk("us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", Object.fromEntries(Object.keys(ends).map((k) => [k, 15])));
    mk("us-gaap:DepreciationDepletionAndAmortization", Object.fromEntries(Object.keys(ends).map((k) => [k, 4])));
    const s = seedFromAnalyst(analyse(p, { now: NOW }));
    // 12 of tax on 60 of pre-tax income = 20 %
    expect(s.taxRate).toBeCloseTo(0.2, 9);
    // (capex 29 − depreciation 16) / (operating income 65 × 0.8)
    expect(s.reinvestmentRate).toBeCloseTo(13 / 52, 9);
    expect(s.sources.reinvestmentRate).toContain("Veränderung des Betriebskapitals ist NICHT enthalten");
  });
});
