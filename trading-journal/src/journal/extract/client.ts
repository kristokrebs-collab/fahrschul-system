/**
 * Client of `POST /api/v1/shot-extract` (F29): picks the picture blobs of the trade's screenshots, scales them down to
 * the wire limits (≤ 1600 px long edge, ≤ 1.5 MB each, ≤ 4.2 MB together, JPEG / PNG / WebP) and asks the server. The
 * pictures only go out when the trader presses „Auslesen“; nothing is stored or cached here.
 */
import { ApiError, apiFetch } from "@/cloud";
import type { ScreenshotRef } from "@/domain/types";
import { fitSize } from "@/journal/screenshots/image";
import { getShotBlob, localKeyOf } from "@/journal/screenshots/store";
import { shotUrl } from "@/journal/screenshots/shots";
import { Extraction, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_LONG_EDGE, MAX_TOTAL_IMAGE_BYTES, type ExtractReply, type ImageType } from "./contract";

export interface WireImage {
  mediaType: ImageType;
  /** Base64 without the `data:` prefix. */
  data: string;
}

export interface ExtractHint {
  market?: "perp" | "spot";
  timezone?: string;
  exchange?: string;
  pair?: string;
}

/** A problem the trader can understand (German). */
export class ExtractError extends Error {
  constructor(
    message: string,
    readonly code: "decode" | "size" | "api" | "offline" | "gone" = "api",
    /** The server's error code (`shot_extract_unavailable` …) when the answer carried one – shown small for support. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

const isWireType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new ExtractError("Das Bild ließ sich nicht lesen.", "decode"));
    r.readAsDataURL(blob);
  });
}

const base64Size = (b64: string): number => Math.floor((b64.length * 3) / 4);

/** The picture's bytes: the local blob, else the cloud copy through its signed link. */
export async function blobOfShot(ref: ScreenshotRef): Promise<Blob | null> {
  const local = localKeyOf(ref);
  if (local) {
    const b = await getShotBlob(local);
    if (b) return b;
  }
  try {
    const url = await shotUrl(ref);
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/**
 * One picture on the wire. A picture that already fits (type, edge, size) goes out unchanged; otherwise it is drawn
 * onto a canvas at ≤ 1600 px and encoded as JPEG, lowering the quality (then the size) until it is ≤ 1.5 MB.
 * `quality` caps the first try (lower it to make room for the other pictures).
 */
export async function shrinkForExtract(blob: Blob, quality = 0.88): Promise<WireImage> {
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof createImageBitmap === "function") bitmap = await createImageBitmap(blob);
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    // no decoder (very old browsers): the picture must already be in a wire format and small enough
    if (isWireType(blob.type) && blob.size <= MAX_IMAGE_BYTES) return { mediaType: blob.type, data: await toBase64(blob) };
    throw new ExtractError("Das Bild ließ sich nicht verkleinern. Nutze PNG, JPEG oder WebP unter 1,5 MB.", "decode");
  }
  const { width, height } = bitmap;
  const fits = Math.max(width, height) <= MAX_LONG_EDGE && isWireType(blob.type) && blob.size <= MAX_IMAGE_BYTES * 0.9;
  if (fits && quality >= 0.88) {
    bitmap.close?.();
    return { mediaType: blob.type as ImageType, data: await toBase64(blob) };
  }
  let scale = 1;
  let q = quality;
  for (let attempt = 0; attempt < 8; attempt++) {
    const size = fitSize(Math.round(width * scale), Math.round(height * scale), MAX_LONG_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const g = canvas.getContext("2d");
    if (!g) break;
    g.fillStyle = "#fff"; // JPEG has no alpha: transparent screenshots must not turn black
    g.fillRect(0, 0, size.w, size.h);
    g.drawImage(bitmap, 0, 0, size.w, size.h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (out && out.size <= MAX_IMAGE_BYTES * 0.95) {
      bitmap.close?.();
      return { mediaType: "image/jpeg", data: await toBase64(out) };
    }
    q = Math.max(0.5, q - 0.12);
    if (attempt >= 2) scale *= 0.85;
  }
  bitmap.close?.();
  throw new ExtractError("Das Bild ist auch verkleinert zu groß. Schneide den Bereich mit dem Trade aus.", "size");
}

/** Up to four pictures on the wire, together ≤ 4.2 MB (the quality drops step by step until they fit). */
export async function prepareImages(blobs: readonly Blob[]): Promise<WireImage[]> {
  if (!blobs.length) throw new ExtractError("Kein Bild zum Auslesen.", "gone");
  if (blobs.length > MAX_IMAGES) throw new ExtractError(`Höchstens ${MAX_IMAGES} Bilder auf einmal.`, "size");
  for (const quality of [0.88, 0.72, 0.58]) {
    const out: WireImage[] = [];
    for (const b of blobs) out.push(await shrinkForExtract(b, quality));
    if (out.reduce((n, i) => n + base64Size(i.data), 0) <= MAX_TOTAL_IMAGE_BYTES) return out;
  }
  throw new ExtractError("Die Bilder sind zusammen zu groß. Wähle weniger Bilder oder schneide sie zu.", "size");
}

/** Asks the server to read the pictures. Rejects with an `ExtractError` carrying a German message. */
export async function requestExtraction(images: readonly WireImage[], hint?: ExtractHint, signal?: AbortSignal): Promise<ExtractReply> {
  let raw: ExtractReply;
  try {
    raw = await apiFetch<ExtractReply>("/shot-extract", { method: "POST", body: { images, ...(hint && Object.keys(hint).length ? { hint } : {}) }, signal });
  } catch (e) {
    throw extractError(e);
  }
  // the server validated it already – a reply that does not fit the contract (old / foreign server) is never used
  const parsed = Extraction.safeParse(raw);
  if (!parsed.success) throw new ExtractError("Die Antwort des Servers hat nicht das erwartete Format (ein anderer oder älterer Server?). Du kannst die Werte von Hand eintragen.", "api", "bad_reply");
  return { ...parsed.data, model: typeof raw.model === "string" ? raw.model : "", ...(raw.reason ? { reason: raw.reason } : {}) };
}

/** German message for anything that went wrong on the way (kept as an `ExtractError`). */
export function extractError(e: unknown): ExtractError {
  if (e instanceof ExtractError) return e;
  if (e instanceof DOMException && e.name === "AbortError") return new ExtractError("Abgebrochen.", "gone");
  if (e instanceof ApiError) {
    if (e.status === 0) return new ExtractError(`${e.message} Du kannst die Werte wie gewohnt von Hand eintragen.`, "offline");
    if (e.status === 401) return new ExtractError("Bitte melde dich an, um Screenshots auslesen zu lassen.", "api");
    if (e.status === 402) return new ExtractError(e.code === "limit_reached" ? "Das Tageslimit deines Tarifs für den Screenshot-Import ist erreicht." : "Der Screenshot-Import gehört nicht zu deinem Tarif.", "api");
    if (e.status === 413 || e.status === 422) return new ExtractError("Die Bilder sind zu groß oder in einem nicht unterstützten Format (PNG, JPEG, WebP).", "size", e.code);
    // an answer the function did not write itself (the platform's page): the REASON is where it came from, not "unwell"
    if (e.code.startsWith("http_")) {
      if (e.status === 404 || e.status === 405) return new ExtractError(`Die Funktion „shot-extract“ ist auf diesem Server nicht bereitgestellt (HTTP ${e.status}).`, "api", e.code);
      if (e.status >= 500) return new ExtractError(`Der Server hat nicht (rechtzeitig) geantwortet (HTTP ${e.status}) – meist das Zeitlimit der Netlify-Funktion beim Auslesen. Versuche es noch einmal, mit weniger oder kleineren Bildern.`, "api", e.code);
    }
    return new ExtractError(e.message, "api", e.code);
  }
  return new ExtractError("Das Auslesen hat nicht geklappt. Du kannst die Werte von Hand eintragen.", "api");
}
