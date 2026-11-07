/**
 * "Backup mit Bildern" as a ZIP (A2): the journal's JSON backup plus the ORIGINAL bytes of every screenshot, with a
 * manifest that lists each file's SHA-256, size, type and file name.
 *
 *   manifest.json                     format, time, journal hash, one row per picture (+ the pictures that could not be reached)
 *   journal.json                      the same JSON backup as „JSON exportieren“ (references only)
 *   shots/<key>.<ext>                 the original bytes, one file per local blob key
 *
 * Export reads each picture from this device, else (signed in) from the cloud, hashes the bytes it actually writes and
 * says so when a picture could not be reached or no longer matches the hash stored with it. Restore checks every file
 * against the manifest (CRC-32 of the archive and SHA-256) before it is written back; a file whose hash differs is NOT
 * restored and is named. The hashes only show that a file is UNDAMAGED ("unversehrt") – the manifest is in the same
 * archive, so a forged backup carries matching hashes. Therefore a restore also runs the entry checks of
 * `restoreGuard.ts` (real image bytes, size and measures) and never replaces a picture the device already holds. Old
 * JSON backups with base64 pictures (`backupShots.ts`) are still read, with the same checks.
 */
import { toJsonBackup } from "@/domain/csv";
import type { JsonBackup, ScreenshotRef, Trade } from "@/domain/types";
import { getEnriched, useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { extOfMime, isOriginal } from "./info";
import { loadOriginal, saveBlob } from "./original";
import { MAX_INPUT_BYTES } from "./image";
import { emptyReport, inspectRestoredImage, keyState, RESTORE_MAX_FILES, restoreSummary as summaryOf, SHOT_KEY_RE, type RestoreReport } from "./restoreGuard";
import { sha256Hex } from "./sha256";
import { localKeyOf, putShotBlobChecked } from "./store";
import { buildZip, readZip, type ZipEntry } from "./zip";

export const BACKUP_ZIP_FORMAT = "tj-backup-zip/1";
const KEY_RE = SHOT_KEY_RE;
/** Largest `manifest.json` / `journal.json` the restore reads (a journal of tens of thousands of trades is a few MB). */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
/** Where a picture may sit inside the archive: `shots/<name>` – one level, no `..`, no further folders. */
const SHOT_FILE_RE = /^shots\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$/;

export interface ManifestShot {
  /** Local blob key (`shot_…`) – the restore writes the file back under it. */
  key: string;
  /** Path inside the ZIP. */
  file: string;
  /** SHA-256 of the bytes in the ZIP. */
  sha256: string;
  bytes: number;
  mime: string;
  originalName?: string;
  w?: number;
  h?: number;
  /** `true` = the file the trader added; `false` = an older shrunk version (never claimed as the original). */
  original: boolean;
  tradeIds: string[];
  shotIds: string[];
  /** Whether the bytes still match the hash stored on the reference (`null` = the reference had none, e.g. an older one). */
  matchesReference: boolean | null;
}

export interface ManifestMissing {
  tradeId: string;
  shotId: string;
  reason: "unreachable";
}

export interface BackupManifest {
  format: typeof BACKUP_ZIP_FORMAT;
  exportedAt: string;
  journal: "journal.json";
  journalSha256: string;
  journalBytes: number;
  tradeCount: number;
  shots: ManifestShot[];
  missing: ManifestMissing[];
}

const fileDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every picture the trades reference that holds bytes (not external links), once per trade reference. */
export function shotRefs(trades: readonly Pick<Trade, "id" | "screenshots">[]): { tradeId: string; ref: ScreenshotRef }[] {
  const out: { tradeId: string; ref: ScreenshotRef }[] = [];
  for (const t of trades) for (const ref of t.screenshots ?? []) if (ref.store !== "url") out.push({ tradeId: t.id, ref });
  return out;
}

/** The blob key a reference is stored under in a backup (a cloud picture without an offline copy gets `shot_<id>`). */
function backupKey(ref: ScreenshotRef): string | null {
  const k = localKeyOf(ref) ?? (ref.store === "cloud" ? `shot_${ref.id}` : null);
  return k && KEY_RE.test(k) ? k : null;
}

export interface ZipBuild {
  blob: Blob;
  manifest: BackupManifest;
  filename: string;
}

/** Builds the archive for `trades` (the journal state is passed in so tests need no store). */
export async function buildBackupZip(
  parts: { trades: readonly Trade[]; backup: JsonBackup & Record<string, unknown> },
  now: Date = new Date(),
  onProgress?: (done: number, total: number) => void,
): Promise<ZipBuild> {
  const rows = shotRefs(parts.trades);
  const files = new Map<string, { entry: ManifestShot; blob: Blob; ref: ScreenshotRef }>();
  const unreachable = new Set<string>();
  const missing: ManifestMissing[] = [];
  const uniqueKeys = new Set(rows.map((r) => backupKey(r.ref)).filter((k): k is string => !!k));
  let done = 0;
  for (const { tradeId, ref } of rows) {
    const key = backupKey(ref);
    if (!key) continue;
    const have = files.get(key);
    if (have) {
      if (!have.entry.tradeIds.includes(tradeId)) have.entry.tradeIds.push(tradeId);
      if (!have.entry.shotIds.includes(ref.id)) have.entry.shotIds.push(ref.id);
      continue;
    }
    if (unreachable.has(key)) {
      missing.push({ tradeId, shotId: ref.id, reason: "unreachable" });
      continue;
    }
    const got = await loadOriginal(ref, false);
    if (!got) {
      unreachable.add(key);
      missing.push({ tradeId, shotId: ref.id, reason: "unreachable" });
    } else {
      const sha = await sha256Hex(got.blob);
      const mime = ref.mime || got.blob.type || "image/png";
      const entry: ManifestShot = {
        key,
        file: `shots/${key}.${extOfMime(mime)}`,
        sha256: sha,
        bytes: got.blob.size,
        mime,
        original: isOriginal(ref),
        tradeIds: [tradeId],
        shotIds: [ref.id],
        matchesReference: ref.sha256 ? ref.sha256 === sha : null,
      };
      if (ref.originalName) entry.originalName = ref.originalName;
      if (ref.w) entry.w = ref.w;
      if (ref.h) entry.h = ref.h;
      files.set(key, { entry, blob: got.blob, ref });
    }
    done += 1;
    onProgress?.(Math.min(done, uniqueKeys.size), uniqueKeys.size);
  }

  // the journal copy: references get their hash / size (older ones too – labelled as versions, not originals) and an
  // offline key when the picture was only reachable through the cloud
  const patched: Trade[] = parts.trades.map((t) =>
    t.screenshots?.length
      ? {
          ...t,
          screenshots: t.screenshots.map((ref) => {
            const key = ref.store === "url" ? null : backupKey(ref);
            const f = key ? files.get(key) : undefined;
            if (!f) return ref;
            const next: ScreenshotRef = { ...ref, sha256: ref.sha256 ?? f.entry.sha256, bytes: ref.bytes ?? f.entry.bytes };
            if (ref.store === "cloud" && !ref.cacheKey) next.cacheKey = f.entry.key;
            return next;
          }),
        }
      : t,
  );
  const journalText = JSON.stringify({ ...parts.backup, trades: patched }, null, 2);
  const journalBlob = new Blob([journalText], { type: "application/json" });
  const manifest: BackupManifest = {
    format: BACKUP_ZIP_FORMAT,
    exportedAt: now.toISOString(),
    journal: "journal.json",
    journalSha256: await sha256Hex(journalBlob),
    journalBytes: journalBlob.size,
    tradeCount: parts.trades.length,
    shots: [...files.values()].map((f) => f.entry),
    missing,
  };
  const blob = await buildZip(
    [
      { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
      { name: "journal.json", data: journalBlob },
      ...[...files.values()].map((f) => ({ name: f.entry.file, data: f.blob })),
    ],
    now,
  );
  return { blob, manifest, filename: `trade-journal-${fileDate(now)}-mit-bildern.zip` };
}

/** German summary of an export for a toast. */
export function exportSummary(m: BackupManifest): { kind: "success" | "error"; title: string; detail: string } {
  const n = m.shots.length;
  const wrong = m.shots.filter((s) => s.matchesReference === false);
  const parts = [`${n === 1 ? "1 Bild" : `${n} Bilder`} mit Hash im Manifest`];
  const versions = m.shots.filter((s) => !s.original).length;
  if (versions) parts.push(`${versions === 1 ? "1 Bild ist" : `${versions} Bilder sind`} eine verkleinerte Version aus einer älteren App-Fassung`);
  if (m.missing.length) parts.push(`${m.missing.length === 1 ? "1 Bild war" : `${m.missing.length} Bilder waren`} nicht erreichbar und fehlt${m.missing.length === 1 ? "" : "en"} im Backup`);
  if (wrong.length) parts.push(`${wrong.length === 1 ? "1 Bild weicht" : `${wrong.length} Bilder weichen`} vom gespeicherten Hash ab`);
  return { kind: m.missing.length || wrong.length ? "error" : "success", title: m.missing.length || wrong.length ? "Backup mit Bildern – mit Hinweisen" : "Backup mit Bildern gespeichert", detail: `${parts.join(" · ")}.` };
}

/** "Backup mit Bildern": builds the ZIP from the open journal and saves it. Resolves `true` when a file was handed to the browser. */
export async function exportBackupZip(now: Date = new Date()): Promise<boolean> {
  const s = useJournal.getState();
  const enriched = getEnriched(s.trades, s.settings);
  const backup = { ...toJsonBackup(enriched, s.settings, s.hyblock, now), days: s.days };
  let built: ZipBuild;
  try {
    built = await buildBackupZip({ trades: s.trades, backup }, now);
  } catch (e) {
    pushToast({ kind: "error", title: "Backup mit Bildern fehlgeschlagen", detail: e instanceof Error ? e.message : undefined });
    return false;
  }
  if (!saveBlob(built.filename, built.blob)) {
    pushToast({ kind: "error", title: "Export fehlgeschlagen", detail: "Diese Umgebung darf keine Dateien speichern." });
    return false;
  }
  pushToast({ ...exportSummary(built.manifest), duration: 8000 });
  return true;
}

/* ------------------------------------------------------------------ restore */

/** An opened backup ZIP: the journal text and the lazy files. */
export interface ZipBackup {
  journalText: string;
  manifest: BackupManifest;
  entries: ReadonlyMap<string, ZipEntry>;
}

export const ZIP_BACKUP_MESSAGES = {
  noManifest: "Im ZIP fehlt das Manifest (manifest.json) – das ist kein Backup dieses Journals.",
  badManifest: "Das Manifest im ZIP ist unlesbar.",
  noJournal: "Im ZIP fehlt die Journal-Datei (journal.json).",
  journalChanged: "Die Journal-Datei im ZIP stimmt nicht mit dem Manifest überein (Hash verschieden). Das Backup wurde verändert oder ist beschädigt.",
  tooBig: "Das ZIP enthält eine Manifest- oder Journal-Datei, die für ein Backup dieses Journals viel zu groß ist.",
  tooMany: "Das Manifest listet unglaublich viele Bilder – das ist kein Backup dieses Journals.",
} as const;

const isHex = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** Thrown by `readManifest` for a manifest that lists more pictures than any journal can carry. */
class TooManyShots extends Error {}

function readManifest(raw: unknown): BackupManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<BackupManifest>;
  if (m.format !== BACKUP_ZIP_FORMAT || m.journal !== "journal.json" || !isHex(m.journalSha256) || !Array.isArray(m.shots)) return null;
  if (m.shots.length > RESTORE_MAX_FILES) throw new TooManyShots();
  const shots: ManifestShot[] = [];
  // one row per key AND per archive file: a second row for the same key or the same file is dropped (it could only make the
  // restore read one entry again and again, or write a key twice)
  const seenKey = new Set<string>();
  const seenFile = new Set<string>();
  for (const s of m.shots as Partial<ManifestShot>[]) {
    if (!s || typeof s.key !== "string" || !KEY_RE.test(s.key) || !isHex(s.sha256) || typeof s.file !== "string" || !SHOT_FILE_RE.test(s.file) || typeof s.mime !== "string" || !s.mime.startsWith("image/")) continue;
    if (seenKey.has(s.key) || seenFile.has(s.file)) continue;
    seenKey.add(s.key);
    seenFile.add(s.file);
    shots.push({
      key: s.key,
      file: s.file,
      sha256: s.sha256,
      bytes: typeof s.bytes === "number" ? s.bytes : 0,
      mime: s.mime,
      original: s.original === true,
      tradeIds: Array.isArray(s.tradeIds) ? s.tradeIds.map(String) : [],
      shotIds: Array.isArray(s.shotIds) ? s.shotIds.map(String) : [],
      matchesReference: typeof s.matchesReference === "boolean" ? s.matchesReference : null,
      ...(typeof s.originalName === "string" ? { originalName: s.originalName } : {}),
      ...(typeof s.w === "number" ? { w: s.w } : {}),
      ...(typeof s.h === "number" ? { h: s.h } : {}),
    });
  }
  return {
    format: BACKUP_ZIP_FORMAT,
    exportedAt: typeof m.exportedAt === "string" ? m.exportedAt : "",
    journal: "journal.json",
    journalSha256: m.journalSha256,
    journalBytes: typeof m.journalBytes === "number" ? m.journalBytes : 0,
    tradeCount: typeof m.tradeCount === "number" ? m.tradeCount : 0,
    shots,
    missing: Array.isArray(m.missing) ? (m.missing as ManifestMissing[]) : [],
  };
}

/** Opens a backup ZIP: reads manifest and journal, checks the journal's hash. Rejects with a German message. */
export async function readBackupZip(file: Blob): Promise<ZipBackup> {
  const list = await readZip(file);
  const byName = new Map(list.map((e) => [e.name, e]));
  const mEntry = byName.get("manifest.json");
  if (!mEntry) throw new Error(ZIP_BACKUP_MESSAGES.noManifest);
  if (mEntry.size > MAX_MANIFEST_BYTES) throw new Error(ZIP_BACKUP_MESSAGES.tooBig);
  const mText = await (await mEntry.checkedData()).text(); // a damaged archive says so (CRC) instead of "unlesbar"
  let manifest: BackupManifest | null;
  try {
    manifest = readManifest(JSON.parse(mText));
  } catch (e) {
    if (e instanceof TooManyShots) throw new Error(ZIP_BACKUP_MESSAGES.tooMany, { cause: e });
    manifest = null;
  }
  if (!manifest) throw new Error(ZIP_BACKUP_MESSAGES.badManifest);
  const jEntry = byName.get("journal.json");
  if (!jEntry) throw new Error(ZIP_BACKUP_MESSAGES.noJournal);
  if (jEntry.size > MAX_JOURNAL_BYTES) throw new Error(ZIP_BACKUP_MESSAGES.tooBig);
  const jBlob = await jEntry.data();
  if ((await sha256Hex(jBlob)) !== manifest.journalSha256) throw new Error(ZIP_BACKUP_MESSAGES.journalChanged);
  await jEntry.checkedData(); // the SHA fits: now the archive's own CRC (a damaged directory entry is told apart from an edit)
  const entries = new Map<string, ZipEntry>();
  for (const s of manifest.shots) {
    const e = byName.get(s.file);
    if (e) entries.set(s.key, e);
  }
  return { journalText: await jBlob.text(), manifest, entries };
}

/** What a ZIP says about its pictures, for the import preview: how many it carries and how many it could not carry. */
export function zipShotInfo(z: ZipBackup): { embedded: number; missing: number } {
  return { embedded: z.manifest.shots.filter((s) => z.entries.has(s.key)).length, missing: z.manifest.missing.length };
}

/** Outcome of a ZIP restore (see `RestoreReport`). */
export type ZipRestoreResult = RestoreReport;

/**
 * After an import: writes the pictures of the ZIP into this device's store. A picture is written only if its CRC-32 and
 * SHA-256 fit, its bytes are a real image of sane size and measures (`restoreGuard.ts`), and this device holds no
 * different picture under the same key.
 */
export async function restoreShotsFromZip(z: ZipBackup, onProgress?: (done: number, total: number) => void): Promise<ZipRestoreResult> {
  const out = emptyReport();
  const total = z.manifest.shots.length;
  let done = 0;
  for (const s of z.manifest.shots) {
    done += 1;
    onProgress?.(done, total);
    const e = z.entries.get(s.key);
    if (!e) {
      out.corrupt.push(s.key);
      continue;
    }
    try {
      if (e.size > MAX_INPUT_BYTES) {
        out.rejected.push({ key: s.key, reason: "size" });
        continue;
      }
      const raw = await e.checkedData();
      if ((await sha256Hex(raw)) !== s.sha256) {
        out.corrupt.push(s.key);
        continue;
      }
      const seen = await inspectRestoredImage(raw);
      if (!seen.ok) {
        out.rejected.push({ key: s.key, reason: seen.reason });
        continue;
      }
      const state = await keyState(s.key, s.sha256);
      if (state === "same") {
        out.alreadyThere += 1;
        continue;
      }
      if (state === "taken") {
        out.kept.push(s.key);
        continue;
      }
      // the type is the one the bytes show, not the one the manifest claims
      const blob = raw.type === seen.mime ? raw : new Blob([raw], { type: seen.mime });
      const put = await putShotBlobChecked(blob, s.key);
      out.written += 1;
      if (put.where === "ram") out.notSaved += 1;
    } catch {
      out.corrupt.push(s.key);
    }
  }
  return out;
}

/** German toast for a finished restore (`null` = nothing to tell). */
export const restoreSummary = summaryOf;
