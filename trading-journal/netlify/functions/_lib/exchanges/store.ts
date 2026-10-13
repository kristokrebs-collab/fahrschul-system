/**
 * Database side of the exchange sync (P11): connections (with the encrypted key), cursors, runs and the journal upsert.
 * Service role only – every query filters by the verified user id. Secrets are decrypted in memory just before a sync
 * and never returned, logged or written anywhere else.
 */
import { decrypt, encrypt, keyringFromEnv, last4, needsReencrypt, secretAad, type Keyring } from "../crypto";
import { HttpError } from "../http";
import { supabaseAdmin } from "../supabase";
import type { ExchangeCredentials, ExchangeId } from "./types";

export const CONNECTION_COLUMNS =
  "id,user_id,exchange,label,key_last4,key_version,permissions,status,last_sync_at,last_error,created_at,updated_at,journal_account,sync_enabled";

/** What the client may see of a connection. */
export interface ConnectionInfo {
  id: string;
  exchange: ExchangeId;
  label: string;
  keyLast4: string;
  permissions: string[];
  status: "active" | "invalid" | "revoked" | "paused";
  lastSyncAt: string | null;
  lastError: string | null;
  journalAccount: "makro" | "scalp";
  syncEnabled: boolean;
  createdAt: string;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  exchange: ExchangeId;
  label: string;
  key_last4: string;
  key_version: number;
  permissions: string[] | null;
  status: ConnectionInfo["status"];
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at?: string;
  journal_account: "makro" | "scalp";
  sync_enabled: boolean;
  api_key_enc?: string;
  secret_enc?: string;
  passphrase_enc?: string | null;
  meta?: Record<string, unknown> | null;
}

export function connectionInfo(r: ConnectionRow): ConnectionInfo {
  return {
    id: r.id,
    exchange: r.exchange,
    label: r.label ?? "",
    keyLast4: r.key_last4 ?? "",
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    status: r.status,
    lastSyncAt: r.last_sync_at ?? null,
    lastError: r.last_error ?? null,
    journalAccount: r.journal_account === "makro" ? "makro" : "scalp",
    syncEnabled: r.sync_enabled !== false,
    createdAt: r.created_at,
  };
}

const dbFail = (what: string, code?: string): HttpError => {
  console.error(`[fn] exchange ${what} failed`, code ?? "");
  return new HttpError(500, "db_error", "Die Datenbank antwortet gerade nicht. Bitte später erneut versuchen.");
};

/** True when the server can store exchange keys (`EXCHANGE_ENC_KEY_V1…` set). */
export function encryptionConfigured(): boolean {
  try {
    keyringFromEnv();
    return true;
  } catch {
    return false;
  }
}

export async function listConnections(userId: string): Promise<ConnectionRow[]> {
  const { data, error } = await supabaseAdmin().from("exchange_connections").select(CONNECTION_COLUMNS).eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw dbFail("list", error.code);
  return (data ?? []) as unknown as ConnectionRow[];
}

/** A connection of `userId` WITH its secret columns (for a sync), or null. */
export async function loadConnection(userId: string, connectionId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("exchange_connections")
    .select(`${CONNECTION_COLUMNS},api_key_enc,secret_enc,passphrase_enc,meta`)
    .eq("user_id", userId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw dbFail("load", error.code);
  return (data as unknown as ConnectionRow | null) ?? null;
}

/** Decrypts the key of a loaded connection (AAD binds each blob to its user, row and column). */
export function credentialsOf(row: ConnectionRow, ring: Keyring = keyringFromEnv()): ExchangeCredentials {
  if (!row.api_key_enc || !row.secret_enc) throw new HttpError(500, "connection_incomplete", "Die Verbindung ist unvollständig. Bitte neu verbinden.");
  const creds: ExchangeCredentials = {
    apiKey: decrypt(row.api_key_enc, secretAad(row.user_id, row.id, "api_key"), ring),
    secret: decrypt(row.secret_enc, secretAad(row.user_id, row.id, "secret"), ring),
  };
  if (row.passphrase_enc) creds.passphrase = decrypt(row.passphrase_enc, secretAad(row.user_id, row.id, "passphrase"), ring);
  return creds;
}

/** True when any secret blob of the row was written with an older key version than the keyring's current one. */
export function rowNeedsReencrypt(row: Pick<ConnectionRow, "api_key_enc" | "secret_enc" | "passphrase_enc">, ring: Keyring = keyringFromEnv()): boolean {
  return [row.api_key_enc, row.secret_enc, row.passphrase_enc].some((b) => !!b && needsReencrypt(b, ring));
}

/**
 * Re-encrypts the blobs of a connection with the newest key version (lazy key rotation, review KEY-01): called after
 * every successful use of the key (sync, live positions) and by the cron's sweep (`rotateStaleConnections`), so an
 * old `EXCHANGE_ENC_KEY_V<n>` can be retired once no blob uses it. Best effort – never throws; true when rotated.
 */
export async function rotateIfNeeded(row: ConnectionRow, creds: ExchangeCredentials, ring?: Keyring): Promise<boolean> {
  try {
    const kr = ring ?? keyringFromEnv();
    if (!rowNeedsReencrypt(row, kr)) return false;
    const patch: Record<string, unknown> = {
      api_key_enc: encrypt(creds.apiKey, secretAad(row.user_id, row.id, "api_key"), kr),
      secret_enc: encrypt(creds.secret, secretAad(row.user_id, row.id, "secret"), kr),
      passphrase_enc: creds.passphrase ? encrypt(creds.passphrase, secretAad(row.user_id, row.id, "passphrase"), kr) : null,
      key_version: kr.current,
    };
    const { error } = await supabaseAdmin().from("exchange_connections").update(patch).eq("id", row.id).eq("user_id", row.user_id);
    if (error) console.error("[fn] exchange key rotation failed", error.code);
    return !error;
  } catch (e) {
    console.error("[fn] exchange key rotation failed", e instanceof Error ? e.name : "");
    return false;
  }
}

export interface RotationSweep {
  /** connections re-encrypted in this sweep */
  rotated: number;
  /** connections whose blobs could not be decrypted (unknown key version, wrong AAD) – need a reconnect */
  failed: number;
  /** connections still on an older key version after the sweep (0 = old keys can be removed) */
  remaining: number;
}

/**
 * Re-encrypts up to `limit` connections still on an older key version – also invalid, paused or switched-off ones
 * that never sync again (review KEY-01). The cron logs `remaining`; at 0 the old `EXCHANGE_ENC_KEY_V<n>` can go.
 */
export async function rotateStaleConnections(limit = 50, ring?: Keyring): Promise<RotationSweep> {
  const out: RotationSweep = { rotated: 0, failed: 0, remaining: 0 };
  let kr: Keyring;
  try {
    kr = ring ?? keyringFromEnv();
  } catch {
    return out;
  }
  const { data, error } = await supabaseAdmin()
    .from("exchange_connections")
    .select(`${CONNECTION_COLUMNS},api_key_enc,secret_enc,passphrase_enc`)
    .lt("key_version", kr.current)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[fn] exchange key sweep failed", error.code);
    return out;
  }
  for (const row of (data ?? []) as unknown as ConnectionRow[]) {
    try {
      if (await rotateIfNeeded(row, credentialsOf(row, kr), kr)) out.rotated++;
      else out.failed++;
    } catch {
      out.failed++; // never log the user or the key
    }
  }
  const left = await supabaseAdmin().from("exchange_connections").select("id").lt("key_version", kr.current).limit(10_000);
  out.remaining = left.error ? -1 : (left.data ?? []).length;
  return out;
}

export interface NewConnection {
  userId: string;
  exchange: ExchangeId;
  label: string;
  creds: ExchangeCredentials;
  journalAccount: "makro" | "scalp";
  permissions: string[];
  id?: string;
}

/** Encrypts and stores a new connection; the id is generated BEFORE encryption (it is part of the AAD). */
export async function insertConnection(c: NewConnection, ring: Keyring = keyringFromEnv()): Promise<ConnectionRow> {
  const id = c.id ?? crypto.randomUUID();
  const row = {
    id,
    user_id: c.userId,
    exchange: c.exchange,
    label: c.label,
    api_key_enc: encrypt(c.creds.apiKey, secretAad(c.userId, id, "api_key"), ring),
    secret_enc: encrypt(c.creds.secret, secretAad(c.userId, id, "secret"), ring),
    passphrase_enc: c.creds.passphrase ? encrypt(c.creds.passphrase, secretAad(c.userId, id, "passphrase"), ring) : null,
    key_version: ring.current,
    key_last4: last4(c.creds.apiKey),
    permissions: c.permissions,
    status: "active",
    journal_account: c.journalAccount,
    sync_enabled: true,
  };
  const { data, error } = await supabaseAdmin().from("exchange_connections").insert(row).select(CONNECTION_COLUMNS).single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "connection_exists", "Diese Börse ist mit diesem Namen schon verbunden.");
    throw dbFail("insert", error.code);
  }
  return data as unknown as ConnectionRow;
}

export async function updateConnection(userId: string, id: string, patch: Partial<Pick<ConnectionRow, "status" | "last_sync_at" | "last_error" | "journal_account" | "sync_enabled" | "label" | "meta">>): Promise<void> {
  const clean: Record<string, unknown> = { ...patch };
  if (typeof clean.last_error === "string") clean.last_error = (clean.last_error as string).slice(0, 300);
  const { error } = await supabaseAdmin().from("exchange_connections").update(clean).eq("user_id", userId).eq("id", id);
  if (error) throw dbFail("update", error.code);
}

export async function deleteConnection(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from("exchange_connections").delete().eq("user_id", userId).eq("id", id).select("id");
  if (error) throw dbFail("delete", error.code);
  return Array.isArray(data) && data.length > 0;
}

/* ------------------------------------------------------------------ cursor */

export interface CursorRow {
  cursor_ms: number | null;
  meta: Record<string, unknown>;
}

export async function getCursor(connectionId: string, stream: string): Promise<CursorRow | null> {
  const { data, error } = await supabaseAdmin().from("sync_cursor").select("cursor_ms,meta").eq("connection_id", connectionId).eq("stream", stream).maybeSingle();
  if (error) throw dbFail("cursor read", error.code);
  if (!data) return null;
  const r = data as { cursor_ms: number | string | null; meta: Record<string, unknown> | null };
  return { cursor_ms: r.cursor_ms === null ? null : Number(r.cursor_ms), meta: r.meta ?? {} };
}

export async function setCursor(userId: string, connectionId: string, stream: string, cursorMs: number | null, meta: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sync_cursor")
    .upsert({ connection_id: connectionId, stream, user_id: userId, cursor_ms: cursorMs, meta }, { onConflict: "connection_id,stream" });
  if (error) throw dbFail("cursor write", error.code);
}

/* ------------------------------------------------------------------ runs */

export type RunKind = "manual" | "cron" | "backfill" | "dry_run";
export type RunStatus = "running" | "ok" | "partial" | "error";

export interface RunCounts {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface RunInfo extends RunCounts {
  id: string;
  connectionId: string | null;
  exchange: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  more: boolean;
  dryRun: boolean;
}

export const RUN_COLUMNS = "id,connection_id,exchange,kind,status,started_at,finished_at,fetched,inserted,updated,unchanged,skipped,error,meta";

export function runInfo(r: Record<string, unknown>): RunInfo {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    connectionId: (r.connection_id as string | null) ?? null,
    exchange: String(r.exchange),
    kind: r.kind as RunKind,
    status: r.status as RunStatus,
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    fetched: Number(r.fetched ?? 0),
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    unchanged: Number(r.unchanged ?? 0),
    skipped: Number(r.skipped ?? 0),
    error: (r.error as string | null) ?? null,
    more: meta.more === true,
    dryRun: r.kind === "dry_run",
  };
}

export async function startRun(userId: string, connectionId: string, exchange: string, kind: RunKind, runId?: string): Promise<string> {
  const id = runId ?? crypto.randomUUID();
  const { error } = await supabaseAdmin().from("sync_runs").insert({ id, user_id: userId, connection_id: connectionId, exchange, kind, status: "running" });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "run_exists", "Dieser Import läuft bereits.");
    throw dbFail("run start", error.code);
  }
  return id;
}

export async function finishRun(
  userId: string,
  id: string,
  status: RunStatus,
  counts: RunCounts,
  extra: { error?: string | null; windowFrom?: number; windowTo?: number; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status, finished_at: new Date().toISOString(), ...counts, error: extra.error ? extra.error.slice(0, 300) : null };
  if (extra.windowFrom) patch.window_from = new Date(extra.windowFrom).toISOString();
  if (extra.windowTo) patch.window_to = new Date(extra.windowTo).toISOString();
  if (extra.meta) patch.meta = extra.meta;
  const { error } = await supabaseAdmin().from("sync_runs").update(patch).eq("user_id", userId).eq("id", id);
  if (error) console.error("[fn] exchange run finish failed", error.code);
}

export async function recentRuns(userId: string, limit = 10): Promise<RunInfo[]> {
  const { data, error } = await supabaseAdmin().from("sync_runs").select(RUN_COLUMNS).eq("user_id", userId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw dbFail("runs", error.code);
  return ((data ?? []) as Record<string, unknown>[]).map(runInfo);
}

/** A running run of this connection that started within `withinMs` (no two syncs of one connection at a time). */
export async function runningRun(userId: string, connectionId: string, withinMs: number, now = Date.now()): Promise<RunInfo | null> {
  const { data, error } = await supabaseAdmin()
    .from("sync_runs")
    .select(RUN_COLUMNS)
    .eq("user_id", userId)
    .eq("connection_id", connectionId)
    .eq("status", "running")
    .gte("started_at", new Date(now - withinMs).toISOString())
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw dbFail("running run", error.code);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  return r ? runInfo(r) : null;
}

/* ------------------------------------------------------------------ journal */

export type UpsertResult = "inserted" | "updated" | "unchanged" | "deleted";
export interface UpsertItem {
  id: string;
  set: Record<string, unknown>;
  fill: Record<string, unknown>;
  new: Record<string, unknown>;
}

const UPSERT_CHUNK = 100;

/** Writes synced trades through `upsert_synced_trades` (only exchange fields of existing records change). */
export async function upsertSyncedTrades(userId: string, items: readonly UpsertItem[]): Promise<Record<string, UpsertResult>> {
  const out: Record<string, UpsertResult> = {};
  for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
    const chunk = items.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await supabaseAdmin().rpc("upsert_synced_trades", { p_user: userId, p_items: chunk });
    if (error) throw dbFail("upsert", error.code);
    Object.assign(out, (data ?? {}) as Record<string, UpsertResult>);
  }
  return out;
}

export interface PulledTrade {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

/** Origins the server writes (exchange sync, TradingView webhook, REST API) – what the pull delivers. */
export const SERVER_ORIGINS = ["api", "webhook", "bot"] as const;

/* ------------------------------------------------------------------ keyset pages over journal_docs */

/**
 * Position in a page walk over `journal_docs` ordered by `(updated_at, id)`. `updated_at` is `now()` of the writing
 * transaction, so every record of one `upsert_synced_trades` chunk (100) shares ONE timestamp: a cursor on the
 * timestamp alone either skips the rest of such a group (`gt`) or returns the same page forever. `id` breaks the tie;
 * `ts` is kept as the raw microsecond string the database returned (a JS Date would cut it to milliseconds).
 */
export interface PageCursor {
  ts: string;
  /** Null for a plain point in time (`?since=<ISO>`): everything changed strictly after it. */
  id: string | null;
}

const CURSOR_PREFIX = "c1.";
/** A timestamp as PostgREST renders `timestamptz` (or as a client sends it): safe to pass to a filter verbatim. */
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/** The opaque `next` value of a page (`c1.` + base64url of `<updated_at>|<id>`); URL-safe without encoding. */
export function encodeCursor(c: { ts: string; id: string }): string {
  return CURSOR_PREFIX + Buffer.from(`${c.ts}|${c.id}`, "utf8").toString("base64url");
}

/**
 * Reads a `since` parameter: an opaque cursor from `next`, or a plain point in time (ISO 8601). Undefined when it is
 * neither (→ 400); null when absent.
 */
export function parseCursor(raw: string | null): PageCursor | null | undefined {
  if (raw === null || raw === "") return null;
  if (raw.startsWith(CURSOR_PREFIX)) {
    let plain: string;
    try {
      plain = Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    } catch {
      return undefined;
    }
    const cut = plain.indexOf("|");
    if (cut < 0) return undefined;
    const ts = plain.slice(0, cut);
    const id = plain.slice(cut + 1);
    if (!TS_RE.test(ts) || !id || id.length > 200) return undefined;
    return { ts, id };
  }
  // a `+00:00` offset that arrived unencoded in a query string reads as a space
  const iso = raw.replace(/ (\d{2}(?::?\d{2})?)$/, "+$1");
  if (TS_RE.test(iso)) return { ts: iso, id: null };
  if (Number.isNaN(Date.parse(iso))) return undefined;
  return { ts: new Date(iso).toISOString(), id: null };
}

interface DocRow {
  id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

/**
 * One page of the user's live trade records after `cursor`, ordered by `(updated_at, id)`: first the rest of the
 * cursor's timestamp group (`updated_at = ts and id > cursor.id`), then everything newer. `next` is the cursor of the
 * last row (null for an empty page), `more` when the page is full.
 */
export async function tradeDocPage(
  userId: string,
  cursor: PageCursor | null,
  limit: number,
  opts: { origins?: readonly string[]; what?: string } = {},
): Promise<{ rows: DocRow[]; more: boolean; next: string | null }> {
  const base = () => {
    let q = supabaseAdmin().from("journal_docs").select("id,data,updated_at").eq("user_id", userId).eq("kind", "trade").eq("deleted", false);
    if (opts.origins) q = q.in("data->origin->>kind", [...opts.origins]);
    return q;
  };
  const rows: DocRow[] = [];
  if (cursor?.id) {
    const { data, error } = await base().eq("updated_at", cursor.ts).gt("id", cursor.id).order("id", { ascending: true }).limit(limit);
    if (error) throw dbFail(opts.what ?? "page", error.code);
    rows.push(...((data ?? []) as DocRow[]));
  }
  if (rows.length < limit) {
    let q = base();
    if (cursor) q = q.gt("updated_at", cursor.ts);
    const { data, error } = await q.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit - rows.length);
    if (error) throw dbFail(opts.what ?? "page", error.code);
    rows.push(...((data ?? []) as DocRow[]));
  }
  const last = rows[rows.length - 1];
  return { rows, more: rows.length >= limit, next: last ? encodeCursor({ ts: last.updated_at, id: last.id }) : null };
}

/**
 * Server-written trades (exchange sync, webhook, REST) changed after `cursor`, oldest change first – for signed-in
 * devices whose cloud sync is off: they merge these locally. `limit` ≤ 500; `more` when the page is full; `next` is
 * the cursor of the following page (keep it as the pull mark).
 */
export async function pullSyncedTrades(
  userId: string,
  cursor: PageCursor | null,
  limit = 500,
): Promise<{ trades: PulledTrade[]; more: boolean; next: string | null }> {
  const page = await tradeDocPage(userId, cursor, limit, { origins: SERVER_ORIGINS, what: "pull" });
  return { trades: page.rows.map((r) => ({ id: r.id, data: r.data, updatedAt: r.updated_at })), more: page.more, next: page.next };
}

/** The user's time zone (`profiles.tz`), or null. */
export async function profileTz(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("profiles").select("tz").eq("id", userId).maybeSingle();
  if (error) return null;
  const tz = (data as { tz?: unknown } | null)?.tz;
  return typeof tz === "string" ? tz : null;
}
