/**
 * Scheduled (every 5 min, published deploys only): the four alarms (C2). One run does three things in a fixed order:
 *
 *   1. LOOK     `runAlerts`  – read the sources that are due, decide events (pure engine), write events + deliveries + jobs
 *   2. DELIVER  `runWorker`  – take due jobs (lease), send the mail / dial the call; retry with back-off, dead letter after the last try
 *   3. SETTLE   `reconcileCalls` – ask Twilio for calls whose status callback did not arrive; once a day the housekeeping (`alert_prune`)
 *
 * A run that stops anywhere is safe to repeat: events are deduplicated by their key, jobs by their lease, an e-mail by its idempotency key and
 * a call by its commitment (`dialed_at`) – see `_lib/alerts/run.ts` and `deliver.ts`. Next to (not instead of) `alert-watch-cron` (the key-level
 * e-mail summary). Needs migration 0014; without it the run says `migration` in its log and does nothing. Off with `ALERTS_CRON_ENABLED=0`.
 * No account with a source on → one query and nothing else. The log line has counts and codes only.
 */
import type { Config } from "@netlify/functions";
import { appOrigin } from "./_lib/alertWatch/mail";
import { defaultDeliverDeps, emptyWorkerSummary, reconcileCalls, runWorker, type WorkerSummary } from "./_lib/alerts/deliver";
import { defaultLoaders } from "./_lib/alerts/loaders";
import { runAlerts, type RunSummary } from "./_lib/alerts/run";
import { AlertsMigrationMissing, supabaseAlertStore } from "./_lib/alerts/store";
import { envBool } from "./_lib/env";
import { errorFrom, json } from "./_lib/http";

export interface AlertsCronSummary {
  enabled: boolean;
  look: RunSummary | null;
  deliver: WorkerSummary | null;
  code: string | null;
}

export async function runAlertsCron(): Promise<AlertsCronSummary> {
  if (!envBool("ALERTS_CRON_ENABLED", true)) return { enabled: false, look: null, deliver: null, code: null };
  const store = supabaseAlertStore();
  const appUrl = appOrigin();
  const loaders = defaultLoaders({ now: () => Date.now(), proxyBase: appUrl ? `${appUrl}/api/binance` : null });
  const look = await runAlerts({ store, loaders });
  if (look.code === "migration") return { enabled: true, look, deliver: null, code: "migration" };
  let deliver = emptyWorkerSummary();
  let code: string | null = look.code;
  try {
    const deps = defaultDeliverDeps(store);
    deliver = await runWorker(deps);
    await reconcileCalls(deps, deliver);
    const now = new Date();
    if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) await store.prune();
  } catch (e) {
    code = e instanceof AlertsMigrationMissing ? "migration" : "db";
    console.error("[fn] alerts-cron deliver failed", code);
  }
  return { enabled: true, look, deliver, code };
}

export default async (): Promise<Response> => {
  try {
    const summary = await runAlertsCron();
    console.log("[fn] alerts-cron", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "*/5 * * * *" };
