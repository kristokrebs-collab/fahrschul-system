/**
 * /api/v1/alerts/prefs – the settings of the four alarms (C2).
 *
 *   GET → `{ prefs, plan, limits, tz, email, phone, lastRun }` – everything the settings card shows: the stored settings (all-off default for a
 *         new account), the plan's limits (`alertChannels`, `phoneCallsPerMonth`, from `src/billing/plans.ts`), whether the server can mail /
 *         call at all, the phone's state (masked – never the number) and the heartbeat of the last run.
 *   PUT `{ prefs }` → validates and stores. The settings document is read by `alertPrefsOf` (unknown keys dropped, numbers clamped, markets
 *         checked), the PLAN is checked here and only here (more channels than `alertChannels`, the phone without calls in the plan → 402
 *         `limit_reached` / `plan_required` with the next step), and the phone channel needs a verified number (409 `phone_not_verified`).
 *         The client has no write access to the table – this function is the only door.
 *
 * Guards: signed in (aal2 if 2FA), rate limit, body ≤ 16 KiB. Nothing secret is returned.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { alertPrefsOf, channelOn, checkPrefsAgainstLimits } from "../../src/domain/alerts/config";
import { requireUser } from "./_lib/auth";
import { mailConfig } from "./_lib/alertWatch/mail";
import { recipientOf } from "./_lib/alertWatch/recipient";
import { alertLimits } from "./_lib/alerts/limits";
import { phoneState } from "./_lib/alerts/phoneAccount";
import { RUN_STATE_KEY } from "./_lib/alerts/store";
import { twilioConfig } from "./_lib/alerts/twilio";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { planOf } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const PutBody = z.object({ prefs: z.unknown() });

async function lastRun(): Promise<{ at: number; ok: boolean; code: string | null } | null> {
  try {
    const { data, error } = await supabaseAdmin().from("app_config").select("value").eq("key", RUN_STATE_KEY).maybeSingle();
    if (error || !data) return null;
    const v = (data as { value?: Record<string, unknown> }).value;
    if (!v || typeof v.at !== "number") return null;
    return { at: v.at, ok: v.ok === true, code: typeof v.code === "string" ? v.code : null };
  } catch {
    return null;
  }
}

async function view(userId: string): Promise<Record<string, unknown>> {
  const sb = supabaseAdmin();
  const [plan, stored, profile, phone, rcpt, run] = await Promise.all([
    planOf(userId),
    sb.from("alert_prefs").select("prefs").eq("user_id", userId).maybeSingle(),
    sb.from("profiles").select("tz").eq("id", userId).maybeSingle(),
    phoneState(userId),
    recipientOf(userId),
    lastRun(),
  ]);
  if (stored.error && stored.error.code && ["42P01", "PGRST205"].includes(stored.error.code)) throw new HttpError(503, "alerts_unavailable", "Die Alarme sind auf diesem Server noch nicht eingerichtet (Datenbank-Migration fehlt).");
  const tw = twilioConfig();
  return {
    prefs: alertPrefsOf((stored.data as { prefs?: unknown } | null)?.prefs),
    plan: plan.plan,
    limits: alertLimits(plan.plan),
    tz: typeof (profile.data as { tz?: unknown } | null)?.tz === "string" ? (profile.data as { tz: string }).tz : "Europe/Berlin",
    email: { configured: mailConfig() !== null, hasEmail: rcpt !== null, confirmed: rcpt?.confirmed ?? false },
    phone: { configured: tw !== null, verifyConfigured: tw?.verifySid != null, status: phone.status, masked: phone.masked },
    lastRun: run,
  };
}

export default handler(async (req) => {
  requireMethod(req, "GET", "PUT");
  const user = await requireUser(req, { aal2: "ifEnrolled" });

  if (req.method.toUpperCase() === "GET") {
    await enforceRateLimit(rateKey("alerts-prefs", user.id), 60, 600);
    return json(await view(user.id));
  }

  await enforceRateLimit(rateKey("alerts-prefs-put", user.id), 30, 600, { failClosed: true });
  const body = await readJson(req, PutBody, { maxBytes: 16 * 1024 });
  const prefs = alertPrefsOf(body.prefs);
  const plan = await planOf(user.id);
  const limits = alertLimits(plan.plan);
  const check = checkPrefsAgainstLimits(prefs, limits);
  if (!check.ok) {
    if (check.problem === "phone") throw new HttpError(402, "plan_required", "Anrufe sind in deinem Tarif nicht enthalten.", { feature: "phoneCallsPerMonth", required: "premium", plan: plan.plan });
    throw new HttpError(402, "limit_reached", `Dein Tarif erlaubt ${limits.alertChannels} ${limits.alertChannels === 1 ? "Kanal" : "Kanäle"} gleichzeitig. Schalte einen anderen Kanal aus, oder wechsle den Tarif.`, { key: "alertChannels", limit: limits.alertChannels, plan: plan.plan });
  }
  if (channelOn(prefs, "phone") && (await phoneState(user.id)).status !== "verified") {
    throw new HttpError(409, "phone_not_verified", "Richte zuerst das Telefon ein und bestätige deine Nummer.");
  }
  const { error } = await supabaseAdmin().from("alert_prefs").upsert({ user_id: user.id, prefs }, { onConflict: "user_id" });
  if (error) {
    console.error("[fn] alerts-prefs save failed", error.code ?? "");
    throw new HttpError(error.code === "42P01" ? 503 : 500, error.code === "42P01" ? "alerts_unavailable" : "internal");
  }
  return json(await view(user.id));
});

export const config: Config = { path: "/api/v1/alerts/prefs", method: ["GET", "PUT"] };
