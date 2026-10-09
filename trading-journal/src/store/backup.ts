import type { DayNotes, HyblockReading, JsonBackup, Rule, Settings, Setup, Trade } from "@/domain/types";
import { JsonBackupSchema } from "@/domain/schemas";
import { toJsonBackup, tradesToCsv } from "@/domain/csv";
import { normalizeDayNotes, normalizeSettings } from "@/domain/normalize";
import { fmt } from "@/lib/format";
import { download } from "./download";
import { freshSnapshot, getEnriched, useJournal } from "./journalStore";
import type { StorageSnapshot } from "./adapters/StoreApi";
import { appendQuarantine, readQuarantine, SNAPSHOT_FAILED_TITLE, validateReadings, validateTrades, type QuarantineEntry } from "./migrate";
import { isQuotaError, KEYS, listKeys, readJson, removeKey, writeJsonStrict } from "./storage";
import { pushToast } from "./uiStore";

/* --------------------------------------------------------------- snapshots */

/** Value stored under `tj2-backup-{tag}`. */
export interface BackupSnapshot {
  settings: unknown;
  trades: unknown;
  hyblock: unknown;
  /** NEW: day journal (absent in older snapshots → restore keeps the current day notes). */
  days?: unknown;
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
  if (/^v\d+-/.test(tag)) return "v0"; // migration snapshots (label "Migration")
  if (tag.startsWith("import-")) return "import";
  return "auto";
}

function currentSnapshot(at: string): BackupSnapshot {
  const s = useJournal.getState();
  return { settings: s.settings, trades: s.trades, hyblock: s.hyblock, days: s.days, at };
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
  if (listKeys(key).includes(key) || (state.trades.length === 0 && state.hyblock.length === 0 && Object.keys(state.days).length === 0)) {
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

/**
 * JSON backup `{ exportedAt, settings, trades, hyblock, schemaVersion, days }`, 2 spaces,
 * `trade-journal-YYYY-MM-DD.json`. The other journal version imports it too (it reads `trades`, ignores the rest).
 */
export async function exportJson(now: Date = new Date()): Promise<boolean> {
  const s = useJournal.getState();
  const enriched = getEnriched(s.trades, s.settings);
  const backup: JsonBackup = { ...toJsonBackup(enriched, s.settings, s.hyblock, now), days: s.days };
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
  /** NEW: day journal entries in the backup. */
  days: number;
  exportedAt: string;
  schemaVersion: number | null;
  /** Records (trades + readings) that failed validation even after normalising; they are skipped and quarantined on import. */
  invalid: number;
}

export interface InvalidImportRecord {
  kind: "trade" | "hyblock";
  raw: unknown;
  error: string;
}

/**
 * Which parts the file really carries. A part the file lacks is never treated as "empty": replace keeps the current
 * data for it, merge leaves it alone (a bare trade list must not wipe settings, readings or day notes).
 */
export interface BackupParts {
  settings: boolean;
  trades: boolean;
  hyblock: boolean;
  days: boolean;
  /**
   * Top-level keys and setup ids the file's RAW settings had. Merge only adopts what the file really carries – not
   * the defaults `normalizeSettings` filled in (an old backup must not bring back a deleted `s_mtf` or mistake tag).
   */
  settingsKeys?: readonly string[];
  setupIds?: readonly string[];
}

export const ALL_PARTS: BackupParts = { settings: true, trades: true, hyblock: true, days: true };

export type ParsedBackup =
  | { ok: true; backup: JsonBackup; preview: ImportPreview; invalid: InvalidImportRecord[]; parts: BackupParts }
  | { ok: false; error: string; path: string };

/** Error text for an object that carries neither trades nor settings. */
export const NOT_A_BACKUP = "Keine Trades oder Einstellungen in der Datei";

/** `{n} Einträge übersprungen` – detail line for a partially valid backup. */
export function skippedText(n: number): string {
  return `${n} Einträge übersprungen`;
}

/** `{n} Trades, {m} Grundlagen, {k} Ablesungen · exportiert am {date}` */
export function previewText(p: ImportPreview): string {
  const date = p.exportedAt ? fmt.date(new Date(p.exportedAt)) : "–";
  return `${p.trades} Trades, ${p.setups} Grundlagen, ${p.readings} Ablesungen · exportiert am ${date}`;
}

/**
 * Parses backup text. Accepted (both journal versions, every format they ever wrote):
 * - ours `{ exportedAt, settings, trades, hyblock, schemaVersion, days? }`;
 * - the other version's `{ exportedAt, settings, trades }` (no hyblock / schemaVersion);
 * - `{ trades }` and a bare `[trade, …]` array (the other version's import accepts both).
 * Present parts must have the right type (zod path in `path`); an object with neither `trades` nor `settings` is
 * rejected. Trades and readings are validated per record (`validateTrades` / `validateReadings`, normalise first) and
 * broken ones are counted in `preview.invalid` instead of rejecting the whole file. `parts` says what the file
 * carries. Never throws.
 */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Kein gültiges JSON", path: "" };
  }
  if (Array.isArray(json)) json = { trades: json };
  const parsed = JsonBackupSchema.passthrough().safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.map(String).join(".") : "";
    return { ok: false, error: issue?.message ?? "Ungültiges Backup", path };
  }
  const data = parsed.data as unknown as Omit<JsonBackup, "trades" | "hyblock" | "settings" | "exportedAt" | "days"> & {
    exportedAt?: string;
    settings?: unknown;
    trades?: unknown[];
    hyblock?: unknown[];
    days?: unknown;
  };
  if (data.settings === undefined && data.trades === undefined) return { ok: false, error: NOT_A_BACKUP, path: "trades" };
  const rawSettings = data.settings && typeof data.settings === "object" ? (data.settings as Record<string, unknown>) : null;
  const parts: BackupParts = {
    settings: data.settings !== undefined,
    trades: data.trades !== undefined,
    hyblock: Array.isArray(data.hyblock),
    days: data.days !== undefined,
    settingsKeys: rawSettings ? Object.keys(rawSettings) : [],
    setupIds: rawSettings && Array.isArray(rawSettings.setups)
      ? rawSettings.setups.flatMap((x) => (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? [(x as { id: string }).id] : []))
      : [],
  };
  const settings = normalizeSettings(data.settings ?? null);
  const trades = validateTrades(data.trades ?? []);
  const readings = Array.isArray(data.hyblock) ? validateReadings(data.hyblock) : null;
  const days = parts.days ? normalizeDayNotes(data.days) : undefined;
  const backup: JsonBackup = {
    ...data,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    settings,
    trades: trades.valid,
    hyblock: readings ? readings.valid : undefined,
    days,
  };
  if (!days) delete backup.days;
  const invalid: InvalidImportRecord[] = [
    ...trades.invalid.map((i) => ({ kind: "trade" as const, ...i })),
    ...(readings?.invalid ?? []).map((i) => ({ kind: "hyblock" as const, ...i })),
  ];
  return {
    ok: true,
    backup,
    invalid,
    parts,
    preview: {
      trades: backup.trades.length,
      // what the file carries (normalising may append `s_mtf` to legacy settings – not part of the file)
      setups: !parts.settings ? 0 : rawSettings && Array.isArray(rawSettings.setups) ? rawSettings.setups.length : settings.setups.length,
      readings: backup.hyblock?.length ?? 0,
      days: days ? Object.keys(days).length : 0,
      exportedAt: backup.exportedAt,
      schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : null,
      invalid: invalid.length,
    },
  };
}

export type ImportMode = "merge" | "replace";

function newer(a: { updatedAt?: string }, b: { updatedAt?: string }): boolean {
  return (a.updatedAt ?? "") > (b.updatedAt ?? "");
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `{ ...cur, ...inc }`: the incoming record wins, keys only the current record has survive (lossless upsert). */
function overlay<T extends object>(cur: T, inc: T): T {
  return { ...cur, ...inc };
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
      out[i] = overlay(out[i] as T, inc);
    }
  }
  return out;
}

/** Keys (deep, plain objects only) that exist in `incoming` but not in `current` are adopted; everything else stays. */
export function fillMissing<T>(current: T, incoming: unknown): T {
  if (!isPlain(current) || !isPlain(incoming)) return current;
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    if (!(k in out) || out[k] === undefined) out[k] = v;
    else out[k] = fillMissing(out[k], v);
  }
  return out as T;
}

/** `date|entry|side` – the other version's duplicate key for trades entered in both apps (needs date + entry). */
function signature(t: Trade): string | null {
  return t.date && t.entry != null ? `${t.date}|${t.entry}|${t.side}` : null;
}

/** Bookkeeping keys that may differ between two copies of the same trade. */
const META_KEYS = new Set(["id", "createdAt", "updatedAt", "pnl", "r"]);

const isEmptyValue = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) || (isPlain(v) && Object.keys(v).length === 0);

/**
 * The incoming copy carries nothing the current trade lacks: every filled user field of `inc` holds exactly the
 * current value. Only then is it a pure duplicate (e.g. the same backup imported twice by an app that assigned new
 * ids) and may be skipped – a copy with any extra or different value is a different record and is kept.
 */
function addsNothing(cur: Trade, inc: Trade): boolean {
  const rc = cur as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(inc as unknown as Record<string, unknown>)) {
    if (META_KEYS.has(k) || isEmptyValue(v)) continue;
    if (JSON.stringify(v) !== JSON.stringify(rc[k])) return false;
  }
  return true;
}

/**
 * Trades: upsert by `id` (newer `updatedAt` wins, ties keep the current record; the winner keeps keys only the
 * loser had). An incoming trade with an unknown id whose `date|entry|side` matches exactly ONE current trade and adds
 * nothing to it is a pure duplicate and skipped (the other version's dedupe key). Everything else is added – a
 * duplicate can be deleted, a dropped trade cannot be recovered.
 */
function mergeTrades(current: Trade[], incoming: Trade[]): Trade[] {
  const ids = new Set(current.map((t) => t.id));
  const bySig = new Map<string, number | null>();
  current.forEach((t, i) => {
    const sig = signature(t);
    if (sig) bySig.set(sig, bySig.has(sig) ? null : i); // null = ambiguous, never skipped
  });
  const out = mergeById(current, incoming.filter((t) => ids.has(t.id)), (cur, inc) => newer(inc, cur));
  for (const inc of incoming) {
    if (ids.has(inc.id)) continue;
    const sig = signature(inc);
    const i = sig ? bySig.get(sig) : undefined;
    if (i != null && addsNothing(out[i] as Trade, inc)) continue;
    ids.add(inc.id);
    out.push(inc);
  }
  return out;
}

/** Day notes: per date, newer `updatedAt` wins (keys only the other entry had survive); new dates are added. */
function mergeDays(current: DayNotes, incoming: DayNotes): DayNotes {
  const out: DayNotes = { ...current };
  for (const [date, inc] of Object.entries(incoming)) {
    const cur = out[date];
    out[date] = !cur ? inc : newer(inc, cur) ? overlay(cur, inc) : overlay(inc, cur);
  }
  return out;
}

/** Union of two tag lists, current order first. */
function union(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

/**
 * Pure merge/replace of a backup into the current snapshot (Plan 8.5). `parts` = what the file carries
 * (`parseBackup`); a part the file lacks keeps the current data in both modes.
 * merge:
 * - trades: see `mergeTrades` (id upsert, newer wins, lossless; `date|entry|side` duplicates folded);
 * - settings: current scalars untouched; setups merged by `id` (backup version wins, current-only keys kept), rules
 *   added by `id` (current wins), mistake tags united, and every key only the backup has – also nested, e.g.
 *   `signals` / `mistakes` from the other version, `market.sourceSymbol` – adopted;
 * - readings upsert by `id`; day notes per date (newer wins).
 * replace: everything the backup carries; readings / day notes / settings / trades it lacks stay as they are.
 */
export function applyBackup(current: StorageSnapshot, backup: JsonBackup, mode: ImportMode, parts: BackupParts = ALL_PARTS): StorageSnapshot {
  const curDays = current.days ?? {};
  const has = { ...parts, hyblock: parts.hyblock && !!backup.hyblock, days: parts.days && !!backup.days };
  if (mode === "replace") {
    return {
      trades: has.trades ? backup.trades : current.trades,
      settings: has.settings ? backup.settings : current.settings,
      hyblock: has.hyblock ? (backup.hyblock as HyblockReading[]) : current.hyblock,
      days: has.days ? (backup.days as DayNotes) : curDays,
    };
  }
  let settings: Settings = current.settings;
  if (has.settings) {
    // Only what the file really carries (not the defaults the parser filled in), see `BackupParts.settingsKeys`.
    const keys = parts.settingsKeys ? new Set(parts.settingsKeys) : null;
    const setupIds = parts.setupIds ? new Set(parts.setupIds) : null;
    const carried = (k: string) => !keys || keys.has(k);
    const b = backup.settings;
    const bSetups = carried("setups") ? b.setups.filter((x) => !setupIds || typeof x.id !== "string" || setupIds.has(x.id)) : [];
    const setups: Setup[] = mergeById(current.settings.setups, bSetups, () => true);
    const rules: Rule[] = carried("rules") ? mergeById(current.settings.rules, Array.isArray(b.rules) ? b.rules : [], () => false) : current.settings.rules;
    const mistakes = carried("mistakes") ? union(current.settings.mistakes ?? [], Array.isArray(b.mistakes) ? b.mistakes : []) : current.settings.mistakes;
    // Keys only the backup has (e.g. `signals` from the other journal) are adopted; existing values stay.
    const extras = Object.fromEntries(Object.entries(b).filter(([k]) => carried(k)));
    settings = { ...fillMissing(current.settings, extras), setups, rules, mistakes };
  }
  const trades: Trade[] = has.trades ? mergeTrades(current.trades, backup.trades) : current.trades;
  const hyblock: HyblockReading[] = has.hyblock
    ? mergeById(current.hyblock, backup.hyblock ?? [], () => true).sort((a, b) => a.at.localeCompare(b.at))
    : current.hyblock;
  const days = has.days ? mergeDays(curDays, backup.days ?? {}) : curDays;
  return { trades, settings, hyblock, days };
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
  // Fresh read: a write another tab made a moment ago must be part of the merge base (and of the safety snapshot).
  const current: StorageSnapshot = freshSnapshot();
  const snapshotTag = `import-${now.toISOString()}`;
  // The snapshot is the only way back – without it nothing is written.
  if (!writeSnapshot(snapshotTag, { ...current, at: now.toISOString() })) {
    if (!opts.silent) pushToast({ kind: "error", title: SNAPSHOT_FAILED_TITLE, detail: "Import abgebrochen" });
    return { ok: false, mode: opts.mode, preview: parsed.preview, snapshotTag: null, error: SNAPSHOT_FAILED_TITLE };
  }

  try {
    await store.replaceAll(applyBackup(current, parsed.backup, opts.mode, parsed.parts));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "", parsed.preview);
  }
  if (parsed.invalid.length) {
    const at = now.toISOString();
    const entries: QuarantineEntry[] = parsed.invalid.map((i) => ({ kind: i.kind, key: "import", raw: i.raw, error: i.error, at }));
    appendQuarantine(entries);
    useJournal.setState({ quarantined: readQuarantine().length });
  }
  if (!opts.silent) {
    pushToast({
      kind: "success",
      title: "Backup importiert",
      value: `${parsed.preview.trades} Trades`,
      detail: parsed.invalid.length ? skippedText(parsed.invalid.length) : undefined,
    });
  }
  return { ok: true, mode: opts.mode, preview: parsed.preview, snapshotTag };
}

/**
 * `Wiederherstellen`: restore = import flow with `Ersetzen` (Plan 8.6). Records are normalised before
 * validation (legacy snapshots with `entry:"100"` / `notes:null` restore fine); a snapshot whose keys were
 * stored as raw strings (unparseable at migration time) has no readable records and restores none.
 */
export async function restoreBackup(tag: string, now: Date = new Date()): Promise<ImportResult> {
  const snap = readBackup(tag);
  if (!snap) {
    pushToast({ kind: "error", title: "Import fehlgeschlagen", detail: `Backup ${tag} nicht gefunden` });
    return { ok: false, mode: "replace", preview: null, snapshotTag: null, error: "not found" };
  }
  const asBackup = {
    exportedAt: typeof snap.at === "string" ? snap.at : now.toISOString(),
    settings: normalizeSettings(snap.settings),
    trades: Array.isArray(snap.trades) ? snap.trades : [],
    hyblock: Array.isArray(snap.hyblock) ? snap.hyblock : undefined,
    days: isPlain(snap.days) ? snap.days : undefined,
    schemaVersion: 1,
  };
  return importBackup(JSON.stringify(asBackup), { mode: "replace", now });
}
