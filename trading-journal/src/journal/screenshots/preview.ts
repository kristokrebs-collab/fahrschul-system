/**
 * The small picture of a screenshot (A2): lists, thumbnails and the lightbox's first paint show a DERIVED preview
 * (long edge ≤ `PREVIEW_SIDE`, WebP) – the stored original is never touched. `derivePreview` runs in the worker
 * (`shot.worker.ts`: `createImageBitmap` + `OffscreenCanvas`) and, where no worker exists, on the main thread; both
 * paths let the browser decode and scale off the main thread (`createImageBitmap` with a target size), so the page
 * only does the cheap parts.
 */
import { fitSize, PREVIEW_SIDE } from "./image";

export interface PreviewResult {
  /** Pixel size of the ORIGINAL (from the header or the decoder). */
  w?: number;
  h?: number;
  /** The derived picture; `null` = the original is small enough to be shown as it is. */
  preview: Blob | null;
}

/** A file this small and this narrow needs no separate preview. */
const SMALL_BYTES = 200 * 1024;
const QUALITY = 0.82;

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

function encode(canvas: Canvas2D, type: string): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality: QUALITY }).catch(() => null);
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), type, QUALITY));
}

function makeCanvas(w: number, h: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/**
 * Decodes `blob` (scaled by the decoder when the size is known) and encodes the preview. Resolves `{ preview: null }`
 * when there is no decoder / canvas here or the picture needs none – the caller then shows the original.
 * `known` = the pixel size from the file header, so the decoder can scale while it decodes.
 */
export async function derivePreview(blob: Blob, known?: { w?: number; h?: number }): Promise<PreviewResult> {
  if (typeof createImageBitmap !== "function") return { w: known?.w, h: known?.h, preview: null };
  // animated pictures keep playing in the viewer: the original is the preview
  if (blob.type === "image/gif") return { w: known?.w, h: known?.h, preview: null };
  let w = known?.w;
  let h = known?.h;
  let bitmap: ImageBitmap | null = null;
  try {
    if (w && h) {
      const t = fitSize(w, h, PREVIEW_SIDE);
      if (t.w === w && blob.size <= SMALL_BYTES) return { w, h, preview: null };
      bitmap = await createImageBitmap(blob, t.w === w ? undefined : { resizeWidth: t.w, resizeHeight: t.h, resizeQuality: "high" });
    } else {
      bitmap = await createImageBitmap(blob);
      w = bitmap.width;
      h = bitmap.height;
    }
    const t = fitSize(w ?? bitmap.width, h ?? bitmap.height, PREVIEW_SIDE);
    const canvas = makeCanvas(t.w, t.h);
    const ctx = canvas?.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
    if (!canvas || !ctx) return { w, h, preview: null };
    ctx.imageSmoothingQuality = "high";
    // a decoder that ignored the resize hint is scaled while drawing
    ctx.drawImage(bitmap, 0, 0, t.w, t.h);
    const webp = await encode(canvas, "image/webp");
    const out = webp && webp.type === "image/webp" ? webp : await encode(canvas, "image/jpeg");
    return { w, h, preview: out && out.size > 0 ? out : null };
  } catch {
    return { w: known?.w ?? w, h: known?.h ?? h, preview: null };
  } finally {
    bitmap?.close?.();
  }
}
