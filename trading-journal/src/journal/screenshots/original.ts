/**
 * "Original ansehen / herunterladen" (A2): hands out exactly the bytes the trader added.
 *
 * `loadOriginal` takes the local blob, else the cloud object, and checks it against the stored SHA-256; a download
 * whose hash differs is reported, never passed off as the original. `saveBlob` writes a Blob to a file with the name it
 * should have (`<a download>`; the claude.ai `downloads` capability only takes text, so there is no binary path there).
 */
import type { ScreenshotRef } from "@/domain/types";
import { downloadCloudShot } from "./cloud";
import { isOriginal, originalFileName } from "./info";
import { isSha256, sha256Hex } from "./sha256";
import { getShotBlob, localKeyOf } from "./store";

export interface LoadedOriginal {
  blob: Blob;
  from: "device" | "cloud";
  /** `true` = the SHA-256 of the bytes equals the stored one; `false` = it differs; `null` = no hash stored (older reference). */
  hashOk: boolean | null;
}

/** The bytes of `ref`, or `null` when neither this device nor the cloud can deliver them now. */
export async function loadOriginal(ref: ScreenshotRef, check = true): Promise<LoadedOriginal | null> {
  let blob: Blob | undefined;
  let from: "device" | "cloud" = "device";
  const local = localKeyOf(ref);
  if (local) blob = await getShotBlob(local);
  if (!blob && ref.store === "cloud" && ref.key) {
    const remote = await downloadCloudShot(ref.key);
    if (remote) {
      blob = remote;
      from = "cloud";
    }
  }
  if (!blob) return null;
  let hashOk: boolean | null = null;
  if (check && isSha256(ref.sha256)) hashOk = (await sha256Hex(blob)) === ref.sha256;
  return { blob, from, hashOk };
}

/** Saves `blob` as `filename` through a temporary link. Resolves `false` when the environment cannot download. */
export function saveBlob(filename: string, blob: Blob): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof document === "undefined") return false;
  const url = URL.createObjectURL(blob);
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
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return true;
}

export type DownloadResult = "ok" | "missing" | "mismatch" | "unsupported";

/** Downloads the original of `ref` under its own file name. `mismatch` = saved, but the hash differs from the stored one. */
export async function downloadOriginal(ref: ScreenshotRef): Promise<DownloadResult> {
  const got = await loadOriginal(ref);
  if (!got) return "missing";
  if (!saveBlob(originalFileName(ref), got.blob)) return "unsupported";
  return got.hashOk === false ? "mismatch" : "ok";
}

/** German line for a finished download (the file is only called „Original“ when the reference says so). */
export function downloadMessage(ref: ScreenshotRef, r: DownloadResult): { kind: "success" | "error"; title: string; detail?: string } {
  switch (r) {
    case "ok":
      return { kind: "success", title: isOriginal(ref) ? "Original heruntergeladen" : "Version heruntergeladen", detail: originalFileName(ref) };
    case "mismatch":
      return { kind: "error", title: "Datei weicht vom gespeicherten Hash ab", detail: "Die Datei wurde gespeichert, ist aber nicht mehr bytegleich mit dem Original. Prüfe dein Backup." };
    case "unsupported":
      return { kind: "error", title: "Download hier nicht möglich", detail: "Diese Umgebung darf keine Dateien speichern." };
    default:
      return { kind: "error", title: "Bild nicht erreichbar", detail: "Weder dieses Gerät noch die Cloud liefert die Datei gerade." };
  }
}
