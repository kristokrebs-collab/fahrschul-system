/**
 * P11 CSV basics: tokenizer, numbers, times, pairs, fill aggregation and the merge that keeps the trader's fields.
 */
import { describe, expect, it } from "vitest";
import type { Trade } from "@/domain/types";
import { aggregateFills, normalizePair, parseCsv, parseNum, parseTime, planCsvMerge, toJournalTrade, type CsvFill } from "@/exchanges/csv";
import { detectDelimiter, fnv1a, parseSide, tokenize, uniqueHeader } from "@/exchanges/csv/parse";

describe("tokenizer", () => {
  it("detects the delimiter from the header line", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,1";b;c')).toBe(";");
  });

  it("handles quotes, doubled quotes, CRLF, BOM and empty lines", () => {
    const rows = tokenize('﻿name,note\r\n"Doe, J.","says ""hi"""\r\n\r\nx,"multi\nline"', ",");
    expect(rows).toEqual([
      ["name", "note"],
      ["Doe, J.", 'says "hi"'],
      ["x", "multi\nline"],
    ]);
  });

  it("skips title lines before the header and makes duplicate names unique", () => {
    const t = parseCsv("Account Statement\nPositions\nTime,Symbol,Price,Time,Price\n2026.10.05 09:30,EURUSD,1.09,2026.10.05 13:00,1.1\n");
    expect(t.header).toEqual(["Time", "Symbol", "Price", "Time_2", "Price_2"]);
    expect(t.rows).toHaveLength(1);
    expect(uniqueHeader(["A", "A", "A"])).toEqual(["A", "A_2", "A_3"]);
  });
});

describe("numbers", () => {
  it.each([
    ["1,234.56", false, 1234.56],
    ["1.234,56", false, 1234.56],
    ["12,5", false, 12.5],
    ["0,123", false, 0.123],
    ["1,234", false, 1234],
    ["1,234", true, 1.234],
    ["−12,50 USDT", false, -12.5],
    ["(3.10)", false, -3.1],
    ["12%", false, 12],
    ["1e-4", false, 0.0001],
    ["$1,000", false, 1000],
    ["", false, null],
    ["–", false, null],
    ["abc", false, null],
  ])("parseNum(%j, %s) = %s", (raw, comma, want) => {
    expect(parseNum(raw, comma)).toBe(want);
  });
});

describe("times", () => {
  const utc = (s: string) => Date.parse(`${s}Z`);
  it("reads the export spellings", () => {
    expect(parseTime("2026-10-05 07:30:12")).toBe(utc("2026-10-05T07:30:12"));
    expect(parseTime("2026-10-05T07:30:12.000Z")).toBe(utc("2026-10-05T07:30:12"));
    expect(parseTime("2026-10-05T09:30:12+02:00")).toBe(utc("2026-10-05T07:30:12"));
    expect(parseTime("2026-10-05 07:30:12.1234")).toBe(utc("2026-10-05T07:30:12.123"));
    expect(parseTime("2026-10-05 09:30:12 (UTC+2)")).toBe(utc("2026-10-05T07:30:12"));
    expect(parseTime("2026.10.05 07:30")).toBe(utc("2026-10-05T07:30:00"));
    expect(parseTime("05.10.2026 07:30")).toBe(utc("2026-10-05T07:30:00"));
    expect(parseTime("10/05/2026 07:30 PM")).toBe(utc("2026-10-05T19:30:00"));
    expect(parseTime("20261005;073012")).toBe(utc("2026-10-05T07:30:12"));
    expect(parseTime("1791185412")).toBe(1791185412000);
    expect(parseTime("1791185412000")).toBe(1791185412000);
    expect(parseTime("")).toBeNull();
    expect(parseTime("2026-13-40 10:00")).toBeNull();
  });
  it("local mode reads a zone-less time as this device's wall clock", () => {
    expect(parseTime("2026-10-05 09:30", { assume: "local" })).toBe(new Date(2026, 9, 5, 9, 30).getTime());
  });
});

describe("pairs and sides", () => {
  it.each([
    ["BTCUSDT", "BTC/USDT"],
    ["BTC-USDT-SWAP", "BTC/USDT"],
    ["BINANCE:BTCUSDT.P", "BTC/USDT"],
    ["XXBTZUSD", "BTC/USD"],
    ["XBTUSD", "BTC/USD"],
    ["ETH/USDT", "ETH/USDT"],
    ["EURUSD", "EUR/USD"],
    ["PF_SOLUSD", "SOL/USD"],
    ["AAPL", "AAPL"],
  ])("%s → %s", (raw, want) => expect(normalizePair(raw)).toBe(want));
  it("sides", () => {
    expect(["Long", "BUY", "kauf", "Entry long", "Close Long"].map(parseSide)).toEqual(["long", "long", "long", "long", "long"]);
    expect(["short", "SELL", "Verkauf", "Exit short"].map(parseSide)).toEqual(["short", "short", "short", "short"]);
    expect(parseSide("deposit")).toBeNull();
  });
});

describe("fill aggregation", () => {
  const f = (id: string, side: "buy" | "sell", qty: number, price: number, at: number, fee = 0): CsvFill => ({ id, symbol: "BTCUSDT", side, qty, price, fee, at });
  it("a flip closes the position and opens the opposite one", () => {
    const { trades } = aggregateFills([f("1", "buy", 1, 100, 1), f("2", "sell", 3, 110, 2), f("3", "buy", 2, 105, 3)], { allowShort: true, market: "perp", pairOf: normalizePair });
    expect(trades.map((t) => [t.side, t.entry, t.exit, t.qty, t.pnl])).toEqual([
      ["long", 100, 110, 1, 10],
      ["short", 110, 105, 2, 10],
    ]);
  });
  it("spot: a sell without holdings is skipped; an unfinished position stays open", () => {
    const res = aggregateFills([f("1", "sell", 1, 100, 1), f("2", "buy", 2, 100, 2), f("3", "sell", 1, 120, 3)], { allowShort: false, market: "spot", pairOf: normalizePair });
    expect(res.skipped).toBe(1);
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0]).toMatchObject({ status: "open", entry: 100, qty: 2, exit: null, pnl: null });
  });
  it("fees are split pro rata over a fill that closes and flips", () => {
    const { trades } = aggregateFills([f("1", "buy", 1, 100, 1, 1), f("2", "sell", 2, 100, 2, 2)], { allowShort: true, market: "perp", pairOf: normalizePair });
    expect(trades[0]!.fees).toBe(2);
    expect(trades[1]!.fees).toBe(1);
  });
});

describe("merge into the journal", () => {
  const now = "2026-10-12T08:00:00.000Z";
  const base = toJournalTrade(
    { key: "k1", pair: "BTC/USDT", side: "long", status: "closed", openedAt: Date.UTC(2026, 9, 5, 7, 30), closedAt: Date.UTC(2026, 9, 5, 11, 0), entry: 62000, exit: 63240, qty: 0.05, pnl: 59 },
    { formatId: "binance", venue: "binance", account: "scalp", nowIso: now },
  );
  it("new records are added, re-imports update only exchange fields, the trader's work stays", () => {
    const edited: Trade = { ...base, notes: "Lehrbuch-Ausbruch", setups: ["s_mtf"], emotion: "Ruhig", stop: 61500 };
    const corrected = { ...base, pnlManual: 58.5, pnl: 58.5, stop: 61000 };
    const plan = planCsvMerge([edited], [corrected, { ...base, id: "t_csv_new" }], now);
    expect(plan.added.map((t) => t.id)).toEqual(["t_csv_new"]);
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]).toMatchObject({ notes: "Lehrbuch-Ausbruch", setups: ["s_mtf"], emotion: "Ruhig", stop: 61500, pnlManual: 58.5 });
    expect(planCsvMerge([edited], [base], now)).toMatchObject({ added: [], updated: [], unchanged: 1 });
  });
  it("fnv1a is stable", () => {
    expect(fnv1a("abc")).toBe("1a47e90b");
  });
});
