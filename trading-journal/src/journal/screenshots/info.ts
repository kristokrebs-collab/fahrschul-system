/**
 * What a screenshot reference says about itself (A2) – pure helpers, no storage access: is it the original or an
 * older shrunk version, where does it live, how big is it, what is the file called when it is downloaded.
 */
import type { ScreenshotRef } from "@/domain/types";

export type ShotStorage = "device" | "cloud" | "ram";

/** Where the picture lives: the stored verdict, else derived from the reference (cloud → cloud, otherwise this device). */
export function shotStorageOf(ref: ScreenshotRef): ShotStorage {
  if (ref.storage === "ram") return "ram";
  if (ref.store === "cloud") return "cloud";
  return "device";
}

/**
 * Whether the bytes behind `ref` are the file the trader chose. Only references written since A2 say so
 * (`original: true`); everything older was shrunk on intake and stays "Version (verkleinert)" – never shown as original.
 * An external link (`store: "url"`) is neither: we hold no bytes of it.
 */
export function isOriginal(ref: ScreenshotRef): boolean {
  return ref.store !== "url" && ref.original === true;
}

/** An older reference from before A2 (kept, marked as a shrunk version). */
export function isShrunkVersion(ref: ScreenshotRef): boolean {
  return ref.store !== "url" && ref.original !== true;
}

export const STORAGE_LABELS: Record<ShotStorage, string> = {
  device: "Auf diesem Gerät",
  cloud: "In der Cloud",
  ram: "Nicht dauerhaft gespeichert",
};

export const ORIGINAL_LABEL = "Original";
export const SHRUNK_LABEL = "Version (verkleinert)";

/** "3,2 MB" / "480 KB" / "812 B" (German decimal comma). */
export function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** File extension for a mime type. */
export function extOfMime(mime: string | undefined): string {
  switch ((mime ?? "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/bmp":
      return "bmp";
    default:
      return "png";
  }
}

/** The name a download gets: the file's own name, else `screenshot-<id>.<ext>` (path characters removed). */
export function originalFileName(ref: ScreenshotRef): string {
  const own = (ref.originalName ?? "").replace(/[\\/:*?"<>|]/g, "_").replace(/\p{Cc}/gu, "_").trim();
  if (own) return own;
  return `screenshot-${ref.id.replace(/[^A-Za-z0-9_-]/g, "")}.${extOfMime(ref.mime)}`;
}

/** One line for the viewer: "Original · PNG · 3840 × 2160 · 12,4 MB" (parts that are unknown are left out). */
export function shotFacts(ref: ScreenshotRef): string {
  const parts: string[] = [isOriginal(ref) ? ORIGINAL_LABEL : ref.store === "url" ? "Link" : SHRUNK_LABEL];
  if (ref.mime) parts.push(extOfMime(ref.mime).toUpperCase());
  if (ref.w && ref.h) parts.push(`${ref.w} × ${ref.h}`);
  const size = formatBytes(ref.bytes);
  if (size) parts.push(size);
  return parts.join(" · ");
}

/** How many picture references of `trades` hold bytes (external links do not). */
export function countShotRefs(trades: readonly { screenshots?: readonly ScreenshotRef[] }[]): number {
  let n = 0;
  for (const t of trades) for (const r of t.screenshots ?? []) if (r.store !== "url") n += 1;
  return n;
}

/** German texts of the storage verdicts (the editor shows them; tests pin them). */
export const STORAGE_MESSAGES = {
  quota: "Speicher voll: Das Bild liegt nur bis zum Neuladen im Arbeitsspeicher und ist nicht dauerhaft gespeichert. Lade das Original herunter oder schaffe Platz (alte Bilder oder Sicherungen löschen). Nichts wurde verkleinert.",
  ram: "Nicht dauerhaft gespeichert: Dieser Browser erlaubt keinen lokalen Bildspeicher. Das Bild bleibt nur bis zum Neuladen – lade das Original herunter.",
  verify: "Das Bild ließ sich nicht verlässlich speichern (die gespeicherte Datei stimmt nicht mit dem Original überein).",
} as const;
