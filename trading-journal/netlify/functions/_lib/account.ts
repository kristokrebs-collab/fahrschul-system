/**
 * Account data helpers (P09): everything the DSGVO tools (export, deletion) and the nightly backup need.
 * Always called AFTER `requireUser` / from the scheduled job, with the verified user id – the admin client bypasses RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_COLUMNS, rowsToBackup, type BackupShape, type DocRow } from "../../../src/cloud/sync/docs";
import { HttpError } from "./http";
import { supabaseAdmin } from "./supabase";

/** The word the user types to confirm the account deletion (the UI uses the same word). */
export const DELETE_CONFIRM_WORD = "LÖSCHEN";

/** Private buckets that hold per-user folders `<user id>/…`. */
export const USER_BUCKETS = ["screenshots", "backups"] as const;
export type UserBucket = (typeof USER_BUCKETS)[number];

/** PostgREST page size (its default max-rows is 1000). */
export const PAGE = 1000;

/** PostgREST / Postgres codes for "this table does not exist (yet)" – later migrations add tables. */
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST200"]);

export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_TABLE.has(error.code);
}

/** Every `journal_docs` row of the user (tombstones included), paged. */
export async function fetchAllDocs(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<DocRow[]> {
  const out: DocRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("journal_docs")
      .select(DOC_COLUMNS)
      .eq("user_id", userId)
      .order("kind", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[fn] journal_docs read failed", error.code);
      throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
    }
    const rows = (data ?? []) as unknown as DocRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The user's journal as a backup file (`parseBackup` format) – live rows only. */
export async function journalBackup(userId: string, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<BackupShape & { counts: Record<string, number> }> {
  const rows = await fetchAllDocs(userId, sb);
  const backup = rowsToBackup(rows, now.toISOString());
  return { ...backup, counts: { trades: backup.trades.length, hyblock: backup.hyblock.length, days: Object.keys(backup.days).length, tombstones: rows.filter((r) => r.deleted).length } };
}

/**
 * Further per-user tables included in the export. Later packages APPEND their tables here (P10 subscriptions /
 * referrals, P11 sync runs, P12 groups …); a table that does not exist yet is skipped. `columns` must never list a
 * secret column (the exchange secrets are excluded by listing the metadata columns explicitly).
 */
export interface ExportTable {
  table: string;
  /** Column holding the user id. */
  userColumn: string;
  /** PostgREST select list. */
  columns: string;
}

export const EXPORT_TABLES: ExportTable[] = [
  { table: "profiles", userColumn: "id", columns: "id,display_name,plan,plan_status,trial_end,tz,privacy,created_at,updated_at" },
  { table: "audit_log", userColumn: "user_id", columns: "id,action,meta,at" },
  { table: "app_errors", userColumn: "user_id", columns: "id,at,message,url,release,edition" },
  {
    table: "exchange_connections",
    userColumn: "user_id",
    columns: "id,exchange,label,key_version,key_last4,permissions,status,last_sync_at,last_error,created_at,updated_at",
  },
  { table: "subscriptions", userColumn: "user_id", columns: "*" },
  { table: "referrals", userColumn: "referrer_id", columns: "*" },
  { table: "sync_runs", userColumn: "user_id", columns: "*" },
];

const SECRET_KEY = /secret|password|passphrase|token|api[-_]?key|authorization|cookie|jwt|_enc$/i;

/** Replaces the values of secret-looking keys (any depth) with "[redacted]"; everything else stays complete. */
export function redactSecrets(v: unknown, depth = 0): unknown {
  if (depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => redactSecrets(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactSecrets(x, depth + 1);
    return out;
  }
  return v;
}

/** Rows of one export table (paged); `null` when the table does not exist. Secret-looking keys are redacted. */
export async function exportTable(t: ExportTable, userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<unknown[] | null> {
  const out: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(t.table).select(t.columns).eq(t.userColumn, userId).range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      console.error("[fn] export read failed", t.table, error.code);
      throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
    }
    const rows = (data ?? []) as unknown[];
    out.push(...rows.map((r) => redactSecrets(r)));
    if (rows.length < PAGE) return out;
  }
}

export interface AccountExport {
  format: "trade-journal-account-export";
  version: 1;
  exportedAt: string;
  account: { id: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; factors: { type: string; friendlyName: string | null; status: string; createdAt: string | null }[] };
  /** The journal in the app's backup format – `Backup importieren` reads this object directly. */
  journal: BackupShape & { counts: Record<string, number> };
  tables: Record<string, unknown[]>;
  files: Record<UserBucket, string[]>;
}

/** Everything stored about the user (DSGVO Art. 15 / 20), secrets excluded. */
export async function collectExport(userId: string, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<AccountExport> {
  const { data: u, error } = await sb.auth.admin.getUserById(userId);
  if (error) console.error("[fn] getUserById failed", error.status ?? "");
  const user = u?.user ?? null;
  const tables: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) {
    const rows = await exportTable(t, userId, sb);
    if (rows) tables[t.table] = rows;
  }
  const files = {} as Record<UserBucket, string[]>;
  for (const b of USER_BUCKETS) files[b] = await listUserFiles(b, userId, sb);
  return {
    format: "trade-journal-account-export",
    version: 1,
    exportedAt: now.toISOString(),
    account: {
      id: userId,
      email: user?.email ?? null,
      createdAt: user?.created_at ?? null,
      lastSignInAt: user?.last_sign_in_at ?? null,
      factors: (user?.factors ?? []).map((f) => ({ type: f.factor_type, friendlyName: f.friendly_name ?? null, status: f.status, createdAt: f.created_at ?? null })),
    },
    journal: await journalBackup(userId, now, sb),
    tables,
    files,
  };
}

/* ------------------------------------------------------------------ storage */

interface StorageEntry {
  name: string;
  id: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

const LIST_PAGE = 100;
const MAX_DEPTH = 4;

/**
 * Every object path below `<bucket>/<userId>/` (recursive, paged). A missing bucket counts as empty. Folders are the
 * entries without an `id`.
 */
export async function listUserFiles(bucket: UserBucket, userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<string[]> {
  const out: string[] = [];
  async function walk(prefix: string, depth: number): Promise<void> {
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) {
        const msg = `${(error as { statusCode?: string }).statusCode ?? ""} ${error.message ?? ""}`;
        if (/not.?found|404/i.test(msg)) return;
        console.error("[fn] storage list failed", bucket);
        throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
      }
      const entries = (data ?? []) as StorageEntry[];
      for (const e of entries) {
        const path = `${prefix}/${e.name}`;
        if (e.id) out.push(path);
        else if (depth < MAX_DEPTH) await walk(path, depth + 1);
      }
      if (entries.length < LIST_PAGE) return;
    }
  }
  await walk(userId, 0);
  return out;
}

/** Removes every object of the user in `bucket` (in chunks); returns the number removed. */
export async function removeUserFiles(bucket: UserBucket, userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<number> {
  const paths = await listUserFiles(bucket, userId, sb);
  for (let i = 0; i < paths.length; i += LIST_PAGE) {
    const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + LIST_PAGE));
    if (error) {
      console.error("[fn] storage remove failed", bucket);
      throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
    }
  }
  return paths.length;
}

/* ------------------------------------------------------------------ backups */

export const BACKUP_BUCKET = "backups" as const;
/** Days a nightly backup is kept. */
export const BACKUP_KEEP_DAYS = 14;

/** `YYYY-MM-DD` (UTC) – the backup object name of a day. */
export function backupDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export interface BackupFile {
  day: string;
  path: string;
  size: number | null;
}

/** The user's nightly backups, newest first. */
export async function listBackups(userId: string, sb: SupabaseClient = supabaseAdmin()): Promise<BackupFile[]> {
  const { data, error } = await sb.storage.from(BACKUP_BUCKET).list(userId, { limit: LIST_PAGE, sortBy: { column: "name", order: "desc" } });
  if (error) {
    if (/not.?found|404/i.test(`${(error as { statusCode?: string }).statusCode ?? ""} ${error.message ?? ""}`)) return [];
    console.error("[fn] backups list failed");
    throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
  }
  const out: BackupFile[] = [];
  for (const e of (data ?? []) as StorageEntry[]) {
    const m = DAY_FILE.exec(e.name);
    if (!m || !e.id) continue;
    const size = typeof e.metadata?.size === "number" ? e.metadata.size : null;
    out.push({ day: m[1]!, path: `${userId}/${e.name}`, size });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Backups older than `keepDays` relative to `now` (by their day name). The newest backup is never expired – a journal
 * that has not changed for weeks still keeps its last copy.
 */
export function expiredBackups(files: readonly BackupFile[], now: Date, keepDays = BACKUP_KEEP_DAYS): BackupFile[] {
  const cutoff = backupDay(new Date(now.getTime() - keepDays * 86_400_000));
  const newest = [...files].sort((a, b) => b.day.localeCompare(a.day))[0];
  return files.filter((f) => f !== newest && f.day < cutoff);
}

/** Creates the private `backups` bucket when it does not exist yet. */
export async function ensureBackupBucket(sb: SupabaseClient = supabaseAdmin()): Promise<void> {
  const { data, error } = await sb.storage.getBucket(BACKUP_BUCKET);
  if (data && !error) return;
  const created = await sb.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (created.error && !/exist/i.test(created.error.message ?? "")) {
    console.error("[fn] backups bucket missing and not creatable");
    throw new HttpError(503, "storage_unavailable", "Der Dateispeicher ist nicht eingerichtet.");
  }
}

export interface NightlyOptions {
  now?: Date;
  /** Stop starting new users after this many ms (scheduled functions end after 30 s). */
  budgetMs?: number;
  /**
   * Back up users whose journal changed within this window. Default 50 h: a user deferred by the time budget (or a
   * missed run) is caught up by the next night.
   */
  sinceMs?: number;
  /** Clock for the budget (tests). */
  clock?: () => number;
  sb?: SupabaseClient;
}

export interface NightlyResult {
  users: number;
  uploaded: number;
  removed: number;
  failed: number;
  /** Users left for the next run because the time budget ran out. */
  deferred: boolean;
  purgedErrors: boolean;
}

/** Days `app_errors` rows are kept. */
export const ERROR_KEEP_DAYS = 30;

/**
 * The nightly job: one JSON backup per user whose journal changed (`backups/<id>/<YYYY-MM-DD>.json`, same format as
 * `Backup (JSON)`), expired backups removed (`BACKUP_KEEP_DAYS`, the newest always kept), `app_errors` purged after
 * `ERROR_KEEP_DAYS`. A failing user is logged and skipped; the time budget defers the rest to the next run.
 */
export async function runNightlyBackup(opts: NightlyOptions = {}): Promise<NightlyResult> {
  const sb = opts.sb ?? supabaseAdmin();
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? 22_000;
  const since = new Date(now.getTime() - (opts.sinceMs ?? 50 * 3_600_000)).toISOString();
  const out: NightlyResult = { users: 0, uploaded: 0, removed: 0, failed: 0, deferred: false, purgedErrors: false };
  await ensureBackupBucket(sb);
  const day = backupDay(now);
  let after: string | null = null;
  outer: for (;;) {
    const page: { data: unknown; error: { code?: string } | null } = await sb.rpc("backup_candidates", { p_since: since, p_after: after, p_limit: 200 });
    if (page.error) {
      console.error("[fn] backup_candidates failed", page.error.code);
      throw new HttpError(502, "db_unavailable");
    }
    const ids: string[] = ((page.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    for (const userId of ids) {
      if (clock() - started > budget) {
        out.deferred = true;
        break outer;
      }
      after = userId;
      out.users++;
      try {
        const backup = await journalBackup(userId, now, sb);
        const body = JSON.stringify({ ...backup, counts: undefined }, null, 0);
        const up = await sb.storage.from(BACKUP_BUCKET).upload(`${userId}/${day}.json`, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
        if (up.error) throw up.error;
        out.uploaded++;
        const stale = expiredBackups(await listBackups(userId, sb), now);
        if (stale.length) {
          const rm = await sb.storage.from(BACKUP_BUCKET).remove(stale.map((f) => f.path));
          if (rm.error) throw rm.error;
          out.removed += stale.length;
        }
      } catch (e) {
        out.failed++;
        console.error("[fn] backup failed for a user", e instanceof Error ? e.name : typeof e);
      }
    }
    if (ids.length < 200) break;
  }
  const cutoff = new Date(now.getTime() - ERROR_KEEP_DAYS * 86_400_000).toISOString();
  const purge = await sb.from("app_errors").delete().lt("at", cutoff);
  out.purgedErrors = !purge.error;
  if (purge.error) console.error("[fn] app_errors purge failed", purge.error.code);
  return out;
}
