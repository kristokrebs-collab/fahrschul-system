/**
 * SEC contract helpers (`src/market/sec`): the reducer of "company facts" (what it keeps, what it drops, that it never changes
 * a value), ticker → CIK lookup, the filings list with the earnings 8-K and its press release, and the date helpers.
 * Fixtures: `tests/fixtures/sec` (SEC's real formats; see `make.mjs`).
 */
import { describe, expect, it } from "vitest";
import { addDays, calendarQuarter, daysBetween, isIsoDate, midpoint, msOfIso } from "@/market/sec/days";
import { archiveFolder, exhibitName, filingRows, namesOfIndex, pickFilings } from "@/market/sec/filings";
import { cleanEntityName, pickUnit, reduceCompanyFacts } from "@/market/sec/reduce";
import { buildTickerIndex, findTicker, normalizeCik, normalizeTicker } from "@/market/sec/tickers";
import { AAPL_8K_INDEX, COMPANY_TICKERS, FIXTURES } from "../fixtures/sec";

describe("days", () => {
  it("validates, counts and shifts calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-6-1")).toBe(false);
    expect(daysBetween("2024-12-28", "2025-03-29")).toBe(91);
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(msOfIso("1970-01-02")).toBe(86_400_000);
    expect(msOfIso("nope")).toBeNull();
  });

  it("assigns a calendar quarter by the middle of the period (fiscal Q2 ending 1 April is calendar Q1)", () => {
    expect(midpoint("2023-01-01", "2023-01-31")).toBe("2023-01-16");
    expect(calendarQuarter("2023-01-01", "2023-04-01")).toEqual({ year: 2023, q: 1 });
    expect(calendarQuarter("2025-03-30", "2025-06-28")).toEqual({ year: 2025, q: 2 });
    expect(calendarQuarter("2025-09-28", "2025-12-27")).toEqual({ year: 2025, q: 4 });
  });
});

describe("reduceCompanyFacts", () => {
  const aapl = reduceCompanyFacts(FIXTURES.AAPL.facts);
  const nwin = reduceCompanyFacts(FIXTURES.NWIN.facts);

  it("takes the CIK, a cleaned name and the newest period", () => {
    expect(aapl.cik).toBe("0000320193");
    expect(aapl.entity).toBe("Apple Inc.");
    expect(aapl.asOf).toBe("2026-06-27");
    expect(nwin.entity).toBe("NORTHWIND INDUSTRIAL CORP");
    expect(cleanEntityName("APPLE INC /DE/")).toBe("APPLE INC");
    expect(cleanEntityName(null)).toBe("");
  });

  it("keeps only known concepts, in one unit each, with the rows as filed", () => {
    expect(Object.keys(aapl.facts)).toContain("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(aapl.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]!.unit).toBe("USD");
    expect(aapl.facts["us-gaap:EarningsPerShareDiluted"]!.unit).toBe("USD/shares");
    expect(aapl.facts["dei:EntityCommonStockSharesOutstanding"]!.unit).toBe("shares");
    const rev = aapl.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]!.rows;
    // repeats are kept (the analyst decides which one counts): Q1 FY25 appears in its own 10-Q and as the comparative of the next year's 10-Q
    expect(rev.filter((r) => r.end === "2024-12-28")).toHaveLength(2);
    // values are never changed
    expect(rev.find((r) => r.end === "2026-06-27" && r.form === "10-Q")!.val).toBe(109_417_000_000);
  });

  it("ignores facts of an 8-K and drops a row without an accession number", () => {
    const rows = nwin.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]!.rows;
    expect(rows.some((r) => r.form === "8-K")).toBe(false);
    expect(rows.filter((r) => r.end === "2025-09-30")).toHaveLength(1);
    expect(aapl.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]!.rows.some((r) => r.val === 1)).toBe(false);
  });

  it("keeps another currency under its own unit (so the analyst can refuse to mix)", () => {
    expect(nwin.facts["us-gaap:GrossProfit"]!.unit).toBe("EUR");
  });

  it("is much smaller than the original", () => {
    expect(JSON.stringify(aapl).length).toBeLessThan(JSON.stringify(FIXTURES.AAPL.facts).length);
  });

  it("cuts history beyond the window and survives garbage", () => {
    const cut = reduceCompanyFacts(FIXTURES.AAPL.facts, { years: 1 });
    const rows = cut.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]!.rows;
    expect(Math.min(...rows.map((r) => Date.parse(r.end)))).toBeGreaterThan(Date.parse("2025-06-01"));
    expect(reduceCompanyFacts(null)).toEqual({ entity: "", cik: "", asOf: null, facts: {} });
    expect(reduceCompanyFacts({ facts: { "us-gaap": { Revenues: { units: { USD: [{ end: "bad", val: 1 }, "x", null] } } } } }).facts).toEqual({});
  });

  it("picks USD, else the most used currency; per-share and share units by their own rule", () => {
    expect(pickUnit({ USD: [1], EUR: [1, 2] }, "money")).toBe("USD");
    expect(pickUnit({ EUR: [1], GBP: [1, 2] }, "money")).toBe("GBP");
    expect(pickUnit({ "USD/shares": [1], "EUR/shares": [1, 2] }, "perShare")).toBe("USD/shares");
    expect(pickUnit({ "EUR/shares": [1] }, "perShare")).toBe("EUR/shares");
    expect(pickUnit({ shares: [1], USD: [1] }, "shares")).toBe("shares");
    expect(pickUnit({ USD: [1] }, "shares")).toBeNull();
    expect(pickUnit({}, "money")).toBeNull();
  });
});

describe("tickers", () => {
  const index = buildTickerIndex(COMPANY_TICKERS);

  it("normalises and looks up, class shares with dash or dot", () => {
    expect(normalizeTicker(" brk.b ")).toBe("BRK.B");
    expect(normalizeTicker("../etc")).toBeNull();
    expect(normalizeTicker("")).toBeNull();
    expect(normalizeTicker(42)).toBeNull();
    expect(findTicker(index, "aapl")).toEqual({ ticker: "AAPL", cik: "0000320193", title: "Apple Inc." });
    expect(findTicker(index, "BRK.B")!.ticker).toBe("BRK-B");
    expect(findTicker(index, "BRK-A")!.ticker).toBe("BRK-A");
    expect(findTicker(index, "NWIN")!.title).toBe("NORTHWIND INDUSTRIAL CORP");
    expect(findTicker(index, "ZZZZ")).toBeNull();
  });

  it("normalises CIKs", () => {
    expect(normalizeCik("320193")).toBe("0000320193");
    expect(normalizeCik(320193)).toBe("0000320193");
    expect(normalizeCik("0")).toBeNull();
    expect(normalizeCik("12345678901")).toBeNull();
    expect(normalizeCik("abc")).toBeNull();
  });

  it("ignores broken entries", () => {
    const idx = buildTickerIndex({ a: null, b: { cik_str: "x", ticker: "OK" }, c: { cik_str: 5, ticker: "good" } });
    expect(findTicker(idx, "OK")).toBeNull();
    expect(findTicker(idx, "GOOD")!.cik).toBe("0000000005");
  });
});

describe("filings", () => {
  const picked = pickFilings(FIXTURES.AAPL.submissions, "0000320193");

  it("lists the newest 10-Q / 10-K / 8-K, newest first, and leaves out other forms", () => {
    expect(picked.filings).toHaveLength(10);
    expect(picked.filings.map((f) => f.form)).not.toContain("4");
    expect(picked.filings.map((f) => f.form)).not.toContain("DEF 14A");
    expect(picked.filings[0]).toMatchObject({ form: "10-Q", filed: "2026-07-31", reportDate: "2026-06-27" });
    expect(picked.filings[0]!.url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019300900107/aapl-20260627.htm");
    expect(picked.filings[0]!.indexUrl).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019300900107/0000320193-00-900107-index.htm");
    const filed = picked.filings.map((f) => f.filed);
    expect([...filed].sort().reverse()).toEqual(filed);
  });

  it("finds the newest report and the earnings 8-K (item 2.02), with the history for matching quarters", () => {
    expect(picked.report).toMatchObject({ form: "10-Q", filed: "2026-07-31" });
    expect(picked.earnings8k).toMatchObject({ form: "8-K", filed: "2026-07-30", items: ["2.02", "9.01"] });
    expect(picked.earningsHistory.map((f) => f.filed)).toEqual(["2026-07-30", "2026-04-30", "2026-01-29", "2025-10-30", "2025-07-31", "2025-05-01", "2025-01-30"]);
    // an 8-K about a management change is in the list but is not an earnings 8-K
    expect(filingRows(FIXTURES.AAPL.submissions, "0000320193").some((f) => f.items.includes("5.02"))).toBe(true);
    expect(picked.earningsHistory.some((f) => f.items.includes("5.02"))).toBe(false);
  });

  it("finds the press release among the files of the 8-K folder", () => {
    const names = namesOfIndex(AAPL_8K_INDEX);
    expect(names).toContain("a8-kex991q3202606.htm");
    expect(exhibitName(names, "aapl-20260730.htm")).toBe("a8-kex991q3202606.htm");
    expect(archiveFolder("0000320193", "0000320193-00-900106")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019300900106/");
    // second choice: any "exhibit 99", then names with "release" / "press", never the XBRL viewer pages or the filing's own text file
    expect(exhibitName(["R1.htm", "0000320193-00-900106.txt", "x-ex99.htm"])).toBe("x-ex99.htm");
    expect(exhibitName(["R2.htm", "press-release.htm"])).toBe("press-release.htm");
    expect(exhibitName(["R2.htm", "../evil.htm"])).toBeNull();
  });

  it("copes with a company without filings and with broken rows", () => {
    expect(pickFilings({}, "0000000001")).toEqual({ filings: [], report: null, earnings8k: null, earningsHistory: [] });
    const bad = { filings: { recent: { accessionNumber: ["not-an-accession", "0000000001-26-000001"], filingDate: ["2026-01-01", "2026-13-40"], form: ["10-K", "10-K"], primaryDocument: ["a.htm", "b.htm"] } } };
    expect(filingRows(bad, "0000000001")).toEqual([]);
  });
});
