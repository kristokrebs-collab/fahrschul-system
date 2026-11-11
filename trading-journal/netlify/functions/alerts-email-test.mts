/**
 * POST /api/v1/alerts/email-test – the test mail of the four alarms' E-Mail channel (C2): ONE mail to the account's own confirmed address,
 * in the account's language, logged in the Zustellprotokoll (kind `test`). Not gated by a plan feature – the E-Mail channel is counted by the plan's
 * `alertChannels`, and a test must work before the channel is switched on. (`/api/v1/alerts/test` stays the status and test of the key-level summary mail.)
 *
 * Guards: signed in (aal2 if 2FA), 3 mails / 10 min and 10 / day per account (fail-closed), 503 `alerts_unavailable` without `RESEND_API_KEY` + `ALERT_FROM`,
 * 422 / 409 without a confirmed address. The recipient is read from Supabase Auth by user id – never from the request, never logged.
 */
import type { Config } from "@netlify/functions";
import { alertPrefsOf } from "../../src/domain/alerts/config";
import { requireUser } from "./_lib/auth";
import { appOrigin, mailConfig, sendMail, SEND_MESSAGE } from "./_lib/alertWatch/mail";
import { formatLocal, safeTz } from "./_lib/alertWatch/clock";
import { recipientOf } from "./_lib/alertWatch/recipient";
import { logEmailDelivery } from "./_lib/alerts/log";
import { handler, HttpError, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

export default handler(async (req) => {
  requireMethod(req, "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const cfg = mailConfig();
  if (!cfg) throw new HttpError(503, "alerts_unavailable", "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.");
  await enforceRateLimit(rateKey("alerts-email-test", user.id), 3, 600, { failClosed: true });
  await enforceRateLimit(rateKey("alerts-email-test-day", user.id), 10, 86_400, { failClosed: true });
  const rcpt = await recipientOf(user.id);
  if (!rcpt) throw new HttpError(422, "no_email", "Zu deinem Konto gehört keine E-Mail-Adresse.");
  if (!rcpt.confirmed) throw new HttpError(409, "email_unconfirmed", "Bitte bestätige zuerst die E-Mail-Adresse deines Kontos.");
  const sb = supabaseAdmin();
  const [prefs, profile] = await Promise.all([sb.from("alert_prefs").select("prefs").eq("user_id", user.id).maybeSingle(), sb.from("profiles").select("tz").eq("id", user.id).maybeSingle()]);
  const lang = alertPrefsOf((prefs.data as { prefs?: unknown } | null)?.prefs).lang;
  const tz = safeTz((profile.data as { tz?: unknown } | null)?.tz);
  const when = `${formatLocal(Date.now(), tz)} (${tz})`;
  const app = appOrigin();
  const text =
    lang === "en"
      ? [`This is a test mail of your alerts. Sent: ${when}.`, "If you read it, the server can reach you.", ...(app ? ["", `To the app: ${app}/#settings`] : []), "", "No professional financial advice."].join("\n")
      : [`Das ist eine Testmail deiner Alarme. Gesendet: ${when}.`, "Wenn du sie liest, kann der Server dich erreichen.", ...(app ? ["", `Zur App: ${app}/#settings`] : []), "", "Keine professionelle Finanzberatung."].join("\n");
  const sent = await sendMail(cfg, { to: rcpt.email, subject: lang === "en" ? "Test mail – alerts" : "Testmail – Alarme", text });
  await logEmailDelivery(user.id, "test", sent.ok ? { ok: true, ref: sent.id } : { ok: false, code: sent.code });
  if (!sent.ok) {
    console.error("[fn] alerts-email-test send failed", sent.code);
    throw new HttpError(502, "alerts_send_failed", SEND_MESSAGE[sent.code], { reason: sent.code });
  }
  return json({ sent: true });
});

export const config: Config = { path: "/api/v1/alerts/email-test", method: ["POST"] };
