import { describe, expect, it } from "vitest";
import { tradesToCsv, csvCell, csvTextCell, CSV_COLUMN_KINDS, CSV_HEADER, CSV_BOM, toJsonBackup, jsonBackupText, exportFilename, stripEnrichment } from "@/domain/csv";
import { A, B, C, D, E, F, enriched, settings } from "./domain.fixtures";

/** The 26 Journal-v3 columns (P06) are appended: a legacy trade leaves them empty. */
const V3_EMPTY = ";".repeat(26);

describe("tradesToCsv (bundle K$)", () => {
  const s = settings();
  it("header verbatim (bundle columns first, Journal-v3 columns appended)", () => {
    expect(CSV_HEADER.slice(0, 25).join(";")).toBe(
      "Datum;Konto;Paar;Richtung;Status;Einstieg;Stop;Ziel;Ausstieg;Größe;Hebel;Gebühren;P&L;R;Kursbewegung %;Ergebnis;Grundlagen;Checkliste;Überzeugung;Plan befolgt;Gefühl;Timeframe;Begründung;Notizen;Chart",
    );
    expect(CSV_HEADER.join(";")).toBe(
      "Datum;Konto;Paar;Richtung;Status;Einstieg;Stop;Ziel;Ausstieg;Größe;Hebel;Gebühren;P&L;R;Kursbewegung %;Ergebnis;Grundlagen;Checkliste;Überzeugung;Plan befolgt;Gefühl;Timeframe;Begründung;Notizen;Chart;" +
        "Ausstiegszeit;Haltedauer (Min);Markt;Börse;Börsenkonto;Menge;Fills;Funding;Slippage;Margin;Margin-Modus;Liq.-Preis;Tags;Bewertung;Stress;Zuversicht;Exit-Grund;MAE;MFE;MAE R;MFE R;ATR % Einstieg;Screenshots;Positions-ID;Gruppe;Quelle",
    );
    expect(Object.keys(CSV_COLUMN_KINDS)).toEqual([...CSV_HEADER]);
  });
  it("snapshot of the sample (BOM, ';', comma decimals, quoting, sort by date asc)", () => {
    const csv = tradesToCsv(enriched([F, D, A, C, B, E]), s);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe(CSV_HEADER.join(";"));
    expect(lines[1]).toBe(
      '2026-01-05T10:00;Scalp;BTC/USDT;long;closed;80000;79000;86000;84000;8000;;4;396;3,96;5;Gewinn;4H-Breakout über 85.900;2/8;4;Ja;Ruhig;4h;"Breakout; ""sauber""";;https://www.tradingview.com/x/abc' + V3_EMPTY,
    );
    expect(lines[2]).toBe("2026-01-12T11:00;Scalp;BTC/USDT;short;closed;85000;86500;;86000;8500;;0;-100;-0,67;-1,18;Verlust;4H-Neckline-Short unter 84.500;0/7;3;Nein;FOMO;4h;;;" + V3_EMPTY);
    expect(lines[3]).toBe("2026-02-03T09:30;Scalp;BTC/USDT;long;closed;82000;;;;;;;50;;;Gewinn;;0/5;;;;4h;;;" + V3_EMPTY);
    expect(lines[4]).toBe("2026-02-10T08:00;Makro;BTC/USDT;long;open;83000;82000;;;4150;;;;;;Offen;Makro-Long Support-Zone;0/9;;;;4h;;;" + V3_EMPTY);
    expect(lines[5]).toBe("2026-02-20T14:15;Scalp;BTC/USDT;long;closed;80000;;;80000;8000;;0;0;;0;Break-even;;0/5;2;Ja;;4h;;;" + V3_EMPTY);
    expect(lines[6]).toBe("2026-03-01T16:45;Scalp;BTC/USDT;long;closed;80000;79500;;79000;8000;;0;-100;-2;-1,25;Verlust;Backtest-Signal (214er);0/8;5;Nein;Gierig;4h;;;" + V3_EMPTY);
  });
  it("Journal-v3 cells: exit time, holding time, venue, quantities, tags, rating, psyche, excursion, origin", () => {
    const v3 = {
      ...A,
      reason: "",
      exitDate: "2026-01-05T13:20",
      market: "perp" as const,
      exchange: "bitunix",
      exchangeAccount: "Haupt",
      qty: 0.1,
      fills: [{ id: "f1", at: "2026-01-05T10:00", side: "open" as const, price: 80000, qty: 0.1, kind: "entry" as const }],
      fundingFees: 1.5,
      slippage: 0.25,
      margin: 1600,
      marginMode: "isolated" as const,
      liqPrice: 64000,
      tags: ["=evil", "Breakout"],
      rating: 4 as const,
      psych: { stress: 2, confidence: 5, exitReason: "Ziel erreicht" },
      mae: 300,
      mfe: 4200,
      maeR: 0.3,
      mfeR: 4.2,
      atrPct: 1.2345,
      screenshots: [{ id: "s", store: "idb" as const, key: "k" }],
      positionId: "p1",
      groupId: "g1",
      origin: { kind: "api" as const },
    };
    const line = tradesToCsv(enriched([v3]), s).slice(1).split("\n")[1]!;
    expect(line.split(";").slice(25).join(";")).toBe("2026-01-05T13:20;200;Perp;bitunix;Haupt;0,1;1;1,5;0,25;1600;Isoliert;64000;\'=evil | Breakout;4;2;5;Ziel erreicht;300;4200;0,3;4,2;1,23;1;p1;g1;API");
    // fills + funding feed the bundle columns: (84000 − 80000) × 0.1 − fees 4 − funding 1.5
    expect(line.split(";")[CSV_HEADER.indexOf("P&L")]).toBe("394,5");
  });
  it("csvCell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(1.5)).toBe("1,5");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("finding 13: free-text cells starting with a formula character are prefixed with ', numbers are not", () => {
    expect(csvTextCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvTextCell("+1")).toBe("'+1");
    expect(csvTextCell("-cmd")).toBe("'-cmd");
    expect(csvTextCell("@SUM")).toBe("'@SUM");
    expect(csvTextCell("\tx")).toBe("'\tx");
    expect(csvTextCell("\rx")).toBe("'\rx");
    expect(csvTextCell("plain")).toBe("plain");
    expect(csvTextCell(null)).toBe("");
    expect(csvCell(-100)).toBe("-100");
    expect(CSV_COLUMN_KINDS.Notizen).toBe("text");
    expect(CSV_COLUMN_KINDS["P&L"]).toBe("value");

    const evil = { ...B, notes: "=1+1", reason: "@cmd", pair: "-BTC", emotion: "+x", timeframe: "=4h", chart: "" };
    const line = tradesToCsv(enriched([evil]), s).slice(1).split("\n")[1]!.split(";");
    const col = (name: (typeof CSV_HEADER)[number]) => line[CSV_HEADER.indexOf(name)];
    expect(col("Notizen")).toBe("'=1+1");
    expect(col("Begründung")).toBe("'@cmd");
    expect(col("Paar")).toBe("'-BTC");
    expect(col("Gefühl")).toBe("'+x");
    expect(col("Timeframe")).toBe("'=4h");
    expect(col("P&L")).toBe("-100"); // numeric column untouched
    expect(col("R")).toBe("-0,67");
  });
  it("json backup", () => {
    const en = enriched([A]);
    const b = toJsonBackup(en, s, undefined, new Date("2026-04-01T00:00:00.000Z"));
    expect(b.hyblock).toBeUndefined();
    expect(b.trades[0]).toEqual(stripEnrichment(en[0]!));
    expect(b.trades[0]!.pnl).toBeCloseTo(396, 10);
    expect((b.trades[0] as unknown as Record<string, unknown>).result).toBeUndefined();
    const text = jsonBackupText(b);
    expect(text.startsWith('{\n  "exportedAt": "2026-04-01T00:00:00.000Z",')).toBe(true);
    expect(exportFilename("csv", new Date("2026-04-01T12:00:00.000Z"))).toBe("trade-journal-2026-04-01.csv");
    expect(exportFilename("json", new Date("2026-04-01T12:00:00.000Z"))).toBe("trade-journal-2026-04-01.json");
  });
});
