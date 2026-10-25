/**
 * Scheduled (every 5 min, published deploys only): E-Mail-Alarm bei geschlossener App (F21). Watches the key-level alerts
 * of every account that switched "E-Mail-Alarm" on – the same pure watch core as the browser (`src/domain/keylevels/watch.ts`) –
 * and mails ONE summary per account when something fired (active hours, daily limit and a gap between mails apply).
 * Logic, caps and the exactly-once protocol: `_lib/alertWatch/run.ts`.
 *
 * Needs `RESEND_API_KEY` and `ALERT_FROM` (Netlify env, secret, scope Functions) and migration 0008; without the two env
 * values the run does nothing and the app shows "Einrichtung nötig". No account with the switch on → one query, nothing
 * else (no standing load). The log line has counts and codes only.
 */
import type { Config } from "@netlify/functions";
import { runAlertWatch } from "./_lib/alertWatch/run";
import { errorFrom, json } from "./_lib/http";

export default async (): Promise<Response> => {
  try {
    const summary = await runAlertWatch();
    console.log("[fn] alert-watch-cron", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "*/5 * * * *" };
