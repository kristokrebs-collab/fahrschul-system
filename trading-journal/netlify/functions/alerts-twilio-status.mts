/**
 * POST /api/v1/alerts/twilio/status – Twilio's status callback of a call (C2): `queued` / `ringing` / `answered` / `completed` / `busy` /
 * `no-answer` / `failed` / `canceled`. Called by Twilio, not by a browser – no login; the proof is Twilio's signature (`X-Twilio-Signature`,
 * HMAC-SHA1 over the URL and the form fields with the account's auth token), checked in constant time. Without `TWILIO_AUTH_TOKEN` the
 * function answers 503; with a wrong or missing signature 403 – nothing is changed, and the signature is checked BEFORE the rate limit counts.
 *
 * A callback moves a call forward only (`alert_delivery_advance`): a repeated or late one changes nothing, so Twilio's retries are harmless.
 * Only the call id (`CA…`) and the status are read; no number, no text ever goes into the log.
 */
import type { Config } from "@netlify/functions";
import { mapCallStatus } from "../../src/domain/alerts/delivery";
import { appOrigin } from "./_lib/alertWatch/mail";
import { supabaseAlertStore } from "./_lib/alerts/store";
import { twilioConfig, validTwilioSignature } from "./_lib/alerts/twilio";
import { error, handler, json } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { readBodyLimited } from "./_lib/signals/receive";

export const STATUS_PATH = "/api/v1/alerts/twilio/status";
/** A status callback is a handful of form fields; anything bigger is refused before it is parsed. */
const MAX_BYTES = 16 * 1024;

export default handler(async (req) => {
  if (req.method.toUpperCase() !== "POST") return error(405, "method_not_allowed");
  const cfg = twilioConfig();
  const origin = appOrigin();
  if (!cfg || !origin) return error(503, "phone_unavailable");
  // the signature comes FIRST (Runde 11): an unsigned request touches neither the shared counter nor the database, so anonymous
  // calls can no longer use up the budget of the real callbacks (429 for Twilio) or write `rate_hits` rows
  const text = await readBodyLimited(req, MAX_BYTES);
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  if (!validTwilioSignature(cfg.token, `${origin}${STATUS_PATH}`, params, req.headers.get("x-twilio-signature"))) return error(403, "bad_signature");
  await enforceRateLimit(rateKey("alerts-twilio-cb"), 600, 60);
  const sid = params.CallSid ?? "";
  const mapped = mapCallStatus(params.CallStatus ?? "");
  if (!/^CA[0-9a-f]{32}$/i.test(sid) || !mapped) return json({ ok: true, changed: false });
  const id = await supabaseAlertStore().advanceByRef(sid, mapped.status, mapped.reason);
  return json({ ok: true, changed: id !== null });
});

export const config: Config = { path: "/api/v1/alerts/twilio/status", method: ["POST"] };
