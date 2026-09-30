import type { HyblockReading, JsonBackup, Settings, Setup, Trade } from "@/domain/types";
import { JsonBackupSchema } from "@/domain/schemas";
import { toJsonBackup, tradesToCsv } from "@/domain/csv";
import { normalizeReading, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { fmt } from "@/lib/format";
import { download } from "./download";
import { getEnriched, useJournal } from "./journalStore";
import type { StorageSnapshot } from "./adapters/StoreApi";
import { isQuotaError, KEYS, listKeys, readJson, removeKey, writeJsonStrict } from "./storage";
import { pushToast } from "./uiStore";

/* --------------------------------------------------------------- snapshots */

/** Value stored under `tj2-backup-{tag}`. */
export interface BackupSnapshot {
  settings: unknown;
  trades: unknown;
  hyblock: unknown;
  at: string;
}

export type BackupKind = "auto" | "import" | "v0";

export interface BackupEntry {
  tag: string;
  key: string;
  kind: BackupKind;
  at: string;
  trades: number;
}

export const AUTO_BACKUP_KEEP = 14;

function localDateTag(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function kindOf(tag: string): BackupKind {
  if (tag.startsWith("v0-")) return "v0";
  if (tag.startsWith("import-")) return "import";
  return "auto";
}

function currentSnapshot(at: string): BackupSnapshot {
  const s = useJournal.getState();
  return { settings: s.settings, trades: s.trades, hyblock: s.hyblock, at };
}

function autoBackupKeys(): string[] {
  return listKeys(KEYS.backupPrefix).filter((k) => kindOf(k.slice(KEYS.backupPrefix.length)) === "auto");
}

/**
 * Writes `tj2-backup-{tag}`. On `QuotaExceededError` the oldest auto backups are removed one by one
 * and the write retried; returns whether it finally succeeded.
 */
export function writeSnapshot(tag: string, snapshot: BackupSnapshot): boolean {
  const key = `${KEYS.backupPrefix}${tag}`;
  for (;;) {
    try {
      writeJsonStrict(key, snapshot);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) return false;
      const victims = autoBackupKeys().filter((k) => k !== key);
      const oldest = victims[0];
      if (!oldest) return false;
      removeKey(oldest);
    }
  }
}

/** All snapshots, newest first. */
export function listBackups(): BackupEntry[] {
  return listKeys(KEYS.backupPrefix)
    .map((key) => {
      const tag = key.slice(KEYS.backupPrefix.length);
      const snap = readJson<Partial<BackupSnapshot> | null>(key, null);
      const trades = Array.isArray(snap?.trades) ? snap.trades.length : 0;
      return { tag, key, kind: kindOf(tag), at: typeof snap?.at === "string" ? snap.at : "", trades };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.tag.localeCompare(a.tag));
}

export function readBackup(tag: string): BackupSnapshot | null {
  const snap = readJson<BackupSnapshot | null>(`${KEYS.backupPrefix}${tag}`, null);
  return snap && typeof snap === "object" ? snap : null;
}

/** `Letztes Backup {date}` – newest auto snapshot, or `null`. */
export function lastAutoBackup(): BackupEntry | null {
  return listBackups().find((b) => b.kind === "auto") ?? null;
}

/**
 * Daily snapshot `tj2-backup-{YYYY-MM-DD}` on the first load of a day (Plan 8.6). Keeps the last 14.
 * Skips when the journal is empty (nothing to protect) or the tag already exists.
 */
export function autoBackup(now: Date = new Date()): { tag: string; created: boolean } {
  const tag = localDateTag(now);
  const key = `${KEYS.backupPrefix}${tag}`;
  const state = useJournal.getState();
  if (listKeys(key).includes(key) || (state.trades.length === 0 && state.hyblock.length === 0)) {
    return { tag, created: false };
  }
  const created = writeSnapshot(tag, currentSnapshot(now.toISOString()));
  const keys = autoBackupKeys();
  while (keys.length > AUTO_BACKUP_KEEP) removeKey(keys.shift() as string);
  return { tag, created };
}

/* ------------------------------------------------------------------ export */

function fileDate(now: Date): string {
  return localDateTag(now);
}

/** JSON backup `{ exportedAt, settings, trades, hyblock, schemaVersion }`, 2 spaces, `trade-journal-YYYY-MM-DD.json`. */
export async function exportJson(now: Date = new Date()): Promise<boolean> {
  const s = useJournal.getState();
  const enriched = getEnriched(s.trades, s.settings);
  const backup = toJsonBackup(enriched, s.settings, s.hyblock);
  return download(`trade-journal-${fileDate(now)}.json`, JSON.stringify(backup, null, 2), "application/json");
}

/** CSV export (BOM, `;`, decimal comma – see `@/domain/csv`), `trade-journal-YYYY-MM-DD.csv`. */
export async function exportCsv(now: Date = new Date()): Promise<boolean> {
  const s = useJournal.getState();
  const enriched = getEnriched(s.trades, s.settings);
  return download(`trade-journal-${fileDate(now)}.csv`, tradesToCsv(enriched, s.settings), "text/csv;charset=utf-8");
}

/* ------------------------------------------------------------------ import */

export interface ImportPreview {
  trades: number;
  setups: number;
  readings: number;
  exportedAt: string;
  schemaVersion: number | null;
}

export type ParsedBackup = { ok: true; backup: JsonBackup; preview: ImportPreview } | { ok: false; error: string; path: string };

/** `{n} Trades, {m} Grundlagen, {k} Ablesungen · exportiert am {date}` */
export function previewText(p: ImportPreview): string {
  const date = p.exportedAt ? fmt.date(new Date(p.exportedAt)) : "–";
  return `${p.trades} Trades, ${p.setups} Grundlagen, ${p.readings} Ablesungen · exportiert am ${date}`;
}

/** Parses backup text with `JsonBackupSchema` (passthrough). Never throws. */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Kein gültiges JSON", path: "" };
  }
  const parsed = JsonBackupSchema.passthrough().safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.map(String).join(".") : "";
    return { ok: false, error: issue?.message ?? "Ungültiges Backup", path };
  }
  const data = parsed.data as unknown as JsonBackup;
  const settings = normalizeSettings(data.settings);
  const backup: JsonBackup = {
    ...data,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    settings,
    trades: Array.isArray(data.trades) ? data.trades.map((t) => normalizeTrade(t)) : [],
    hyblock: Array.isArray(data.hyblock) ? data.hyblock.map((r) => normalizeReading(r)) : undefined,
  };
  return {
    ok: true,
    backup,
    preview: {
      trades: backup.trades.length,
      setups: settings.setups.length,
      readings: backup.hyblock?.length ?? 0,
      exportedAt: backup.exportedAt,
      schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : null,
    },
  };
}

export type ImportMode = "merge" | "replace";

function newer(a: { updatedAt?: string }, b: { updatedAt?: string }): boolean {
  return (a.updatedAt ?? "") > (b.updatedAt ?? "");
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[], incomingWins: (cur: T, inc: T) => boolean): T[] {
  const out = [...current];
  const index = new Map(out.map((x, i) => [x.id, i] as const));
  for (const inc of incoming) {
    const i = index.get(inc.id);
    if (i === undefined) {
      index.set(inc.id, out.length);
      out.push(inc);
    } else if (incomingWins(out[i] as T, inc)) {
      out[i] = inc;
    }
  }
  return out;
}

/**
 * Pure merge/replace of a backup into the current snapshot (Plan 8.5).
 * merge: trades upsert by `id` (newer `updatedAt` wins, ties keep the current record), setups merged by `id`,
 *        readings upsert by `id`, settings scalars untouched.
 * replace: everything from the backup; readings only when the backup carries `hyblock` (legacy exports don't).
 */
export function applyBackup(current: StorageSnapshot, backup: JsonBackup, mode: ImportMode): StorageSnapshot {
  if (mode === "replace") {
    return {
      trades: backup.trades,
      settings: backup.settings,
      hyblock: backup.hyblock ?? current.hyblock,
    };
  }
  const setups: Setup[] = mergeById(current.settings.setups, backup.settings.setups, () => true);
  const settings: Settings = { ...current.settings, setups };
  const trades: Trade[] = mergeById(current.trades, backup.trades, (cur, inc) => newer(inc, cur));
  const hyblock: HyblockReading[] = mergeById(current.hyblock, backup.hyblock ?? [], () => true).sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  return { trades, settings, hyblock };
}

export interface ImportResult {
  ok: boolean;
  mode: ImportMode;
  preview: ImportPreview | null;
  snapshotTag: string | null;
  error?: string;
}

async function readInput(input: File | string): Promise<string> {
  return typeof input === "string" ? input : input.text();
}

/**
 * `Backup importieren`: reads the file/text, validates, snapshots the current data to
 * `tj2-backup-import-{ISO}`, writes through the active adapter and toasts `Backup importiert` /
 * `Import fehlgeschlagen` (zod path in the detail line). Never throws.
 */
export async function importBackup(
  input: File | string,
  opts: { mode: ImportMode; now?: Date; silent?: boolean },
): Promise<ImportResult> {
  const now = opts.now ?? new Date();
  const fail = (error: string, path = "", preview: ImportPreview | null = null): ImportResult => {
    if (!opts.silent) pushToast({ kind: "error", title: "Import fehlgeschlagen", detail: path ? `${path}: ${error}` : error });
    return { ok: false, mode: opts.mode, preview, snapshotTag: null, error: path ? `${path}: ${error}` : error };
  };

  let text: string;
  try {
    text = await readInput(input);
  } catch {
    return fail("Datei konnte nicht gelesen werden");
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) return fail(parsed.error, parsed.path);

  const store = useJournal.getState();
  const current: StorageSnapshot = { trades: store.trades, settings: store.settings, hyblock: store.hyblock };
  const snapshotTag = `import-${now.toISOString()}`;
  writeSnapshot(snapshotTag, { ...current, at: now.toISOString() });

  try {
    await store.replaceAll(applyBackup(current, parsed.backup, opts.mode));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "", parsed.preview);
  }
  if (!opts.silent) pushToast({ kind: "success", title: "Backup importiert", value: `${parsed.preview.trades} Trades` });
  return { ok: true, mode: opts.mode, preview: parsed.preview, snapshotTag };
}

/** `Wiederherstellen`: restore = import flow with `Ersetzen` (Plan 8.6). */
export async function restoreBackup(tag: string, now: Date = new Date()): Promise<ImportResult> {
  const snap = readBackup(tag);
  if (!snap) {
    pushToast({ kind: "error", title: "Import fehlgeschlagen", detail: `Backup ${tag} nicht gefunden` });
    return { ok: false, mode: "replace", preview: null, snapshotTag: null, error: "not found" };
  }
  const asBackup: JsonBackup = {
    exportedAt: snap.at,
    settings: normalizeSettings(snap.settings),
    trades: Array.isArray(snap.trades) ? (snap.trades as Trade[]) : [],
    hyblock: Array.isArray(snap.hyblock) ? (snap.hyblock as HyblockReading[]) : undefined,
    schemaVersion: 1,
  };
  return importBackup(JSON.stringify(asBackup), { mode: "replace", now });
}
