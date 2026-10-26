/**
 * Database access of the e-mail alarm (service role, migration 0008): which accounts to look at, a guarded write of
 * `settings.serverAlerts`, and the one-row heartbeat of the cron (`app_config` key `alert-watch`) the app shows as
 * "zuletzt geprüft". Errors carry codes only – never a row, never an address.
 */
import { supabaseAdmin } from "../supabase";

/** One account that switched the alarm on. */
export interface WatchRow {
  userId: string;
  /** `rev` of the settings row when it was read (the optimistic lock of the write) */
  rev: number;
  keyLevels: unknown;
  serverAlerts: unknown;
  tz: string;
}

/** The database misses migration 0008 (function not found). */
export class MigrationMissing extends Error {
  constructor() {
    super("alert_watch migration missing");
    this.name = "MigrationMissing";
  }
}

const NO_FUNCTION = new Set(["42883", "PGRST202", "PGRST204"]);

function rowOf(r: Record<string, unknown>): WatchRow | null {
  if (typeof r.user_id !== "string" || typeof r.rev !== "number") return null;
  return { userId: r.user_id, rev: r.rev, keyLevels: r.key_levels ?? null, serverAlerts: r.server_alerts ?? null, tz: typeof r.tz === "string" ? r.tz : "" };
}

/** Accounts with the switch on (`limit` ≤ 500), in the order `salt` gives; `userId` re-reads one account. */
export async function listWatchRows(opts: { limit: number; salt: string; userId?: string }): Promise<WatchRow[]> {
  const { data, error } = await supabaseAdmin().rpc("alert_watch_candidates", { p_limit: opts.limit, p_salt: opts.salt, p_user: opts.userId ?? null });
  if (error) {
    if (error.code && NO_FUNCTION.has(error.code)) throw new MigrationMissing();
    throw new Error(`candidates: ${error.code ?? "failed"}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(rowOf).filter((r): r is WatchRow => r != null);
}

/** Replaces `data.serverAlerts` if the row is still at `expectedRev`. The new `rev`, or `null` when somebody wrote first. */
export async function writeServerAlerts(userId: string, expectedRev: number, value: Record<string, unknown>): Promise<number | null> {
  const { data, error } = await supabaseAdmin().rpc("set_server_alerts", { p_user: userId, p_expected_rev: expectedRev, p_value: value });
  if (error) {
    if (error.code && NO_FUNCTION.has(error.code)) throw new MigrationMissing();
    throw new Error(`write: ${error.code ?? "failed"}`);
  }
  return typeof data === "number" ? data : null;
}

// ------------------------------------------------------------------------------------------ heartbeat

export const HEARTBEAT_KEY = "alert-watch";

/** What the last cron run reports (counts and codes only). */
export interface Heartbeat {
  /** ms, end of the run */
  at: number;
  ok: boolean;
  /** why not: `migration`, `binance_451`, `binance_down`, `db` */
  code: string | null;
  accounts: number;
  symbols: number;
  mails: number;
  /** `binance` or `proxy` */
  source: string | null;
}

const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST200"]);

export async function saveHeartbeat(h: Heartbeat): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("app_config").upsert({ key: HEARTBEAT_KEY, value: h, updated_at: new Date(h.at).toISOString() }, { onConflict: "key" });
    if (error && !(error.code && MISSING_TABLE.has(error.code))) console.error("[fn] alert-watch heartbeat failed", error.code ?? "");
  } catch (e) {
    console.error("[fn] alert-watch heartbeat failed", e instanceof Error ? e.name : typeof e);
  }
}

/** The last heartbeat, or `null` (none yet, or no `app_config` table). */
export async function loadHeartbeat(): Promise<Heartbeat | null> {
  try {
    const { data, error } = await supabaseAdmin().from("app_config").select("value").eq("key", HEARTBEAT_KEY).maybeSingle();
    if (error || !data) return null;
    const v = (data as { value?: unknown }).value;
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.at !== "number") return null;
    return {
      at: o.at,
      ok: o.ok === true,
      code: typeof o.code === "string" ? o.code : null,
      accounts: typeof o.accounts === "number" ? o.accounts : 0,
      symbols: typeof o.symbols === "number" ? o.symbols : 0,
      mails: typeof o.mails === "number" ? o.mails : 0,
      source: typeof o.source === "string" ? o.source : null,
    };
  } catch {
    return null;
  }
}
