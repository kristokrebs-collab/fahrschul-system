// @vitest-environment node
/// <reference types="node" />
/**
 * The layout-aware reader (words with boxes → records), table-driven on hand-made OCR word lists in the patterns real
 * exchange screenshots have: Bitunix-like phone cards (German), a desktop table with a header (English, a wrapped date),
 * order cards with „Long schließen“, a card cut off at the bottom, a label the engine garbled, a value it skipped. The one
 * real screenshot's own words (`words-bitunix-positionshistorie-1.json`, flaws included) are the last case.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferLabels, parsePage, symbolOf } from "@/journal/ocr/layout";
import { buildLines } from "@/journal/ocr/lines";
import { finalizePage } from "@/journal/ocr/records";
import type { OcrPage } from "@/journal/ocr/types";
import { line, pageOf, positionCard, TABS_POSITIONS, type Cell } from "./ocr.words";

const REAL = JSON.parse(readFileSync(new URL("../fixtures/ocr/words-bitunix-positionshistorie-1.json", import.meta.url), "utf8")) as OcrPage;

const CARD1 = { symbol: "BTCUSDT", side: "Long" as const, lev: "5X", pnl: "-14.66565175", roi: "-4.03 %", entry: "81,214.3", exit: "80,658.0", qty: "0.0224", open: "2026-10-22 17:07:22", close: "2026-10-24 15:44:24" };
const CARD2 = { symbol: "BTCUSDT", side: "Short" as const, lev: "8X", pnl: "1.60146000", roi: "1.33 %", entry: "81,724.5", exit: "81,494.8", qty: "0.0118", open: "2026-10-22 11:30:53", close: "2026-10-22 15:47:07", pnlInk: "green" as const };

describe("symbols", () => {
  it.each([
    ["BTCUSDT", "BTCUSDT", false],
    ["ETH-USDT", "ETH-USDT", false],
    ["BTC/USDT", "BTC/USDT", false],
    ["BTCUSDT.P", "BTCUSDT.P", false],
    ["1000PEPEUSDT", "1000PEPEUSDT", false],
    ["BTCUSOT", "BTCUSDT", true],
    ["Verlust)", null, false],
    ["Geschlossen", null, false],
    ["USDT", null, false],
    ["(USDT)", null, false],
  ])("%s", (raw, want, repaired) => {
    const s = symbolOf(raw);
    expect(s?.text ?? null).toBe(want);
    if (want) expect(s!.repaired).toBe(repaired);
  });
});

describe("lines and cells", () => {
  it("a lone minus belongs to the number next to it; a chevron and a torn minus are repaired", () => {
    const words = line(100, [
      [20, "ROI", {}],
      [300, "-", { ink: "red" }],
      [316, "4.03", { ink: "red" }],
      [380, "%", { ink: "red" }],
    ]);
    const l = buildLines(words)[0]!;
    expect(l.segs.map((s) => s.text)).toEqual(["ROI", "-4.03 %"]);
    const t = buildLines(line(100, [[20, "Einstiegspreis"], [300, "80,726.1>"]]))[0]!;
    expect(t.segs[1]!.text).toBe("80,726.1");
    expect(buildLines(line(100, [[20, "Position PnL"], [300, "<7.72619518", { ink: "red" }]]))[0]!.segs[1]!.text).toBe("7.72619518");
  });
});

describe("cards (phone)", () => {
  const page = pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1), ...positionCard(720, CARD2)]);

  it("reads every row of every card under its label, the tab names the view, the head gives side / margin / leverage", () => {
    const p = parsePage(page);
    expect(p.layout).toBe("cards");
    expect(p.view).toBe("positions");
    expect(p.viewHow).toBe("active-tab");
    expect(p.records).toHaveLength(2);
    const [a, b] = p.records;
    expect(a!.symbol.text).toBe("BTCUSDT");
    expect(a!.side!.word).toBe("long");
    expect(a!.marginMode!.word).toBe("isolated");
    expect(a!.leverage!.value).toBe(5);
    expect(a!.status!.word).toBe("closed");
    expect(Object.fromEntries(Object.entries(a!.fields).map(([k, c]) => [k, c!.text]))).toEqual({
      pnl: "-14.66565175",
      roi: "-4.03 %",
      entry: "81,214.3",
      exit: "80,658.0",
      maxQty: "0.0224",
      qty: "0.0224",
      openTime: "2026-10-22 17:07:22",
      closeTime: "2026-10-24 15:44:24",
    });
    expect(a!.fields.exit!.unit).toBe("USDT");
    expect(a!.fields.qty!.unit).toBe("BTC");
    expect(b!.side!.word).toBe("short");
    expect(b!.leverage!.value).toBe(8);
  });

  it("status bar, filter chips and the system navigation bar never become part of a trade", () => {
    const noise = [line(8, [[30, "22:44"], [800, "50"]]), line(100, [[20, "Alle", {}], [160, "Alle Statusse"]])];
    const bottom = [line(page.height - 30, [[100, "1"], [400, "O"], [700, "x"]])];
    const p = parsePage(pageOf([...noise, ...TABS_POSITIONS.map((l) => l.map((w) => ({ ...w, box: { ...w.box, y0: w.box.y0 + 60, y1: w.box.y1 + 60 } }))), ...positionCard(180, CARD1), ...bottom]));
    expect(p.records).toHaveLength(1);
    expect(p.records[0]!.box.y1).toBeLessThan(page.height);
  });

  it("a card cut off at the bottom is reported as incomplete – never offered as a trade, nothing guessed", () => {
    const cut = pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1), ...positionCard(720, CARD2), ...positionCard(1320, { ...CARD1, pnl: "-5.91388763", lev: "13X", rows: 3 })]);
    const f = finalizePage(parsePage(cut));
    expect(f.records).toHaveLength(2);
    expect(f.incomplete).toHaveLength(1);
    const c = f.incomplete[0]!;
    expect(c.cut).toBe(true);
    expect(c.text).toContain("abgeschnitten");
    expect(c.text).toContain("nächsten Ausschnitt");
    expect(c.text).toContain("13×");
    expect(c.signature).toMatchObject({ symbol: "BTCUSDT", side: "long", leverage: 13, pnl: -5.91388763 });
    expect(c.missing).toEqual(expect.arrayContaining(["Einstiegspreis", "Menge", "Schlusspreis"]));
  });

  it("a row the engine skipped in the MIDDLE of the last card is a reading gap, not the edge of the picture", () => {
    const rows = positionCard(1320, { ...CARD1, pnl: "-5.91388763" });
    const gap = rows.filter((_, i) => i !== 4); // Einstiegspreis row lost
    const f = finalizePage(parsePage(pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1), ...positionCard(720, CARD2), ...gap])));
    expect(f.incomplete).toHaveLength(0);
    expect(f.records).toHaveLength(3);
    expect(f.records[2]!.missing).toContain("Einstiegspreis");
  });

  it("a value whose label was garbled is placed by the other cards – marked as assumed", () => {
    const card = positionCard(720, CARD2);
    // the PnL label is unreadable ("Position pA 4 0 Lp …"): only the value stands on its line
    card[2] = line(826, [[640, "1.60146000", { ink: "green" }]]);
    const p = parsePage(pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1), ...card]));
    const b = p.records[1]!;
    expect(b.fields.pnl?.text).toBe("1.60146000");
    expect(b.fields.pnl?.inferred).toBe(true);
    const f = finalizePage(p);
    const pnl = f.records[1]!.nums.pnl!;
    // ROI, quantity and prices agree with it → confirmed, not guessed
    expect(pnl.conf).toBeGreaterThanOrEqual(0.85);
  });

  it("inferLabels does nothing with a single card or when the place is unclear", () => {
    const p = parsePage(pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1)]));
    inferLabels(p.records);
    expect(p.records[0]!.notes).toEqual([]);
  });

  it("a label with no value on its line is handed to the second reading", () => {
    const card = positionCard(120, CARD1);
    card[4] = line(336, [[30, "Einstiegspreis", { lum: 150, ink: "dim" }]]);
    const r = parsePage(pageOf([...TABS_POSITIONS, ...card])).records[0]!;
    expect(r.fields.entry).toBeUndefined();
    expect(r.empty?.[0]).toMatchObject({ field: "entry", label: "Einstiegspreis" });
  });
});

/** A desktop table: header + rows (one with the date above the time). */
function table(): OcrPage {
  const head = line(60, [[20, "Symbol"], [170, "Side"], [270, "Entry Price"], [450, "Exit Price"], [630, "Closed Qty"], [780, "Realized PnL"], [980, "Open Time"], [1260, "Close Time"]], 22);
  const row = (y: number, sym: string, side: string, entry: string, exit: string, qty: string, pnl: string, ink: "red" | "green", o: string, c: string): OcrWord[][] => [
    line(y, [[20, sym], [170, side, { ink: side === "Long" ? "green" : "red" }], [270, entry], [450, exit], [630, qty], [780, pnl, { ink }], [980, o], [1260, c]]),
  ];
  return pageOf([[...head], ...row(110, "BTCUSDT", "Long", "81,214.3", "80,658.0", "0.0224", "-14.66565175", "red", "2026-10-22 17:07:22", "2026-10-24 15:44:24"), ...row(160, "ETHUSDT", "Short", "3,377.78", "3,392.84", "0.531", "-10.18285677", "red", "2026-10-23 09:02:47", "2026-10-23 14:54:22"), ...row(210, "SOLUSDT", "Long", "168.86", "169.47", "13.2", "5.54664046", "green", "2026-10-23 19:27:56", "2026-10-24 15:18:24")], { width: 1560 });
}
type OcrWord = ReturnType<typeof line>[number];

describe("table (desktop)", () => {
  it("columns come from the header, every row is one record", () => {
    const p = parsePage(table());
    expect(p.layout).toBe("table");
    expect(p.records).toHaveLength(3);
    const r = p.records[1]!;
    expect(r.symbol.text).toBe("ETHUSDT");
    expect(r.side!.word).toBe("short");
    expect(r.fields.entry!.text).toBe("3,377.78");
    expect(r.fields.exit!.text).toBe("3,392.84");
    expect(r.fields.qty!.text).toBe("0.531");
    expect(r.fields.pnl!.text).toBe("-10.18285677");
    expect(r.fields.openTime!.text).toBe("2026-10-23 09:02:47");
    expect(r.fields.closeTime!.text).toBe("2026-10-23 14:54:22");
    expect(p.header).toBeDefined();
  });

  it("a date above its time (a cell that wraps) is one cell", () => {
    const base = table();
    const wrapped = base.words.filter((w) => !(w.box.y0 > 95 && w.box.y1 < 125 && w.box.x0 >= 980 && w.box.x0 < 1200));
    const dt = [...line(110, [[980, "2026-10-22"]]), ...line(132, [[980, "17:07:22"]])];
    const p = parsePage({ ...base, words: [...wrapped, ...dt] });
    expect(p.records[0]!.fields.openTime!.text).toBe("2026-10-22 17:07:22");
  });

  it("a header cell the first reading dropped leaves a gap that is marked for the second reading", () => {
    const base = table();
    // the qty cell of the SECOND row was skipped; the column is there in the other rows
    const words = base.words.filter((w) => !(w.text === "0.531"));
    const p = parsePage({ ...base, words });
    expect(p.records[1]!.fields.qty).toBeUndefined();
    expect(p.records[1]!.empty?.some((e) => e.field === "qty" && e.region)).toBe(true);
  });

  it("German / English / wrapped header names are the same fields", () => {
    const head = line(60, [[20, "Kontrakt"], [150, "Seite"], [250, "Einstiegspreis"], [470, "Schlusspreis"], [660, "Menge"], [790, "Realisierter PnL"]]);
    const row = line(110, [[20, "BTCUSDT"], [150, "Long", { ink: "green" }], [250, "81,214.3"], [470, "80,658.0"], [660, "0.0224"], [790, "-14.66565175", { ink: "red" }]]);
    const r = parsePage(pageOf([head, row], { width: 1100 })).records[0]!;
    expect(r.fields.entry!.text).toBe("81,214.3");
    expect(r.fields.exit!.text).toBe("80,658.0");
    expect(r.fields.pnl!.text).toBe("-14.66565175");
  });
});

describe("order history (cards and tables)", () => {
  it("„Long schließen“ names the order's action and the POSITION's side; „Markt“ is no price", () => {
    const y = 100;
    const card: Cell[][] = [
      [[30, "BTCUSDT"], [600, "2026-10-19 09:47:27", { lum: 150, ink: "dim" }]],
      [[30, "Long schließen", { ink: "red" }], [230, "Isoliert"], [330, "15X"]],
      [[30, "Realisierter PnL"], [650, "+7.57604000", { ink: "green" }]],
      [[30, "Durchschnittspreis"], [650, "82,701.8"]],
      [[30, "Auftragspreis"], [740, "Markt"]],
      [[30, "Auftragsmenge"], [700, "0.0562"]],
      [[30, "Ausgeführt"], [700, "0.0562"]],
      [[30, "Gebühr"], [650, "1.16196029"]],
    ];
    const p = parsePage(pageOf(card.map((cells, i) => line(y + i * 52, cells))));
    const r = p.records[0]!;
    expect(r.action).toMatchObject({ action: "close", side: "long" });
    expect(r.fields.price!.text).toBe("82,701.8");
    expect(r.fields.orderPrice).toBeUndefined();
    expect(r.fields.qty!.text).toBe("0.0562");
    expect(r.fields.fee!.text).toBe("1.16196029");
    expect(r.fields.pnl!.text).toBe("+7.57604000");
    expect(r.fields.time!.text).toBe("2026-10-19 09:47:27");
    expect(r.leverage!.value).toBe(15);
  });

  it("a table with a Direction column (Open Short / Close Long)", () => {
    const head = line(60, [[20, "Time"], [320, "Symbol"], [470, "Direction"], [650, "Price"], [790, "Qty"], [890, "Fee"], [1040, "Realized PnL"]]);
    const rows = [
      line(110, [[20, "2026-10-24 15:01:22"], [320, "SOLUSDT"], [470, "Close Short", { ink: "red" }], [650, "170.33"], [790, "14.2"], [890, "1.45121160"], [1040, "-13.12028880", { ink: "red" }]]),
      line(160, [[20, "2026-10-23 17:10:47"], [320, "SOLUSDT"], [470, "Open Short", { ink: "red" }], [650, "169.61"], [790, "14.2"], [890, "1.44507720"], [1040, "--"]]),
    ];
    const p = parsePage(pageOf([head, ...rows], { width: 1300 }));
    expect(p.records).toHaveLength(2);
    expect(p.records[0]!.action).toMatchObject({ action: "close", side: "short" });
    expect(p.records[1]!.action).toMatchObject({ action: "open", side: "short" });
    expect(p.records[1]!.fields.pnl).toBeUndefined();
    expect(p.records[0]!.fields.time!.text).toBe("2026-10-24 15:01:22");
  });
});

describe("pages without an order list", () => {
  it("say so instead of inventing a trade", () => {
    const p = parsePage(pageOf([line(50, [[20, "Willkommen bei der Börse"]]), line(120, [[20, "Kontostand"], [500, "1,234.50"]])]));
    expect(p.records).toHaveLength(0);
    expect(p.layout).toBe("none");
    expect(p.notes[0]).toContain("keine Orderliste");
  });

  it("an exchange is named only when its brand is read", () => {
    expect(parsePage(pageOf([line(30, [[20, "Bitunix"]]), ...positionCard(80, CARD1)])).exchange).toEqual({ id: "bitunix", name: "Bitunix" });
    expect(parsePage(pageOf([...TABS_POSITIONS, ...positionCard(120, CARD1)])).exchange).toBeNull();
  });
});

describe("the real screenshot's own words (flaws included)", () => {
  it("two complete cards and the cut third one; the lost decimal point of „81,2143“ is carried as a doubtful cell, not repaired by guessing", () => {
    const p = parsePage(REAL);
    expect(p.view).toBe("positions");
    expect(p.records.map((r) => [r.symbol.text, r.side!.word, r.leverage!.value])).toEqual([
      ["BTCUSDT", "long", 5],
      ["BTCUSDT", "long", 8],
      ["BTCUSDT", "long", 13],
    ]);
    expect(p.records[0]!.fields.entry!.text).toBe("81,2143");
    expect(p.records[0]!.fields.entry!.conf).toBeLessThan(60);
    const f = finalizePage(p);
    expect(f.records).toHaveLength(2);
    expect(f.incomplete).toHaveLength(1);
    // the unsure entry is marked unsure in the typed record
    expect(f.records[0]!.nums.entry!.conf).toBeLessThan(0.7);
    expect(f.records[1]!.nums.entry!.text).toBe("81,724.5");
    expect(f.records[1]!.nums.pnl!.text).toBe("-3.61625864");
  });
});
