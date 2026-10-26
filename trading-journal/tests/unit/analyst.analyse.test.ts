/**
 * Earnings analyst (F68) on two companies in SEC's real format (`tests/fixtures/sec`):
 *  - AAPL, fiscal year ending in September (52/53 weeks), real reported numbers of FY2024 – FY2026. Checked against TradingView's
 *    quarterly history of 2026-10-25 (Q4 FY25: revenue 102,466 M, gross profit 48,341 M, net income 27,466 M, free cash flow
 *    26,486 M; Q4 FY24: revenue 94,930 M, net income 14,736 M) and against the real run of the user's trader-analyst skill of
 *    2026-10-13 (TTM revenue 466,823 M, TTM net income 128,930 M, TTM EPS 8.71, revenue +16.4 %, net income +27.1 %, EPS +28.7 %).
 *  - NWIN, a made-up calendar-year company with a concept switch, a restatement, cumulative cash flow values, a wrong-currency
 *    tag and a debt split over several items.
 */
import { describe, expect, it } from "vitest";
import { analyse, deltaOf } from "@/domain/analyst";
import type { SecFactsPayload } from "@/market/sec/wire";
import { factsPayload, filingsPayload } from "../fixtures/sec";

const NOW = Date.UTC(2026, 9, 25);
const M = 1e6;
const aapl = analyse(factsPayload("AAPL"), { filings: filingsPayload("AAPL"), now: NOW, quarters: 10 });
const nwin = analyse(factsPayload("NWIN"), { filings: filingsPayload("NWIN"), now: NOW, quarters: 10 });
const row = (r: typeof aapl, end: string) => r.quarters.find((q) => q.end === end)!;

describe("AAPL – checked against TradingView and the real skill run", () => {
  it("lists the quarters newest first with the company's own fiscal numbering", () => {
    expect(aapl.quarters.map((q) => q.end).slice(0, 4)).toEqual(["2026-06-27", "2026-03-28", "2025-12-27", "2025-09-27"]);
    expect(aapl.currency).toBe("USD");
    expect(row(aapl, "2026-06-27")).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 3, calendar: { year: 2026, q: 2 } });
    // a fiscal quarter that ends on 2024-12-28 is calendar Q4 (the middle of the period is in November)
    expect(row(aapl, "2024-12-28")).toMatchObject({ fiscalYear: 2025, fiscalQuarter: 1, calendar: { year: 2024, q: 4 } });
  });

  it("matches the reported quarters (TradingView) incl. the derived Q4", () => {
    const q4 = row(aapl, "2025-09-27");
    expect(q4.revenue!.value).toBe(102_466 * M);
    expect(q4.grossProfit!.value).toBe(48_341 * M);
    expect(q4.netIncome!.value).toBe(27_466 * M);
    expect(q4.operatingIncome!.value).toBe(32_427 * M);
    // operating cash flow of Q4 = year − nine months; capex likewise; free cash flow 26,486 M like TradingView
    expect(q4.operatingCashFlow).toMatchObject({ value: 29_728 * M, derived: "fy-minus-9m" });
    expect(q4.capex!.value).toBe(3_242 * M);
    expect(q4.freeCashFlow!.value).toBe(26_486 * M);
    // the income statement has three single quarters, so Q4 = year − the three quarters
    expect(q4.revenue).toMatchObject({ derived: "fy-minus-quarters", approx: false });
    const q4y = row(aapl, "2024-09-28");
    expect(q4y.revenue!.value).toBe(94_930 * M);
    expect(q4y.grossProfit!.value).toBe(43_879 * M);
    expect(q4y.netIncome!.value).toBe(14_736 * M);
  });

  it("derives cash flow quarters from cumulative 10-Q values (6 and 9 months) and marks them", () => {
    const q2 = row(aapl, "2025-03-29");
    const q3 = row(aapl, "2025-06-28");
    expect(q2.operatingCashFlow).toMatchObject({ value: 23_952 * M, derived: "ytd-diff" });
    expect(q3.operatingCashFlow).toMatchObject({ value: 27_867 * M, derived: "ytd-diff" });
    expect(q2.freeCashFlow!.value).toBe(20_881 * M);
    expect(q3.freeCashFlow!.value).toBe(24_405 * M);
    // the first quarter is a plain 3-month value
    expect(row(aapl, "2024-12-28").operatingCashFlow).toMatchObject({ value: 29_935 * M, derived: null });
  });

  it("marks a derived EPS as approximate (1.84 instead of the reported 1.85)", () => {
    const eps = row(aapl, "2025-09-27").epsDiluted!;
    expect(eps.value).toBeCloseTo(1.84, 6);
    expect(eps).toMatchObject({ derived: "fy-minus-quarters", approx: true });
    expect(row(aapl, "2025-06-28").epsDiluted).toMatchObject({ value: 1.57, derived: null, approx: false });
    expect(aapl.notes.some((n) => n.kind === "derived" && /näherungsweise/.test(n.text))).toBe(true);
  });

  it("reproduces the TTM figures of the real run", () => {
    expect(aapl.ttm).toMatchObject({ end: "2026-06-27", revenue: 466_823 * M, netIncome: 128_930 * M });
    expect(aapl.ttm!.epsDiluted).toBeCloseTo(8.71, 6);
    // gross profit of the four quarters is there, operating income of the newest quarters is not in this data
    expect(aapl.ttm!.grossProfit).toBe(227_123 * M);
    expect(aapl.ttm!.operatingIncome).toBeNull();
  });

  it("compares with the year before (same fiscal quarter) and the quarter before", () => {
    const c = aapl.comparisons[0]!;
    expect(c.yoy.revenue!.pct! * 100).toBeCloseTo(16.4, 1);
    expect(c.yoy.netIncome!.pct! * 100).toBeCloseTo(27.1, 1);
    expect(c.yoy.epsDiluted!.pct! * 100).toBeCloseTo(28.7, 1);
    expect(c.qoq.revenue!.pct! * 100).toBeCloseTo(-1.6, 1);
    expect(aapl.quarters[0]!.grossMargin! * 100).toBeCloseTo(50.1, 1);
    expect(aapl.quarters[0]!.prevEnd).toBe("2026-03-28");
    // 52/53 weeks: the quarter a year earlier ended 364 days before, not on the same calendar day
    expect(aapl.quarters[0]!.yearAgoEnd).toBe("2025-06-28");
    expect(row(aapl, "2024-12-28").yearAgoEnd).toBe("2023-12-30");
  });

  it("says 'keine Daten' for what the filings in this data do not carry – no estimate", () => {
    const q = aapl.quarters[0]!;
    expect(q.operatingIncome).toBeNull();
    expect(q.operatingMargin).toBeNull();
    expect(q.freeCashFlow).toBeNull();
    expect(q.debt).toBeNull();
    expect(q.netDebt).toBeNull();
    const missing = aapl.changes.find((c) => c.id === "missing")!;
    expect(missing.text).toContain("Keine Daten für dieses Quartal");
    expect(missing.text).toMatch(/operatives Ergebnis.*freier Cashflow.*Finanzschulden/);
    // the year before has no cash flow for the quarter either: no growth rate invented
    expect(row(aapl, "2025-09-27").freeCashFlow).not.toBeNull();
    expect(aapl.comparisons[aapl.quarters.findIndex((x) => x.end === "2025-09-27")]!.yoy.freeCashFlow).toBeUndefined();
  });

  it("builds the debt from the tagged items (without leases) where they exist", () => {
    const q = row(aapl, "2024-09-28");
    expect(q.debt!.value).toBe((85_750 + 10_912 + 9_967) * M);
    expect(q.debt!.complete).toBe(true);
    expect(q.debt!.parts.map((p) => p.concept.replace("us-gaap:", ""))).toEqual(["LongTermDebtNoncurrent", "LongTermDebtCurrent", "CommercialPaper"]);
    expect(q.netDebt).toBe((106_629 - 29_943 - 35_228) * M);
  });

  it("links each quarter to the earnings 8-K filed after it (by date) and names the consensus honestly", () => {
    expect(aapl.quarters[0]!.earnings8k).toMatchObject({ filed: "2026-07-30", items: ["2.02", "9.01"] });
    expect(row(aapl, "2025-09-27").earnings8k!.filed).toBe("2025-10-30");
    expect(row(aapl, "2024-09-28").earnings8k).toBeNull();
    expect(aapl.consensus).toEqual({ available: false, text: expect.stringContaining("Kein Konsens, nur gemeldete Zahlen") });
    expect(aapl.notes[0]!.kind).toBe("consensus");
  });

  it("writes the changes as plain sentences with the numbers", () => {
    const text = aapl.changes.map((c) => c.text);
    expect(text[0]).toContain("Quartal Q3 GJ 2026 (Kalender-Q2 2026), Ende 27.06.2026");
    expect(text).toContain("Umsatz 109,42 Mrd. USD: +16,4 % zum Vorjahresquartal (94,04 Mrd. USD), −1,6 % zum Vorquartal (111,18 Mrd. USD).");
    expect(text.find((t) => t.startsWith("Nettoergebnis"))).toBe("Nettoergebnis 29,79 Mrd. USD (+27,1 % zum Vorjahresquartal); verwässertes EPS 2,02 USD (+28,7 % zum Vorjahresquartal).");
    expect(text.find((t) => t.startsWith("Bruttomarge"))).toBe("Bruttomarge 50,1 % (+0,8 Pkt. zum Vorquartal, +3,6 Pkt. zum Vorjahresquartal).");
    expect(text.find((t) => t.startsWith("Verwässerte Aktienzahl"))).toContain("−1,6 % zum Vorjahresquartal");
  });

  it("stamps the result with source, stand and time", () => {
    expect(aapl.stamp).toMatchObject({ source: "SEC EDGAR (XBRL)", sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", asOf: "2026-06-27", stale: false });
    expect(aapl.coverShares).toEqual({ value: 14_697_000_000, asOf: "2026-07-17" });
  });
});

describe("NWIN – concept switch, restatement, cumulative values, currency, debt", () => {
  it("joins two revenue concepts over the years and lists which were used", () => {
    expect(nwin.concepts.revenue).toEqual(["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:Revenues"]);
    expect(row(nwin, "2025-09-30").revenue!.concept).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    // the fourth quarter of 2024 exists only under the old concept: year (10-K) − nine months
    expect(row(nwin, "2024-12-31").revenue).toMatchObject({ value: 120 * M, derived: "fy-minus-9m", concept: "us-gaap:Revenues" });
    expect(nwin.quarters.map((q) => q.end)).toEqual(["2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31"]);
  });

  it("uses the restated value and says what it was before", () => {
    const q = row(nwin, "2024-09-30");
    expect(q.operatingIncome).toMatchObject({ value: 17 * M, revised: { original: 18 * M, originalFiled: "2024-11-05" } });
    // growth against the year before uses the restated 17.0, not the original 18.0
    const c = nwin.comparisons[0]!;
    expect(c.yoy.operatingIncome!.pct! * 100).toBeCloseTo((19 / 17 - 1) * 100, 6);
    const note = nwin.notes.find((n) => n.kind === "restated")!;
    expect(note.text).toContain("ursprünglich 18,0 Mio. USD (eingereicht 05.11.2024)");
    expect(note.text).toContain("17,0 Mio. USD (04.11.2025)");
  });

  it("flags a derived value that rests on a restated input", () => {
    // Q4 2024 operating income = year (60) − Q1 12 − Q2 15 − Q3 17 (restated) = 16, while the original quarters give 15
    const q4 = row(nwin, "2024-12-31");
    expect(q4.operatingIncome).toMatchObject({ value: 16 * M, derived: "fy-minus-quarters", inputsRevised: true });
    expect(nwin.notes.some((n) => n.kind === "mixed")).toBe(true);
  });

  it("derives single quarters of the cash flow from 3-, 6- and 9-month values", () => {
    expect(row(nwin, "2025-03-31").operatingCashFlow).toMatchObject({ value: 24 * M, derived: null });
    expect(row(nwin, "2025-06-30").operatingCashFlow).toMatchObject({ value: 28 * M, derived: "ytd-diff" });
    expect(row(nwin, "2025-09-30").operatingCashFlow).toMatchObject({ value: 32 * M, derived: "ytd-diff" });
    expect(row(nwin, "2025-09-30").capex!.value).toBe(8 * M);
    expect(row(nwin, "2025-09-30").freeCashFlow).toMatchObject({ value: 24 * M, derived: "calc" });
    // Q4 2024 from the 10-K: 110 − 75 = 35 and capex 26 − 18 = 8
    expect(row(nwin, "2024-12-31").operatingCashFlow!.value).toBe(35 * M);
    expect(row(nwin, "2024-12-31").freeCashFlow!.value).toBe(27 * M);
    expect(nwin.notes.some((n) => /kumuliert/.test(n.text))).toBe(true);
  });

  it("computes gross profit from revenue and cost when it is not tagged – and skips a gross profit in the wrong currency", () => {
    const q = row(nwin, "2025-09-30");
    expect(q.grossProfit).toMatchObject({ value: 57 * M, derived: "calc", concept: null });
    expect(q.grossMargin).toBeCloseTo(57 / 135, 9);
    expect(nwin.notes.find((n) => n.kind === "currency")!.text).toContain("GrossProfit (EUR)");
    expect(nwin.concepts.grossProfit).toBeUndefined();
  });

  it("sums the debt items without counting commercial paper twice, and nets cash and securities", () => {
    const q = row(nwin, "2025-09-30");
    expect(q.debt!.value).toBe(215 * M);
    expect(q.debt!.parts.map((p) => p.value / M)).toEqual([185, 20, 10]);
    expect(q.netDebt).toBe(130 * M); // 215 − 70 cash − 15 securities
    // no securities tagged at the earlier date: they count as nothing, the net debt says so by being higher
    expect(row(nwin, "2025-06-30").netDebt).toBe(150 * M);
    // no balance sheet in the quarter → no number
    expect(row(nwin, "2024-09-30").debt).toBeNull();
    expect(nwin.comparisons[0]!.debtQoq!.abs).toBe(5 * M);
  });

  it("prefers the aggregate 'DebtCurrent' over adding paper and borrowings again, and refuses a half number", () => {
    const base = factsPayload("NWIN");
    const withAlt: SecFactsPayload = structuredClone(base);
    withAlt.facts["us-gaap:DebtCurrent"] = { unit: "USD", rows: [{ end: "2025-09-30", val: 40 * M, form: "10-Q", filed: "2025-11-04", accn: "x-1" }] };
    delete withAlt.facts["us-gaap:LongTermDebtCurrent"];
    const r = analyse(withAlt, { now: NOW });
    // 185 + 40 (paper is inside DebtCurrent and is not added again)
    expect(row(r, "2025-09-30").debt!.value).toBe(225 * M);
    const noLongTerm: SecFactsPayload = structuredClone(base);
    delete noLongTerm.facts["us-gaap:LongTermDebtNoncurrent"];
    expect(row(analyse(noLongTerm, { now: NOW }), "2025-09-30").debt).toBeNull();
    const noCurrent: SecFactsPayload = structuredClone(base);
    delete noCurrent.facts["us-gaap:LongTermDebtCurrent"];
    const lower = row(analyse(noCurrent, { now: NOW }), "2025-09-30").debt!;
    expect(lower.complete).toBe(false);
    expect(analyse(noCurrent, { now: NOW }).notes.some((n) => /Untergrenze/.test(n.text))).toBe(true);
  });

  it("does not derive a quarter's share count from the year (a weighted average is not additive)", () => {
    expect(row(nwin, "2024-12-31").sharesDiluted).toBeNull();
    expect(row(nwin, "2025-09-30").sharesDiluted!.value).toBe(10 * M);
  });

  it("notes that the data is old and that the newest quarter is ahead of the facts when a later report is filed", () => {
    expect(nwin.notes.some((n) => n.kind === "old")).toBe(true);
    const f = filingsPayload("NWIN");
    f.report = { form: "10-Q", filed: "2026-02-10", reportDate: "2025-12-31", accession: "0000999001-00-800020", items: [], url: "https://www.sec.gov/Archives/edgar/data/999001/x/y.htm", indexUrl: "https://www.sec.gov/Archives/edgar/data/999001/x/" };
    const r = analyse(factsPayload("NWIN"), { filings: f, now: NOW });
    const lag = r.notes.find((n) => n.kind === "lag")!;
    expect(lag.text).toContain("30.09.2025");
    expect(lag.text).toContain("31.12.2025");
    expect(lag.url).toBe("https://www.sec.gov/Archives/edgar/data/999001/x/y.htm");
    expect(nwin.notes.some((n) => n.kind === "lag")).toBe(false);
  });
});

describe("edge cases", () => {
  it("an empty data set gives an empty result with the reason, not an error", () => {
    const empty: SecFactsPayload = { ...factsPayload("AAPL"), facts: {}, asOf: null };
    const r = analyse(empty, { now: NOW });
    expect(r.quarters).toEqual([]);
    expect(r.ttm).toBeNull();
    expect(r.changes).toEqual([]);
    expect(r.notes.map((n) => n.kind)).toContain("missing");
    expect(r.consensus.available).toBe(false);
  });

  it("marks a stale copy and keeps it", () => {
    const r = analyse(factsPayload("AAPL", { stale: true }), { now: NOW });
    expect(r.stamp.stale).toBe(true);
    expect(r.notes.some((n) => n.kind === "stale")).toBe(true);
  });

  it("uses the filer's currency and never mixes (revenue in EUR, EPS in USD/shares is skipped)", () => {
    const p: SecFactsPayload = structuredClone(factsPayload("NWIN"));
    for (const s of Object.values(p.facts)) if (s.unit === "USD") s.unit = "EUR";
    const r = analyse(p, { now: NOW });
    expect(r.currency).toBe("EUR");
    expect(row(r, "2025-09-30").revenue!.value).toBe(135 * M);
    expect(row(r, "2025-09-30").epsDiluted).toBeNull(); // USD/shares does not match EUR
    expect(r.notes.some((n) => n.kind === "currency" && /EUR/.test(n.text))).toBe(true);
    expect(r.changes[1]!.text).toContain("EUR");
  });

  it("a bank without cost of revenue has no gross profit – empty, not zero", () => {
    const p: SecFactsPayload = structuredClone(factsPayload("NWIN"));
    delete p.facts["us-gaap:CostOfRevenue"];
    const r = analyse(p, { now: NOW });
    expect(r.quarters[0]!.grossProfit).toBeNull();
    expect(r.quarters[0]!.grossMargin).toBeNull();
    expect(r.notes.find((n) => n.kind === "missing" && /Bruttoergebnis/.test(n.text))).toBeTruthy();
  });

  it("net income above operating income is pointed out as a possible one-off", () => {
    const p: SecFactsPayload = structuredClone(factsPayload("NWIN"));
    const ni = p.facts["us-gaap:NetIncomeLoss"]!.rows.find((r) => r.end === "2025-09-30" && r.start === "2025-07-01")!;
    ni.val = 25 * M;
    const note = analyse(p, { now: NOW }).notes.find((n) => n.kind === "oneoff")!;
    expect(note.text).toContain("liegt über dem operativen Ergebnis");
    expect(nwin.notes.some((n) => n.kind === "oneoff")).toBe(false);
  });

  it("shows no percentage for a zero or negative base but still the absolute change", () => {
    expect(deltaOf(10, 5)).toEqual({ abs: 5, pct: 1 });
    expect(deltaOf(-2, 4)).toEqual({ abs: -6, pct: -1.5 });
    expect(deltaOf(5, -3)).toEqual({ abs: 8, pct: null, note: "base-negative" });
    expect(deltaOf(5, 0)).toEqual({ abs: 5, pct: null, note: "base-zero" });
    expect(deltaOf(null, 1)).toBeNull();
    expect(deltaOf(1, undefined)).toBeNull();
    expect(deltaOf(Number.NaN, 1)).toBeNull();
  });

  it("a loss in the quarter a year earlier gives a sentence without a percentage", () => {
    const p: SecFactsPayload = structuredClone(factsPayload("NWIN"));
    const ni = p.facts["us-gaap:NetIncomeLoss"]!.rows.filter((r) => r.end === "2024-09-30" && r.start === "2024-07-01");
    for (const r of ni) r.val = -4 * M;
    const r = analyse(p, { now: NOW });
    expect(r.comparisons[0]!.yoy.netIncome).toMatchObject({ abs: 17 * M, pct: null, note: "base-negative" });
    expect(r.changes.find((c) => c.id === "net")!.text).toContain("Vorwert negativ, ohne Prozentwert");
  });

  it("limits the listed quarters but compares against all that exist", () => {
    const r = analyse(factsPayload("NWIN"), { quarters: 3, now: NOW });
    expect(r.quarters).toHaveLength(3);
    expect(r.comparisons).toHaveLength(3);
    expect(r.comparisons[0]!.yoy.revenue).toBeDefined();
  });
});
