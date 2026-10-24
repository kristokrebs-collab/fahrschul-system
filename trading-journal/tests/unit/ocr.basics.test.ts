// @vitest-environment node
/// <reference types="node" />
/**
 * The small, pure parts of the local screenshot reader: the EN / DE vocabulary (and the public column headers of the
 * exchanges it names), number / time cleaning, the arithmetic that ties a position's numbers together, the voting of
 * second readings, the pixel work (any theme, coloured text) and the version of the self-hosted engine files.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OCR_VERSION, OCR_TESSERACT_VERSION, ocrSources, ocrUrls } from "@/journal/ocr/assets";
import { checkRecord, feeShareOf, leverageFromRoi } from "@/journal/ocr/plausibility";
import { blankBands, estimateBackground, inkPlane, inkQuantile, isDarkBackground, printPlane, resizePlane, textLineHeight, wordInk } from "@/journal/ocr/pixels";
import { chooseScale, planStrips, prepare, printStrip } from "@/journal/ocr/preprocess";
import { needsReread, vote } from "@/journal/ocr/refine";
import { cleanNumberText, cleanTimeText, decimalsOf, isFullTime } from "@/journal/ocr/text";
import { isSymbol, KNOWN_LAYOUTS, LABELS, matchLabel, matchTab, parseLeverageToken, parseMarginWord, parseSideWord, parseStatusWord, splitUnit, type FieldId } from "@/journal/ocr/vocab";
import type { Raster } from "@/journal/ocr/types";

describe("vocabulary", () => {
  it.each([
    ["Position PnL (Gewinn und Verlust)", "pnl"],
    ["Realisierter PnL", "pnl"],
    ["Einstiegspreis", "entry"],
    ["Schlusspreis (USDT)", "exit"],
    ["Geschlossene Menge (BTC)", "qty"],
    ["Maximal gehalten (BTC)", "maxQty"],
    ["Zeit geöffnet", "openTime"],
    ["Zeit gedffnet", "openTime"], // the engine's reading
    ["Zeit geschlossen", "closeTime"],
    ["ROI", "roi"],
    ["Durchschnittspreis", "price"],
    ["Auftragspreis", "orderPrice"],
    ["Auftragsmenge", "orderQty"],
    ["Gebühr", "fee"],
    ["Entry Price", "entry"],
    ["Avg. Close Price", "exit"],
    ["Closed P&L", "pnl"],
    ["Realized Profit", "pnl"],
    ["Position pA 4 0 Lp oA LE PnL A (Gewinn und Verlust)", "pnl"], // a dashed underline garbled the middle
  ])("%s → %s", (label, field) => {
    expect(matchLabel(label)?.field).toBe(field);
  });

  it("unknown or generic text is not a label", () => {
    for (const t of ["Isoliert", "Geschlossen", "Alle Statusse", "Vertragsaufträge", "Willkommen"]) expect(matchLabel(t)).toBeNull();
  });

  it("the unit in parentheses is the unit; „(Gewinn und Verlust)“ is part of the label", () => {
    expect(splitUnit("Schlusspreis (USDT)")).toEqual({ text: "Schlusspreis", unit: "USDT" });
    expect(splitUnit("Geschlossene Menge (BTC)").unit).toBe("BTC");
    expect(splitUnit("Position PnL (Gewinn und Verlust)").unit).toBeNull();
  });

  it("every column header of the listed exchanges' histories reads as the field it names", () => {
    expect(KNOWN_LAYOUTS.length).toBeGreaterThanOrEqual(15);
    const exchanges = new Set(KNOWN_LAYOUTS.map((l) => l.exchange));
    for (const e of ["bitunix", "bybit", "binance", "bingx", "mexc", "okx", "bitget", "kucoin", "blofin"]) expect(exchanges.has(e), e).toBe(true);
    for (const l of KNOWN_LAYOUTS) {
      expect(l.headers.length).toBe(l.fields.length);
      l.headers.forEach((h, i) => {
        const want = l.fields[i];
        if (want) expect(matchLabel(h)?.field, `${l.exchange}/${l.view}: ${h}`).toBe(want);
      });
    }
  });

  it("no phrase belongs to two fields (a label must have one meaning)", () => {
    const seen = new Map<string, FieldId>();
    for (const f of Object.keys(LABELS) as FieldId[])
      for (const p of LABELS[f]) {
        const prev = seen.get(p);
        // „type“ style duplicates would make the reading depend on the order of the table
        expect(prev === undefined || prev === f, `${p}: ${prev} / ${f}`).toBe(true);
        seen.set(p, f);
      }
  });

  it("tabs, sides, margin modes, status words and leverage tokens", () => {
    expect(matchTab("Positionshistorie")).toBe("positions");
    expect(matchTab("Positionshistorle")).toBe("positions");
    expect(matchTab("Auftragshistorie")).toBe("orders");
    expect(matchTab("Tradehistorie")).toBe("trades");
    expect(matchTab("Position History")).toBe("positions");
    expect(matchTab("Alle Statusse")).toBeNull();
    expect(parseSideWord("Long")).toBe("long");
    expect(parseSideWord("long")).toBe("long");
    expect(parseSideWord("Short")).toBe("short");
    expect(parseSideWord("Verkauf")).toBe("sell");
    expect(parseSideWord("Isoliert")).toBeNull();
    expect(parseMarginWord("Isoliert")).toBe("isolated");
    expect(parseMarginWord("isoliert")).toBe("isolated");
    expect(parseMarginWord("Cross")).toBe("cross");
    expect(parseStatusWord("Geschlossen")).toBe("closed");
    expect(parseStatusWord("Storniert")).toBe("cancelled");
    expect(parseLeverageToken("5X")).toEqual({ value: 5, repaired: false });
    expect(parseLeverageToken("SX")).toEqual({ value: 5, repaired: true });
    expect(parseLeverageToken("13X")?.value).toBe(13);
    expect(parseLeverageToken("x20")?.value).toBe(20);
    expect(parseLeverageToken("Long")).toBeNull();
    expect(isSymbol("BTCUSDT")).toBe(true);
    expect(isSymbol("ETH-USDT-SWAP")).toBe(true);
    expect(isSymbol("Geschlossen")).toBe(false);
  });
});

describe("number and time cleaning", () => {
  it.each([
    ["-14.66565175", "-14.66565175"],
    ["−14.66565175", "-14.66565175"], // unicode minus
    ["81,214.3>", "81,214.3"],
    ["80,726.1 USDT", "80,726.1"],
    ["-2.99%4", "-2.99 %"], // the icon behind the percent sign
    ["- 4.03 %", "-4.03 %"],
    ["0.0224", "0.0224"],
    ["O.0224", "0.0224"], // a letter O for the zero
    ["[4", "4"],
  ])("number %s → %s", (raw, want) => expect(cleanNumberText(raw).text).toBe(want));

  it("a repaired look-alike is reported", () => {
    expect(cleanNumberText("12O.5").repaired).toBe(true);
    expect(cleanNumberText("120.5").repaired).toBe(false);
  });

  it("times: a separator slip after a full date is repaired, a half date is not complete", () => {
    expect(cleanTimeText("2026-10-22 17.07.22").text).toBe("2026-10-22 17:07:22");
    expect(cleanTimeText("2026-10-22T17:07:22").text).toBe("2026-10-22 17:07:22");
    expect(isFullTime("2026-10-22 17:07:22")).toBe(true);
    expect(isFullTime("22.10.2026 17:07")).toBe(true);
    expect(isFullTime("10-22 17:07:22")).toBe(true);
    expect(isFullTime("17:07:22")).toBe(false);
    expect(isFullTime("2026-10-22")).toBe(false);
  });

  it("decimals as printed", () => {
    expect(decimalsOf("81,214.3")).toBe(1);
    expect(decimalsOf("0.0224")).toBe(4);
    expect(decimalsOf("81214")).toBe(0);
    expect(decimalsOf("81,214")).toBe(0);
    expect(decimalsOf("-4.03 %")).toBe(2);
  });
});

describe("plausibility of one position", () => {
  const card1 = { side: "long" as const, entry: 81214.3, exit: 80658.0, qty: 0.0224, pnl: -14.66565175, roi: -4.03, leverage: 5, fee: null };

  it("the real card: the result is NET – the fees follow from prices × quantity − result, and the ROI agrees", () => {
    const p = checkRecord(card1);
    expect(p.gross).toBeCloseTo(-12.46112, 4);
    expect(p.derivedFees).toBeCloseTo(2.204532, 5);
    expect(p.roiExpected).toBeCloseTo(-4.0307, 3);
    expect(p.roiOk).toBe(true);
    expect(p.flags).toEqual([]);
    expect(leverageFromRoi(p)).toBe(5);
    // the second card of the same screenshot
    const b = checkRecord({ side: "long", entry: 81724.5, exit: 81494.8, qty: 0.0118, pnl: -3.61625864, roi: -2.99, leverage: 8, fee: null });
    expect(b.derivedFees).toBeCloseTo(0.9058, 3);
    expect(b.roiOk).toBe(true);
  });

  it("a lost decimal point shows: quantity ×10 makes the implied fees absurd (here: a refund of 0.6 %)", () => {
    expect(Math.abs(feeShareOf({ ...card1, qty: 0.224 })!)).toBeGreaterThan(0.005);
    const p = checkRecord({ ...card1, qty: 0.224 });
    expect(p.derivedFees).toBeNull();
    expect(p.flags.map((f) => f.code)).toContain("result_far");
    expect(checkRecord({ ...card1, entry: 812143 }).flags.map((f) => f.code)).toContain("price_scale");
  });

  it("a wrong sign of the ROI or the result is named; the leverage the ROI proves is offered", () => {
    expect(checkRecord({ ...card1, roi: 4.03 }).flags.map((f) => f.code)).toContain("roi_mismatch");
    const lev = checkRecord({ ...card1, leverage: 6 });
    expect(lev.flags.find((f) => f.code === "leverage_hint")?.suggest).toEqual({ field: "leverage", value: 5 });
  });

  it("the side is hinted from the numbers when it is unknown", () => {
    const p = checkRecord({ ...card1, side: null });
    expect(p.flags[0]?.code).toBe("side_hint");
    expect(p.flags[0]?.text).toContain("Long");
  });

  it("a short position: gross has the other sign", () => {
    const p = checkRecord({ side: "short", entry: 81200, exit: 81000, qty: 0.01, pnl: 1.8, roi: null, leverage: null, fee: null });
    expect(p.gross).toBeCloseTo(2, 6);
    expect(p.derivedFees).toBeCloseTo(0.2, 6);
  });
});

describe("second reading: voting", () => {
  const ctx = { priceDecimals: 1, qtyDecimals: null };
  it("two agreeing readings win over the first one and are sure", () => {
    const v = vote("entry", { text: "81,2143", conf: 0 }, [{ text: "81,214.3", conf: 65 }, { text: "81,214.3", conf: 89 }, { text: "81214.3", conf: 40 }], ctx);
    expect(v.text).toBe("81,214.3");
    expect(v.agree).toBe(2);
    expect(v.conf).toBeGreaterThanOrEqual(80);
  });
  it("when nothing agrees the price with the market's decimals wins and stays unsure", () => {
    const v = vote("entry", { text: "812143", conf: 60 }, [{ text: "81214.3", conf: 55 }, { text: "8121.43", conf: 58 }], ctx);
    expect(v.text).toBe("81214.3");
    expect(v.conf).toBeLessThanOrEqual(60);
    expect(v.agree).toBe(1);
  });
  it("times vote on the cleaned text", () => {
    const v = vote("openTime", { text: "2026-10-22 17.07.22", conf: 70 }, [{ text: "2026-10-22 17:07:22", conf: 90 }], ctx);
    expect(v.agree).toBe(2);
  });
  it("what deserves a second look: low confidence, a price that lost its point, a time that is not complete", () => {
    const cell = (text: string, conf: number) => ({ text, conf, box: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(needsReread("entry", cell("81,214.3", 96), ctx)).toBe(false);
    expect(needsReread("entry", cell("81,214.3", 60), ctx)).toBe(true);
    expect(needsReread("entry", cell("812143", 95), ctx)).toBe(true);
    expect(needsReread("openTime", cell("2026-10-22 17:07:22", 95), ctx)).toBe(false);
    expect(needsReread("openTime", cell("17:07:22", 95), ctx)).toBe(true);
    expect(needsReread("leverage", cell("SX", 64), ctx)).toBe(true);
    expect(needsReread("leverage", cell("5X", 90), ctx)).toBe(false);
  });
});

function rasterOf(w: number, h: number, bg: [number, number, number], draw: (x: number, y: number) => [number, number, number] | null): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = draw(x, y) ?? bg;
      const o = (y * w + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe("pixels", () => {
  /** Text lines (bars 14 px high) of one colour on a background. */
  const bars = (bg: [number, number, number], ink: [number, number, number], count = 6, h = 14): Raster => rasterOf(300, count * 40 + 20, bg, (x, y) => (x > 20 && x < 260 && (y - 20) % 40 < h && y >= 20 && ((x >> 2) & 1) === 0 ? ink : null));

  it("any theme: the background is the most common colour, ink is the distance from it (dark, light, tinted)", () => {
    for (const [bg, ink, dark] of [
      [[0, 0, 0], [255, 255, 255], true],
      [[255, 255, 255], [20, 20, 20], false],
      [[24, 30, 52], [231, 96, 112], true],
    ] as const) {
      const r = bars([...bg], [...ink]);
      const b = estimateBackground(r);
      expect(Math.abs(b[0] - bg[0]) + Math.abs(b[1] - bg[1]) + Math.abs(b[2] - bg[2])).toBeLessThan(12);
      expect(isDarkBackground(b)).toBe(dark);
      const p = inkPlane(r, b);
      expect(p.data[0]).toBe(0);
      expect(inkQuantile(p, 0.999)).toBeGreaterThan(120);
    }
  });

  it("red text on black keeps its strength (luminance alone would fade it) and is classified red; green is green; white is light", () => {
    const bg: [number, number, number] = [0, 0, 0];
    const red = bars(bg, [231, 96, 112]);
    const p = inkPlane(red, bg);
    expect(Math.max(...p.data)).toBeGreaterThan(200);
    const box = { x0: 20, y0: 20, x1: 260, y1: 34 };
    expect(wordInk(red, box, bg).ink).toBe("red");
    expect(wordInk(bars(bg, [63, 165, 110]), box, bg).ink).toBe("green");
    expect(wordInk(bars(bg, [250, 250, 250]), box, bg).ink).toBe("light");
    expect(wordInk(bars(bg, [149, 151, 155]), box, bg).ink).toBe("dim");
    // black text on a white page is as strong
    expect(wordInk(bars([255, 255, 255], [10, 10, 10]), box, [255, 255, 255]).ink).toBe("light");
  });

  it("the printed picture is black text on white; resizing keeps the size contract", () => {
    const r = bars([0, 0, 0], [255, 255, 255]);
    const ink = inkPlane(r, [0, 0, 0]);
    const printed = printPlane(ink, 255);
    expect(printed.data[0]).toBe(255);
    expect(Math.min(...printed.data)).toBeLessThan(10);
    const big = resizePlane(printed, 600, 480);
    expect([big.width, big.height]).toEqual([600, 480]);
    expect(resizePlane(big, 300, 240).width).toBe(300);
  });

  it("the text size comes from the picture: the line height decides the scale", () => {
    const r = bars([0, 0, 0], [255, 255, 255], 8, 14);
    expect(textLineHeight(inkPlane(r, [0, 0, 0]))).toBe(14);
    expect(chooseScale(14, 1230)).toBeCloseTo(3.5, 1); // small desktop text: enlarged up to the cap
    expect(chooseScale(30, 923)).toBeCloseTo(1.75, 2); // a phone screenshot
    expect(chooseScale(70, 3000)).toBeLessThan(1); // very large text is reduced
    expect(chooseScale(null, 900)).toBe(2);
    // a very tall picture is capped so that reading it cannot take minutes
    expect(chooseScale(14, 585, 8000) * 585 * 8000).toBeLessThan(11_000_000 / chooseScale(14, 585, 8000));
    const s = chooseScale(14, 585, 8000);
    expect(585 * 8000 * s * s).toBeLessThanOrEqual(11_000_001);
  });

  it("a tall picture is cut into strips at blank rows – no line of text is cut in half", () => {
    const r = bars([0, 0, 0], [255, 255, 255], 60, 14);
    const ink = inkPlane(r, [0, 0, 0]);
    const strips = planStrips(ink, 3, 3200);
    expect(strips.length).toBeGreaterThan(1);
    expect(strips[0]!.y0).toBe(0);
    expect(strips.at(-1)!.y1).toBe(r.height);
    const bands = blankBands(ink);
    for (const s of strips.slice(0, -1)) expect(bands.some(([a, b]) => s.y1 >= a && s.y1 <= b), `cut at ${s.y1}`).toBe(true);
    // contiguous
    strips.slice(1).forEach((s, i) => expect(s.y0).toBe(strips[i]!.y1));
  });

  it("prepare() ties it together on a dark picture", () => {
    const prep = prepare(bars([0, 0, 0], [255, 255, 255], 10, 18));
    expect(prep.info.dark).toBe(true);
    expect(prep.info.scale).toBeGreaterThan(2);
    const strip = printStrip(prep, prep.info.strips[0]!);
    expect(strip.width).toBeGreaterThan(300);
  });
});

describe("self-hosted engine files", () => {
  it("the asset version follows the pinned packages (bump OCR_VERSION when they change)", () => {
    const root = new URL("../../", import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies["tesseract.js"]).toBe(OCR_TESSERACT_VERSION); // exact, no range
    for (const [name, v] of [["tesseract.js", OCR_TESSERACT_VERSION], ["tesseract.js-core", OCR_TESSERACT_VERSION]] as const) {
      const installed = JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, root), "utf8")) as { version: string };
      expect(installed.version, name).toBe(v);
    }
    expect(OCR_VERSION.startsWith(OCR_TESSERACT_VERSION)).toBe(true);
    expect(pkg.devDependencies["@tesseract.js-data/eng"]).toMatch(/^\d/);
    expect(pkg.devDependencies["@tesseract.js-data/deu"]).toMatch(/^\d/);
  });

  it("every file the build copies exists in node_modules; the URLs are same-origin, versioned and need no CDN", () => {
    const root = new URL("../../node_modules/", import.meta.url);
    for (const s of ocrSources()) expect(() => readFileSync(new URL(s.from, root)), s.from).not.toThrow();
    const u = ocrUrls();
    for (const url of Object.values(u)) {
      expect(url.startsWith(`/ocr/${OCR_VERSION}/`)).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    }
    expect(ocrUrls("/teilen/ocr/").lang).toBe(`/teilen/ocr/${OCR_VERSION}/lang`);
    // the core variants: relaxed SIMD, SIMD and plain – a device without the first two still works
    expect(ocrSources().filter((s) => s.to.startsWith("core/")).map((s) => s.to)).toHaveLength(3);
    // language data: English numbers / labels and the German UI words
    expect(ocrSources().filter((s) => s.to.startsWith("lang/")).map((s) => s.to)).toEqual(["lang/eng.traineddata.gz", "lang/deu.traineddata.gz"]);
  });
});
