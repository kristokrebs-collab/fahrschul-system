// @vitest-environment node
/// <reference types="node" />
/**
 * REAL text recognition in Node (tesseract.js, the same pipeline the browser runs): the user's own Bitunix screenshot and
 * four mock exchange screenshots (dark / light theme, desktop table / 390-px phone cards, order histories) that
 * `tests/fixtures/ocr/generate.mjs` renders from HTML with known values. Every field of every trade is compared with what
 * the picture shows; the hit rate PER FIELD is the test – a reading that is wrong must be wrong in a way the preview marks.
 *
 * The thresholds are what the reader reaches today, not wishes: the real screenshot must come out exactly (18 / 18 fields,
 * the cut-off card reported, nothing invented); the mocks must stay above the floors below and never invent a trade.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveZone } from "@/journal/extract/candidate";
import { createTesseractEngine, type OcrEngine } from "@/journal/ocr/engine";
import { ocrCandidates } from "@/journal/ocr/candidates";
import { nodeEngineOptions, readImage } from "@/journal/ocr/node/io";
import { readPictures, type PipelineResult } from "@/journal/ocr/pipeline";
import { SCORED_FIELDS, scoreAgainstTruth, scoreText, type Score, type TruthTrade } from "@/journal/ocr/truth";
import type { Raster } from "@/journal/ocr/types";

const fx = (name: string): string => new URL(`../fixtures/ocr/${name}`, import.meta.url).pathname;
const truthOf = (base: string): { trades: TruthTrade[] } => JSON.parse(readFileSync(fx(`${base}.truth.json`), "utf8")) as { trades: TruthTrade[] };

let engine: OcrEngine;
beforeAll(async () => {
  engine = await createTesseractEngine(nodeEngineOptions());
}, 120_000);
afterAll(async () => {
  await engine.terminate();
});

const ZONE = resolveZone(null, null, "UTC");
const candidatesOf = (res: PipelineResult) => ocrCandidates(res, { now: new Date("2026-10-24T22:50:00Z"), zone: ZONE, localZone: "UTC", fallbackStyle: "point" });

async function read(file: string): Promise<{ res: PipelineResult; score: Score; raster: Raster }> {
  const raster = readImage(fx(file));
  const res = await readPictures([raster], engine);
  const base = file.replace(/\.[a-z]+$/, "");
  return { res, raster, score: scoreAgainstTruth(candidatesOf(res).candidates, truthOf(base).trades) };
}

const crop = (r: Raster, y0: number, y1: number): Raster => ({ width: r.width, height: y1 - y0, data: r.data.slice(y0 * r.width * 4, y1 * r.width * 4) });

describe("real text recognition", { timeout: 120_000 }, () => {
  it("THE REAL SCREENSHOT (Bitunix, Positionshistorie, phone, dark): 2 trades, every field exact; the cut-off third card is reported, not entered", async () => {
    const { res, score } = await read("bitunix-positionshistorie-1.jpg");
    expect(scoreText(score)).toContain("Felder gesamt 18/18");
    expect(score.found).toBe(2);
    expect(score.extra).toBe(0);
    expect(score.hit).toBe(score.total);
    expect(res.incomplete).toHaveLength(1);
    expect(res.incomplete[0]!.text).toContain("abgeschnitten");
    expect(res.incomplete[0]!.text).toContain("13×");
    expect(res.incomplete[0]!.signature).toMatchObject({ pnl: -5.91388763, leverage: 13 });
    expect(res.extraction.trades).toHaveLength(2);
    expect(res.pictures[0]!.parsed.view).toBe("positions");
    expect(res.pictures[0]!.read.prep.info.dark).toBe(true);
    // the cells that needed a second look were read again, not guessed
    expect(res.pictures[0]!.refine.reread).toBeGreaterThan(0);
  });

  it("the same picture twice in one import is one trade each, not four", async () => {
    const raster = readImage(fx("bitunix-positionshistorie-1.jpg"));
    const res = await readPictures([raster, raster], engine);
    expect(candidatesOf(res).candidates).toHaveLength(2);
  });

  it("a picture WITHOUT an order list (the tabs and filters of the same screen) yields no trade and says so", async () => {
    const raster = readImage(fx("bitunix-positionshistorie-1.jpg"));
    const res = await readPictures([crop(raster, 0, 380)], engine);
    expect(res.extraction.trades).toHaveLength(0);
    expect(res.incomplete).toHaveLength(0);
    expect(res.pages[0]!.notes[0]).toContain("keine Orderliste");
  });

  it("only the bottom of the screen (the cut-off card): nothing becomes a trade", async () => {
    const raster = readImage(fx("bitunix-positionshistorie-1.jpg"));
    const res = await readPictures([crop(raster, 1690, 2000)], engine);
    expect(res.extraction.trades).toHaveLength(0);
    expect(res.incomplete).toHaveLength(1);
  });

  const MOCKS: { file: string; what: string; overall: number; perField: number; trades: number }[] = [
    { file: "table-dark-en.png", what: "desktop table, dark theme, English, 10 rows, small text (13 px)", overall: 0.95, perField: 0.8, trades: 10 },
    { file: "cards-dark-de-390.jpg", what: "390-px phone cards, dark, German, 8 cards (a tall JPEG)", overall: 0.97, perField: 0.9, trades: 8 },
    { file: "orders-light-en.png", what: "desktop order table, LIGHT theme, English, 10 orders = 5 trades", overall: 0.92, perField: 0.8, trades: 5 },
    { file: "ordercards-dark-de-390.jpg", what: "390-px order cards („Long öffnen / schließen“), dark, German, 8 orders = 4 trades", overall: 0.97, perField: 0.9, trades: 4 },
  ];
  for (const m of MOCKS)
    it(`${m.file}: ${m.what}`, async () => {
      const { res, score } = await read(m.file);
      const rates = Object.fromEntries(SCORED_FIELDS.filter((f) => score.fields[f].total).map((f) => [f, `${score.fields[f].hit}/${score.fields[f].total}`]));
      const msg = `\n${scoreText(score)}\n${JSON.stringify(rates)}`;
      expect(score.found, msg).toBe(m.trades);
      expect(score.extra, `no phantom trade${msg}`).toBe(0);
      expect(score.hit / score.total, `overall${msg}`).toBeGreaterThanOrEqual(m.overall);
      for (const f of SCORED_FIELDS) if (score.fields[f].total) expect(score.fields[f].hit / score.fields[f].total, `${f}${msg}`).toBeGreaterThanOrEqual(m.perField);
      expect(res.incomplete, "a complete list has no cut-off card").toHaveLength(0);
    });

  it("two screenshots of ONE list that overlap: the card the first one cuts off is complete in the second, nothing twice", async () => {
    const raster = readImage(fx("cards-dark-de-390.jpg"));
    // where the 4th card starts (from a reading of the whole picture): the first picture ends right after that card's result row
    // (like the real screenshot's cut card), the second starts a little above it
    const whole = await readPictures([raster], engine);
    const y = whole.pictures[0]!.parsed.records[3]!.symbol.box.y0;
    const res = await readPictures([crop(raster, 0, Math.round(y + 110)), crop(raster, Math.round(y - 70), raster.height)], engine);
    expect(res.pictures[0]!.records.incomplete, "the first picture cuts a card").toHaveLength(1);
    expect(res.incomplete, "the cut card is covered by the second picture").toHaveLength(0);
    const s = scoreAgainstTruth(candidatesOf(res).candidates, truthOf("cards-dark-de-390").trades);
    expect(s.extra).toBe(0);
    expect(s.found).toBeGreaterThanOrEqual(7);
    expect(s.hit / s.total).toBeGreaterThanOrEqual(0.9);
  });
});
