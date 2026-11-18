/**
 * Browser side of the OCR (lazy, loaded with the sheet): decoding a picture file into pixels, the PNG the engine reads,
 * row crops for the preview, and the engine itself from the self-hosted files. Nothing here uploads anything; pictures
 * live in memory (object URLs) until the sheet closes.
 */
import { BUILD_TARGET } from "@/edition";
import { ocrUrls } from "./assets";
import type { EngineProgress, OcrEngine } from "./engine";
import type { Box, Plane, Raster } from "./types";
import { planeToRaster } from "./pixels";

/** Largest picture decoded at full size (pixels); larger ones are scaled down once (a stitched mega-screenshot). */
export const MAX_PIXELS = 40_000_000;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif,image/gif,image/bmp";

/** Whether this browser can run the local reader, with the honest reason when not. */
export function ocrSupport(): { ok: true } | { ok: false; reason: string } {
  if (BUILD_TARGET === "file") return { ok: false, reason: "Die Texterkennung braucht die Web-App (die Einzeldatei kann ihre Sprachdaten nicht laden)." };
  if (typeof WebAssembly !== "object" || typeof Worker === "undefined") return { ok: false, reason: "Dieser Browser kann die Texterkennung nicht ausführen (WebAssembly oder Web Worker fehlen)." };
  if (typeof createImageBitmap !== "function") return { ok: false, reason: "Dieser Browser kann Bilder nicht für die Texterkennung zerlegen." };
  return { ok: true };
}

export class PictureError extends Error {}

export interface Picture {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Kept for the row crops (the original picture, in memory only). */
  bitmap: ImageBitmap;
  /** Thumbnail for the list. */
  thumb: string;
}

const isHeic = (f: Blob & { name?: string }): boolean => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name ?? "");

/** A picture file as pixels. HEIC / HEIF are read where the browser can (Safari); elsewhere the reason is named. */
export async function loadPicture(file: File, id: string): Promise<{ picture: Picture; raster: Raster }> {
  if (file.size > MAX_FILE_BYTES) throw new PictureError(`„${file.name}“ ist größer als 30 MB – schneide den Bereich mit den Trades aus.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PictureError(
      isHeic(file)
        ? `„${file.name}“ ist ein HEIC-Foto, das dieser Browser nicht öffnet. Mache einen Screenshot (PNG) oder exportiere das Bild als JPEG.`
        : `„${file.name}“ ließ sich nicht als Bild lesen (PNG, JPEG, WebP und GIF gehen).`,
    );
  }
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new PictureError("Der Browser stellt keine Zeichenfläche bereit.");
  g.drawImage(bitmap, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const raster: Raster = { width: w, height: h, data: new Uint8ClampedArray(data.data.buffer) };
  const thumb = await cropUrl({ bitmap, width: bitmap.width, height: bitmap.height }, { x0: 0, y0: 0, x1: bitmap.width, y1: Math.min(bitmap.height, bitmap.width * 1.2) }, 220);
  return { picture: { id, name: file.name, width: raster.width, height: raster.height, bitmap, thumb }, raster };
}

/** A PNG of a printed plane – what the engine reads (a Blob; `canvas.toBlob`, no pixel loop in JS). */
export async function encodePlaneBlob(p: Plane): Promise<Blob> {
  const r = planeToRaster(p);
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  const g = canvas.getContext("2d");
  if (!g) throw new PictureError("Der Browser stellt keine Zeichenfläche bereit.");
  g.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PictureError("PNG-Erzeugung fehlgeschlagen"))), "image/png"));
}

/** An object URL of a region of the ORIGINAL picture (the preview's „so sieht es im Screenshot aus“). */
export async function cropUrl(src: { bitmap: ImageBitmap; width: number; height: number }, box: Box, maxWidth = 900, pad = 10): Promise<string> {
  const sx = src.bitmap.width / src.width;
  const sy = src.bitmap.height / src.height;
  const x0 = Math.max(0, Math.floor((box.x0 - pad) * sx));
  const y0 = Math.max(0, Math.floor((box.y0 - pad) * sy));
  const x1 = Math.min(src.bitmap.width, Math.ceil((box.x1 + pad) * sx));
  const y1 = Math.min(src.bitmap.height, Math.ceil((box.y1 + pad) * sy));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const k = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const g = canvas.getContext("2d");
  if (!g) return "";
  g.drawImage(src.bitmap, x0, y0, w, h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? URL.createObjectURL(blob) : "";
}

/** German line for the engine's own phase names. */
export function progressText(p: EngineProgress): string {
  const pct = p.progress > 0 && p.progress < 1 ? ` ${Math.round(p.progress * 100)} %` : "";
  if (/loading tesseract core|loading language|initializing|loading language traineddata/i.test(p.status)) return `Texterkennung wird einmalig geladen …${/language/i.test(p.status) ? pct : ""}`;
  return "Texterkennung wird gestartet …";
}

/** Starts the engine from the self-hosted files (the first start downloads a few MB, later ones come from the cache). */
export async function startEngine(onProgress?: (p: EngineProgress) => void): Promise<OcrEngine> {
  const { createTesseractEngine } = await import("./engine");
  const u = ocrUrls();
  return await createTesseractEngine({ langPath: u.lang, corePath: u.core, workerPath: u.worker, encode: encodePlaneBlob, ...(onProgress ? { onProgress } : {}), cacheMethod: "write" });
}
