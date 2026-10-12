/**
 * Scheduled (every 30 min, published deploys only): automatic exchange sync (P11). Takes the active connections that
 * waited longest, skips those synced in the last 20 min, those whose plan lacks `exchangeSync` (unless payments are not
 * set up) and those with a sync running; each gets ≤ 8 s, the whole run ≤ 24 s (scheduled functions stop at 30 s).
 * Unfinished windows resume on the next run. Off with `SYNC_CRON_ENABLED=0`; inert without `EXCHANGE_ENC_KEY_V1`.
 */
import type { Config } from "@netlify/functions";
import { planIncludes } from "../../src/billing/plans";
import { errorFrom, json } from "./_lib/http";
import { paymentsConfigured, planOf } from "./_lib/plan";
import { supabaseAdmin } from "./_lib/supabase";
import { cronEnabled } from "./_lib/exchanges/api";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { CONNECTION_COLUMNS, loadConnection, profileTz, runningRun, type ConnectionRow } from "./_lib/exchanges/store";
import { runSync } from "./_lib/exchanges/sync";

export const CRON_TOTAL_MS = 24_000;
export const CRON_PER_CONNECTION_MS = 8_000;
export const CRON_MIN_GAP_MS = 20 * 60_000;
export const CRON_BATCH = 40;

export interface CronSummary {
  enabled: boolean;
  considered: number;
  synced: number;
  skipped: number;
  failed: number;
}

export async function runExchangeCron(now = Date.now()): Promise<CronSummary> {
  const summary: CronSummary = { enabled: cronEnabled(), considered: 0, synced: 0, skipped: 0, failed: 0 };
  if (!summary.enabled) return summary;
  const end = now + CRON_TOTAL_MS;
  const { data, error } = await supabaseAdmin()
    .from("exchange_connections")
    .select(CONNECTION_COLUMNS)
    .eq("status", "active")
    .eq("sync_enabled", true)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(CRON_BATCH);
  if (error) throw new Error(`connections: ${error.code}`);
  const gated = paymentsConfigured();
  for (const meta of (data ?? []) as unknown as ConnectionRow[]) {
    if (Date.now() >= end - 1_000) break;
    summary.considered++;
    try {
      if (meta.last_sync_at && now - Date.parse(meta.last_sync_at) < CRON_MIN_GAP_MS) {
        summary.skipped++;
        continue;
      }
      if (gated && !planIncludes((await planOf(meta.user_id)).plan, "exchangeSync")) {
        summary.skipped++;
        continue;
      }
      if (await runningRun(meta.user_id, meta.id, 2 * 60_000)) {
        summary.skipped++;
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
    } catch {
      // recorded in sync_runs / last_error by runSync; never log the user or the key
      summary.failed++;
    }
  }
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
