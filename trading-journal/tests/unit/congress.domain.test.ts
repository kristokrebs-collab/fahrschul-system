// @vitest-environment node
/**
 * The Congress tracker's pure logic (`src/domain/congress`): the reporting delay (trade date → filing date, over 45 days is late),
 * the words and figures of a row (ranges stay ranges), the watchlist match, the windows and the member match, the list with its
 * filters (unreadable rows are counted when a filter keeps them out, never dropped silently) and the "new since your last visit"
 * record. No clock: `today` is always passed in.
 */
import { describe, expect, it } from "vitest";
import {
  amountDe,
  buildLines,
  dayDe,
  dayNumber,
  dayOfNumber,
  delayInfo,
  delayText,
  filterLines,
  freshDocIds,
  inWindow,
  isRange,
  isWatched,
  memberMatches,
  membersOf,
  NO_FILTER,
  nextSeen,
  optionLine,
  queryMatches,
  seenOf,
  selectFilings,
  summarize,
  tickerKey,
  watchSet,
  windowStart,
  windowYears,
  type LineFilter,
} from "../../src/domain/congress";
import type { CongressFiling, CongressReport, CongressRow, CongressTrade } from "../../src/market/congress/wire";

const filing = (docId: string, name: string, filed: string | null, district = "CA11", year = 2026): CongressFiling => ({ docId, year, name, last: name.split(" ").at(-1)!, district, filed, url: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf` });
const trade = (o: Partial<CongressTrade> = {}): CongressTrade => ({
  ok: true,
  owner: "spouse",
  asset: "Bloom Energy Corporation Class A Common Stock",
  ticker: "BE",
  assetCode: "ST",
  side: "buy",
  tradeDate: "2026-07-24",
  notifiedDate: "2026-07-24",
  amountText: "$1,000,001 - $5,000,000",
  amountLow: 1000001,
  amountHigh: 5000000,
  option: null,
  shares: 10000,
  description: "Purchased 10,000 shares.",
  account: null,
  ...o,
});
const report = (docId: string, rows: CongressRow[], o: Partial<CongressReport> = {}): CongressReport => ({ docId, year: 2026, url: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/${docId}.pdf`, readAt: 1, status: "ok", filer: null, signed: null, rows, ...o });
const bad: CongressRow = { ok: false, reason: "Betragsspanne fehlt.", raw: "SP | Foo" };

describe("the reporting delay", () => {
  it("counts calendar days from the trade to the filing – 28 for the example of the skill", () => {
    expect(delayInfo("2026-07-24", "2026-08-21")).toEqual({ days: 28, late: false, problem: null });
    expect(delayInfo("2026-07-24", "2026-07-24")).toEqual({ days: 0, late: false, problem: null });
    expect(delayInfo("2026-02-27", "2026-03-02").days).toBe(3);
    expect(delayInfo("2024-02-28", "2024-03-01").days).toBe(2); // leap year
  });

  it("calls a report late only after 45 days", () => {
    expect(delayInfo("2026-01-01", "2026-02-15")).toMatchObject({ days: 45, late: false });
    expect(delayInfo("2026-01-01", "2026-02-16")).toMatchObject({ days: 46, late: true });
  });

  it("gives no number for a trade after its filing or a missing date, and says why", () => {
    expect(delayInfo("2026-07-31", "2026-07-27")).toEqual({ days: null, late: false, problem: "after-filing" });
    expect(delayInfo(null, "2026-07-27")).toEqual({ days: null, late: false, problem: "no-date" });
    expect(delayInfo("2026-02-30", "2026-03-27").problem).toBe("no-date");
    expect(delayText(delayInfo("2026-07-31", "2026-07-27"))).toMatch(/nicht berechenbar/);
    expect(delayText(delayInfo(null, null))).toBe("keine Daten");
  });

  it("says it in words", () => {
    expect(delayText({ days: 28, late: false, problem: null })).toBe("28 Tage");
    expect(delayText({ days: 1, late: false, problem: null })).toBe("1 Tag");
    expect(delayText({ days: 0, late: false, problem: null })).toBe("am selben Tag");
  });

  it("converts days both ways", () => {
    expect(dayOfNumber(dayNumber("2026-10-26")!)).toBe("2026-10-26");
    expect(dayNumber("2026-13-01")).toBeNull();
    expect(dayNumber("26-10-01")).toBeNull();
  });
});

describe("words and figures", () => {
  it("keeps a range a range, with the printed dollar signs", () => {
    expect(amountDe({ amountText: "$1,000,001 - $5,000,000" })).toBe("$1,000,001 – $5,000,000");
    expect(isRange(trade())).toBe(true);
    expect(isRange(trade({ amountText: "Over $50,000,000", amountLow: 50000000, amountHigh: null }))).toBe(true);
    expect(isRange(trade({ amountText: "$2,722.50", amountLow: null, amountHigh: null }))).toBe(false);
    expect(isRange(trade({ amountText: "$250", amountLow: 250, amountHigh: 250 }))).toBe(false);
  });

  it("writes only what an option description states", () => {
    expect(optionLine({ contracts: 100, kind: "call", strike: 100, expires: "2027-06-17", exercised: false })).toBe("Call · 100 Kontrakte · Strike $100 · Verfall 17.06.2027");
    expect(optionLine({ contracts: 1, kind: "put", strike: 1250.5, expires: null, exercised: true })).toBe("ausgeübt · Put · 1 Kontrakt · Strike $1,250.5 · Verfall nicht erkannt");
    expect(optionLine({ contracts: null, kind: null, strike: null, expires: null, exercised: false })).toBe("Option · Strike nicht erkannt · Verfall nicht erkannt");
  });

  it("writes German dates and a dash for none", () => {
    expect(dayDe("2026-08-21")).toBe("21.08.2026");
    expect(dayDe(null)).toBe("–");
    expect(dayDe("21.08.2026")).toBe("–");
  });
});

describe("the watchlist match", () => {
  it("compares tickers by one key – a class share is the same with a dot, a hyphen or a slash", () => {
    expect(tickerKey("brk-b")).toBe("BRK.B");
    expect(tickerKey(" BRK/B ")).toBe("BRK.B");
    expect(tickerKey(null)).toBe("");
    const w = watchSet([{ kind: "stock", symbol: "BRK.B" }, { kind: "stock", symbol: "NVDA" }, { kind: "crypto", symbol: "BTCUSDT" }]);
    expect([...w].sort()).toEqual(["BRK.B", "NVDA"]);
    expect(isWatched("BRK-B", w)).toBe(true);
    expect(isWatched("btcusdt", w)).toBe(false);
    expect(isWatched(null, w)).toBe(false);
  });
});

describe("windows and members", () => {
  const today = "2026-10-26";
  it("starts a window at a day or at the first of the year", () => {
    expect(windowStart("7", today)).toBe("2026-10-19");
    expect(windowStart("30", today)).toBe("2026-09-26");
    expect(windowStart("90", today)).toBe("2026-07-28");
    expect(windowStart("year", today)).toBe("2026-01-01");
  });

  it("asks for the year before only when the window reaches into it", () => {
    expect(windowYears("30", today)).toEqual([2026]);
    expect(windowYears("90", "2026-02-10")).toEqual([2026, 2025]);
    expect(windowYears("year", "2026-02-10")).toEqual([2026]);
    expect(windowYears("7", "2026-01-03")).toEqual([2026, 2025]);
  });

  it("puts a filing in or out of the window by its filing day (the day itself is in; a filing without a date is out)", () => {
    expect(inWindow({ filed: "2026-09-26" }, "30", today)).toBe(true);
    expect(inWindow({ filed: "2026-09-25" }, "30", today)).toBe(false);
    expect(inWindow({ filed: "2026-10-27" }, "30", today)).toBe(false);
    expect(inWindow({ filed: null }, "year", today)).toBe(false);
  });

  it("matches a member by every word of the query, without accents", () => {
    const f = filing("1", "Nancy Pelosi", "2026-10-02");
    expect(memberMatches(f, "pelosi")).toBe(true);
    expect(memberMatches(f, "Nancy Pelosi")).toBe(true);
    expect(memberMatches(f, "ca11")).toBe(true);
    expect(memberMatches(f, "pelosi ca12")).toBe(false);
    expect(memberMatches(f, "")).toBe(true);
    expect(memberMatches(filing("2", "Nydia Velázquez", "2026-10-02", "NY07"), "velazquez")).toBe(true);
  });

  it("selects the newest filings of a window and a member, capped, and says when more match", () => {
    const list = [filing("5", "A One", "2026-10-20"), filing("4", "B Two", "2026-10-25"), filing("3", "A One", "2026-10-10"), filing("2", "C Old", "2026-05-01"), filing("1", "D None", null)];
    const r = selectFilings(list, { window: "30", today, cap: 2 });
    expect(r.filings.map((f) => f.docId)).toEqual(["4", "5"]);
    expect(r).toMatchObject({ total: 3, capped: true });
    expect(selectFilings(list, { window: "30", today, member: "one", cap: 10 }).filings.map((f) => f.docId)).toEqual(["5", "3"]);
    expect(selectFilings(list, { window: "year", today, cap: 10 }).total).toBe(4);
  });

  it("lists the members by last name with their number of reports", () => {
    const m = membersOf([filing("1", "Nancy Pelosi", "2026-01-01"), filing("2", "Nancy Pelosi", "2026-02-01"), filing("3", "Josh Gottheimer", "2026-02-01", "NJ05")]);
    expect(m.map((x) => [x.name, x.count])).toEqual([["Josh Gottheimer", 1], ["Nancy Pelosi", 2]]);
  });
});

describe("the list and its filters", () => {
  const f1 = filing("20035143", "Nancy Pelosi", "2026-08-21");
  const f2 = filing("20035401", "Lloyd Doggett", "2026-09-08", "TX37");
  const f3 = filing("20035500", "Josh Gottheimer", "2026-10-01", "NJ05");
  const reports = {
    "20035143": report("20035143", [trade(), trade({ ticker: "INTC", asset: "Intel Corporation - Common Stock", assetCode: "OP", option: { contracts: 50, kind: "call", strike: 50, expires: "2027-06-17", exercised: false } }), trade({ ticker: null, asset: "REOF XXV, LLC", assetCode: "AB", description: null })]),
    "20035401": report("20035401", [trade({ ticker: "NVDA", asset: "NVIDIA Corporation - Common Stock", side: "sell", owner: "self", tradeDate: "2026-06-01", amountText: "$1,001 - $15,000", amountLow: 1001, amountHigh: 15000 }), bad]),
    "20035500": report("20035500", [], { status: "unreadable", problem: "scan", message: "Papierformular." }),
  };
  const watch = watchSet([{ kind: "stock", symbol: "NVDA" }]);
  const lines = buildLines({ filings: [f1, f2, f3], reports, watch, fresh: new Set(["20035500"]) });

  it("makes one line per row, newest filing first, and one 'nicht lesbar' line for an unreadable report", () => {
    expect(lines.map((l) => l.key)).toEqual(["20035500:report", "20035401:0", "20035401:1", "20035143:0", "20035143:1", "20035143:2"]);
    const report0 = lines[0]!;
    expect(report0.row).toMatchObject({ ok: false, reason: "Papierformular." });
    expect(report0).toMatchObject({ isNew: true, delay: null, index: -1 });
  });

  it("computes the delay from the trade date to the filing date of the index and marks the watchlist", () => {
    const pelosi = lines.find((l) => l.key === "20035143:0")!;
    expect(pelosi.delay).toEqual({ days: 28, late: false, problem: null });
    expect(pelosi.watched).toBe(false);
    const nvda = lines.find((l) => l.key === "20035401:0")!;
    expect(nvda.delay).toEqual({ days: 99, late: true, problem: null });
    expect(nvda.watched).toBe(true);
  });

  it("falls back to the signature date when the index has no filing date", () => {
    const l = buildLines({ filings: [filing("9", "No Date", null)], reports: { "9": report("9", [trade()], { signed: "2026-08-21" }) }, watch, fresh: new Set() });
    expect(l[0]).toMatchObject({ filed: "2026-08-21" });
    expect(l[0]!.delay?.days).toBe(28);
  });

  it("skips filings whose report has not been read yet", () => {
    expect(buildLines({ filings: [f1, f2], reports: { "20035143": reports["20035143"] }, watch, fresh: new Set() }).map((l) => l.docId)).toEqual(["20035143", "20035143", "20035143"]);
  });

  const f = (p: Partial<LineFilter>): LineFilter => ({ ...NO_FILTER, ...p });
  it("filters by member (words), ticker (exact) or name (three letters or more)", () => {
    expect(filterLines(lines, f({ member: "pelosi" })).lines).toHaveLength(3);
    expect(filterLines(lines, f({ query: "nvda" })).lines.map((l) => l.key)).toEqual(["20035401:0"]);
    expect(filterLines(lines, f({ query: "nv" })).lines).toHaveLength(0); // two letters: ticker only, and NV is none
    expect(filterLines(lines, f({ query: "intel" })).lines.map((l) => l.key)).toEqual(["20035143:1"]);
    expect(queryMatches(trade({ ticker: "BRK.B" }) as Extract<CongressRow, { ok: true }>, "brk-b")).toBe(true);
  });

  it("filters buy and sell (a partial sale is a sale), the watchlist, the new ones and the rows with a ticker", () => {
    expect(filterLines(lines, f({ side: "buy" })).lines).toHaveLength(3);
    expect(filterLines(lines, f({ side: "sell" })).lines.map((l) => l.key)).toEqual(["20035401:0"]);
    expect(filterLines(lines, f({ watchOnly: true })).lines.map((l) => l.key)).toEqual(["20035401:0"]);
    expect(filterLines(lines, f({ newOnly: true })).lines.map((l) => l.key)).toEqual(["20035500:report"]);
    expect(filterLines(lines, f({ tickerOnly: true })).lines.map((l) => l.key)).toEqual(["20035401:0", "20035143:0", "20035143:1"]);
    expect(filterLines(lines, f({ side: "sell", member: "doggett" })).lines).toHaveLength(1);
  });

  it("counts the unreadable rows a content filter keeps out of view instead of hiding them silently", () => {
    expect(filterLines(lines, f({})).hiddenUnreadable).toBe(0);
    expect(filterLines(lines, f({})).lines.filter((l) => !l.row.ok)).toHaveLength(2);
    const r = filterLines(lines, f({ side: "buy" }));
    expect(r.hiddenUnreadable).toBe(2);
    expect(r.lines.every((l) => l.row.ok)).toBe(true);
    // a member filter keeps the member's unreadable rows – they belong to the member
    expect(filterLines(lines, f({ member: "doggett" })).lines.map((l) => l.key)).toEqual(["20035401:0", "20035401:1"]);
    expect(filterLines(lines, f({ member: "doggett", side: "sell" })).hiddenUnreadable).toBe(1);
  });

  it("summarises what was read", () => {
    expect(summarize(lines, 3, 3)).toEqual({ filings: 3, read: 3, unreadableReports: 1, rows: 4, unreadableRows: 1, withTicker: 3, watched: 1, late: 1 });
  });
});

describe("new since the last visit", () => {
  it("marks nothing without a record, and the numbers that were not listed with one", () => {
    expect([...freshDocIds(["1", "2", "3"], null)]).toEqual([]);
    expect([...freshDocIds(["1", "2", "3"], { at: 5, docIds: ["1", "2"] })]).toEqual(["3"]);
  });

  it("merges what is listed now into the record and bounds its size", () => {
    expect(nextSeen(["2", "3"], 9, { at: 5, docIds: ["1", "2"] }).docIds.sort()).toEqual(["1", "2", "3"]);
    const big = nextSeen(Array.from({ length: 50 }, (_, i) => String(1000 + i)), 1, null, 10);
    expect(big.docIds).toHaveLength(10);
    expect(big.docIds.at(-1)).toBe("1049");
  });

  it("reads a stored record leniently", () => {
    expect(seenOf({ at: 5, docIds: ["1", 2, "3"] })).toEqual({ at: 5, docIds: ["1", "3"] });
    expect(seenOf({ at: "x", docIds: [] })).toBeNull();
    expect(seenOf(null)).toBeNull();
    expect(seenOf("nonsense")).toBeNull();
  });
});
