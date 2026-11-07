/**
 * Screenshots in JSON backups (Review F08). The plain JSON backup (`store/backup.ts`, PR #3 format) carries only the
 * references – a restore on another device or after clearing site data showed "Nicht verfügbar" for every local
 * picture, and nobody said so. Additive on top of that format:
 *
 * - `exportJsonWithShots()` – the same backup plus `screenshots: { [key]: { mime, data } }` (base64) for every LOCAL
 *   blob a trade references (`store: "idb"`, and the offline copy of cloud pictures). Old importers ignore the key.
 * - `restoreShotsFromBackup(text)` – after an import, writes those blobs back into this device's store.
 * - `localShotCount(trades)` / `backupShotInfo(text)` – the honest lines in Daten and in the import preview.
 * Cloud pictures need no copy: they come back with the account.
 */
import { toJsonBackup } from "@/domain/csv";
import type { JsonBackup, ScreenshotRef, Trade } from "@/domain/types";
import { download } from "@/store/download";
import { getEnriched, useJournal } from "@/store/journalStore";
import { getShotBlob, putShotBlob } from "./store";

export interface BackupShot {
  mime: string;
  /** base64 of the image bytes */
  data: string;
}

/** Local blob keys the trades reference that exist ONLY on this device (idb refs; cloud refs come back with the account). */
export function localOnlyKeys(trades: readonly { screenshots?: readonly ScreenshotRef[] }[]): string[] {
  const out = new Set<string>();
  for (const t of trades) for (const r of t.screenshots ?? []) if (r.store === "idb" && r.key) out.add(r.key);
  return [...out];
}

/** How many pictures of the journal live only in this browser. */
export const localShotCount = (trades: readonly { screenshots?: readonly ScreenshotRef[] }[]): number => localOnlyKeys(trades).length;

/** Every local key worth embedding: the idb blobs and the offline copies of cloud pictures. */
function embeddableKeys(trades: readonly Trade[]): string[] {
  const out = new Set(localOnlyKeys(trades));
  for (const t of trades) {
    for (const r of t.screenshots ?? []) {
      const cache = (r as ScreenshotRef & { cacheKey?: unknown }).cacheKey;
      if (r.store === "cloud" && typeof cache === "string" && cache) out.add(cache);
    }
  }
  return [...out];
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromBase64(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** The pictures of `trades` that are in this browser, keyed like the references. */
export async function collectBackupShots(trades: readonly Trade[]): Promise<Record<string, BackupShot>> {
  const out: Record<string, BackupShot> = {};
  for (const key of embeddableKeys(trades)) {
    const blob = await getShotBlob(key);
    if (blob) out[key] = { mime: blob.type || "image/png", data: await toBase64(blob) };
  }
  return out;
}

const fileDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Backup mit Bildern": the JSON backup plus the local pictures, `trade-journal-YYYY-MM-DD-mit-bildern.json`. */
export async function exportJsonWithShots(now: Date = new Date()): Promise<boolean> {
  const s = useJournal.getState();
  const enriched = getEnriched(s.trades, s.settings);
  const backup: JsonBackup & { screenshots: Record<string, BackupShot> } = {
    ...toJsonBackup(enriched, s.settings, s.hyblock, now),
    days: s.days,
    screenshots: await collectBackupShots(s.trades),
  };
  return download(`trade-journal-${fileDate(now)}-mit-bildern.json`, JSON.stringify(backup), "application/json");
}

const isShot = (v: unknown): v is BackupShot =>
  !!v && typeof v === "object" && typeof (v as BackupShot).data === "string" && typeof (v as BackupShot).mime === "string" && (v as BackupShot).mime.startsWith("image/");

/** What a backup file says about pictures: how many it carries, how many local references it has without them. */
export function backupShotInfo(text: string): { embedded: number; missing: number } {
  try {
    const json = JSON.parse(text) as { trades?: unknown; screenshots?: unknown };
    const shots = json && typeof json.screenshots === "object" && json.screenshots ? (json.screenshots as Record<string, unknown>) : {};
    const embedded = Object.values(shots).filter(isShot).length;
    const trades = Array.isArray(json) ? json : Array.isArray(json?.trades) ? json.trades : [];
    const keys = localOnlyKeys(trades as Trade[]);
    return { embedded, missing: keys.filter((k) => !isShot(shots[k])).length };
  } catch {
    return { embedded: 0, missing: 0 };
  }
}

/** After an import: writes the pictures of the file into this device's store. Resolves the number written. */
export async function restoreShotsFromBackup(text: string): Promise<number> {
  let shots: Record<string, unknown> = {};
  try {
    const json = JSON.parse(text) as { screenshots?: unknown };
    if (json && typeof json.screenshots === "object" && json.screenshots) shots = json.screenshots as Record<string, unknown>;
  } catch {
    return 0;
  }
  let n = 0;
  for (const [key, v] of Object.entries(shots)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || !isShot(v)) continue;
    try {
      await putShotBlob(fromBase64(v.data, v.mime), key);
      n += 1;
    } catch {
      /* a broken entry is skipped */
    }
  }
  return n;
}
