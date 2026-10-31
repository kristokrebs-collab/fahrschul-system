/**
 * Calls of the e-mail alarm card to `netlify/functions/alert-test.mts` (`/api/v1/alerts/test`): the server's status
 * (can it mail at all, does the plan allow it, is the address confirmed, when did the schedule last run) and the test
 * mail. The address itself never travels in either direction.
 */
import { ApiError, apiFetch } from "@/cloud/api";

export interface AlertHeartbeat {
  /** ms, end of the last run */
  at: number;
  ok: boolean;
  /** `binance_451`, `binance_down`, `migration`, `db` */
  code: string | null;
  accounts: number;
  symbols: number;
  mails: number;
  source: string | null;
}

export interface AlertStatus {
  /** `RESEND_API_KEY` and `ALERT_FROM` are set on the server */
  configured: boolean;
  /** the plan includes the alarm (always true while payments are not set up) */
  entitled: boolean;
  hasEmail: boolean;
  emailConfirmed: boolean;
  lastRun: AlertHeartbeat | null;
  intervalMin: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function heartbeatOf(v: unknown): AlertHeartbeat | null {
  if (!isObj(v) || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  return {
    at: v.at,
    ok: v.ok === true,
    code: typeof v.code === "string" ? v.code : null,
    accounts: typeof v.accounts === "number" ? v.accounts : 0,
    symbols: typeof v.symbols === "number" ? v.symbols : 0,
    mails: typeof v.mails === "number" ? v.mails : 0,
    source: typeof v.source === "string" ? v.source : null,
  };
}

/** The server's answer, checked. Throws `ApiError` (also for an answer that is not this function's). */
export async function fetchAlertStatus(signal?: AbortSignal): Promise<AlertStatus> {
  const raw = await apiFetch<unknown>("/alerts/test", { signal });
  if (!isObj(raw) || typeof raw.configured !== "boolean") throw new ApiError(0, "unavailable", "Der Server hat unerwartet geantwortet.");
  return {
    configured: raw.configured,
    entitled: raw.entitled !== false,
    hasEmail: raw.hasEmail !== false,
    emailConfirmed: raw.emailConfirmed === true,
    lastRun: heartbeatOf(raw.lastRun),
    intervalMin: typeof raw.intervalMin === "number" ? raw.intervalMin : 5,
  };
}

/** Sends the test mail to the account's own address. Throws `ApiError` with the server's German message. */
export async function sendAlertTestMail(): Promise<void> {
  await apiFetch<unknown>("/alerts/test", { method: "POST" });
}
