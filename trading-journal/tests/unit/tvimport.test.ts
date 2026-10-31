import { describe, expect, it } from "vitest";
import { adaptersOf, barMsOf, compareTrades, mapColumns, parseNumber, parseTvTime, parseTvTrades, splitCsv, STATUS_LABEL, TV_ADAPTERS, type LabTrade, type TvTrade } from "@/domain/tvimport";

const H = 3_600_000;
const T0 = Date.UTC(2025, 2, 3, 8, 0);

const EN_NEW = [
  "Trade #,Type,Date/Time,Signal,Price USDT,Position size (qty),Position size (value),Net P&L USDT,Net P&L %,Favorable excursion USDT,Favorable excursion %,Adverse excursion USDT,Adverse excursion %,Cumulative P&L USDT,Cumulative P&L %",
  "3,Exit long,2025-03-05 16:00,Open,66000,0.5,33000,250,0.76,300,0.9,-50,-0.1,1210.5,1.2",
  "3,Entry long,2025-03-05 08:00,Long,65500,0.5,32750,250,0.76,300,0.9,-50,-0.1,1210.5,1.2",
  "2,Exit short,2025-03-04 12:00,Close,64000.5,0.5,32000.25,\"1,000.25\",3.1,1100,3.4,-50,-0.2,960.5,1",
  "2,Entry short,2025-03-04 04:00,Short,66000,0.5,33000,\"1,000.25\",3.1,1100,3.4,-50,-0.2,960.5,1",
  "1,Exit long,2025-03-03 20:00,TP,65100,0.5,32550,-200.5,-0.61,40,0.1,-250,-0.8,-40,-0.04",
  "1,Entry long,2025-03-03 08:00,Long,65500,0.5,32750,-200.5,-0.61,40,0.1,-250,-0.8,-40,-0.04",
].join("\n");

const DE = [
  "Trade-Nr.;Typ;Datum/Uhrzeit;Signal;Preis USDT;Kontrakte;Gewinn USDT;Gewinn %;Kumulierter Gewinn USDT",
  "2;Ausstieg Short;04.03.2025 12:00;Close;64.000,50;0,5;1.000,25;3,10;800",
  "2;Einstieg Short;04.03.2025 04:00;Short;66.000;0,5;1.000,25;3,10;800",
  "1;Ausstieg Long;03.03.2025 20:00;TP;65.100,5;0,5;-200,5;-0,61;-200,5",
  "1;Einstieg Long;03.03.2025 08:00;Long;65.500;0,5;-200,5;-0,61;-200,5",
].join("\n");

describe("TradingView-Export lesen (F14)", () => {
  it("englisches Format: Reihenfolge der Spalten egal, Zeilenpaare, offener Trade, Tausendertrennzeichen", () => {
    const r = parseTvTrades(EN_NEW);
    expect(r.errors).toEqual([]);
    expect(r.delimiter).toBe(",");
    expect(r.language).toBe("en");
    expect(r.currency).toBe("USDT");
    expect(r.trades.map((t) => t.no)).toEqual([1, 2, 3]);
    const [a, b, c] = r.trades;
    expect(a).toMatchObject({ side: "long", entryPrice: 65500, exitPrice: 65100, pnl: -200.5, qty: 0.5, open: false, entryTime: Date.UTC(2025, 2, 3, 8, 0), exitTime: Date.UTC(2025, 2, 3, 20, 0) });
    expect(b).toMatchObject({ side: "short", pnl: 1000.25, pnlPct: 3.1, exitSignal: "Close" });
    expect(c).toMatchObject({ open: true });
  });

  it("deutsches Format mit Semikolon und Dezimalkomma", () => {
    const r = parseTvTrades(DE);
    expect(r.errors).toEqual([]);
    expect(r.delimiter).toBe(";");
    expect(r.language).toBe("de");
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ side: "long", entryPrice: 65500, exitPrice: 65100.5, qty: 0.5, pnl: -200.5 });
    expect(r.trades[1]).toMatchObject({ side: "short", exitPrice: 64000.5, pnl: 1000.25, entryTime: Date.UTC(2025, 2, 4, 4, 0) });
  });

  it("andere Spaltenreihenfolge und fehlende optionale Spalten", () => {
    const csv = ["Price USDT,Date/Time,Type,Trade #", "101,2025-01-01 00:00,Entry long,1", "103,2025-01-01 04:00,Exit long,1"].join("\n");
    const r = parseTvTrades(csv);
    expect(r.errors).toEqual([]);
    expect(r.trades[0]).toMatchObject({ entryPrice: 101, exitPrice: 103, pnl: null });
    expect(r.warnings.join(" ")).toMatch(/Keine Gewinn-Spalte/);
  });

  it("Zeitzone der Datei: der Versatz wird abgezogen", () => {
    const r = parseTvTrades(EN_NEW, { utcOffsetMinutes: 120 });
    expect(r.trades[0]!.entryTime).toBe(Date.UTC(2025, 2, 3, 6, 0));
  });

  it("Fehler mit Zeilennummer; gute Zeilen bleiben", () => {
    const csv = [
      "Trade #,Type,Date/Time,Signal,Price USDT,Net P&L USDT",
      "1,Entry long,2025-03-03 08:00,L,100,5", // 2
      "1,Exit long,2025-03-03 12:00,X,abc,5", // 3: price not a number
      "2,Entry sideways,2025-03-04 08:00,L,100,5", // 4: type
      "3,Entry long,31.02.2025 08:00,L,100,5", // 5: impossible date
      "x,Entry long,2025-03-05 08:00,L,100,5", // 6: trade number
      "4,Entry long,2025-03-06 08:00,L,100,5", // 7
      "4,Exit long,2025-03-06 12:00,X,110,10", // 8
    ].join("\n");
    const r = parseTvTrades(csv);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[0]!.message).toMatch(/Preis „abc“ ist keine Zahl/);
    expect(r.errors[1]!.message).toMatch(/Typ „Entry sideways“ nicht erkannt/);
    expect(r.errors[2]!.message).toMatch(/Datum „31.02.2025 08:00“ nicht lesbar/);
    expect(r.errors[3]!.message).toMatch(/Trade-Nummer „x“/);
    // trade 1 lost its exit row (line 3) → open with a warning; trade 4 is whole
    expect(r.trades.map((t) => [t.no, t.open])).toEqual([[1, true], [4, false]]);
    expect(r.warnings.join(" ")).toMatch(/Trade 1 hat keine Ausstiegszeile/);
  });

  it("Datei ohne passende Kopfzeile oder leer: verständliche Meldung statt Absturz", () => {
    expect(parseTvTrades("").errors[0]!.message).toMatch(/leer/);
    const r = parseTvTrades("foo,bar\n1,2");
    expect(r.errors[0]).toMatchObject({ line: 1 });
    expect(r.errors[0]!.message).toMatch(/fehlt: Trade-Nummer, Typ, Datum\/Uhrzeit, Preis/);
    expect(r.trades).toEqual([]);
  });

  it("Ausstieg ohne Einstieg, doppelte Zeilen und widersprüchliche Richtung werden gemeldet", () => {
    const csv = ["Trade #,Type,Date/Time,Price", "1,Exit long,2025-01-01 10:00,5", "2,Entry long,2025-01-01 10:00,5", "2,Entry long,2025-01-01 11:00,5", "3,Entry long,2025-01-02 10:00,5", "3,Exit short,2025-01-02 12:00,6"].join("\n");
    const r = parseTvTrades(csv);
    expect(r.errors.map((e) => e.line)).toEqual([4, 2, 6]);
    expect(r.errors[0]!.message).toMatch(/^Trade 2 hat zwei Einstiegszeilen \(die erste steht in Zeile 3\)/);
    expect(r.errors[1]!.message).toMatch(/^Trade 1: Ausstiegszeile ohne Einstiegszeile/);
    expect(r.errors[2]!.message).toMatch(/^Trade 3: Einstieg ist Long, Ausstieg Short/);
  });

  it("BOM, CRLF, Anführungszeichen mit Zeilenumbruch in der Zelle", () => {
    const csv = '﻿Trade #,Type,Date/Time,Signal,Price\r\n1,Entry long,2025-01-01 00:00,"Long\nentry",10\r\n1,Exit long,2025-01-01 04:00,"say ""hi""",12\r\n';
    const r = parseTvTrades(csv);
    expect(r.errors).toEqual([]);
    expect(r.trades[0]).toMatchObject({ entrySignal: "Long\nentry", exitSignal: 'say "hi"', line: 2 });
    expect(splitCsv("a,b\n\n\nc,d", ",").map((x) => x.line)).toEqual([1, 4]);
  });

  it("Zahlen: beide Schreibweisen, Minuszeichen, Klammern, Unlesbares", () => {
    expect(parseNumber("1.234,56", "point")).toBe(1234.56);
    expect(parseNumber("1,234.56", "comma")).toBe(1234.56);
    expect(parseNumber("−12,5", "comma")).toBe(-12.5);
    expect(parseNumber("(3.5)", "point")).toBe(-3.5);
    expect(parseNumber("1 234,5", "comma")).toBe(1234.5);
    expect(parseNumber("65,500", "point")).toBe(65500);
    expect(parseNumber("0,123", "point")).toBe(0.123);
    expect(parseNumber("1.234", "comma")).toBe(1234);
    expect(parseNumber("12.5", "comma")).toBe(12.5);
    expect(parseNumber("1,234,567", "point")).toBe(1234567);
    expect(parseNumber("+5", "point")).toBe(5);
    expect(parseNumber("", "point")).toBeNull();
    expect(parseNumber("—", "point")).toBeNull();
    expect(parseNumber("abc", "point")).toBeNaN();
  });

  it("Datum: ISO mit Offset, deutsch, Schrägstrich-Mehrdeutigkeit, unmöglich", () => {
    expect(parseTvTime("2025-03-03T08:00:00Z", 120).ms).toBe(Date.UTC(2025, 2, 3, 8, 0));
    expect(parseTvTime("2025-03-03 08:00+02:00", 0).ms).toBe(Date.UTC(2025, 2, 3, 6, 0));
    expect(parseTvTime("03.03.2025, 08:00", 0).ms).toBe(Date.UTC(2025, 2, 3, 8, 0));
    expect(parseTvTime("2025-03-03", 0).ms).toBe(Date.UTC(2025, 2, 3, 0, 0));
    expect(parseTvTime("13/03/2025 10:00", 0)).toEqual({ ms: Date.UTC(2025, 2, 13, 10, 0), ambiguous: false });
    expect(parseTvTime("03/04/2025 10:00", 0)).toMatchObject({ ms: Date.UTC(2025, 2, 4, 10, 0), ambiguous: true });
    expect(parseTvTime("2025-02-30 10:00", 0).ms).toBeNaN();
    expect(parseTvTime("gestern", 0).ms).toBeNaN();
    expect(parseTvTime("", 0).ms).toBeNull();
  });

  it("Spalten per Kopfzeile, Währung aus dem Namen, kumulierte Spalten bleiben außen vor", () => {
    const c = mapColumns(["Trade #", "Type", "Date/Time", "Signal", "Price USDT", "Position size (qty)", "Position size (value)", "Net P&L USDT", "Net P&L %", "Cumulative P&L USDT", "Run-up USDT"]);
    expect(c.idx).toEqual({ no: 0, type: 1, time: 2, signal: 3, price: 4, qty: 5, pnl: 7, pnlPct: 8 });
    expect(c.currency).toBe("USDT");
    const old = mapColumns(["Trade #", "Type", "Signal", "Date/Time", "Price USDT", "Contracts", "Profit USDT", "Profit %", "Cum. Profit USDT"]);
    expect(old.idx).toMatchObject({ qty: 5, pnl: 6, pnlPct: 7 });
  });
});

describe("Adapterstatus (F14)", () => {
  it("nennt unterstützt, nur Forwardtest und nicht unterstützt – jedes mit Grenzen; kein Login, kein fremder Code", () => {
    expect(adaptersOf("supported").map((a) => a.id)).toEqual(["pine-export", "tester-export", "indicator-check"]);
    expect(adaptersOf("forward").map((a) => a.id)).toEqual(["alert-webhook"]);
    expect(adaptersOf("unsupported").map((a) => a.id)).toEqual(["pine-strategy", "pine-indicator", "indicator-series", "account"]);
    expect(STATUS_LABEL).toEqual({ supported: "unterstützt", forward: "nur Forwardtest über Alert", unsupported: "nicht unterstützt" });
    for (const a of TV_ADAPTERS) expect(a.limits.length).toBeGreaterThan(40);
    expect(TV_ADAPTERS.find((a) => a.id === "account")!.limits).toMatch(/kein Login/);
    expect(TV_ADAPTERS.find((a) => a.id === "pine-strategy")!.limits).toMatch(/keinen fremden Code/);
  });
});

const tv = (no: number, side: "long" | "short", entryH: number, exitH: number, entry: number, exit: number, pnl: number, over: Partial<TvTrade> = {}): TvTrade => ({
  no, side, entryTime: T0 + entryH * H, exitTime: T0 + exitH * H, entryPrice: entry, exitPrice: exit, qty: 1, pnl, pnlPct: null, entrySignal: "", exitSignal: "", open: false, line: 2 * no, ...over,
});
const lab = (side: "long" | "short", entryH: number, exitH: number, entry: number, exit: number, pnl: number, over: Partial<LabTrade> = {}): LabTrade => ({
  side, entryTime: T0 + entryH * H, exitTime: T0 + exitH * H, entry, exit, pnl, fees: 2, funding: 0, slippage: 1, qty: 1, move: ((side === "long" ? 1 : -1) * (exit - entry)) / entry, reason: "target", ...over,
});
const OPTS = { barMs: H, labFrom: T0 - 100 * H, labTo: T0 + 1000 * H };

describe("Vergleich mit einem Labor-Lauf (F14)", () => {
  it("paart nach Richtung und Einstiegszeit (eine Kerze Toleranz), jedes Gegenstück nur einmal", () => {
    const c = compareTrades(
      [tv(1, "long", 0, 10, 100, 110, 10), tv(2, "short", 20, 30, 200, 190, 10), tv(3, "long", 40, 50, 100, 90, -10), tv(4, "long", 60, 61, 100, 101, 1)],
      [lab("long", 0, 10, 100, 110, 8), lab("short", 21, 30, 200, 190, 9), lab("long", 44, 50, 100, 90, -12), lab("long", 90, 95, 100, 120, 20)],
      OPTS,
    );
    expect(c.pairs.map((p) => [p.tv.no, p.entryBars])).toEqual([[1, 0], [2, -1]]);
    expect(c.onlyTv.map((t) => t.no)).toEqual([3, 4]);
    // the lab trade at hour 90 starts after TradingView's last exit: outside the common period, not "only in the lab"
    expect(c.onlyLab).toHaveLength(1);
    expect(c.lab).toMatchObject({ total: 4, inWindow: 3, outside: 1 });
    expect(c.matchRate).toBeCloseTo(0.5);
    expect(c.net.tvPaired).toBe(20);
    expect(c.net.labPaired).toBe(17);
    expect(c.net.diffPaired).toBe(-3);
    expect(c.net.tvAll).toBe(11);
    expect(c.net.labAll).toBe(8 + 9 - 12);
    expect(c.net.diffAll).toBe(5 - 11);
  });

  it("Gründe nur mit Zahlen: Kosten, Positionsgröße, Reihenfolge in der Kerze, Verzögerung, Trades ohne Gegenstück", () => {
    const c = compareTrades(
      [tv(1, "long", 0, 10, 100, 110, 10, { qty: 1 }), tv(2, "long", 20, 30, 100, 90, -10, { qty: 1 }), tv(3, "short", 40, 50, 100, 90, 10, { qty: 1 })],
      [lab("long", 1, 10, 100.2, 109, 8, { qty: 2, fees: 3, funding: 1 }), lab("long", 20, 31, 100, 95, -6, { qty: 2, ambiguous: true }), lab("short", 45, 49, 100, 95, 5, { qty: 2 })],
      OPTS,
    );
    const ids = c.reasons.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["costs", "sizing", "order", "delay", "exits", "unpaired", "scope"]));
    const text = (id: string) => c.reasons.find((r) => r.id === id)!.text;
    expect(text("costs")).toMatch(/2 gepaarten Trades 5 USDT Gebühren und 1 USDT Funding/);
    expect(text("sizing")).toMatch(/1,00 Einheiten, das Labor 2,00/);
    expect(text("order")).toMatch(/1 gepaarter Trade hatte Stop und Ziel in derselben Kerze/);
    expect(text("delay")).toMatch(/1 von 2 Paaren .* im Median 0,5 Kerzen früher in TradingView/);
    expect(text("exits")).toMatch(/1 Ausstieg kam in TradingView früher/);
    expect(text("unpaired")).toMatch(/1 Trade nur in TradingView, 1 nur im Labor/);
    // every observation is hedged, none claims a proven cause
    for (const r of c.reasons) expect(r.text).not.toMatch(/\bwegen\b|\bist die Ursache\b|\bbeweist\b(?! keine)/);
  });

  it("gemeinsamer Zeitraum: Trades davor und danach zählen nicht; offene TradingView-Trades bleiben außen vor", () => {
    const c = compareTrades(
      [tv(1, "long", 0, 10, 100, 110, 10), tv(2, "long", 100, 110, 100, 110, 10), tv(3, "long", 200, 0, 100, 100, 0, { open: true, exitTime: null })],
      [lab("long", 0, 10, 100, 110, 9), lab("long", 100, 110, 100, 110, 9), lab("long", 400, 410, 100, 110, 9)],
      { ...OPTS, labTo: T0 + 150 * H },
    );
    expect(c.tv).toMatchObject({ total: 3, open: 1, closed: 2, inWindow: 2, outside: 0 });
    expect(c.lab).toMatchObject({ total: 3, inWindow: 2, outside: 1 });
    expect(c.pairs).toHaveLength(2);
    expect(c.reasons.find((r) => r.id === "period")!.text).toMatch(/Außerhalb liegen 0 Trades aus TradingView und 1 aus dem Labor; 1 offener TradingView-Trade bleibt außen vor/);
  });

  it("ohne Überlappung oder ohne Trades: ehrliche Meldung, keine erfundenen Zahlen", () => {
    const c = compareTrades([tv(1, "long", 0, 10, 100, 110, 10)], [lab("long", 0, 10, 100, 110, 9)], { ...OPTS, labFrom: T0 + 500 * H, labTo: T0 + 600 * H });
    expect(c.window).toBeNull();
    expect(c.pairs).toEqual([]);
    expect(c.matchRate).toBeNull();
    expect(c.reasons.map((r) => r.id)).toEqual(["period"]);
    const empty = compareTrades([], [], OPTS);
    expect(empty.window).toBeNull();
    expect(empty.net.tvAll).toBe(0);
  });

  it("fehlende Gewinn-Spalte: Netto aus TradingView bleibt unbekannt (null), die Bewegungen werden trotzdem verglichen", () => {
    const c = compareTrades([tv(1, "long", 0, 10, 100, 110, 0, { pnl: null })], [lab("long", 0, 10, 100, 110, 9)], OPTS);
    expect(c.net.tvPaired).toBeNull();
    expect(c.net.diffPaired).toBeNull();
    expect(c.moves.tv).toBeCloseTo(10);
    expect(c.moves.lab).toBeCloseTo(10);
  });

  it("Kerzenlänge je Zeiteinheit", () => {
    expect(barMsOf("4h")).toBe(14_400_000);
    expect(barMsOf("1d")).toBe(86_400_000);
    expect(barMsOf("15m")).toBe(900_000);
  });
});
