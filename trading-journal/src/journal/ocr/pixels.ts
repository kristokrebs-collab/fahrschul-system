/**
 * Pixel work of the screenshot OCR – PURE functions on `Raster` / `Plane` (no canvas, no DOM), so the very same code
 * runs in the browser (pixels from `getImageData`) and in Node (pixels from a decoded PNG / JPEG: the tests and
 * `scripts/ocrCheck.ts`).
 *
 * Why not "grey + invert if dark": a screenshot is text on a background of ANY colour (a dark theme, a light theme, a
 * tinted card) and the text is often coloured (red losses, green gains). Measuring how far each pixel is from the
 * background colour (the most common colour of the picture) gives "ink" that is as strong for red 231/96/112 as for
 * white – with plain luminance the red minus sign of "−2.99 %" fades to a grey the engine drops.
 */
import type { Box, InkColor, Plane, Raster } from "./types";

/* ------------------------------------------------------------------ background / theme */

/** The most common colour of the picture (5 bits per channel buckets, every `stride`-th pixel) – the background. */
export function estimateBackground(r: Raster, stride = 5): [number, number, number] {
  const hist = new Map<number, number>();
  const n = r.width * r.height;
  for (let i = 0; i < n; i += stride) {
    const o = i * 4;
    const k = ((r.data[o]! >> 3) << 10) | ((r.data[o + 1]! >> 3) << 5) | (r.data[o + 2]! >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestKey = 0;
  for (const [k, v] of hist) {
    if (v > best) {
      best = v;
      bestKey = k;
    }
  }
  // the bucket's centre; refined to the true mean of the pixels in it (a pure #000 / #fff background stays exact)
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let c = 0;
  for (let i = 0; i < n; i += stride) {
    const o = i * 4;
    const k = ((r.data[o]! >> 3) << 10) | ((r.data[o + 1]! >> 3) << 5) | (r.data[o + 2]! >> 3);
    if (k !== bestKey) continue;
    sr += r.data[o]!;
    sg += r.data[o + 1]!;
    sb += r.data[o + 2]!;
    c += 1;
  }
  return c ? [Math.round(sr / c), Math.round(sg / c), Math.round(sb / c)] : [255, 255, 255];
}

export const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** A dark theme: the background is darker than mid-grey (the text is lighter than it). */
export const isDarkBackground = (bg: readonly [number, number, number]): boolean => luma(bg[0], bg[1], bg[2]) < 128;

/** Mean brightness 0–255 of the whole picture (the brief's "Mittelwert-Helligkeit"; only informational here). */
export function meanBrightness(r: Raster, stride = 7): number {
  let s = 0;
  let c = 0;
  const n = r.width * r.height;
  for (let i = 0; i < n; i += stride) {
    const o = i * 4;
    s += luma(r.data[o]!, r.data[o + 1]!, r.data[o + 2]!);
    c += 1;
  }
  return c ? s / c : 255;
}

/* ------------------------------------------------------------------ ink */

/** Below this distance from the background a pixel is noise (JPEG blocks, gradients), not ink. */
export const NOISE_FLOOR = 14;

/**
 * Ink 0–255 per pixel: the largest channel difference to the background, minus the noise floor and stretched back to
 * 0–255. Text of every colour comes out strong; the background is exactly 0.
 */
export function inkPlane(r: Raster, bg: readonly [number, number, number]): Plane {
  const n = r.width * r.height;
  const out = new Uint8ClampedArray(n);
  const k = 255 / (255 - NOISE_FLOOR);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(r.data[o]! - bg[0]), Math.abs(r.data[o + 1]! - bg[1]), Math.abs(r.data[o + 2]! - bg[2]));
    out[i] = d <= NOISE_FLOOR ? 0 : (d - NOISE_FLOOR) * k;
  }
  return { width: r.width, height: r.height, data: out };
}

/** The value at the `p` quantile (0–1) of the non-zero ink – robust "full ink" (a few white pixels must not set the scale). */
export function inkQuantile(p: Plane, q: number): number {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i]!;
    if (v > 0) {
      hist[v] = (hist[v] ?? 0) + 1;
      total += 1;
    }
  }
  if (!total) return 255;
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= total * (1 - q)) return v;
  }
  return 255;
}

/**
 * The picture the engine reads: black text on white (what Tesseract is trained on) from the ink, with the strongest
 * ink at full black. `gamma < 1` darkens the weak ink (grey labels) a little.
 */
export function printPlane(ink: Plane, full: number, gamma = 0.8): Plane {
  const out = new Uint8ClampedArray(ink.data.length);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 - 255 * Math.pow(Math.min(1, v / Math.max(1, full)), gamma);
  for (let i = 0; i < out.length; i++) out[i] = lut[ink.data[i]!]!;
  return { width: ink.width, height: ink.height, data: out };
}

/* ------------------------------------------------------------------ resize */

/** Bilinear resize to `w × h` (upscaling: smooth; downscaling is box-filtered first so thin text does not alias away). */
export function resizePlane(p: Plane, w: number, h: number): Plane {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === p.width && h === p.height) return p;
  let src = p;
  if (w < p.width * 0.75 || h < p.height * 0.75) src = boxShrink(p, Math.max(1, Math.floor(p.width / w)), Math.max(1, Math.floor(p.height / h)));
  const out = new Uint8ClampedArray(w * h);
  const sw = src.width;
  const sh = src.height;
  const xr = sw / w;
  const yr = sh / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1.0001, Math.max(0, (y + 0.5) * yr - 0.5));
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const r0 = y0 * sw;
    const r1 = Math.min(sh - 1, y0 + 1) * sw;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1.0001, Math.max(0, (x + 0.5) * xr - 0.5));
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x1 = Math.min(sw - 1, x0 + 1);
      const a = src.data[r0 + x0]!;
      const b = src.data[r0 + x1]!;
      const c = src.data[r1 + x0]!;
      const d = src.data[r1 + x1]!;
      out[y * w + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return { width: w, height: h, data: out };
}

function boxShrink(p: Plane, fx: number, fy: number): Plane {
  if (fx <= 1 && fy <= 1) return p;
  const w = Math.max(1, Math.floor(p.width / fx));
  const h = Math.max(1, Math.floor(p.height / fy));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) s += p.data[(y * fy + j) * p.width + x * fx + i]!;
      out[y * w + x] = s / (fx * fy);
    }
  return { width: w, height: h, data: out };
}

/** A white margin around the plane (the engine reads text at the very edge badly). */
export function padPlane(p: Plane, pad: number, value = 255): Plane {
  const w = p.width + pad * 2;
  const h = p.height + pad * 2;
  const out = new Uint8ClampedArray(w * h).fill(value);
  for (let y = 0; y < p.height; y++) out.set(p.data.subarray(y * p.width, (y + 1) * p.width), (y + pad) * w + pad);
  return { width: w, height: h, data: out };
}

export function cropPlane(p: Plane, b: Box): Plane {
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(p.width, Math.ceil(b.x1));
  const y1 = Math.min(p.height, Math.ceil(b.y1));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) out.set(p.data.subarray((y0 + y) * p.width + x0, (y0 + y) * p.width + x0 + w), y * w);
  return { width: w, height: h, data: out };
}

/** The plane as grey RGBA (an engine that wants an image takes it as a PNG / canvas). */
export function planeToRaster(p: Plane): Raster {
  const data = new Uint8ClampedArray(p.width * p.height * 4);
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i]!;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: p.width, height: p.height, data };
}

/* ------------------------------------------------------------------ text size / strips */

/**
 * Typical height (px) of a line of text in the ink plane: the median height of the runs of rows that carry ink
 * (thin divider lines and underlines are shorter than `minRun` and ignored).
 */
export function textLineHeight(ink: Plane, minRun = 7, maxRun = 160): number | null {
  const rows: boolean[] = [];
  const thr = Math.max(2, Math.round(ink.width * 0.002));
  for (let y = 0; y < ink.height; y++) {
    let c = 0;
    const o = y * ink.width;
    for (let x = 0; x < ink.width; x++) if (ink.data[o + x]! > 110) c += 1;
    rows.push(c >= thr);
  }
  const runs: number[] = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y <= rows.length; y++) {
    const on = y < rows.length && rows[y]!;
    if (on) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > 1 || y === rows.length) {
        const len = y - gap - start + 1;
        if (len >= minRun && len <= maxRun) runs.push(len);
        start = -1;
        gap = 0;
      }
    }
  }
  if (runs.length < 3) return null;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)]!;
}

/** Rows (y) of the ink plane without any ink, as `[from, to)` ranges of at least `minGap` rows. */
export function blankBands(ink: Plane, minGap = 4): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let y = 0; y <= ink.height; y++) {
    let blank = y < ink.height;
    if (blank) {
      const o = y * ink.width;
      for (let x = 0; x < ink.width; x++)
        if (ink.data[o + x]! > 40) {
          blank = false;
          break;
        }
    }
    if (blank) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start >= minGap) out.push([start, y]);
      start = -1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ word colour */

/**
 * The colour a piece of text is painted in, from the ORIGINAL pixels inside `box`: the strongest 8 % of the pixels
 * (by distance from the background) are the glyph cores. Red (231/96/112 in the exchange apps) and green (63/165/110)
 * are told apart from white / grey text; `lum` is how strongly the glyph core stands out from the background (0–255): the active tab is stronger than the inactive ones on either theme.
 */
export function wordInk(r: Raster, box: Box, bg: readonly [number, number, number]): { ink: InkColor; lum: number } {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(r.width, Math.ceil(box.x1));
  const y1 = Math.min(r.height, Math.ceil(box.y1));
  const px: [number, number, number, number][] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * r.width + x) * 4;
      const d = Math.max(Math.abs(r.data[o]! - bg[0]), Math.abs(r.data[o + 1]! - bg[1]), Math.abs(r.data[o + 2]! - bg[2]));
      if (d > NOISE_FLOOR * 2) px.push([r.data[o]!, r.data[o + 1]!, r.data[o + 2]!, d]);
    }
  if (px.length < 4) return { ink: "dim", lum: 0 };
  px.sort((a, b) => b[3] - a[3]);
  const top = px.slice(0, Math.max(4, Math.floor(px.length * 0.08)));
  const avg = [0, 1, 2].map((c) => top.reduce((s, p) => s + p[c]!, 0) / top.length) as [number, number, number];
  const [R, G, B] = avg;
  // how far the glyph core is from the background in brightness: white on black and black on white are both "strong"
  const l = Math.round(Math.abs(luma(R, G, B) - luma(bg[0], bg[1], bg[2])));
  if (R - G >= 55 && R - B >= 35) return { ink: "red", lum: l };
  if (G - R >= 35 && G - B >= 15) return { ink: "green", lum: l };
  return { ink: l >= 205 ? "light" : "dim", lum: l };
}
