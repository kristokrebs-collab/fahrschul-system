/**
 * Emergency switches (C4 Betrieb, Runde 11: five): environment flags the operator flips in Netlify (Site settings → Environment
 * variables → set to `true`, then trigger a new deploy: Netlify applies changed variables to functions with the next
 * deploy – the app cannot confirm that sooner, `/api/v1/ops/status` shows what the RUNNING functions see) to stop one
 * area without touching code:
 *
 * | flag            | stops                                                                                      |
 * |-----------------|--------------------------------------------------------------------------------------------|
 * | `KILL_SYNC`     | Börsen-Sync (connect, manual sync, positions, backfill, cron). The browser journal keeps working locally |
 * | `KILL_CALLS`    | every phone call (Twilio) – `assertRunning("calls")` is the first line of the call path         |
 * | `KILL_AI`       | every KI call (Coach wording, Screenshot-Import, Strategie-Übersetzer, Assistent)               |
 * | `KILL_CHECKOUT` | NEW purchases (billing-checkout). Existing subscriptions, the customer portal and the webhook keep running |
 * | `KILL_MAIL`     | every outgoing e-mail (Resend): alarm mails, test mails, the confirmation mails of cancellation / withdrawal. Alarms are logged "Übersprungen: Notschalter (E-Mail)" |
 *
 * A stopped area answers 503 `switched_off` with a German sentence – never a silent success. The state is visible to the
 * operator in `/api/v1/ops/status` (`switches`). Unset or any other value = running.
 */
import { envBool, type ServerEnvName } from "./env";
import { HttpError } from "./http";

export type Switch = "sync" | "calls" | "ai" | "checkout" | "mail";

const FLAG: Readonly<Record<Switch, ServerEnvName>> = { sync: "KILL_SYNC", calls: "KILL_CALLS", ai: "KILL_AI", checkout: "KILL_CHECKOUT", mail: "KILL_MAIL" };

const TEXT: Readonly<Record<Switch, string>> = {
  sync: "Der Sync ist gerade abgeschaltet. Dein Journal bleibt in diesem Browser, nichts geht verloren.",
  calls: "Anrufe sind gerade abgeschaltet.",
  ai: "Die KI-Funktionen sind gerade abgeschaltet. Alles andere in der App rechnet weiter wie gewohnt.",
  checkout: "Neue Käufe sind gerade pausiert. Bestehende Abos und das Kundenportal funktionieren weiter.",
  mail: "E-Mails werden gerade nicht verschickt.",
};

/** True while the operator has this area switched off. */
export function killed(s: Switch): boolean {
  return envBool(FLAG[s], false);
}

/** Throws 503 `switched_off` (German text) while the area is switched off. */
export function assertRunning(s: Switch): void {
  if (killed(s)) throw new HttpError(503, "switched_off", TEXT[s], { switch: s });
}

/** All states (true = switched OFF). */
export function switchStates(): Record<Switch, boolean> {
  return { sync: killed("sync"), calls: killed("calls"), ai: killed("ai"), checkout: killed("checkout"), mail: killed("mail") };
}
