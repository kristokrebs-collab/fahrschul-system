/**
 * POST /api/v1/alerts/twilio/status – Twilio's status callback of a call (C2): `queued` / `ringing` / `answered` / `completed` / `busy` /
 * `no-answer` / `failed` / `canceled`. Called by Twilio, not by a browser – no login; the proof is Twilio's signature (`X-Twilio-Signature`,
 * HMAC-SHA1 over the URL and the form fields with the account's auth token), checked in constant time. Without `TWILIO_AUTH_TOKEN` the
 * function answers 503; with a wrong or missing signature 403 – nothing is changed.
 *
 * A callback moves a call forward only (`alert_delivery_advance`): a repeated or late one changes nothing, so Twilio's retries are harmless.
 * Only the call id (`CA…`) and the status are read; no number, no text ever goes into the log.
 */
import type { Config } from "@netlify/functions";
import { mapCallStatus } from "../../src/domain/alerts/delivery";
import { appOrigin } from "./_lib/alertWatch/mail";
import { supabaseAlertStore } from "./_lib/alerts/store";
import { twilioConfig, validTwilioSignature } from "./_lib/alerts/twilio";
import { error, errorFrom, json } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export const STATUS_PATH = "/api/v1/alerts/twilio/status";

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method.toUpperCase() !== "POST") return error(405, "method_not_allowed");
    const cfg = twilioConfig();
    const origin = appOrigin();
    if (!cfg || !origin) return error(503, "phone_unavailable");
    await enforceRateLimit(rateKey("alerts-twilio-cb"), 600, 60);
    const text = await req.text();
    if (text.length > 16 * 1024) return error(413, "payload_too_large");
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) params[k] = v;
    if (!validTwilioSignature(cfg.token, `${origin}${STATUS_PATH}`, params, req.headers.get("x-twilio-signature"))) return error(403, "bad_signature");
    const sid = params.CallSid ?? "";
    const mapped = mapCallStatus(params.CallStatus ?? "");
    if (!/^CA[0-9a-f]{32}$/i.test(sid) || !mapped) return json({ ok: true, changed: false });
    const id = await supabaseAlertStore().advanceByRef(sid, mapped.status, mapped.reason);
    return json({ ok: true, changed: id !== null });
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { path: STATUS_PATH, method: ["POST"] };
