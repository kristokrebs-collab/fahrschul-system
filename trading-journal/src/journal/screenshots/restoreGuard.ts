/**
 * Entry checks for pictures that come out of an IMPORTED backup (ZIP or old JSON with base64 pictures). A restore writes
 * straight into this device's screenshot store, so it must not be a way around the checks of a normal intake
 * (`image.ts` / `sniff.ts`). A file from a backup is therefore only written when
 *
 * - it is at most `MAX_INPUT_BYTES` (25 MB, the limit of a picture the trader adds himself),
 * - its first bytes say PNG, JPEG, GIF, WebP, BMP or AVIF – whatever the manifest claims (an SVG, HTML or any other file
 *   with an `image/…` label is refused; the stored type is the one the bytes show),
 * - the size in its header is readable and stays below `RESTORE_MAX_PIXELS` / `RESTORE_MAX_SIDE` (a tiny PNG with huge
 *   measures would take the tab down when it is shown), and
 * - it does not replace a picture this device already holds under the same key (see `keyState`).
 *
 * The SHA-256 of a backup only tells that a file is the one the manifest lists – the manifest sits in the same archive,
 * so whoever builds a backup builds the hashes too. It protects against damage on the way, not against a forged backup.
 */
import { MAX_INPUT_BYTES } from "./image";
import { sha256Hex } from "./sha256";
import { sniffBlob } from "./sniff";
import { getShotBlob } from "./store";

/** Most pictures one backup may bring (a manifest or `screenshots` object with more is refused / cut). */
export const RESTORE_MAX_FILES = 20_000;
/** Width × height of a restored picture (10,000 × 10,000 px; a 4K screenshot is 8.3 million). */
export const RESTORE_MAX_PIXELS = 100_000_000;
/** Longest edge of a restored picture. */
export const RESTORE_MAX_SIDE = 30_000;
/** Longest base64 text that can hold a picture of `MAX_INPUT_BYTES` (4 characters per 3 bytes, plus padding). */
export const MAX_BASE64_CHARS = Math.ceil((MAX_INPUT_BYTES * 4) / 3) + 4;
/** SHA-256 of `blob` (re-exported so the lazy callers need no second import). */
export const sha256Of = sha256Hex;
/** Local blob keys a backup may name. */
export const SHOT_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

export type RejectReason = "size" | "type" | "dimensions";

/** German reason per refusal, for the restore summary. */
export const REJECT_TEXT: Record<RejectReason, string> = {
  size: "größer als 25 MB",
  type: "kein PNG, JPEG, GIF, WebP, BMP oder AVIF",
  dimensions: "Bildmaße nicht lesbar oder zu groß",
};

export type Inspected = { ok: true; mime: string; w?: number; h?: number } | { ok: false; reason: RejectReason };

/** Looks at the bytes of `blob` (not at its label) and says whether it may be stored. */
export async function inspectRestoredImage(blob: Blob): Promise<Inspected> {
  if (blob.size > MAX_INPUT_BYTES) return { ok: false, reason: "size" };
  if (blob.size === 0) return { ok: false, reason: "type" };
  let sniffed: Awaited<ReturnType<typeof sniffBlob>>;
  try {
    sniffed = await sniffBlob(blob);
  } catch {
    sniffed = null;
  }
  if (!sniffed) return { ok: false, reason: "type" };
  // AVIF carries no size in its header; the 25 MB cap is its only bound. Every other type must state its measures.
  if (sniffed.mime !== "image/avif") {
    const { w, h } = sniffed;
    if (!w || !h || w > RESTORE_MAX_SIDE || h > RESTORE_MAX_SIDE || w * h > RESTORE_MAX_PIXELS) return { ok: false, reason: "dimensions" };
  }
  return { ok: true, mime: sniffed.mime, ...(sniffed.w ? { w: sniffed.w } : {}), ...(sniffed.h ? { h: sniffed.h } : {}) };
}

/**
 * What this device already holds under `key`: nothing (`free`), the very same bytes (`same` – nothing to write) or
 * another picture (`taken` – NEVER replaced: keys are written once, so a different file under a known key means the
 * backup is not from this journal or is trying to swap evidence).
 */
export async function keyState(key: string, sha256: string): Promise<"free" | "same" | "taken"> {
  const have = await getShotBlob(key);
  if (!have) return "free";
  try {
    return (await sha256Hex(have)) === sha256 ? "same" : "taken";
  } catch {
    return "taken";
  }
}

/** The outcome of a restore (ZIP and old JSON alike). */
export interface RestoreReport {
  /** Files written to this device (or, when the store refused, kept in memory – see `notSaved`). */
  written: number;
  /** Keys whose bytes do not match the manifest hash, or whose file is missing from the archive: NOT written. */
  corrupt: string[];
  /** Written, but only into memory (device storage full or unavailable). */
  notSaved: number;
  /** Keys refused by the entry checks (type, size, measures), with the reason. */
  rejected: { key: string; reason: RejectReason }[];
  /** Keys this device already holds with DIFFERENT content: left as they are. */
  kept: string[];
  /** Keys this device already holds with the very same bytes: nothing to do. */
  alreadyThere: number;
}

export const emptyReport = (): RestoreReport => ({ written: 0, corrupt: [], notSaved: 0, rejected: [], kept: [], alreadyThere: 0 });

const n = (k: number, one: string, many: string): string => `${k === 1 ? `1 ${one}` : `${k} ${many}`}`;

/** German toast for a finished restore (`null` = nothing to tell). */
export function restoreSummary(r: RestoreReport): { kind: "success" | "error"; title: string; detail: string } | null {
  if (!r.written && !r.corrupt.length && !r.rejected.length && !r.kept.length && !r.alreadyThere) return null;
  const parts: string[] = [];
  if (r.written) parts.push(`${n(r.written, "Bild", "Bilder")} unversehrt wiederhergestellt (Prüfsumme stimmt mit der Liste im Backup überein)`);
  if (r.alreadyThere) parts.push(`${n(r.alreadyThere, "Bild war", "Bilder waren")} schon auf diesem Gerät`);
  if (r.corrupt.length) parts.push(`${n(r.corrupt.length, "Bild", "Bilder")} nicht übernommen: Prüfsumme stimmt nicht oder Datei fehlt`);
  if (r.rejected.length) parts.push(`${n(r.rejected.length, "Datei", "Dateien")} abgewiesen (${[...new Set(r.rejected.map((x) => REJECT_TEXT[x.reason]))].join("; ")})`);
  if (r.kept.length) parts.push(`${n(r.kept.length, "Bild", "Bilder")} nicht überschrieben: auf diesem Gerät liegt unter demselben Schlüssel schon ein anderes Bild`);
  if (r.notSaved) parts.push(`${r.notSaved === 1 ? "1 Bild ist" : `${r.notSaved} Bilder sind`} nicht dauerhaft gespeichert (Speicher voll)`);
  const bad = r.corrupt.length > 0 || r.rejected.length > 0 || r.kept.length > 0 || r.notSaved > 0;
  return { kind: bad ? "error" : "success", title: bad ? "Bilder nur teilweise wiederhergestellt" : "Bilder wiederhergestellt", detail: `${parts.join(" · ")}.` };
}
