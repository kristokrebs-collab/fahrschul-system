/**
 * One picture → its recognised words in the picture's own pixels (PURE glue over the engine interface, so a test can
 * hand in a fake engine): preprocessing, strips, mapping the engine's coordinates back, ink colour per word.
 */
import type { OcrEngine } from "./engine";
import { printStrip, prepare, toOriginal, type Prepared } from "./preprocess";
import { wordInk } from "./pixels";
import type { OcrPage, OcrWord, Raster } from "./types";

export interface PictureRead {
  page: OcrPage;
  prep: Prepared;
  /** Milliseconds the engine needed (all strips). */
  ms: number;
}

const area = (b: { x0: number; y0: number; x1: number; y1: number }): number => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

function iou(a: OcrWord["box"], b: OcrWord["box"]): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (area(a) + area(b) - i);
}

export async function recognizePicture(raster: Raster, index: number, engine: OcrEngine, onStrip?: (done: number, total: number) => void): Promise<PictureRead> {
  const prep = prepare(raster);
  const t0 = Date.now();
  const words: OcrWord[] = [];
  const strips = prep.info.strips;
  for (let i = 0; i < strips.length; i++) {
    const strip = strips[i]!;
    const found = await engine.recognize(printStrip(prep, strip), { psm: "3" });
    for (const w of found) {
      const a = toOriginal(prep, strip, w.box.x0, w.box.y0);
      const b = toOriginal(prep, strip, w.box.x1, w.box.y1);
      const box = { x0: Math.max(0, a.x), y0: Math.max(0, a.y), x1: Math.min(raster.width, b.x), y1: Math.min(raster.height, b.y) };
      if (box.x1 <= box.x0 || box.y1 <= box.y0) continue;
      const { ink, lum } = wordInk(raster, box, prep.info.background);
      const dup = words.findIndex((o) => iou(o.box, box) > 0.5);
      if (dup >= 0) {
        // the same word seen in two strips: keep the surer reading
        if (words[dup]!.conf < w.conf) words[dup] = { text: w.text, conf: w.conf, box, ink, lum };
        continue;
      }
      words.push({ text: w.text, conf: w.conf, box, ink, lum });
    }
    onStrip?.(i + 1, strips.length);
  }
  return { page: { index, width: raster.width, height: raster.height, words }, prep, ms: Date.now() - t0 };
}
