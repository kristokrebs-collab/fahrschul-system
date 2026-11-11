/// <reference types="node" />
/**
 * Node side of the OCR (tests, `scripts/ocrCheck.ts`) – NEVER imported by the app: decoding a PNG / JPEG into pixels
 * (`pngjs`, `jpeg-js`, dev dependencies) and the engine options that read the pinned packages from `node_modules`.
 * The pipeline itself (`../pipeline.ts`) is the same code the browser runs.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { OCR_LANGS, ocrSources } from "../assets";
import type { TesseractEngineOptions } from "../engine";
import type { Plane, Raster } from "../types";

/** Pixels of a PNG or JPEG file (by its signature, not its name). */
export function decodeImage(buf: Uint8Array): Raster {
  const b = Buffer.from(buf);
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) {
    const png = PNG.sync.read(b);
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) {
    const j = jpeg.decode(b, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data) };
  }
  throw new Error("Nur PNG und JPEG lassen sich hier lesen.");
}

export function readImage(path: string): Raster {
  return decodeImage(readFileSync(path));
}

/** A grey plane as a PNG file (what the engine reads in Node). */
export function encodePlanePng(p: Plane): Buffer {
  const png = new PNG({ width: p.width, height: p.height });
  for (let i = 0; i < p.data.length; i++) {
    const v = p.data[i]!;
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** The trading-journal folder (…/trading-journal), found from this file's place. */
function root(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** `node_modules/.cache/tj-ocr/lang` with both language files (the engine wants ONE directory; the packages are two). */
export function nodeLangDir(): string {
  const base = root();
  const dir = join(base, "node_modules", ".cache", "tj-ocr", "lang");
  mkdirSync(dir, { recursive: true });
  for (const l of OCR_LANGS) {
    const target = join(dir, `${l}.traineddata.gz`);
    if (existsSync(target)) continue;
    const src = ocrSources().find((s) => s.to === `lang/${l}.traineddata.gz`)!;
    copyFileSync(join(base, "node_modules", src.from), target);
  }
  return dir;
}

export function nodeEngineOptions(over: Partial<TesseractEngineOptions> = {}): TesseractEngineOptions {
  return { langPath: nodeLangDir(), cacheMethod: "none", encode: async (p) => encodePlanePng(p), ...over };
}
