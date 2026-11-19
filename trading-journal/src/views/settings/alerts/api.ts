/**
 * Calls of the alarm settings to the server (`/api/v1/alerts/*`, C2). Every answer is checked (`model.ts`); a wrong shape is an `ApiError`
 * ("unerwartet geantwortet"), never a half-used object. The number is sent once (start) and never comes back – only its masked form.
 */
import { ApiError, apiFetch } from "@/cloud/api";
import type { AlertPrefs } from "@/domain/alerts/config";
import { CONSENT_VERSION } from "@/domain/alerts/phone";
import { parseFeed, parsePrefsView, type Feed, type PhoneStatus, type PrefsView } from "./model";

const unexpected = (): ApiError => new ApiError(0, "unavailable", "Der Server hat unerwartet geantwortet.");

export async function fetchPrefs(signal?: AbortSignal): Promise<PrefsView> {
  const v = parsePrefsView(await apiFetch<unknown>("/alerts/prefs", { signal }));
  if (!v) throw unexpected();
  return v;
}

export async function savePrefs(prefs: AlertPrefs): Promise<PrefsView> {
  const v = parsePrefsView(await apiFetch<unknown>("/alerts/prefs", { method: "PUT", body: { prefs } }));
  if (!v) throw unexpected();
  return v;
}

export async function fetchFeed(signal?: AbortSignal): Promise<Feed> {
  const f = parseFeed(await apiFetch<unknown>("/alerts/feed", { signal }));
  if (!f) throw unexpected();
  return f;
}

export async function ackBrowser(ids: string[]): Promise<void> {
  if (ids.length) await apiFetch<unknown>("/alerts/feed", { method: "POST", body: { ack: ids.slice(0, 20) } });
}

export async function sendEmailTest(): Promise<void> {
  await apiFetch<unknown>("/alerts/email-test", { method: "POST" });
}

export async function phoneStart(number: string): Promise<{ masked: string }> {
  const r = await apiFetch<{ status?: unknown; masked?: unknown }>("/alerts/phone", { method: "POST", body: { action: "start", number, consent: true, consentVersion: CONSENT_VERSION } });
  if (r?.status !== "pending" || typeof r.masked !== "string") throw unexpected();
  return { masked: r.masked };
}

export async function phoneCheck(code: string): Promise<{ masked: string | null }> {
  const r = await apiFetch<{ status?: unknown; masked?: unknown }>("/alerts/phone", { method: "POST", body: { action: "check", code } });
  if (r?.status !== "verified") throw unexpected();
  return { masked: typeof r.masked === "string" ? r.masked : null };
}

export interface TestCallResult {
  status: string;
  reason: string | null;
  reasonText: string | null;
}

export async function phoneTest(): Promise<TestCallResult> {
  const r = await apiFetch<Record<string, unknown>>("/alerts/phone", { method: "POST", body: { action: "test" } });
  if (typeof r?.status !== "string") throw unexpected();
  return { status: r.status, reason: typeof r.reason === "string" ? r.reason : null, reasonText: typeof r.reasonText === "string" ? r.reasonText : null };
}

export async function phoneRevoke(): Promise<PhoneStatus> {
  await apiFetch<unknown>("/alerts/phone", { method: "DELETE" });
  return "revoked";
}
