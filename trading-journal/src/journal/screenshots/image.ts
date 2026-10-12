/**
 * Image intake for screenshots (Journal v3, P06): only images, at most `MAX_INPUT_BYTES`; large pictures are scaled
 * down to `MAX_SIDE` px on the long side and re-encoded (WebP, JPEG fallback) so a chart screenshot stays a few
 * hundred kB. Decoding failures keep the original file when it is small enough.
 */

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_SIDE = 2000;
const QUALITY = 0.86;

export interface PreparedImage {
  blob: Blob;
  mime: string;
  w?: number;
  h?: number;
}

export type IntakeProblem = "type" | "size" | "decode";

/** German message per problem. */
export const INTAKE_MESSAGES: Record<IntakeProblem, string> = {
  type: "Nur Bilder (PNG, JPG, WebP, GIF).",
  size: "Das Bild ist größer als 15 MB.",
  decode: "Das Bild ließ sich nicht lesen.",
};

/** Rejection of `prepareImage`. */
export class IntakeError extends Error {
  constructor(readonly problem: IntakeProblem) {
    super(INTAKE_MESSAGES[problem]);
  }
}

export function isImage(file: Blob): boolean {
  return /^image\/(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.type);
}

/** Target size for a picture of `w × h` (keeps the ratio; never upscales). */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max || long <= 0) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Validates and (when needed) shrinks `file`. Rejects with an `IntakeError`. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!isImage(file)) throw new IntakeError("type");
  if (file.size > MAX_INPUT_BYTES) throw new IntakeError("size");
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof createImageBitmap === "function") bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    // no decoder here (tests, very old browsers): keep the file as it is when it is small
    if (file.size <= 4 * 1024 * 1024) return { blob: file, mime: file.type || "image/png" };
    throw new IntakeError("decode");
  }
  const { width, height } = bitmap;
  const target = fitSize(width, height);
  const animated = file.type === "image/gif";
  if (animated || (target.w === width && file.size <= 1.5 * 1024 * 1024)) {
    bitmap.close?.();
    return { blob: file, mime: file.type, w: width, h: height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.w;
  canvas.height = target.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return { blob: file, mime: file.type, w: width, h: height };
  }
  ctx.drawImage(bitmap, 0, 0, target.w, target.h);
  bitmap.close?.();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, QUALITY));
  const webp = await encode("image/webp");
  const blob = webp && webp.type === "image/webp" ? webp : await encode("image/jpeg");
  if (!blob) return { blob: file, mime: file.type, w: width, h: height };
  return { blob, mime: blob.type, w: target.w, h: target.h };
}

/** Image files of a drop / paste (`DataTransfer`), in order. */
export function imagesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  } else if (data.files?.length) out.push(...Array.from(data.files));
  return out;
}
