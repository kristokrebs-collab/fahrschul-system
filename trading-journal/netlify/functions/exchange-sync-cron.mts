/**
 * Scheduled (every 30 min, published deploys only): automatic exchange sync (P11). Takes the active connections that
 * are due (`next_sync_at`, 0006), skips those synced in the last 20 min, those whose plan lacks `exchangeSync` (unless
 * payments are not set up) and those with a sync running; each gets ≤ 8 s, the whole run ≤ 24 s (scheduled functions
 * stop at 30 s). Unfinished windows resume on the next run. Off with `SYNC_CRON_ENABLED=0`; inert without
 * `EXCHANGE_ENC_KEY_V1`.
 *
 * Fair queue (review SYNC-01): every attempt writes the connection's next turn – synced → next run, failing → back-off
 * (20 min · 2^(n−1), ≤ 12 h), plan without auto-sync → in 6 h – so connections that keep failing or whose trial ended
 * can no longer hold the 40 places of the batch while paying traders wait. Without migration 0006 the cron falls back
 * to the old order by `last_sync_at`.
 *
 * Key rotation (review KEY-01): after the syncs, up to 50 connections still encrypted with an older
 * `EXCHANGE_ENC_KEY_V<n>` are re-encrypted with the newest one (also invalid or switched-off ones); the logged summary
 * (`keys.remaining`) says when the old key can be removed. Since Runde 11 the sweep also covers the encrypted phone numbers and the TradingView-MCP
 * tokens (same key family, `_lib/keyRotation.ts`) – `remaining = 0` now really means that nothing needs the old key any more.
 */
import type { Config } from "@netlify/functions";
import { autoSyncAllowed, limitOf } from "../../src/billing/plans";
import { errorFrom, json } from "./_lib/http";
import { gatesOpen, planOf } from "./_lib/plan";
import { supabaseAdmin } from "./_lib/supabase";
import { cronEnabled } from "./_lib/exchanges/api";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { CONNECTION_COLUMNS, listConnections, loadConnection, profileTz, runningRun, type ConnectionRow, type RotationSweep } from "./_lib/exchanges/store";
import { rotateAllStaleSecrets } from "./_lib/keyRotation";
import { runSync } from "./_lib/exchanges/sync";
import { killed } from "./_lib/killswitch";

export const CRON_TOTAL_MS = 24_000;
export const CRON_PER_CONNECTION_MS = 8_000;
export const CRON_MIN_GAP_MS = 20 * 60_000;
export const CRON_BATCH = 40;
/** Connections re-encrypted per run by the key rotation sweep. */
export const CRON_ROTATE_BATCH = 50;
/** A connection whose plan has no auto-sync is looked at again after this long. */
export const CRON_PLAN_RECHECK_MS = 6 * 60 * 60_000;
/** Longest back-off of a connection that keeps failing. */
export const CRON_MAX_BACKOFF_MS = 12 * 60 * 60_000;

export interface CronSummary {
  enabled: boolean;
  considered: number;
  synced: number;
  skipped: number;
  failed: number;
  /** key rotation sweep (review KEY-01): re-encrypted / undecryptable / still on an older key version */
  keys?: RotationSweep;
}

/** A connection row as the cron reads it (0006 adds the schedule columns). */
type CronRow = ConnectionRow & { next_sync_at?: string | null; sync_failures?: number | null };

/** Delay before the next attempt after `failures` failures in a row (1 → 20 min, 2 → 40 min, …, ≤ 12 h). */
export function backoffMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(CRON_MAX_BACKOFF_MS, CRON_MIN_GAP_MS * 2 ** Math.min(n - 1, 16));
}

/** Postgres "undefined column": migration 0006 is not applied yet. */
const UNDEFINED_COLUMN = "42703";

async function dueConnections(): Promise<{ rows: CronRow[]; scheduled: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from("exchange_connections")
    .select(`${CONNECTION_COLUMNS},next_sync_at,sync_failures`)
    .eq("status", "active")
    .eq("sync_enabled", true)
    .order("next_sync_at", { ascending: true, nullsFirst: true })
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(CRON_BATCH);
  if (!error) return { rows: (data ?? []) as unknown as CronRow[], scheduled: true };
  if (error.code !== UNDEFINED_COLUMN) throw new Error(`connections: ${error.code}`);
  const legacy = await supabaseAdmin()
    .from("exchange_connections")
    .select(CONNECTION_COLUMNS)
    .eq("status", "active")
    .eq("sync_enabled", true)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(CRON_BATCH);
  if (legacy.error) throw new Error(`connections: ${legacy.error.code}`);
  return { rows: (legacy.data ?? []) as unknown as CronRow[], scheduled: false };
}

/**
 * The ids of the connections a plan syncs in the BACKGROUND (`backgroundSyncConnections`: Pro 1, Premium / Team 5): the oldest active ones
 * with the automatic sync switched on, up to the plan's number. The cron used to check only "may this plan sync at all", so a Pro account
 * with several connections (a race at connect, a downgrade) had them all synced (Runde 11, Linse 1 #4).
 */
async function backgroundAllowedIds(userId: string, limit: number): Promise<Set<string>> {
  const rows = (await listConnections(userId)).filter((c) => c.status === "active" && c.sync_enabled !== false);
  rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id));
  return new Set(rows.slice(0, Math.max(0, limit)).map((c) => c.id));
}

/** Writes the connection's next turn (best effort: a failed write only costs fairness, never the run). */
async function schedule(row: CronRow, nextAt: number, failures: number): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("exchange_connections")
    .update({ next_sync_at: new Date(nextAt).toISOString(), sync_failures: Math.min(failures, 32_000) })
    .eq("user_id", row.user_id)
    .eq("id", row.id);
  if (error) console.error("[fn] exchange-sync-cron schedule failed", error.code ?? "");
}

export async function runExchangeCron(now = Date.now()): Promise<CronSummary> {
  const summary: CronSummary = { enabled: cronEnabled() && !killed("sync"), considered: 0, synced: 0, skipped: 0, failed: 0 };
  if (!summary.enabled) return summary;
  const end = now + CRON_TOTAL_MS;
  const { rows, scheduled } = await dueConnections();
  const plan = scheduled ? schedule : async () => undefined;
  const gated = !gatesOpen();
  for (const meta of rows) {
    if (Date.now() >= end - 1_000) break;
    summary.considered++;
    const failures = Math.max(0, Number(meta.sync_failures) || 0);
    try {
      // not due yet (ordered last, so only seen when fewer than a batch are due)
      if (meta.next_sync_at && Date.parse(meta.next_sync_at) > now) {
        summary.skipped++;
        continue;
      }
      if (meta.last_sync_at && now - Date.parse(meta.last_sync_at) < CRON_MIN_GAP_MS) {
        summary.skipped++;
        await plan(meta, Date.parse(meta.last_sync_at) + CRON_MIN_GAP_MS, failures);
        continue;
      }
      if (gated) {
        const info = await planOf(meta.user_id);
        // the plan has no background sync, or this connection is beyond the number the plan allows
        const allowed = autoSyncAllowed(info.plan) && (await backgroundAllowedIds(meta.user_id, limitOf(info.plan, "backgroundSyncConnections"))).has(meta.id);
        if (!allowed) {
          summary.skipped++;
          await plan(meta, now + CRON_PLAN_RECHECK_MS, failures);
          continue;
        }
      }
      if (await runningRun(meta.user_id, meta.id, 2 * 60_000)) {
        summary.skipped++;
        await plan(meta, now + CRON_MIN_GAP_MS, failures);
        continue;
      }
      const connection = await loadConnection(meta.user_id, meta.id);
      if (!connection) {
        summary.skipped++;
        continue;
      }
      const tz = (await profileTz(meta.user_id)) ?? DEFAULT_TZ;
      await runSync({ userId: meta.user_id, connection, kind: "cron", dryRun: false, tz, deadline: Math.min(end, Date.now() + CRON_PER_CONNECTION_MS) });
      summary.synced++;
      await plan(meta, now + CRON_MIN_GAP_MS, 0);
    } catch {
      // recorded in sync_runs / last_error by runSync; never log the user or the key
      summary.failed++;
      await plan(meta, now + backoffMs(failures + 1), failures + 1);
    }
  }
  // key rotation (review KEY-01): connections still on an older EXCHANGE_ENC_KEY_V<n> – also invalid or switched-off
  // ones that never sync again – move to the newest key; the log shows how many are left (0 → the old key can go)
  if (Date.now() < end) summary.keys = await rotateAllStaleSecrets(CRON_ROTATE_BATCH);
  return summary;
}

export default async (): Promise<Response> => {
  try {
    const summary = await runExchangeCron();
    console.log("[fn] exchange-sync-cron", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "*/30 * * * *" };
