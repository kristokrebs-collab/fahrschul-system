// Generator of the SEC fixtures in this folder (`node tests/fixtures/sec/make.mjs`). The JSON files next to it are its output.
//
// WHAT THEY ARE: rebuilt ("nachgebaut") in the exact format of SEC's APIs
//   - companyfacts-<CIK>.json   data.sec.gov/api/xbrl/companyfacts/CIK##########.json
//   - submissions-<CIK>.json    data.sec.gov/submissions/CIK##########.json   (the `filings.recent` columns)
//   - index-<accession>.json    www.sec.gov/Archives/edgar/data/<cik>/<accession>/index.json
//   - company_tickers.json      www.sec.gov/files/company_tickers.json
//
// AAPL ("Apple Inc."): the numbers are Apple's reported quarters of fiscal 2024 – 2026 (millions of USD, EPS in USD). They were
// checked against TradingView's quarterly history (NASDAQ:AAPL, fq, 2026-10-25: revenue, gross profit, net income, FCF) and
// against the real run of the user's trader-analyst skill of 2026-10-13 (TTM revenue 466,823 M, TTM net income 128,930 M,
// TTM EPS 8.71 with the derived Q4, revenue growth +16.4 %, EPS growth +28.7 %). Accession numbers and filing dates are
// SYNTHETIC (accession year "00"); they only have to be unique and consistent. Not every concept exists for every quarter on
// purpose (operating income, cash flow and the balance sheet are missing for the newest quarters: "keine Daten").
//
// NWIN ("Northwind Industrial Corp."): a made-up calendar-year company that exercises what Apple does not: a concept switch
// (Revenues -> RevenueFromContractWithCustomerExcludingAssessedTax), a RESTATEMENT (Q3 2024 operating income 18.0 -> 17.0 in the
// Q3 2025 10-Q), cumulative cash flow values in the 10-Qs, a gross profit tagged in the wrong currency (EUR, must be skipped), a
// debt split over several items, a fact of an 8-K (must be ignored) and a row without accession (must be dropped).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
const M = 1e6;

function builder(cik, entityName) {
  const facts = { "us-gaap": {}, dei: {} };
  const add = (ns, concept, unit, rec) => {
    const node = (facts[ns][concept] ??= { label: concept, description: "", units: {} });
    (node.units[unit] ??= []).push(rec);
  };
  /** one filing: its facts are rows with the filing's accession / form / filed / fy / fp */
  const filing = (f) => ({
    flow: (concept, unit, start, end, val, extra = {}) => add("us-gaap", concept, unit, { start, end, val, accn: f.accn, fy: f.fy, fp: f.fp, form: f.form, filed: f.filed, ...extra }),
    point: (concept, unit, end, val, ns = "us-gaap", extra = {}) => add(ns, concept, unit, { end, val, accn: f.accn, fy: f.fy, fp: f.fp, form: f.form, filed: f.filed, ...extra }),
  });
  return { facts, filing, out: () => ({ cik, entityName, facts }) };
}

function submissions(cik, name, rows) {
  const col = (k) => rows.map((r) => r[k] ?? "");
  return {
    cik,
    name,
    filings: {
      recent: {
        accessionNumber: col("accn"),
        filingDate: col("filed"),
        reportDate: col("report"),
        form: col("form"),
        primaryDocument: col("doc"),
        items: col("items"),
      },
      files: [],
    },
  };
}

/* ================================================================================================ AAPL */
const aapl = builder("0000320193", "Apple Inc.");
let n = 0;
const acc = (cik, ymd) => `${cik}-00-${String(++n).padStart(6, "0")}`;
const A = "0000320193";
const F = {
  q1_25: { accn: acc(A), form: "10-Q", filed: "2025-01-31", fy: 2025, fp: "Q1" },
  q2_25: { accn: acc(A), form: "10-Q", filed: "2025-05-02", fy: 2025, fp: "Q2" },
  q3_25: { accn: acc(A), form: "10-Q", filed: "2025-08-01", fy: 2025, fp: "Q3" },
  k_25: { accn: acc(A), form: "10-K", filed: "2025-10-31", fy: 2025, fp: "FY" },
  q1_26: { accn: acc(A), form: "10-Q", filed: "2026-01-30", fy: 2026, fp: "Q1" },
  q2_26: { accn: acc(A), form: "10-Q", filed: "2026-05-01", fy: 2026, fp: "Q2" },
  q3_26: { accn: acc(A), form: "10-Q", filed: "2026-07-31", fy: 2026, fp: "Q3" },
};
// fiscal calendar (52/53 weeks, the year ends on the last Saturday of September)
const D = { fy24s: "2023-10-01", q1_24: "2023-12-30", q2s_24: "2023-12-31", q2_24: "2024-03-30", q3s_24: "2024-03-31", q3_24: "2024-06-29", fy24: "2024-09-28", fy25s: "2024-09-29", q1_25: "2024-12-28", q2s_25: "2024-12-29", q2_25: "2025-03-29", q3s_25: "2025-03-30", q3_25: "2025-06-28", fy25: "2025-09-27", fy26s: "2025-09-28", q1_26: "2025-12-27", q2s_26: "2025-12-28", q2_26: "2026-03-28", q3s_26: "2026-03-29", q3_26: "2026-06-27" };
const REV = "RevenueFromContractWithCustomerExcludingAssessedTax";
const U = "USD";
const set = (f, concept, start, end, mil, unit = U) => aapl.filing(f).flow(concept, unit, start, end, unit === "USD/shares" ? mil : Math.round(mil * M));

// income statement items by fiscal quarter: [revenue, gross profit, operating income, net income, EPS]
const IS = {
  q1_24: [119575, 54855, 40373, 33916, 2.18],
  q2_24: [90753, 42271, 27900, 23636, 1.53],
  q3_24: [85777, 39678, 25352, 21448, 1.4],
  fy24: [391035, 180683, 123216, 93736, 6.08],
  q1_25: [124300, 58275, 42832, 36330, 2.4],
  q2_25: [95359, 44867, 29589, 24780, 1.65],
  q3_25: [94036, 43718, 28202, 23434, 1.57],
  fy25: [416161, 195201, 133050, 112010, 7.46],
};
const ISN = ["revenue", "gross", "op", "net", "eps"];
function writeIs(f, key, start, end, only = ISN) {
  const v = IS[key];
  const m = { revenue: [REV, v[0]], gross: ["GrossProfit", v[1]], op: ["OperatingIncomeLoss", v[2]], net: ["NetIncomeLoss", v[3]], eps: ["EarningsPerShareDiluted", v[4]] };
  for (const k of only) set(f, m[k][0], start, end, m[k][1], k === "eps" ? "USD/shares" : U);
}
// diluted weighted shares (millions): from the quarterly net income and the EPS TradingView lists (NI / EPS)
const SH = { q1_25: 15150.865, q2_25: 15056.0, q3_25: 14948.0, q1_26: 14810.0, q2_26: 14725.0, q3_26: 14715.0 };
const sh = (f, start, end, mil) => aapl.filing(f).flow("WeightedAverageNumberOfDilutedSharesOutstanding", "shares", start, end, Math.round(mil * M));

// 10-Q Q1 FY25: this quarter and the same quarter of the year before (comparative)
writeIs(F.q1_25, "q1_25", D.fy25s, D.q1_25);
writeIs(F.q1_25, "q1_24", D.fy24s, D.q1_24);
sh(F.q1_25, D.fy25s, D.q1_25, SH.q1_25);
set(F.q1_25, "NetCashProvidedByUsedInOperatingActivities", D.fy25s, D.q1_25, 29935);
set(F.q1_25, "PaymentsToAcquirePropertyPlantAndEquipment", D.fy25s, D.q1_25, 2940);
// 10-Q Q2 FY25: 3 months, 6 months (income statement) and 6 months only (cash flow)
writeIs(F.q2_25, "q2_25", D.q2s_25, D.q2_25);
writeIs(F.q2_25, "q2_24", D.q2s_24, D.q2_24);
sh(F.q2_25, D.q2s_25, D.q2_25, SH.q2_25);
set(F.q2_25, "NetCashProvidedByUsedInOperatingActivities", D.fy25s, D.q2_25, 53887);
set(F.q2_25, "PaymentsToAcquirePropertyPlantAndEquipment", D.fy25s, D.q2_25, 6011);
// 10-Q Q3 FY25
writeIs(F.q3_25, "q3_25", D.q3s_25, D.q3_25);
writeIs(F.q3_25, "q3_24", D.q3s_24, D.q3_24);
sh(F.q3_25, D.q3s_25, D.q3_25, SH.q3_25);
set(F.q3_25, "NetCashProvidedByUsedInOperatingActivities", D.fy25s, D.q3_25, 81754);
set(F.q3_25, "PaymentsToAcquirePropertyPlantAndEquipment", D.fy25s, D.q3_25, 9473);
// 10-K FY25: the year and the year before (income statement and cash flow), the balance sheet of the year before
writeIs(F.k_25, "fy25", D.fy25s, D.fy25);
writeIs(F.k_25, "fy24", D.fy24s, D.fy24);
set(F.k_25, "NetCashProvidedByUsedInOperatingActivities", D.fy25s, D.fy25, 111482);
set(F.k_25, "PaymentsToAcquirePropertyPlantAndEquipment", D.fy25s, D.fy25, 12715);
set(F.k_25, "NetCashProvidedByUsedInOperatingActivities", D.fy24s, D.fy24, 118254);
set(F.k_25, "PaymentsToAcquirePropertyPlantAndEquipment", D.fy24s, D.fy24, 9447);
{
  const f = aapl.filing(F.k_25);
  f.point("CashAndCashEquivalentsAtCarryingValue", U, D.fy24, 29943 * M);
  f.point("MarketableSecuritiesCurrent", U, D.fy24, 35228 * M);
  f.point("CommercialPaper", U, D.fy24, 9967 * M);
  f.point("LongTermDebtCurrent", U, D.fy24, 10912 * M);
  f.point("LongTermDebtNoncurrent", U, D.fy24, 85750 * M);
  f.point("EntityCommonStockSharesOutstanding", "shares", "2025-10-17", 14776353000, "dei");
}
// FY26: only what the reports of Q1 – Q3 carry in this fixture (no operating income, no cash flow, no balance sheet): revenue,
// gross profit, net income, EPS and shares; each 10-Q repeats the quarter of the year before as a comparative (same values)
const IS26 = { q1_26: [143756, 69231, null, 42097, 2.84], q2_26: [111184, 54781, null, 29578, 2.01], q3_26: [109417, 54770, null, 29789, 2.02] };
function writeIs26(f, key, start, end) {
  const [rev, gross, , net, eps] = IS26[key];
  set(f, REV, start, end, rev);
  set(f, "GrossProfit", start, end, gross);
  set(f, "NetIncomeLoss", start, end, net);
  set(f, "EarningsPerShareDiluted", start, end, eps, "USD/shares");
}
writeIs26(F.q1_26, "q1_26", D.fy26s, D.q1_26);
writeIs(F.q1_26, "q1_25", D.fy25s, D.q1_25); // the comparative repeats Q1 FY25 (same numbers)
sh(F.q1_26, D.fy26s, D.q1_26, SH.q1_26);
writeIs26(F.q2_26, "q2_26", D.q2s_26, D.q2_26);
writeIs(F.q2_26, "q2_25", D.q2s_25, D.q2_25);
sh(F.q2_26, D.q2s_26, D.q2_26, SH.q2_26);
writeIs26(F.q3_26, "q3_26", D.q3s_26, D.q3_26);
writeIs(F.q3_26, "q3_25", D.q3s_25, D.q3_25);
sh(F.q3_26, D.q3s_26, D.q3_26, SH.q3_26);
aapl.filing(F.q3_26).point("EntityCommonStockSharesOutstanding", "shares", "2026-07-17", 14697000000, "dei");
// a fact of an 8-K must be ignored by the reducer
aapl.filing({ accn: `${A}-00-999999`, form: "8-K", filed: "2026-07-30", fy: 2026, fp: "Q3" }).flow(REV, U, D.q3s_26, D.q3_26, 1);
writeFileSync(join(here, "companyfacts-0000320193.json"), JSON.stringify({ _fixture: "nachgebaut nach dem Format der SEC (siehe make.mjs)", ...aapl.out() }));

const sub = [];
const row = (accn, form, filed, report, doc, items = "") => sub.push({ accn, form, filed, report, doc, items });
// newest first like SEC; synthetic accession numbers
row(`${A}-00-900107`, "10-Q", "2026-07-31", D.q3_26, "aapl-20260627.htm");
row(`${A}-00-900106`, "8-K", "2026-07-30", "2026-07-30", "aapl-20260730.htm", "2.02,9.01");
row(`${A}-00-900105`, "4", "2026-07-15", "2026-07-13", "wk-form4.xml");
row(`${A}-00-900104`, "10-Q", "2026-05-01", D.q2_26, "aapl-20260328.htm");
row(`${A}-00-900103`, "8-K", "2026-04-30", "2026-04-30", "aapl-20260430.htm", "2.02,9.01");
row(`${A}-00-900102`, "8-K", "2026-03-10", "2026-03-10", "aapl-20260310.htm", "5.02");
row(`${A}-00-900101`, "10-Q", "2026-01-30", D.q1_26, "aapl-20251227.htm");
row(`${A}-00-900100`, "8-K", "2026-01-29", "2026-01-29", "aapl-20260129.htm", "2.02,9.01");
row(`${A}-00-900099`, "DEF 14A", "2026-01-08", "2026-02-24", "aapl-def14a.htm");
row(`${A}-00-900098`, "10-K", "2025-10-31", D.fy25, "aapl-20250927.htm");
row(`${A}-00-900097`, "8-K", "2025-10-30", "2025-10-30", "aapl-20251030.htm", "2.02,9.01");
row(`${A}-00-900096`, "10-Q", "2025-08-01", D.q3_25, "aapl-20250628.htm");
row(`${A}-00-900095`, "8-K", "2025-07-31", "2025-07-31", "aapl-20250731.htm", "2.02,9.01");
row(`${A}-00-900094`, "10-Q", "2025-05-02", D.q2_25, "aapl-20250329.htm");
row(`${A}-00-900093`, "8-K", "2025-05-01", "2025-05-01", "aapl-20250501.htm", "2.02,9.01");
row(`${A}-00-900092`, "10-Q", "2025-01-31", D.q1_25, "aapl-20241228.htm");
row(`${A}-00-900091`, "8-K", "2025-01-30", "2025-01-30", "aapl-20250130.htm", "2.02,9.01");
writeFileSync(join(here, "submissions-0000320193.json"), JSON.stringify({ _fixture: "nachgebaut", ...submissions("0000320193", "Apple Inc.", sub) }));
writeFileSync(
  join(here, "index-0000320193-00-900106.json"),
  JSON.stringify({
    directory: {
      name: "/Archives/edgar/data/320193/000032019300900106",
      item: [
        { name: "0000320193-00-900106-index.htm", type: "text.gif" },
        { name: "0000320193-00-900106.txt", type: "text.gif" },
        { name: "R1.htm", type: "text.gif" },
        { name: "Financial_Report.xlsx", type: "text.gif" },
        { name: "a8-kex991q3202606.htm", type: "text.gif" },
        { name: "aapl-20260730.htm", type: "text.gif" },
      ],
    },
  }),
);

/* ================================================================================================ NWIN */
const nw = builder("0000999001", "NORTHWIND INDUSTRIAL CORP /DE/");
const NC = "0000999001";
let m = 0;
const nacc = () => `${NC}-00-${String(++m).padStart(6, "0")}`;
const G = {
  q1_24: { accn: nacc(), form: "10-Q", filed: "2024-05-07", fy: 2024, fp: "Q1" },
  q2_24: { accn: nacc(), form: "10-Q", filed: "2024-08-06", fy: 2024, fp: "Q2" },
  q3_24: { accn: nacc(), form: "10-Q", filed: "2024-11-05", fy: 2024, fp: "Q3" },
  k_24: { accn: nacc(), form: "10-K", filed: "2025-03-04", fy: 2024, fp: "FY" },
  q1_25: { accn: nacc(), form: "10-Q", filed: "2025-05-06", fy: 2025, fp: "Q1" },
  q2_25: { accn: nacc(), form: "10-Q", filed: "2025-08-05", fy: 2025, fp: "Q2" },
  q3_25: { accn: nacc(), form: "10-Q", filed: "2025-11-04", fy: 2025, fp: "Q3" },
};
const nf = (f, concept, unit, start, end, val) => nw.filing(f).flow(concept, unit, start, end, val);
const REVS = "Revenues";
const money = (x) => Math.round(x * M);
// 2024 (revenue under "Revenues"; cost of revenue; operating income; net income; EPS; shares; gross profit is NOT tagged)
function isq(f, start, end, rev, cost, op, net, eps, shares, concept = REVS) {
  nf(f, concept, "USD", start, end, money(rev));
  nf(f, "CostOfRevenue", "USD", start, end, money(cost));
  nf(f, "OperatingIncomeLoss", "USD", start, end, money(op));
  nf(f, "NetIncomeLoss", "USD", start, end, money(net));
  nf(f, "EarningsPerShareDiluted", "USD/shares", start, end, eps);
  if (shares) nf(f, "WeightedAverageNumberOfDilutedSharesOutstanding", "shares", start, end, money(shares));
}
isq(G.q1_24, "2024-01-01", "2024-03-31", 100, 60, 12, 8, 0.8, 10);
nf(G.q1_24, "NetCashProvidedByUsedInOperatingActivities", "USD", "2024-01-01", "2024-03-31", money(20));
nf(G.q1_24, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2024-01-01", "2024-03-31", money(5));
isq(G.q2_24, "2024-04-01", "2024-06-30", 110, 64, 15, 10, 1.0, 10);
nf(G.q2_24, REVS, "USD", "2024-01-01", "2024-06-30", money(210)); // 6-month income statement values
nf(G.q2_24, "NetCashProvidedByUsedInOperatingActivities", "USD", "2024-01-01", "2024-06-30", money(45));
nf(G.q2_24, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2024-01-01", "2024-06-30", money(11));
isq(G.q3_24, "2024-07-01", "2024-09-30", 120, 70, 18, 12, 1.2, 10); // operating income 18.0 – restated to 17.0 a year later
nf(G.q3_24, REVS, "USD", "2024-01-01", "2024-09-30", money(330));
nf(G.q3_24, "NetCashProvidedByUsedInOperatingActivities", "USD", "2024-01-01", "2024-09-30", money(75));
nf(G.q3_24, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2024-01-01", "2024-09-30", money(18));
// 10-K 2024: the year
nf(G.k_24, REVS, "USD", "2024-01-01", "2024-12-31", money(450));
nf(G.k_24, "CostOfRevenue", "USD", "2024-01-01", "2024-12-31", money(268)); // Q4 cost = 268 - (60 + 64 + 70) = 74
nf(G.k_24, "OperatingIncomeLoss", "USD", "2024-01-01", "2024-12-31", money(60));
nf(G.k_24, "NetIncomeLoss", "USD", "2024-01-01", "2024-12-31", money(40));
nf(G.k_24, "EarningsPerShareDiluted", "USD/shares", "2024-01-01", "2024-12-31", 4.0);
nf(G.k_24, "WeightedAverageNumberOfDilutedSharesOutstanding", "shares", "2024-01-01", "2024-12-31", money(10));
nf(G.k_24, "NetCashProvidedByUsedInOperatingActivities", "USD", "2024-01-01", "2024-12-31", money(110));
nf(G.k_24, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2024-01-01", "2024-12-31", money(26));
{
  const p = nw.filing(G.k_24);
  p.point("CashAndCashEquivalentsAtCarryingValue", "USD", "2024-12-31", money(50));
  p.point("LongTermDebtNoncurrent", "USD", "2024-12-31", money(200));
  p.point("LongTermDebtCurrent", "USD", "2024-12-31", money(20));
}
// 2025 (revenue under the new concept); each 10-Q repeats the quarter of 2024 as a comparative
const REVC = "RevenueFromContractWithCustomerExcludingAssessedTax";
isq(G.q1_25, "2025-01-01", "2025-03-31", 115, 66, 14, 9, 0.9, 10, REVC);
isq(G.q1_25, "2024-01-01", "2024-03-31", 100, 60, 12, 8, 0.8, 10, REVC);
nf(G.q1_25, "NetCashProvidedByUsedInOperatingActivities", "USD", "2025-01-01", "2025-03-31", money(24));
nf(G.q1_25, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2025-01-01", "2025-03-31", money(6));
{
  const p = nw.filing(G.q1_25);
  p.point("CashAndCashEquivalentsAtCarryingValue", "USD", "2025-03-31", money(55));
  p.point("LongTermDebtNoncurrent", "USD", "2025-03-31", money(195));
  p.point("LongTermDebtCurrent", "USD", "2025-03-31", money(20));
}
isq(G.q2_25, "2025-04-01", "2025-06-30", 125, 72, 16, 11, 1.1, 10, REVC);
isq(G.q2_25, "2024-04-01", "2024-06-30", 110, 64, 15, 10, 1.0, 10, REVC);
nf(G.q2_25, "NetCashProvidedByUsedInOperatingActivities", "USD", "2025-01-01", "2025-06-30", money(52));
nf(G.q2_25, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2025-01-01", "2025-06-30", money(13));
{
  const p = nw.filing(G.q2_25);
  p.point("CashAndCashEquivalentsAtCarryingValue", "USD", "2025-06-30", money(60));
  p.point("LongTermDebtNoncurrent", "USD", "2025-06-30", money(190));
  p.point("LongTermDebtCurrent", "USD", "2025-06-30", money(20));
}
isq(G.q3_25, "2025-07-01", "2025-09-30", 135, 78, 19, 13, 1.3, 10, REVC);
isq(G.q3_25, "2024-07-01", "2024-09-30", 120, 70, 17, 12, 1.2, 10, REVC); // RESTATED: operating income 17.0 instead of 18.0
nf(G.q3_25, REVC, "USD", "2024-01-01", "2024-09-30", money(330));
nf(G.q3_25, "NetCashProvidedByUsedInOperatingActivities", "USD", "2025-01-01", "2025-09-30", money(84));
nf(G.q3_25, "PaymentsToAcquirePropertyPlantAndEquipment", "USD", "2025-01-01", "2025-09-30", money(21));
nf(G.q3_25, "GrossProfit", "EUR", "2025-07-01", "2025-09-30", money(57)); // wrong currency on purpose: must be skipped
{
  const p = nw.filing(G.q3_25);
  p.point("CashAndCashEquivalentsAtCarryingValue", "USD", "2025-09-30", money(70));
  p.point("MarketableSecuritiesCurrent", "USD", "2025-09-30", money(15));
  p.point("LongTermDebtNoncurrent", "USD", "2025-09-30", money(185));
  p.point("LongTermDebtCurrent", "USD", "2025-09-30", money(20));
  p.point("CommercialPaper", "USD", "2025-09-30", money(10));
  p.point("EntityCommonStockSharesOutstanding", "shares", "2025-10-28", 9_900_000, "dei");
}
// a row without an accession number (dropped), a fact of an 8-K (ignored)
nw.facts["us-gaap"][REVC].units.USD.push({ start: "2025-07-01", end: "2025-09-30", val: 999 * M, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-04" });
nw.filing({ accn: `${NC}-00-777777`, form: "8-K", filed: "2025-10-30", fy: 2025, fp: "Q3" }).flow(REVC, "USD", "2025-07-01", "2025-09-30", 1);
writeFileSync(join(here, "companyfacts-0000999001.json"), JSON.stringify({ _fixture: "synthetisch (siehe make.mjs)", ...nw.out() }));

const nsub = [];
const nrow = (accn, form, filed, report, doc, items = "") => nsub.push({ accn, form, filed, report, doc, items });
nrow(`${NC}-00-800010`, "8-K", "2025-11-18", "2025-11-18", "nwin-8k.htm", "5.02");
nrow(`${NC}-00-800009`, "10-Q", "2025-11-04", "2025-09-30", "nwin-20250930.htm");
nrow(`${NC}-00-800008`, "8-K", "2025-10-30", "2025-10-30", "nwin-8k-20251030.htm", "2.02,7.01,9.01");
nrow(`${NC}-00-800007`, "10-Q", "2025-08-05", "2025-06-30", "nwin-20250630.htm");
nrow(`${NC}-00-800006`, "8-K", "2025-07-31", "2025-07-31", "nwin-8k-20250731.htm", "2.02,9.01");
nrow(`${NC}-00-800005`, "10-Q", "2025-05-06", "2025-03-31", "nwin-20250331.htm");
nrow(`${NC}-00-800004`, "8-K", "2025-05-01", "2025-05-01", "nwin-8k-20250501.htm", "2.02");
nrow(`${NC}-00-800003`, "10-K", "2025-03-04", "2024-12-31", "nwin-20241231.htm");
writeFileSync(join(here, "submissions-0000999001.json"), JSON.stringify({ _fixture: "synthetisch", ...submissions("0000999001", "Northwind Industrial Corp.", nsub) }));

writeFileSync(
  join(here, "company_tickers.json"),
  JSON.stringify({
    "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    "1": { cik_str: 999001, ticker: "NWIN", title: "NORTHWIND INDUSTRIAL CORP /DE/" },
    "2": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
    "3": { cik_str: 1067983, ticker: "BRK-A", title: "BERKSHIRE HATHAWAY INC" },
    "4": { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
  }),
);
console.log("written to", here);
