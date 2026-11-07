/**
 * Twilio over plain `fetch` against the REST API – no SDK (no dependency, nothing to bundle). Three things:
 *
 *   Voice    `createCall` (POST /Calls.json with inline TwiML and a status callback) and `getCall` (poll)
 *   Verify   `verifyStart` / `verifyCheck` – the number check (SMS code, generated, limited and expired by Twilio)
 *   Webhook  `twilioSignature` / `validTwilioSignature` – the HMAC-SHA1 check of the status callback
 *
 * Why Twilio Verify and not an own code by SMS: Twilio makes, sends, expires and rate-limits the code (so no code, no hash of it and no
 * attempt counter live in our database), has fraud protection against SMS pumping, and does not need the voice number `TWILIO_FROM` to be
 * SMS-capable. The price is one more Twilio product (a Verify service, `TWILIO_VERIFY_SERVICE_SID`); without it the number check is
 * "Einrichtung nötig" and the phone stays off – a call is never made to a number nobody confirmed.
 *
 * Env (all server-only, see docs/ENV.md): `TWILIO_ACCOUNT_SID` (AC…), `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (E.164, a Twilio number or
 * verified caller id), `TWILIO_VERIFY_SERVICE_SID` (VA…). Without the first three: no call. Never logged: the token, a number, a code.
 *
 * What a failure means for a CALL (this decides whether a retry is safe): a definitive refusal that created no call (4xx, 429) → the caller
 * may roll back and retry; anything where Twilio MAY have created the call (5xx, timeout, broken connection) → `unclear`, never retried.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryReason } from "../../../../src/domain/alerts/delivery";
import { isE164 } from "../../../../src/domain/alerts/phone";
import { envOptional } from "../env";

export interface TwilioConfig {
  sid: string;
  token: string;
  from: string;
  /** `null` = no Verify service: the number check is not possible */
  verifySid: string | null;
}

/** The config, or `null` when the account id, token or sender are missing or malformed (then nothing is dialed). */
export function twilioConfig(): TwilioConfig | null {
  const sid = envOptional("TWILIO_ACCOUNT_SID")?.trim();
  const token = envOptional("TWILIO_AUTH_TOKEN")?.trim();
  const from = envOptional("TWILIO_FROM")?.trim();
  const verify = envOptional("TWILIO_VERIFY_SERVICE_SID")?.trim();
  if (!sid || !/^AC[0-9a-f]{32}$/i.test(sid) || !token || !from || !isE164(from)) return null;
  return { sid, token, from, verifySid: verify && /^VA[0-9a-f]{32}$/i.test(verify) ? verify : null };
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchOverride: FetchFn | null = null;
/** Tests: inject a fetch (`null` restores the real one). */
export function setTwilioFetchForTests(f: FetchFn | null): void {
  fetchOverride = f;
}

const TIMEOUT_MS = 8_000;

async function post(cfg: TwilioConfig, url: string, form: URLSearchParams): Promise<{ status: number; body: Record<string, unknown> | null } | "network"> {
  const f = fetchOverride ?? ((i, n) => fetch(i, n));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body };
  } catch {
    return "network";
  } finally {
    clearTimeout(timer);
  }
}

async function get(cfg: TwilioConfig, url: string): Promise<{ status: number; body: Record<string, unknown> | null } | "network"> {
  const f = fetchOverride ?? ((i, n) => fetch(i, n));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { method: "GET", signal: ctrl.signal, headers: { authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64")}` } });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body };
  } catch {
    return "network";
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------------------------------ calls

export type CallResult =
  | { ok: true; sid: string; status: string }
  /** `retryable`: Twilio refused and created no call (429) – the caller may roll back and try again later */
  | { ok: false; reason: DeliveryReason; retryable: boolean; httpStatus: number | null };

export interface CallInput {
  /** E.164 */
  to: string;
  twiml: string;
  /** absolute https URL of the status callback, or `null` (statuses are then polled) */
  statusCallback: string | null;
}

export function failureOfCall(res: { status: number; body: Record<string, unknown> | null } | "network"): { reason: DeliveryReason; retryable: boolean; httpStatus: number | null } {
  if (res === "network") return { reason: "unclear", retryable: false, httpStatus: null };
  const s = res.status;
  if (s === 401 || s === 403) return { reason: "twilio_auth", retryable: false, httpStatus: s };
  if (s === 429) return { reason: "twilio_rate", retryable: true, httpStatus: s };
  if (s === 400 || s === 404) return { reason: "twilio_number", retryable: false, httpStatus: s };
  if (s >= 500) return { reason: "unclear", retryable: false, httpStatus: s };
  return { reason: "twilio_error", retryable: false, httpStatus: s };
}

/** Starts ONE call. Never throws; the number is only in the request body. */
export async function createCall(cfg: TwilioConfig, c: CallInput): Promise<CallResult> {
  const form = new URLSearchParams();
  form.set("To", c.to);
  form.set("From", cfg.from);
  form.set("Twiml", c.twiml);
  form.set("Timeout", "30");
  if (c.statusCallback) {
    form.set("StatusCallback", c.statusCallback);
    form.set("StatusCallbackMethod", "POST");
    for (const e of ["initiated", "ringing", "answered", "completed"]) form.append("StatusCallbackEvent", e);
  }
  const res = await post(cfg, `https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Calls.json`, form);
  if (res !== "network" && res.status >= 200 && res.status < 300 && typeof res.body?.sid === "string" && /^CA[0-9a-f]{32}$/i.test(res.body.sid)) {
    return { ok: true, sid: res.body.sid, status: typeof res.body.status === "string" ? res.body.status : "queued" };
  }
  if (res !== "network" && res.status >= 200 && res.status < 300) return { ok: false, reason: "unclear", retryable: false, httpStatus: res.status };
  return { ok: false, ...failureOfCall(res) };
}

/** The current status of a call (`queued`, `ringing`, `in-progress`, `completed`, `busy`, `no-answer`, `failed`, `canceled`), or `null` when unknown/unreachable. */
export async function getCall(cfg: TwilioConfig, sid: string): Promise<string | null> {
  if (!/^CA[0-9a-f]{32}$/i.test(sid)) return null;
  const res = await get(cfg, `https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Calls/${sid}.json`);
  if (res === "network" || res.status !== 200) return null;
  return typeof res.body?.status === "string" ? res.body.status : null;
}

// ------------------------------------------------------------------------------------------ Verify

export type VerifyStartResult = { ok: true } | { ok: false; code: "not_configured" | "invalid_number" | "rate" | "unreachable" | "failed" };
export type VerifyCheckResult = { ok: true } | { ok: false; code: "not_configured" | "wrong" | "expired" | "rate" | "unreachable" | "failed" };

/** Sends the code by SMS (Twilio's text, in the user's language). */
export async function verifyStart(cfg: TwilioConfig, to: string, lang: "de" | "en"): Promise<VerifyStartResult> {
  if (!cfg.verifySid) return { ok: false, code: "not_configured" };
  const form = new URLSearchParams({ To: to, Channel: "sms", Locale: lang });
  const res = await post(cfg, `https://verify.twilio.com/v2/Services/${cfg.verifySid}/Verifications`, form);
  if (res === "network") return { ok: false, code: "unreachable" };
  if (res.status >= 200 && res.status < 300) return { ok: true };
  if (res.status === 429) return { ok: false, code: "rate" };
  // 60200 invalid parameter (the number), 60203 max send attempts (Twilio's own limit), 21608 / 21211 unreachable or invalid number
  const code = typeof res.body?.code === "number" ? res.body.code : 0;
  if (code === 60203) return { ok: false, code: "rate" };
  if (res.status === 400 || res.status === 404) return { ok: false, code: "invalid_number" };
  return { ok: false, code: res.status >= 500 ? "unreachable" : "failed" };
}

/** Checks the code the person typed. */
export async function verifyCheck(cfg: TwilioConfig, to: string, code: string): Promise<VerifyCheckResult> {
  if (!cfg.verifySid) return { ok: false, code: "not_configured" };
  const res = await post(cfg, `https://verify.twilio.com/v2/Services/${cfg.verifySid}/VerificationCheck`, new URLSearchParams({ To: to, Code: code }));
  if (res === "network") return { ok: false, code: "unreachable" };
  if (res.status === 200) return res.body?.status === "approved" ? { ok: true } : { ok: false, code: "wrong" };
  if (res.status === 404) return { ok: false, code: "expired" }; // 20404: no pending verification (expired, used, or too many wrong attempts)
  if (res.status === 429) return { ok: false, code: "rate" };
  return { ok: false, code: res.status >= 500 ? "unreachable" : "failed" };
}

// ------------------------------------------------------------------------------------------ webhook signature

/** Twilio's signature: base64(HMAC-SHA1(token, url + for each POST parameter sorted by name: name + value)). */
export function twilioSignature(token: string, url: string, params: Readonly<Record<string, string>>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64");
}

/** Constant-time comparison of the `X-Twilio-Signature` header with the expected one. */
export function validTwilioSignature(token: string, url: string, params: Readonly<Record<string, string>>, header: string | null): boolean {
  if (!header) return false;
  const a = Buffer.from(twilioSignature(token, url, params));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
