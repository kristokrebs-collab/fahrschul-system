/**
 * Image intake for screenshots (Journal v3, P06; A2 "Originale bytegleich").
 *
 * The file the trader chooses or pastes is kept EXACTLY as it is – `prepareImage` only checks it (an image, at most
 * `MAX_INPUT_BYTES`) and reads its type and pixel size from the header; it never decodes, shrinks or re-encodes.
 * The small picture the app shows in lists and previews is derived separately (`preview.ts`, in a worker).
 */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Long edge of the derived preview (never the stored file). */
export const PREVIEW_SIDE = 1280;
/** Default long edge of `fitSize` (the model path scales its own copy to its wire limits; the stored file is never touched). */
export const MAX_SIDE = 2000;

export interface PreparedImage {
  /** The file itself (same object, same bytes). */
  blob: Blob;
  mime: string;
  w?: number;
  h?: number;
}

export type IntakeProblem = "type" | "size" | "decode";

/** German message per problem. */
export const INTAKE_MESSAGES: Record<IntakeProblem, string> = {
  type: "Nur Bilder (PNG, JPG, WebP, GIF).",
  size: "Das Bild ist größer als 25 MB.",
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

/**
 * Validates `file` and reads its type / size from the header. The result carries the SAME blob – nothing is shrunk.
 * A file without a usable `type` (some pastes) is recognised by its first bytes. Rejects with an `IntakeError`.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (file.size > MAX_INPUT_BYTES) throw new IntakeError("size");
  if (file.size === 0) throw new IntakeError("decode");
  let sniffed: Awaited<ReturnType<typeof import("./sniff").sniffBlob>>;
  try {
    sniffed = await (await import("./sniff")).sniffBlob(file);
  } catch {
    sniffed = null;
  }
  if (!isImage(file) && !sniffed) throw new IntakeError("type");
  const mime = isImage(file) ? file.type.toLowerCase().replace("image/jpg", "image/jpeg") : sniffed!.mime;
  const out: PreparedImage = { blob: file, mime };
  if (sniffed?.w && sniffed.h) {
    out.w = sniffed.w;
    out.h = sniffed.h;
  }
  return out;
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
