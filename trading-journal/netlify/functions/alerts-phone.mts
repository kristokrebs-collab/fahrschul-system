/**
 * /api/v1/alerts/phone – the telephone channel of the four alarms (C2): opt-in with explicit consent, number check, test call, opt-out.
 *
 *   POST { action: "start", number, consent: true, consentVersion }  → stores the consent (time + text version), checks the number (E.164,
 *        worldwide, country code required), sends a code by SMS (Twilio Verify) → `{ status: "pending", masked }`. No call is ever made
 *        to a number that was not confirmed this way.
 *   POST { action: "check", code }   → Twilio checks the code; right → the number is `verified` (one verified number per number across
 *        accounts) → `{ status: "verified", masked }`; wrong / expired → 422 `code_wrong` / `code_expired`.
 *   POST { action: "test" }          → ONE test call to the verified number (it counts against the month and the day like a real one) →
 *        `{ status, reason }` (queued / ringing … or skipped with the reason, e.g. the monthly limit).
 *   DELETE                           → opt-out at once: the number is deleted, calls not yet dialed are cancelled, the phone events in the
 *        settings are switched off → `{ status: "revoked" }`.
 *
 * Guards: signed in (aal2 if 2FA), the plan has calls (`phoneCallsPerMonth` > 0 – Premium and Team), rate limits per account (fail-closed),
 * the emergency switch `KILL_CALLS` off (start and test answer 503 `switched_off`; opt-out always works), `TWILIO_*` and `EXCHANGE_ENC_KEY_V1` configured (else 503 `phone_unavailable`, German "Einrichtung nötig"). The number is stored only encrypted
 * (+ a keyed hash), never logged, never returned (only the masked form).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { alertPrefsOf } from "../../src/domain/alerts/config";
import { reasonText } from "../../src/domain/alerts/delivery";
import { maskPhone, parsePhone, PHONE_PROBLEM_TEXT } from "../../src/domain/alerts/phone";
import { requireUser } from "./_lib/auth";
import { CryptoError } from "./_lib/crypto";
import { defaultDeliverDeps, runWorker } from "./_lib/alerts/deliver";
import { alertLimits } from "./_lib/alerts/limits";
import { CONSENT_VERSION, numberHash, openNumber, phoneState, sealNumber } from "./_lib/alerts/phoneAccount";
import { supabaseAlertStore } from "./_lib/alerts/store";
import { twilioConfig, verifyCheck, verifyStart } from "./_lib/alerts/twilio";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { assertRunning } from "./_lib/killswitch";
import { planOf } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), number: z.string().max(40), consent: z.literal(true), consentVersion: z.literal(CONSENT_VERSION) }),
  z.object({ action: z.literal("check"), code: z.string().regex(/^\d{4,10}$/) }),
  z.object({ action: z.literal("test") }),
]);

const UNAVAILABLE = "Das Telefon ist auf diesem Server nicht eingerichtet (Einrichtung nötig).";

function unavailable(): never {
  throw new HttpError(503, "phone_unavailable", UNAVAILABLE);
}

export default handler(async (req) => {
  requireMethod(req, "POST", "DELETE");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const sb = supabaseAdmin();

  if (req.method.toUpperCase() === "DELETE") {
    await enforceRateLimit(rateKey("alerts-phone-revoke", user.id), 20, 600);
    const { error } = await sb.rpc("alert_phone_revoke", { p_user: user.id });
    if (error) throw new HttpError(error.code === "42883" ? 503 : 500, error.code === "42883" ? "alerts_unavailable" : "internal");
    // the phone events in the settings go off with it (nothing is left that could ask for a call)
    const { data } = await sb.from("alert_prefs").select("prefs").eq("user_id", user.id).maybeSingle();
    if (data) {
      const p = alertPrefsOf((data as { prefs: unknown }).prefs);
      const off = { green_warn: false, green_confirm: false, red_warn: false, red_confirm: false };
      await sb.from("alert_prefs").upsert({ user_id: user.id, prefs: { ...p, channels: { ...p.channels, phone: off } } }, { onConflict: "user_id" });
    }
    return json({ status: "revoked" });
  }

  const body = await readJson(req, Body, { maxBytes: 2 * 1024 });
  const tw = twilioConfig();
  if (!tw) unavailable();
  const plan = await planOf(user.id);
  if (!(alertLimits(plan.plan).phoneCallsPerMonth > 0)) {
    throw new HttpError(402, "plan_required", "Anrufe sind in deinem Tarif nicht enthalten.", { feature: "phoneCallsPerMonth", required: "premium", plan: plan.plan });
  }

  // KILL_CALLS: no SMS code (Twilio Verify) and no test call while the operator has the phone switched off. Opting out (DELETE, above) stays possible.
  if (body.action === "start" || body.action === "test") assertRunning("calls");

  if (body.action === "start") {
    if (!tw.verifySid) throw new HttpError(503, "verify_unavailable", "Die Nummernprüfung ist auf diesem Server nicht eingerichtet (Einrichtung nötig).");
    await enforceRateLimit(rateKey("alerts-phone-start", user.id), 3, 600, { failClosed: true });
    await enforceRateLimit(rateKey("alerts-phone-start-day", user.id), 6, 86_400, { failClosed: true });
    const parsed = parsePhone(body.number);
    if (!parsed.ok) throw new HttpError(422, "invalid_number", PHONE_PROBLEM_TEXT[parsed.problem], { problem: parsed.problem });
    let hash: string;
    let blob: string;
    try {
      hash = numberHash(parsed.e164);
      blob = sealNumber(user.id, parsed.e164);
    } catch (e) {
      if (e instanceof CryptoError) unavailable();
      throw e;
    }
    const taken = await sb.from("alert_phone_secrets").select("user_id").eq("number_hash", hash).eq("verified", true).neq("user_id", user.id).limit(1);
    if (taken.data && taken.data.length > 0) throw new HttpError(409, "number_in_use", "Diese Nummer kann nicht verwendet werden.");
    const secrets = await sb.from("alert_phone_secrets").upsert({ user_id: user.id, number_enc: blob, number_hash: hash, verified: false }, { onConflict: "user_id" });
    if (secrets.error) throw new HttpError(500, "internal");
    const masked = maskPhone(parsed.e164);
    const phones = await sb
      .from("alert_phones")
      .upsert({ user_id: user.id, status: "pending", masked, consent_at: new Date().toISOString(), consent_version: body.consentVersion, verified_at: null, revoked_at: null }, { onConflict: "user_id" });
    if (phones.error) throw new HttpError(500, "internal");
    const prefs = await sb.from("alert_prefs").select("prefs").eq("user_id", user.id).maybeSingle();
    const sent = await verifyStart(tw, parsed.e164, alertPrefsOf((prefs.data as { prefs?: unknown } | null)?.prefs).lang);
    if (!sent.ok) {
      console.error("[fn] alerts-phone verify start failed", sent.code);
      if (sent.code === "invalid_number") throw new HttpError(422, "number_rejected", "Der Telefondienst kann diese Nummer nicht erreichen. Prüfe sie und versuche es noch einmal.");
      if (sent.code === "rate") throw new HttpError(429, "rate_limited", "Zu viele Codes für diese Nummer. Bitte warte ein paar Minuten.");
      throw new HttpError(502, "verify_failed", "Der Code konnte nicht gesendet werden. Bitte versuche es gleich noch einmal.");
    }
    return json({ status: "pending", masked });
  }

  if (body.action === "check") {
    await enforceRateLimit(rateKey("alerts-phone-check", user.id), 6, 600, { failClosed: true });
    await enforceRateLimit(rateKey("alerts-phone-check-day", user.id), 20, 86_400, { failClosed: true });
    const state = await phoneState(user.id);
    if (state.status !== "pending") throw new HttpError(409, "no_pending", "Es läuft keine Prüfung. Fordere zuerst einen Code an.");
    const secret = await sb.from("alert_phone_secrets").select("number_enc").eq("user_id", user.id).maybeSingle();
    const blob = (secret.data as { number_enc?: unknown } | null)?.number_enc;
    if (typeof blob !== "string") throw new HttpError(409, "no_pending", "Es läuft keine Prüfung. Fordere zuerst einen Code an.");
    let number: string;
    try {
      number = openNumber(user.id, blob);
    } catch {
      unavailable();
    }
    const res = await verifyCheck(tw, number, body.code);
    if (!res.ok) {
      if (res.code === "wrong") throw new HttpError(422, "code_wrong", "Der Code stimmt nicht.");
      if (res.code === "expired") throw new HttpError(422, "code_expired", "Der Code ist abgelaufen oder zu oft falsch eingegeben. Fordere einen neuen an.");
      if (res.code === "rate") throw new HttpError(429, "rate_limited", "Zu viele Versuche. Bitte warte ein paar Minuten.");
      throw new HttpError(502, "verify_failed", "Die Prüfung ist gerade nicht möglich. Bitte versuche es gleich noch einmal.");
    }
    const mark = await sb.from("alert_phone_secrets").update({ verified: true }).eq("user_id", user.id);
    if (mark.error) {
      if (mark.error.code === "23505") throw new HttpError(409, "number_in_use", "Diese Nummer kann nicht verwendet werden.");
      throw new HttpError(500, "internal");
    }
    const phones = await sb.from("alert_phones").update({ status: "verified", verified_at: new Date().toISOString() }).eq("user_id", user.id);
    if (phones.error) throw new HttpError(500, "internal");
    return json({ status: "verified", masked: state.masked });
  }

  // test call
  const state = await phoneState(user.id);
  if (state.status !== "verified") throw new HttpError(409, "phone_not_verified", "Bestätige zuerst deine Nummer.");
  await enforceRateLimit(rateKey("alerts-phone-test", user.id), 2, 600, { failClosed: true });
  await enforceRateLimit(rateKey("alerts-phone-test-day", user.id), 4, 86_400, { failClosed: true });
  const store = supabaseAlertStore();
  const id = await store.enqueueTest(user.id, "phone", true);
  await runWorker(defaultDeliverDeps(store), { userId: user.id, limit: 5, budgetMs: 15_000 });
  const d = await store.delivery(id);
  return json({ status: d?.status ?? "queued", reason: d?.reason ?? null, reasonText: d?.reason ? reasonText(d.reason) : null });
});

export const config: Config = { path: "/api/v1/alerts/phone", method: ["POST", "DELETE"] };
