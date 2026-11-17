import { requestCapability } from "./capability";
import { pushToast } from "./uiStore";

interface DownloadsCapability {
  save(args: { filename: string; data: string }): Promise<unknown>;
}

/** True when either the claude.ai `downloads` capability may exist or a Blob download is possible. */
export function canDownload(): boolean {
  if (typeof window === "undefined") return false;
  const claude = (window as unknown as { claude?: { use?: unknown } }).claude;
  if (claude && typeof claude.use === "function") return true;
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
}

/** Shown on the `Daten` card when `canDownload()` is false (bundle text, unchanged). */
export const DOWNLOAD_UNAVAILABLE = "Export gibt es nur, wenn das Journal auf claude.ai geöffnet ist.";

function blobDownload(filename: string, data: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Saves a file: claude.ai `downloads.save({filename, data})` when present, else Blob + `<a download>`.
 * A user decline (`code === "declined"`) is silent; every other failure shows `Export fehlgeschlagen`.
 * Resolves `true` on success, `false` otherwise.
 */
export async function download(filename: string, data: string, mime = "application/octet-stream"): Promise<boolean> {
  const downloads = await requestCapability<DownloadsCapability>("downloads");
  if (downloads && typeof downloads.save === "function") {
    try {
      await downloads.save({ filename, data });
      return true;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== "declined") pushToast({ kind: "error", title: "Export fehlgeschlagen" });
      return false;
    }
  }
  try {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("no createObjectURL");
    blobDownload(filename, data, mime);
    return true;
  } catch {
    pushToast({ kind: "error", title: "Export fehlgeschlagen" });
    return false;
  }
}
