/**
 * Preparation of a screenshot for the engine (PURE – `Raster` in, planes out): background and ink (any theme, any text
 * colour), the scale that gives the text the size the engine reads best, and the strips a very tall picture is cut
 * into (at blank rows, so no line of text is cut in half).
 */
import { blankBands, estimateBackground, inkPlane, inkQuantile, isDarkBackground, meanBrightness, padPlane, printPlane, resizePlane, textLineHeight } from "./pixels";
import type { Plane, PrepInfo, Raster } from "./types";

/** Height (px) of a line of text the engine reads best: ~ 50–60 px per line run (cap height ≈ 30–35 px). */
export const TARGET_LINE_PX = 56;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.5;
/** Widest picture handed to the engine (px): above it the scale is lowered. */
export const MAX_SCALED_WIDTH = 4800;
/** Tallest strip handed to the engine (px). */
export const MAX_STRIP_PX = 3200;
/** White margin around a strip (px, scaled). */
export const STRIP_PAD = 24;

export interface Prepared {
  raster: Raster;
  /** Ink of the original picture (0–255), the base of every crop and re-read. */
  ink: Plane;
  /** The ink value that is printed as full black. */
  full: number;
  info: PrepInfo;
  /** Mean brightness of the whole picture (informational). */
  brightness: number;
}

const roundScale = (s: number): number => Math.round(s * 4) / 4;

/** The scale for text of `lineHeight` px in a picture `width` px wide. */
export function chooseScale(lineHeight: number | null, width: number): number {
  let s = lineHeight ? TARGET_LINE_PX / lineHeight : width < 1300 ? 2 : width < 2200 ? 1.5 : 1;
  s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  if (width * s > MAX_SCALED_WIDTH) s = MAX_SCALED_WIDTH / width;
  return Math.max(MIN_SCALE, roundScale(s));
}

/** y ranges (original px) of the strips, cut at blank rows when the scaled picture is taller than `MAX_STRIP_PX`. */
export function planStrips(ink: Plane, scale: number, maxPx = MAX_STRIP_PX): { y0: number; y1: number }[] {
  const maxH = Math.max(200, Math.floor(maxPx / scale));
  if (ink.height <= maxH) return [{ y0: 0, y1: ink.height }];
  const bands = blankBands(ink, Math.max(3, Math.round(4 / Math.max(scale, 0.5))));
  const strips: { y0: number; y1: number }[] = [];
  let y0 = 0;
  while (ink.height - y0 > maxH) {
    const limit = y0 + maxH;
    // the last blank band that still fits, but not so early that the strip is nearly empty
    const fit = bands.filter(([a, b]) => b <= limit && (a + b) / 2 > y0 + maxH * 0.4).pop();
    const cut = fit ? Math.round((fit[0] + fit[1]) / 2) : limit;
    strips.push({ y0, y1: cut });
    y0 = cut;
  }
  strips.push({ y0, y1: ink.height });
  return strips;
}

export function prepare(raster: Raster): Prepared {
  const bg = estimateBackground(raster);
  const ink = inkPlane(raster, bg);
  const full = Math.max(160, inkQuantile(ink, 0.9995));
  const lh = textLineHeight(ink);
  const scale = chooseScale(lh, raster.width);
  const strips = planStrips(ink, scale);
  return { raster, ink, full, brightness: meanBrightness(raster), info: { dark: isDarkBackground(bg), scale, background: bg, strips } };
}

/** The printed (black on white) strip the engine reads, scaled and padded; coordinates map back with `stripOrigin`. */
export function printStrip(p: Prepared, strip: { y0: number; y1: number }): Plane {
  const rows = p.ink.data.subarray(strip.y0 * p.ink.width, strip.y1 * p.ink.width);
  const part: Plane = { width: p.ink.width, height: strip.y1 - strip.y0, data: new Uint8ClampedArray(rows) };
  const s = p.info.scale;
  const scaled = resizePlane(part, part.width * s, part.height * s);
  return padPlane(printPlane(scaled, p.full), STRIP_PAD);
}

/** Original-picture coordinates of a point in a printed strip. */
export function toOriginal(p: Prepared, strip: { y0: number }, x: number, y: number): { x: number; y: number } {
  const s = p.info.scale;
  return { x: (x - STRIP_PAD) / s, y: (y - STRIP_PAD) / s + strip.y0 };
}

/** A small crop of the ORIGINAL ink, printed and scaled for a re-read of one cell. */
export function printCrop(p: Prepared, box: { x0: number; y0: number; x1: number; y1: number }, scale: number, pad = { x: 8, y: 6 }): Plane {
  const x0 = Math.max(0, Math.floor(box.x0 - pad.x));
  const y0 = Math.max(0, Math.floor(box.y0 - pad.y));
  const x1 = Math.min(p.ink.width, Math.ceil(box.x1 + pad.x));
  const y1 = Math.min(p.ink.height, Math.ceil(box.y1 + pad.y));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) data.set(p.ink.data.subarray((y0 + y) * p.ink.width + x0, (y0 + y) * p.ink.width + x0 + w), y * w);
  const crop: Plane = { width: w, height: h, data };
  return padPlane(printPlane(resizePlane(crop, w * scale, h * scale), p.full), STRIP_PAD);
}
