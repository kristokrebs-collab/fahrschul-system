/**
 * F70 – Transaktionsbuch (Hilfsrechnung): rows from the journal, first-in-first-out matching (partial closings, DCA, short),
 * years in the chosen zone, fees and funding as rows of their own, and the visible flags (gap, duplicate, missing fee /
 * funding / time, difference to the journal) with HAND-COMPUTED numbers. The comment at each expectation says how it follows.
 * All times are written in the source zone given to the ledger; most tests use UTC so the instants are the wall times.
 */
import { describe, expect, it } from "vitest";
import { buildLedger, entryQty, ledgerFilename, ledgerToCsv, LEDGER_NOTE, matchesToCsv, rowsOfYear, type Ledger, type LedgerOptions } from "@/domain/ledger";
import type { Fill, Trade } from "@/domain/types";
import { mkTrade } from "./domain.fixtures";

const UTC: LedgerOptions = { sourceZone: "UTC", displayZone: "UTC", scope: "position" };
const f = (id: string, at: string, side: Fill["side"], price: number, qty: number, extra: Partial<Fill> = {}): Fill => ({ id, at, side, price, qty, kind: side === "open" ? "entry" : "partial", ...extra });
const build = (trades: Trade[], o: Partial<LedgerOptions> = {}): Ledger => buildLedger(trades, { currency: "USDT" }, { ...UTC, ...o });
const flagsOf = (l: Ledger, id: string): string[] => l.rows.filter((r) => r.flags.some((x) => x.id === id)).map((r) => r.id);

/** Long, two openings, two closings, the second one in the next year; every fill pays 0,10. */
const A = mkTrade({
  id: "A",
  pair: "BTCUSDT",
  date: "2026-01-10T10:00",
  exitDate: "2027-01-02T09:00",
  entry: 110,
  exit: 90,
  size: 220,
  fundingFees: 0,
  fills: [
    f("a1", "2026-01-10T10:00", "open", 100, 1, { fee: 0.1 }),
    f("a2", "2026-01-10T11:00", "open", 120, 1, { fee: 0.1, kind: "add" }),
    f("a3", "2026-01-11T09:00", "close", 130, 1.5, { fee: 0.1 }),
    f("a4", "2027-01-02T09:00", "close", 90, 0.5, { fee: 0.1, kind: "exit" }),
  ],
});

describe("FIFO matching – long with DCA and partial closings", () => {
  const l = build([A]);
  const [a1, a2, a3, a4] = l.rows;

  it("makes one row per execution, in time order, with Kauf / Verkauf", () => {
    expect(l.rows.map((r) => [r.id, r.kind, r.action, r.qty, r.price, r.fee])).toEqual([
      ["A:f0", "open", "Kauf", 1, 100, 0.1],
      ["A:f1", "open", "Kauf", 1, 120, 0.1],
      ["A:f2", "close", "Verkauf", 1.5, 130, 0.1],
      ["A:f3", "close", "Verkauf", 0.5, 90, 0.1],
    ]);
    expect(a1!.source).toBe("fills");
  });

  it("matches the 1,5 sold to the first lot (1 @ 100) and half of the second (0,5 @ 120)", () => {
    // 1 × (130 − 100) = 30 and 0,5 × (130 − 120) = 5
    expect(a3!.matches.map((m) => [m.qty, m.openPrice, m.realized])).toEqual([
      [1, 100, 30],
      [0.5, 120, 5],
    ]);
    expect(a3!.realized).toBe(35);
    // the rest of the second lot (0,5 @ 120) goes against the last sale: 0,5 × (90 − 120) = −15
    expect(a4!.matches.map((m) => [m.qty, m.openPrice, m.realized])).toEqual([[0.5, 120, -15]]);
    expect(a4!.realized).toBe(-15);
    expect(a2!.realized).toBeNull(); // an opening has no result
    expect(l.openLots).toEqual([]);
  });

  it("gives the years: the result in the year of the closing, fees in the year they were paid", () => {
    const [y26, y27] = l.years;
    // 2026: closing a3 -> gains 35; fees of a1, a2, a3 = 0,30
    expect(y26).toMatchObject({ year: 2026, closes: 1, gains: 35, losses: 0, gross: 35, funding: 0 });
    expect(y26!.fees).toBeCloseTo(0.3, 12);
    expect(y26!.net).toBeCloseTo(34.7, 12);
    // 2027: closing a4 -> losses −15; fee of a4 = 0,10
    expect(y27).toMatchObject({ year: 2027, closes: 1, gains: 0, losses: -15, gross: -15 });
    expect(y27!.net).toBeCloseTo(-15.1, 12);
  });

  it("agrees with the journal's own result (Ø entry 110: 1,5 × 20 + 0,5 × −20 = 20 gross, 0,4 fees -> 19,6) and raises no difference flag", () => {
    const total = l.years.reduce((s, y) => s + y.net, 0);
    expect(total).toBeCloseTo(19.6, 12);
    expect(flagsOf(l, "diff")).toEqual([]);
    expect(l.rows.every((r) => r.flags.length === 0)).toBe(true);
  });
});

describe("FIFO – short, missing fee and funding are flagged, not guessed", () => {
  const B = mkTrade({
    id: "B",
    side: "short",
    pair: "ETHUSDT",
    date: "2026-03-01T08:00",
    exitDate: "2026-03-03T08:00",
    entry: 50,
    exit: 55,
    size: 100,
    fills: [f("b1", "2026-03-01T08:00", "open", 50, 2), f("b2", "2026-03-02T08:00", "close", 45, 1), f("b3", "2026-03-03T08:00", "close", 55, 1, { kind: "exit" })],
  });
  const l = build([B]);

  it("values a short closing as (open − close) × qty and labels it Kauf", () => {
    expect(l.rows.map((r) => [r.kind, r.action, r.realized])).toEqual([
      ["open", "Verkauf", null],
      ["close", "Kauf", 5], // (50 − 45) × 1
      ["close", "Kauf", -5], // (50 − 55) × 1
    ]);
    expect(l.years[0]).toMatchObject({ gains: 5, losses: -5, gross: 0, net: 0 });
  });

  it("flags the missing fee on the money rows and the missing funding after a settlement lay inside the holding time", () => {
    expect(flagsOf(l, "fee-missing")).toEqual(["B:f0", "B:f1", "B:f2"]);
    // opened 01.03. 08:00, closed 03.03. 08:00: the grid 00 / 08 / 16 UTC was crossed -> "Funding fehlt" on the closings, no funding row invented
    expect(flagsOf(l, "funding-missing")).toEqual(["B:f1", "B:f2"]);
    expect(l.rows.some((r) => r.kind === "funding" || r.kind === "fee")).toBe(false);
  });

  it("does not flag funding for a short stay between two settlements, nor on spot", () => {
    const quick = mkTrade({ id: "Q", date: "2026-03-01T09:00", exitDate: "2026-03-01T10:00", entry: 10, exit: 11, size: 100, fees: 0 });
    const spot = mkTrade({ id: "S", market: "spot", date: "2026-03-01T01:00", exitDate: "2026-03-05T01:00", entry: 10, exit: 11, size: 100, fees: 0 });
    expect(flagsOf(build([quick, spot]), "funding-missing")).toEqual([]);
  });
});

describe("fees and funding as rows of their own", () => {
  const H = mkTrade({ id: "H", pair: "SOLUSDT", date: "2026-07-01T00:00", exitDate: "2026-07-02T00:00", entry: 10, exit: 12, size: 100, fees: 0.5, fundingFees: 0.2 });
  const l = build([H]);

  it("turns the entry's sums into a fee row and a funding row at the closing, marked as sums", () => {
    expect(entryQty(H)).toBe(10); // 100 ÷ 10
    expect(l.rows.map((r) => [r.kind, r.qty, r.price, r.fee, r.funding, r.realized, r.source])).toEqual([
      ["open", 10, 10, null, null, null, "entry"],
      ["close", 10, 12, null, null, 20, "entry"], // (12 − 10) × 10
      ["fee", null, null, 0.5, null, null, "entry"],
      ["funding", null, null, null, 0.2, null, "entry"],
    ]);
    expect(l.rows[2]!.at).toBe(l.rows[1]!.at);
    expect(l.rows[2]!.flags.map((x) => x.id)).toEqual(["lump"]);
    expect(l.rows[3]!.flags.map((x) => x.id)).toEqual(["lump"]);
    // 20 gross − 0,5 fee − 0,2 funding = 19,3, exactly the journal's number
    expect(l.years[0]!.net).toBeCloseTo(19.3, 12);
  });

  it("counts received funding (negative) apart and subtracts the net", () => {
    const t = mkTrade({ id: "F", date: "2026-07-01T00:00", exitDate: "2026-07-02T00:00", entry: 10, exit: 11, size: 100, fees: 0, fundingFees: -0.3 });
    const y = build([t]).years[0]!;
    expect(y).toMatchObject({ fundingPaid: 0, fundingReceived: 0.3 });
    expect(y.funding).toBeCloseTo(-0.3, 12);
    expect(y.net).toBeCloseTo(10 + 0.3, 12); // 10 gross + 0,3 received
  });

  it("shows the entry's fee instead of the executions' when they do not add up, and says so", () => {
    const M = mkTrade({
      id: "M",
      date: "2026-05-01T10:00",
      exitDate: "2026-05-01T11:00",
      entry: 10,
      exit: 11,
      size: 10,
      fees: 1,
      fundingFees: 0,
      fills: [f("m1", "2026-05-01T10:00", "open", 10, 1, { fee: 0.2 }), f("m2", "2026-05-01T11:00", "close", 11, 1, { fee: 0.2 })],
    });
    const l2 = build([M]);
    expect(l2.rows.map((r) => [r.kind, r.fee])).toEqual([
      ["open", null],
      ["close", null],
      ["fee", 1],
    ]);
    expect(flagsOf(l2, "fee-diff")).toEqual(["M:fee"]);
    expect(l2.years[0]!.fees).toBe(1);
  });
});

describe("gaps, order, rest and what cannot be turned into rows", () => {
  it("does not value a closing without an opening: unmatched quantity, a gap flag, the opening stays open", () => {
    const E = mkTrade({
      id: "E",
      date: "2026-05-02T10:00",
      exitDate: "2026-05-01T10:00",
      entry: 100,
      exit: 110,
      size: 100,
      fees: 0,
      fundingFees: 0,
      fills: [f("e1", "2026-05-02T10:00", "open", 100, 1), f("e2", "2026-05-01T10:00", "close", 110, 1, { kind: "exit" })],
    });
    const l = build([E]);
    const close = l.rows.find((r) => r.kind === "close")!;
    expect(close.realized).toBeNull();
    expect(close.unmatchedQty).toBe(1);
    expect(close.flags.map((x) => x.id).sort()).toEqual(["gap", "order"]);
    expect(l.years[0]).toMatchObject({ closes: 0, gross: 0, unmatchedQty: 1 });
    expect(l.openLots).toEqual([{ tradeId: "E", market: "BTC/USDT", account: "scalp", side: "long", qty: 1, price: 100, at: Date.UTC(2026, 4, 2, 10) }]);
  });

  it("closes the rest at the entry's exit price and marks the row as a rest", () => {
    const R = mkTrade({
      id: "R",
      date: "2026-05-03T10:00",
      exitDate: "2026-05-03T12:00",
      entry: 10,
      exit: 14,
      size: 20,
      fees: 0,
      fundingFees: 0,
      fills: [f("r1", "2026-05-03T10:00", "open", 10, 2), f("r2", "2026-05-03T11:00", "close", 12, 1)],
    });
    const l = build([R]);
    expect(l.rows.map((r) => [r.id, r.kind, r.qty, r.price, r.realized])).toEqual([
      ["R:f0", "open", 2, 10, null],
      ["R:f1", "close", 1, 12, 2], // (12 − 10) × 1
      ["R:rest", "close", 1, 14, 4], // (14 − 10) × 1
    ]);
    expect(flagsOf(l, "rest")).toEqual(["R:rest"]);
    expect(l.years[0]!.gross).toBe(6); // the journal's 2 + 4
    expect(flagsOf(l, "diff")).toEqual([]);
  });

  it("puts what it cannot turn into rows on the list of open questions", () => {
    const noTime = mkTrade({ id: "T1", date: "gestern", entry: 10, exit: 11, size: 10 });
    const manual = mkTrade({ id: "T2", date: "2026-05-04T10:00", pnlManual: 12.5 });
    const noExit = mkTrade({ id: "T3", date: "2026-05-04T10:00", entry: 10, size: 10 });
    const restNoExit = mkTrade({ id: "T4", date: "2026-05-04T10:00", entry: 10, size: 20, fills: [f("x", "2026-05-04T10:00", "open", 10, 2), f("y", "2026-05-04T11:00", "close", 11, 1)] });
    const l = build([noTime, manual, noExit, restNoExit]);
    expect(l.unresolved.map((u) => [u.tradeId, u.reason])).toEqual([
      ["T1", "Die Zeit des Eintrags ist nicht lesbar."],
      ["T2", "Einstiegskurs oder Menge fehlen, daraus lassen sich keine Zeilen bilden. Es gibt nur ein von Hand eingetragenes Ergebnis."],
      ["T3", "Eintrag ist geschlossen, hat aber keinen Ausstiegskurs."],
      ["T4", "Eintrag ist geschlossen, aber 1 Einheiten sind weder durch Ausführungen noch durch einen Ausstiegskurs geschlossen."],
    ]);
  });

  it("marks a missing execution time and a journal result that differs from the book", () => {
    const W = mkTrade({ id: "W", date: "2026-08-01T10:00", exitDate: "2026-08-02T10:00", entry: 10, exit: 11, size: 10, fees: 0, fundingFees: 0, fills: [f("w1", "2026-08-01T10:00", "open", 10, 1), f("w2", "", "close", 11, 1, { kind: "exit" })] });
    const l = build([W]);
    const close = l.rows.find((r) => r.kind === "close")!;
    expect(close.at).toBe(Date.UTC(2026, 7, 2, 10)); // the entry's exit time stands in
    expect(close.flags.map((x) => x.id)).toEqual(["time-missing"]);
    const N = mkTrade({ id: "N", date: "2026-08-01T10:00", exitDate: "2026-08-01T11:00", entry: 10, exit: 12, size: 100, fees: 0, fundingFees: 0, pnlManual: 999 });
    const ln = build([N]);
    const diff = ln.rows.find((r) => r.flags.some((x) => x.id === "diff"))!;
    expect(diff.kind).toBe("close");
    expect(diff.flags[0]!.text).toContain("999,00");
    expect(diff.flags[0]!.text).toContain("20,00"); // (12 − 10) × 10
  });
});

describe("scope – one position or the whole market", () => {
  const F = mkTrade({ id: "F", status: "open", date: "2026-06-01T09:00", entry: 100, size: 100, fees: 0, fundingFees: 0 });
  const G = mkTrade({ id: "G", date: "2026-06-02T09:00", exitDate: "2026-06-02T10:00", entry: 110, exit: 120, size: 110, fees: 0, fundingFees: 0 });

  it("matches within each entry by default: G earns 10, F stays open", () => {
    const l = build([F, G]);
    expect(l.rows.find((r) => r.id === "G:close")!.realized).toBe(10); // (120 − 110) × 1
    expect(l.openLots.map((o) => [o.tradeId, o.price])).toEqual([["F", 100]]);
  });

  it("lets all entries of a market share one queue when asked: the older lot of F is sold first", () => {
    const l = build([F, G], { scope: "market" });
    const close = l.rows.find((r) => r.id === "G:close")!;
    expect(close.realized).toBe(20); // (120 − 100) × 1: first in, first out across entries
    expect(close.matches[0]!.openRowId).toBe("F:open");
    expect(l.openLots.map((o) => [o.tradeId, o.price])).toEqual([["G", 110]]);
    // the comparison with the journal is a per-entry statement and is left out
    expect(flagsOf(l, "diff")).toEqual([]);
  });
});

describe("possible duplicates are marked, never removed", () => {
  const X = mkTrade({ id: "X", pair: "LTCUSDT", date: "2026-09-01T10:00", exitDate: "2026-09-01T11:00", entry: 50, exit: 55, size: 500, fees: 0, fundingFees: 0 });
  const Y = { ...X, id: "Y" };

  it("flags the same event (to the minute, market, quantity, price) in two entries", () => {
    const l = build([X, Y]);
    expect(l.rows).toHaveLength(4); // nothing dropped
    expect(flagsOf(l, "duplicate").sort()).toEqual(["X:close", "X:open", "Y:close", "Y:open"]);
    expect(l.flagCounts.duplicate).toBe(4);
    // the money of the duplicate is visible apart: both closings count 50, 100 is in the sum and 100 sits in flagged rows
    expect(l.years[0]).toMatchObject({ gross: 100, duplicateGross: 100 });
  });

  it("flags two entries with the same exchange id, and leaves different trades alone", () => {
    const P = mkTrade({ id: "P", exchange: "bitunix", externalId: "p9", date: "2026-09-02T10:00", exitDate: "2026-09-02T11:00", entry: 50, exit: 51, size: 50, fees: 0, fundingFees: 0 });
    const Q = mkTrade({ id: "Q", exchange: "bitunix", externalId: "p9", date: "2026-09-03T10:00", exitDate: "2026-09-03T11:00", entry: 60, exit: 61, size: 60, fees: 0, fundingFees: 0 });
    const clean = mkTrade({ id: "C", date: "2026-09-04T10:00", exitDate: "2026-09-04T11:00", entry: 70, exit: 71, size: 70, fees: 0, fundingFees: 0 });
    const l = build([P, Q, clean]);
    expect(new Set(flagsOf(l, "duplicate").map((id) => id.split(":")[0]))).toEqual(new Set(["P", "Q"]));
  });
});

describe("time zones – the year depends on the zone the book is read in", () => {
  // written in Berlin (CET, UTC+1): 01.01.2026 00:30 -> 31.12.2025 23:30 UTC; closing 01:30 -> 00:30 UTC
  const Z = mkTrade({ id: "Z", date: "2026-01-01T00:30", exitDate: "2026-01-01T01:30", entry: 100, exit: 101, size: 100, fees: 0, fundingFees: 0 });

  it("converts the wall clock from the source zone to UTC", () => {
    const l = build([Z], { sourceZone: "Europe/Berlin", displayZone: "UTC" });
    expect(l.rows.map((r) => new Date(r.at).toISOString())).toEqual(["2025-12-31T23:30:00.000Z", "2026-01-01T00:30:00.000Z"]);
  });

  it("books the closing in 2026 in Berlin and UTC, but in 2025 in New York (31.12. 19:30 EST)", () => {
    expect(build([Z], { sourceZone: "Europe/Berlin", displayZone: "Europe/Berlin" }).years.map((y) => y.year)).toEqual([2026]);
    expect(build([Z], { sourceZone: "Europe/Berlin", displayZone: "UTC" }).years.map((y) => y.year)).toEqual([2025, 2026]);
    const ny = build([Z], { sourceZone: "Europe/Berlin", displayZone: "America/New_York" });
    // both rows are on 31 December in New York
    expect(ny.years.map((y) => [y.year, y.gains])).toEqual([[2025, 1]]);
  });
});

describe("CSV export – head, columns, decimal comma, summary", () => {
  const l = build([A]);
  const now = Date.UTC(2026, 9, 25, 12, 0);

  it("heads the book with the note, the zone and what is not in it", () => {
    const csv = ledgerToCsv(l, 2026, now);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe(`"${LEDGER_NOTE}"`);
    expect(LEDGER_NOTE).toBe("Hilfsrechnung ohne Steuerberatung; Steuerregeln prüft eine Fachperson");
    expect(lines[1]).toContain("Transaktionsbuch 2026");
    expect(lines[1]).toContain("Zeitzone UTC");
    expect(lines[1]).toContain("erstellt 25.10.2026 12:00");
    expect(lines[4]).toContain("Nicht enthalten: Ein- und Auszahlungen");
  });

  it("writes one line per row of the year with the dates of acquisition and disposal and decimal commas", () => {
    const lines = ledgerToCsv(l, 2026, now).split("\n");
    const sale = lines.find((x) => x.startsWith("11.01.2026 09:00;"))!;
    // closing 1,5 @ 130, fee 0,10, result 35,00, openings on 10.01.2026, closing on 11.01.2026
    expect(sale).toBe("11.01.2026 09:00;2026-01-11T09:00:00Z;Scalp;;BTCUSDT;Schließen;Verkauf;Long;1,5;130,00;0,10;;35,00;10.01.2026;11.01.2026;USDT;Ausführung;A;");
    expect(lines.filter((x) => /^\d\d\.\d\d\.\d{4} \d\d:\d\d;/.test(x))).toHaveLength(3); // a1, a2, a3 – a4 is 2027
    expect(lines.some((x) => x.startsWith("2026;1;35,00;0,00;35,00;0,30;0,00;0,00;34,70;0;USDT"))).toBe(true);
    expect(lines.some((x) => x.startsWith("2027;"))).toBe(false);
  });

  it("exports all years when asked and the matching as a second file", () => {
    const all = ledgerToCsv(l, null, now);
    expect(all).toContain("Transaktionsbuch alle Jahre");
    expect(all).toContain("\n2027;1;0,00;-15,00;-15,00;0,10;0,00;0,00;-15,10;0;USDT");
    const m = matchesToCsv(l, 2026, now).split("\n");
    // 1 @ 100 and 0,5 @ 120 matched to the sale of 11.01.2026 -> 30,00 and 5,00
    expect(m).toContain("11.01.2026 09:00;10.01.2026 10:00;Scalp;BTCUSDT;Long;1;100,00;130,00;30,00;USDT;A;A:f2");
    expect(m).toContain("11.01.2026 09:00;10.01.2026 11:00;Scalp;BTCUSDT;Long;0,5;120,00;130,00;5,00;USDT;A;A:f2");
    expect(ledgerFilename("buch", 2026)).toBe("transaktionsbuch-2026.csv");
    expect(ledgerFilename("zuordnung", null)).toBe("fifo-zuordnung-alle-jahre.csv");
  });

  it("guards a text cell against formulas and lists the flags of a row", () => {
    const evil = mkTrade({ id: "=cmd", pair: "=BTC", date: "2026-02-01T10:00", entry: 10, size: 10, status: "open" });
    const csv = ledgerToCsv(build([evil]), null, now);
    expect(csv).toContain(";'=BTC;");
    expect(csv).toContain("Gebühr fehlt: Gebühr nicht erfasst");
  });

  it("selects the rows of a year in the zone of the book", () => {
    expect(rowsOfYear(l, 2027, "UTC").map((r) => r.id)).toEqual(["A:f3"]);
    expect(rowsOfYear(l, null, "UTC")).toHaveLength(4);
  });
});
