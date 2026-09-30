import { describe, expect, it } from "vitest";
import { tradesToCsv, csvCell, CSV_HEADER, CSV_BOM, toJsonBackup, jsonBackupText, exportFilename, stripEnrichment } from "@/domain/csv";
import { A, B, C, D, E, F, enriched, settings } from "./domain.fixtures";

describe("tradesToCsv (bundle K$)", () => {
  const s = settings();
  it("header verbatim", () => {
    expect(CSV_HEADER.join(";")).toBe(
      "Datum;Konto;Paar;Richtung;Status;Einstieg;Stop;Ziel;Ausstieg;Größe;Hebel;Gebühren;P&L;R;Kursbewegung %;Ergebnis;Grundlagen;Checkliste;Überzeugung;Plan befolgt;Gefühl;Timeframe;Begründung;Notizen;Chart",
    );
  });
  it("snapshot of the sample (BOM, ';', comma decimals, quoting, sort by date asc)", () => {
    const csv = tradesToCsv(enriched([F, D, A, C, B, E]), s);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe(CSV_HEADER.join(";"));
    expect(lines[1]).toBe(
      '2026-01-05T10:00;Scalp;BTC/USDT;long;closed;80000;79000;86000;84000;8000;;4;396;3,96;5;Gewinn;4H-Breakout über 85.900;2/8;4;Ja;Ruhig;4h;"Breakout; ""sauber""";;https://www.tradingview.com/x/abc',
    );
    expect(lines[2]).toBe("2026-01-12T11:00;Scalp;BTC/USDT;short;closed;85000;86500;;86000;8500;;0;-100;-0,67;-1,18;Verlust;4H-Neckline-Short unter 84.500;0/7;3;Nein;FOMO;4h;;;");
    expect(lines[3]).toBe("2026-02-03T09:30;Scalp;BTC/USDT;long;closed;82000;;;;;;;50;;;Gewinn;;0/5;;;;4h;;;");
    expect(lines[4]).toBe("2026-02-10T08:00;Makro;BTC/USDT;long;open;83000;82000;;;4150;;;;;;Offen;Makro-Long Support-Zone;0/9;;;;4h;;;");
    expect(lines[5]).toBe("2026-02-20T14:15;Scalp;BTC/USDT;long;closed;80000;;;80000;8000;;0;0;;0;Break-even;;0/5;2;Ja;;4h;;;");
    expect(lines[6]).toBe("2026-03-01T16:45;Scalp;BTC/USDT;long;closed;80000;79500;;79000;8000;;0;-100;-2;-1,25;Verlust;Backtest-Signal (214er);0/8;5;Nein;Gierig;4h;;;");
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
