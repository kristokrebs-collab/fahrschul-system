/**
 * /api/v1/alerts/test – the small companion of the e-mail alarm (F21, `alert-watch-cron.mts`).
 *
 *   GET   → `{ configured, entitled, hasEmail, emailConfirmed, lastRun, intervalMin }` – what the Alarme card shows:
 *           whether the server can mail at all (`RESEND_API_KEY` + `ALERT_FROM` set), whether the plan includes the
 *           alarm, whether the account has a confirmed address, and the heartbeat of the last cron run
 *           (`{ at, ok, code, accounts, symbols, mails, source }`, counts and codes only). The address itself is never sent.
 *   POST  → sends ONE test mail to the account's own confirmed address → `{ sent: true }`.
 *
 * Guards: signed in (aal2 if 2FA), plan feature `boxScanner` for the test mail (the gate of the alarm; open while payments
 * are not set up), 3 test mails / 10 min and 10 / day per account (fail-closed), 503 `alerts_unavailable` without the
 * server env. The recipient is read from Supabase Auth by user id – never from the request, never logged.
 */
import type { Config } from "@netlify/functions";
import { planIncludes } from "../../src/billing/plans";
import { requireUser } from "./_lib/auth";
import { safeTz } from "./_lib/alertWatch/clock";
import { appOrigin, buildTestMail, mailConfig, sendMail, SEND_MESSAGE } from "./_lib/alertWatch/mail";
import { recipientOf } from "./_lib/alertWatch/recipient";
import { loadHeartbeat } from "./_lib/alertWatch/store";
import { handler, HttpError, json, requireMethod } from "./_lib/http";
import { paymentsConfigured, planOf, requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

export const NOT_CONFIGURED_MESSAGE = "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.";

async function tzOf(userId: string): Promise<string> {
  const { data } = await supabaseAdmin().from("profiles").select("tz").eq("id", userId).maybeSingle();
  return safeTz((data as { tz?: unknown } | null)?.tz);
}

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });

  if (req.method.toUpperCase() === "GET") {
    await enforceRateLimit(rateKey("alert-status", user.id), 60, 600);
    const [plan, rcpt, lastRun] = await Promise.all([planOf(user.id), recipientOf(user.id), loadHeartbeat()]);
    return json({
      configured: mailConfig() !== null,
      entitled: !paymentsConfigured() || planIncludes(plan.plan, "boxScanner"),
      hasEmail: rcpt !== null,
      emailConfirmed: rcpt?.confirmed ?? false,
      lastRun,
      intervalMin: 5,
    });
  }

  await requireFeature(user.id, "boxScanner");
  const cfg = mailConfig();
  if (!cfg) throw new HttpError(503, "alerts_unavailable", NOT_CONFIGURED_MESSAGE);
  await enforceRateLimit(rateKey("alert-test", user.id), 3, 600, { failClosed: true });
  await enforceRateLimit(rateKey("alert-test-day", user.id), 10, 86_400, { failClosed: true });
  const rcpt = await recipientOf(user.id);
  if (!rcpt) throw new HttpError(422, "no_email", "Zu deinem Konto gehört keine E-Mail-Adresse.");
  if (!rcpt.confirmed) throw new HttpError(409, "email_unconfirmed", "Bitte bestätige zuerst die E-Mail-Adresse deines Kontos.");
  const now = Date.now();
  const content = buildTestMail({ now, tz: await tzOf(user.id), appUrl: appOrigin() });
  const sent = await sendMail(cfg, { to: rcpt.email, ...content });
  if (!sent.ok) {
    console.error("[fn] alert-test send failed", sent.code);
    throw new HttpError(502, "alerts_send_failed", SEND_MESSAGE[sent.code], { reason: sent.code });
  }
  return json({ sent: true });
});

export const config: Config = { path: "/api/v1/alerts/test", method: ["GET", "POST"] };
