/**
 * Scheduled (@daily, published deploys only): nightly cloud backup of every journal that changed, into the private
 * `backups` bucket (`backups/<user id>/<YYYY-MM-DD>.json`, 14 days, the newest always kept), plus the 30-day purge of
 * `app_errors`. Logic in `_lib/account.ts` `runNightlyBackup`. Users restore a backup in Konto → Daten
 * (`/api/v1/account/backups`).
 */
import type { Config } from "@netlify/functions";
import { runNightlyBackup } from "./_lib/account";
import { errorFrom, json } from "./_lib/http";

export default async (): Promise<Response> => {
  try {
    const result = await runNightlyBackup();
    console.log("[fn] backup-nightly", JSON.stringify(result));
    return json(result);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "@daily" };
