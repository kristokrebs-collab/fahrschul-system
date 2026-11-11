/**
 * One picture → its recognised words in the picture's own pixels (PURE glue over the engine interface, so a test can
 * hand in a fake engine): preprocessing, strips, mapping the engine's coordinates back, ink colour per word.
 */
import type { OcrEngine } from "./engine";
import { fromCrop, printCropAt, printStrip, prepare, toOriginal, type Prepared } from "./preprocess";
import { wordInk } from "./pixels";
import type { OcrPage, OcrWord, Raster } from "./types";

export interface PictureRead {
  page: OcrPage;
  prep: Prepared;
  /** Milliseconds the engine needed (all strips). */
  ms: number;
}

const area = (b: { x0: number; y0: number; x1: number; y1: number }): number => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

/** How much of the SMALLER box lies inside the other (0–1): two readings of the same spot overlap almost fully. */
function overlapShare(a: OcrWord["box"], b: OcrWord["box"]): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(area(a), area(b)));
}

/** Page-segmentation modes of the readings that are merged: the automatic one first, a sparse-text one fills what it skipped. */
export type Psm = "3" | "6" | "7" | "11";

/** Adds a word read at `box`; when the spot was read before, the surer reading stays and a clearly surer one replaces it. */
function mergeWord(words: OcrWord[], raster: Raster, prep: Prepared, text: string, conf: number, box: OcrWord["box"]): void {
  const { ink, lum } = wordInk(raster, box, prep.info.background);
  const hits = words.filter((o) => overlapShare(o.box, box) >= 0.5);
  if (hits.length && !hits.every((h) => h.conf + 8 < conf)) return;
  for (const h of hits) words.splice(words.indexOf(h), 1);
  words.push({ text, conf, box, ink, lum });
}

/** Reads every strip with one segmentation mode and merges the words into `words` (the surer reading of a spot stays). */
async function readStrips(prep: Prepared, raster: Raster, engine: OcrEngine, psm: Psm, words: OcrWord[], onStrip?: (done: number, total: number) => void): Promise<void> {
  const strips = prep.info.strips;
  for (let i = 0; i < strips.length; i++) {
    const strip = strips[i]!;
    const found = await engine.recognize(printStrip(prep, strip), { psm });
    for (const w of found) {
      const a = toOriginal(prep, strip, w.box.x0, w.box.y0);
      const b = toOriginal(prep, strip, w.box.x1, w.box.y1);
      const box = { x0: Math.max(0, a.x), y0: Math.max(0, a.y), x1: Math.min(raster.width, b.x), y1: Math.min(raster.height, b.y) };
      if (box.x1 <= box.x0 || box.y1 <= box.y0) continue;
      mergeWord(words, raster, prep, w.text, w.conf, box);
    }
    onStrip?.(i + 1, strips.length);
  }
}

export async function recognizePicture(raster: Raster, index: number, engine: OcrEngine, onStrip?: (done: number, total: number) => void, psm: Psm = "3"): Promise<PictureRead> {
  const prep = prepare(raster);
  const t0 = Date.now();
  const words: OcrWord[] = [];
  await readStrips(prep, raster, engine, psm, words, onStrip);
  return { page: { index, width: raster.width, height: raster.height, words }, prep, ms: Date.now() - t0 };
}

/**
 * A second reading with the sparse-text mode: the automatic mode groups a page into blocks and can skip whole columns of a
 * table or rows of a card list; the sparse mode finds words wherever they stand. It costs about as much as the first
 * reading, so it only runs when the first one left the records incomplete (`pipeline.ts`).
 */
export async function addSparsePass(read: PictureRead, raster: Raster, engine: OcrEngine, onStrip?: (done: number, total: number) => void): Promise<PictureRead> {
  const t0 = Date.now();
  const words = [...read.page.words];
  await readStrips(read.prep, raster, engine, "11", words, onStrip);
  return { ...read, page: { ...read.page, words }, ms: read.ms + (Date.now() - t0) };
}

/**
 * A band of the picture (the header row of a table) read again, enlarged, on its own: small grey header words that the
 * whole-page reading drops („Qty“) are found when the band is read as one line of sparse text.
 */
export async function addBandPass(read: PictureRead, raster: Raster, engine: OcrEngine, band: OcrWord["box"]): Promise<PictureRead> {
  const t0 = Date.now();
  const words = [...read.page.words];
  const h = Math.max(6, band.y1 - band.y0);
  for (const target of [56, 80]) {
    const crop = printCropAt(read.prep, { x0: 0, y0: band.y0, x1: raster.width, y1: band.y1 }, Math.min(8, Math.max(1, target / h)), { x: 0, y: 6 });
    for (const w of await engine.recognize(crop.plane, { psm: "7" })) {
      const a = fromCrop(crop, w.box.x0, w.box.y0);
      const b = fromCrop(crop, w.box.x1, w.box.y1);
      const box = { x0: Math.max(0, a.x), y0: Math.max(0, a.y), x1: Math.min(raster.width, b.x), y1: Math.min(raster.height, b.y) };
      if (box.x1 > box.x0 && box.y1 > box.y0) mergeWord(words, raster, read.prep, w.text, w.conf, box);
    }
  }
  return { ...read, page: { ...read.page, words }, ms: read.ms + (Date.now() - t0) };
}
