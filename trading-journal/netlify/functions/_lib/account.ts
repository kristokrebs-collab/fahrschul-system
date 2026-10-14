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
  // never `referred_id` – that is another person's account
  { table: "referrals", userColumn: "referrer_id", columns: "id,code,status,created_at,converted_at" },
  // P10 (0002_billing): the user's Stripe customer link, referral code, credits / commissions, team seats they own
  { table: "billing_customers", userColumn: "user_id", columns: "user_id,stripe_customer_id,created_at" },
  { table: "referral_codes", userColumn: "user_id", columns: "user_id,code,commission_pct,created_at" },
  { table: "affiliate_ledger", userColumn: "referrer_id", columns: "id,kind,amount,currency,status,created_at" },
  { table: "team_seats", userColumn: "owner_id", columns: "owner_id,member_id,created_at" },
  { table: "sync_runs", userColumn: "user_id", columns: "*" },
  // P12 (0004_social): pseudonym, own groups / memberships, what the user posted or shared, their figures, feedback
  { table: "social_profiles", userColumn: "user_id", columns: "pseudonym,created_at,updated_at" },
  { table: "groups", userColumn: "owner_id", columns: "id,kind,name,description,created_at" },
  { table: "group_members", userColumn: "user_id", columns: "group_id,role,share_level,joined_at" },
  { table: "group_reviews", userColumn: "author_id", columns: "id,group_id,payload,question,status,created_at" },
  { table: "comments", userColumn: "author_id", columns: "id,review_id,body,hidden,created_at" },
  { table: "group_goals", userColumn: "student_id", columns: "id,group_id,draft,status,created_at" },
  { table: "shares", userColumn: "user_id", columns: "id,kind,payload,created_at,expires_at,revoked_at,views" },
  { table: "member_stats", userColumn: "user_id", columns: "*" },
  { table: "feedback", userColumn: "user_id", columns: "id,kind,message,page,target_type,target_id,status,created_at" },
  // review DSGVO-01: API tokens (never the hash), the user's daily leaderboard ranks, invites the user created
  { table: "api_tokens", userColumn: "user_id", columns: "id,name,prefix,scopes,last_used_at,created_at,revoked_at" },
  { table: "leaderboard_snapshots", userColumn: "user_id", columns: "day,metric,rank,value,trades" },
  { table: "group_invites", userColumn: "created_by", columns: "code,group_id,role,max_uses,uses,expires_at,created_at" },
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
  /**
   * Download links (signed URLs, valid `FILE_LINK_TTL_S`) for the stored files – the export lists the screenshots and
   * backups AND lets the user fetch them (review DSGVO-01). A file without a link is still listed in `files`.
   */
  links: { expiresAt: string } & Record<UserBucket, { path: string; url: string }[]>;
}

/** Validity of the file links in an export (24 h). */
export const FILE_LINK_TTL_S = 24 * 3600;

/** Signed URLs for `paths` of `bucket` (chunks of 100); paths Storage refuses are left out. Never throws. */
export async function signedLinks(bucket: UserBucket, paths: readonly string[], ttlS: number, sb: SupabaseClient = supabaseAdmin()): Promise<{ path: string; url: string }[]> {
  const out: { path: string; url: string }[] = [];
  for (let i = 0; i < paths.length; i += 100) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), ttlS);
      if (error) {
        console.error("[fn] signed links failed", bucket);
        continue;
      }
      for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out.push({ path: d.path, url: d.signedUrl });
    } catch {
      console.error("[fn] signed links failed", bucket);
    }
  }
  return out;
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
  const links = { expiresAt: new Date(now.getTime() + FILE_LINK_TTL_S * 1000).toISOString() } as AccountExport["links"];
  // staged exports (`exports/`) are the export itself, not stored data
  for (const b of USER_BUCKETS) links[b] = await signedLinks(b, files[b].filter((p) => !p.startsWith(`${userId}/${EXPORTS_DIR}/`)), FILE_LINK_TTL_S, sb);
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
    links,
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

/* ------------------------------------------------------------------ large downloads (review DSGVO-02) */

/**
 * Netlify answers a buffered function response with at most 6 MB. A heavy scalper's export or backup (one synced trade
 * with its fills is ~1 KB) passes that after a year, and the download fails with a platform 502. Anything above this
 * size goes through Storage instead: the function answers `{ download: { url, bytes, expiresAt, name } }` with a short
 * signed URL, and the client fetches the file from Storage directly.
 */
export const INLINE_JSON_MAX = 4 * 1024 * 1024;
/** Validity of the link to a staged export / large backup (s). */
export const DOWNLOAD_LINK_TTL_S = 15 * 60;
/** Folder of staged exports inside the user's `backups/<uid>/` (removed by the next export, the next backup list and the account deletion). */
export const EXPORTS_DIR = "exports";
/** A staged export older than this is removed when the user's backups are listed. */
export const STAGED_EXPORT_KEEP_MS = 60 * 60_000;

export interface DownloadLink {
  url: string;
  bytes: number | null;
  expiresAt: string;
  name: string;
}

const utf8Bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** True when `text` fits a buffered function response. */
export const fitsInline = (text: string): boolean => utf8Bytes(text) <= INLINE_JSON_MAX;

async function signedLink(path: string, name: string, bytes: number | null, now: Date, sb: SupabaseClient): Promise<DownloadLink> {
  const { data, error } = await sb.storage.from(BACKUP_BUCKET).createSignedUrl(path, DOWNLOAD_LINK_TTL_S, { download: name });
  if (error || !data?.signedUrl) {
    console.error("[fn] download link failed");
    throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
  }
  return { url: data.signedUrl, bytes, expiresAt: new Date(now.getTime() + DOWNLOAD_LINK_TTL_S * 1000).toISOString(), name };
}

/** Removes staged exports of the user (all, or those older than `olderThanMs`). Best effort; returns the number removed. */
export async function removeStagedExports(userId: string, opts: { olderThanMs?: number; now?: Date; keep?: string } = {}, sb: SupabaseClient = supabaseAdmin()): Promise<number> {
  try {
    const { data, error } = await sb.storage.from(BACKUP_BUCKET).list(`${userId}/${EXPORTS_DIR}`, { limit: LIST_PAGE, sortBy: { column: "name", order: "asc" } });
    if (error || !data?.length) return 0;
    const now = (opts.now ?? new Date()).getTime();
    const stale = (data as StorageEntry[])
      .filter((e) => e.id)
      .map((e) => ({ path: `${userId}/${EXPORTS_DIR}/${e.name}`, at: Number(/^(\d+)-/.exec(e.name)?.[1] ?? 0) }))
      .filter((e) => e.path !== opts.keep && (opts.olderThanMs === undefined || now - e.at > opts.olderThanMs))
      .map((e) => e.path);
    if (!stale.length) return 0;
    const rm = await sb.storage.from(BACKUP_BUCKET).remove(stale);
    return rm.error ? 0 : stale.length;
  } catch {
    return 0;
  }
}

/**
 * Stores an export too big for a function response under `backups/<uid>/exports/<ms>-<name>` and answers a signed
 * link (`DOWNLOAD_LINK_TTL_S`). Earlier staged exports of the user are removed.
 */
export async function stageExport(userId: string, name: string, text: string, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<DownloadLink> {
  await ensureBackupBucket(sb);
  const path = `${userId}/${EXPORTS_DIR}/${now.getTime()}-${name}`;
  const { error } = await sb.storage.from(BACKUP_BUCKET).upload(path, new Blob([text], { type: "application/json" }), { contentType: "application/json", upsert: true });
  if (error) {
    console.error("[fn] export staging failed");
    throw new HttpError(502, "storage_unavailable", "Der Dateispeicher antwortet gerade nicht.");
  }
  await removeStagedExports(userId, { keep: path }, sb);
  return signedLink(path, name, utf8Bytes(text), now, sb);
}

/** A link to a stored backup (it already lives in Storage – nothing is copied). */
export function backupLink(file: BackupFile, now: Date = new Date(), sb: SupabaseClient = supabaseAdmin()): Promise<DownloadLink> {
  return signedLink(file.path, `trade-journal-backup-${file.day}.json`, file.size, now, sb);
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
