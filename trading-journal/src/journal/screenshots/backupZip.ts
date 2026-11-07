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
 * against the manifest before it is written back; a file whose hash differs is NOT restored and is named. Old JSON
 * backups with base64 pictures (`backupShots.ts`) are still read.
 */
import { toJsonBackup } from "@/domain/csv";
import type { JsonBackup, ScreenshotRef, Trade } from "@/domain/types";
import { getEnriched, useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { extOfMime, isOriginal } from "./info";
import { loadOriginal, saveBlob } from "./original";
import { sha256Hex } from "./sha256";
import { localKeyOf, putShotBlobChecked } from "./store";
import { buildZip, readZip, type ZipEntry } from "./zip";

export const BACKUP_ZIP_FORMAT = "tj-backup-zip/1";
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

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
} as const;

const isHex = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

function readManifest(raw: unknown): BackupManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<BackupManifest>;
  if (m.format !== BACKUP_ZIP_FORMAT || m.journal !== "journal.json" || !isHex(m.journalSha256) || !Array.isArray(m.shots)) return null;
  const shots: ManifestShot[] = [];
  for (const s of m.shots as Partial<ManifestShot>[]) {
    if (!s || typeof s.key !== "string" || !KEY_RE.test(s.key) || !isHex(s.sha256) || typeof s.file !== "string" || !s.file.startsWith("shots/") || typeof s.mime !== "string" || !s.mime.startsWith("image/")) continue;
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
  let manifest: BackupManifest | null;
  try {
    manifest = readManifest(JSON.parse(await (await mEntry.data()).text()));
  } catch {
    manifest = null;
  }
  if (!manifest) throw new Error(ZIP_BACKUP_MESSAGES.badManifest);
  const jEntry = byName.get("journal.json");
  if (!jEntry) throw new Error(ZIP_BACKUP_MESSAGES.noJournal);
  const jBlob = await jEntry.data();
  if ((await sha256Hex(jBlob)) !== manifest.journalSha256) throw new Error(ZIP_BACKUP_MESSAGES.journalChanged);
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

export interface ZipRestoreResult {
  written: number;
  /** Keys whose bytes do not match the manifest hash (or whose file is missing from the ZIP): NOT written. */
  corrupt: string[];
  /** Written, but only into memory (device storage full or unavailable). */
  notSaved: number;
}

/** After an import: writes the pictures of the ZIP into this device's store, each one only if its SHA-256 matches the manifest. */
export async function restoreShotsFromZip(z: ZipBackup, onProgress?: (done: number, total: number) => void): Promise<ZipRestoreResult> {
  const out: ZipRestoreResult = { written: 0, corrupt: [], notSaved: 0 };
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
      const raw = await e.data();
      if ((await sha256Hex(raw)) !== s.sha256) {
        out.corrupt.push(s.key);
        continue;
      }
      const blob = raw.type === s.mime ? raw : new Blob([raw], { type: s.mime });
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
export function restoreSummary(r: ZipRestoreResult): { kind: "success" | "error"; title: string; detail: string } | null {
  if (!r.written && !r.corrupt.length) return null;
  const parts: string[] = [];
  if (r.written) parts.push(`${r.written === 1 ? "1 Bild" : `${r.written} Bilder`} bytegleich wiederhergestellt (Hash geprüft)`);
  if (r.corrupt.length) parts.push(`${r.corrupt.length === 1 ? "1 Bild" : `${r.corrupt.length} Bilder`} nicht übernommen: Hash stimmt nicht oder Datei fehlt`);
  if (r.notSaved) parts.push(`${r.notSaved === 1 ? "1 Bild ist" : `${r.notSaved} Bilder sind`} nicht dauerhaft gespeichert (Speicher voll)`);
  const bad = r.corrupt.length > 0 || r.notSaved > 0;
  return { kind: bad ? "error" : "success", title: bad ? "Bilder nur teilweise wiederhergestellt" : "Bilder wiederhergestellt", detail: `${parts.join(" · ")}.` };
}
