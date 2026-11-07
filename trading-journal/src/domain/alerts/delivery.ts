/**
 * Delivery planning (C2): which channel gets what, when, and the vocabulary of the delivery log. Pure.
 *
 *   quiet hours   phone: never during quiet hours (a call at night about a stale event helps nobody) → logged as skipped;
 *                 e-mail: held until the quiet hours end; browser: not shown during quiet hours (the log still lists it)
 *   cooldown      a suppressed event has no deliveries at all (the event row says why)
 *   readiness     a channel that is not set up (no verified number, no confirmed address) is logged `skipped` with the reason –
 *                 the protocol answers "why did I not get a call?" instead of staying silent
 *   phone         at most ONE call per event, ever (`phoneBudget` checks the monthly, the daily and the global brake)
 */
import { ALERT_CHANNELS, type AlertChannel, type AlertPrefs } from "./config";
import { isQuiet, quietEndsAt } from "./quiet";
import type { AlertFire } from "./types";

export const DELIVERY_STATUSES = ["queued", "sending", "ringing", "answered", "sent", "shown", "failed", "skipped", "dead"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Why a delivery did not happen or failed (codes only; the protocol shows `DELIVERY_REASON_TEXT`). */
export type DeliveryReason =
  | "quiet_hours"
  | "phone_not_ready"
  | "email_not_ready"
  | "phone_opted_out"
  | "switched_off"
  | "calls_off"
  | "month_limit"
  | "user_day_limit"
  | "global_day_limit"
  | "no_plan"
  | "busy"
  | "no_answer"
  | "call_failed"
  | "canceled"
  | "unclear"
  | "twilio_auth"
  | "twilio_number"
  | "twilio_rate"
  | "twilio_error"
  | "twilio_network"
  | "resend_auth"
  | "resend_invalid"
  | "resend_rate"
  | "resend_busy"
  | "resend_5xx"
  | "resend_network"
  | "mail_off"
  | "no_recipient"
  | "email_unconfirmed"
  | "not_configured"
  | "retries_used_up";

export const DELIVERY_REASON_TEXT: Readonly<Record<DeliveryReason, string>> = {
  quiet_hours: "Ruhezeit",
  phone_not_ready: "Telefon nicht eingerichtet",
  email_not_ready: "E-Mail nicht eingerichtet",
  phone_opted_out: "Telefon abgemeldet",
  switched_off: "Kanal inzwischen ausgeschaltet",
  calls_off: "Übersprungen: Notschalter (Anrufe) des Betreibers ist an",
  month_limit: "Anruf-Grenze des Monats erreicht",
  user_day_limit: "Anruf-Grenze des Tages erreicht",
  global_day_limit: "Kostenbremse des Servers für heute erreicht",
  no_plan: "Telefon ist in deinem Tarif nicht enthalten",
  busy: "Besetzt",
  no_answer: "Nicht abgenommen",
  call_failed: "Anruf fehlgeschlagen",
  canceled: "Anruf abgebrochen",
  unclear: "Ausgang unklar (Abbruch während des Anrufs) – aus Sicherheit nicht noch einmal angerufen",
  twilio_auth: "Der Telefondienst hat die Zugangsdaten abgelehnt",
  twilio_number: "Der Telefondienst hat die Nummer abgelehnt",
  twilio_rate: "Der Telefondienst ist ausgelastet",
  twilio_error: "Der Telefondienst meldet einen Fehler",
  twilio_network: "Der Telefondienst ist nicht erreichbar",
  resend_auth: "Der Versanddienst hat den Schlüssel abgelehnt",
  resend_invalid: "Der Versanddienst hat die Mail abgelehnt",
  resend_rate: "Der Versanddienst ist ausgelastet",
  resend_busy: "Der Versanddienst bearbeitet gerade dieselbe Anfrage",
  resend_5xx: "Der Versanddienst antwortet nicht",
  resend_network: "Der Versanddienst ist nicht erreichbar",
  mail_off: "Übersprungen: Notschalter (E-Mail) des Betreibers ist an",
  no_recipient: "Keine E-Mail-Adresse im Konto",
  email_unconfirmed: "E-Mail-Adresse nicht bestätigt",
  not_configured: "Auf dem Server nicht eingerichtet",
  retries_used_up: "Alle Versuche verbraucht",
};

export const reasonText = (code: string | null | undefined): string => (code && code in DELIVERY_REASON_TEXT ? DELIVERY_REASON_TEXT[code as DeliveryReason] : (code ?? ""));

/** What the server can say about the channels of one account when it plans deliveries. */
export interface PlanContext {
  now: number;
  tz: string;
  prefs: Pick<AlertPrefs, "channels" | "quiet">;
  /** a verified, not revoked number and a configured Twilio */
  phoneReady: boolean;
  /** a confirmed address and a configured Resend */
  emailReady: boolean;
}

export interface PlannedDelivery {
  channel: AlertChannel;
  status: "queued" | "skipped";
  reason: DeliveryReason | null;
  /** ms: not before this (e-mail held over quiet hours); `now` otherwise */
  runAt: number;
}

export function planDeliveries(fire: Pick<AlertFire, "event" | "quiet" | "suppressed" | "at">, ctx: PlanContext): PlannedDelivery[] {
  if (fire.suppressed) return [];
  const out: PlannedDelivery[] = [];
  for (const channel of ALERT_CHANNELS) {
    if (!ctx.prefs.channels[channel][fire.event]) continue;
    const quiet = isQuiet(ctx.prefs.quiet, ctx.now, ctx.tz);
    if (channel === "phone") {
      if (!ctx.phoneReady) out.push({ channel, status: "skipped", reason: "phone_not_ready", runAt: ctx.now });
      else if (quiet) out.push({ channel, status: "skipped", reason: "quiet_hours", runAt: ctx.now });
      else out.push({ channel, status: "queued", reason: null, runAt: ctx.now });
    } else if (channel === "email") {
      if (!ctx.emailReady) out.push({ channel, status: "skipped", reason: "email_not_ready", runAt: ctx.now });
      else out.push({ channel, status: "queued", reason: null, runAt: quiet ? quietEndsAt(ctx.prefs.quiet, ctx.now, ctx.tz) : ctx.now });
    } else if (quiet) out.push({ channel, status: "skipped", reason: "quiet_hours", runAt: ctx.now });
    else out.push({ channel, status: "queued", reason: null, runAt: ctx.now });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ retries

/** E-mail: seconds to wait after the n-th failed attempt (1-based); `null` = used up (dead letter). */
export const RETRY_BACKOFF_SEC: readonly number[] = [60, 300, 900, 3600];
export const MAX_ATTEMPTS = RETRY_BACKOFF_SEC.length + 1;
export function backoffSec(attempt: number): number | null {
  return RETRY_BACKOFF_SEC[attempt - 1] ?? null;
}

/** How long a worker may hold a job before another one may take it over (seconds). */
export const LEASE_SEC = 90;

// ------------------------------------------------------------------------------------------ Twilio statuses

/** `CallStatus` of Twilio → our status and reason. `completed` after an answer stays "answered". */
export function mapCallStatus(s: string): { status: DeliveryStatus; reason: DeliveryReason | null } | null {
  switch (s) {
    case "queued":
    case "initiated":
      return { status: "queued", reason: null };
    case "ringing":
      return { status: "ringing", reason: null };
    case "in-progress":
    case "completed":
      return { status: "answered", reason: null };
    case "busy":
      return { status: "failed", reason: "busy" };
    case "no-answer":
      return { status: "failed", reason: "no_answer" };
    case "failed":
      return { status: "failed", reason: "call_failed" };
    case "canceled":
      return { status: "failed", reason: "canceled" };
    default:
      return null;
  }
}

const RANK: Readonly<Record<DeliveryStatus, number>> = { queued: 1, sending: 2, ringing: 3, answered: 4, sent: 4, shown: 4, failed: 4, skipped: 4, dead: 4 };

/** A callback may only move a call forward: a late "ringing" never undoes "answered", and "answered" never becomes "failed". */
export function mayAdvance(from: DeliveryStatus, to: DeliveryStatus): boolean {
  if (from === to) return false;
  if (from === "answered") return false;
  if (from === "failed" || from === "skipped" || from === "dead" || from === "sent" || from === "shown") return false;
  return RANK[to] > RANK[from];
}

// ------------------------------------------------------------------------------------------ phone budget

export interface PhoneBudgetInput {
  /** the plan's calls per month (`phoneCallsPerMonth`); 0 = not in the plan */
  monthLimit: number;
  monthUsed: number;
  /** calls per account and day (env) */
  userDayMax: number;
  userDayUsed: number;
  /** calls of ALL accounts per day (env): the cost brake */
  globalDayMax: number;
  globalDayUsed: number;
}

/** Checks the brakes in a fixed order: plan, month, day of the account, day of the server. */
export function phoneBudget(i: PhoneBudgetInput): { ok: true } | { ok: false; reason: "no_plan" | "month_limit" | "user_day_limit" | "global_day_limit" } {
  if (!(i.monthLimit > 0)) return { ok: false, reason: "no_plan" };
  if (i.monthUsed >= i.monthLimit) return { ok: false, reason: "month_limit" };
  if (i.userDayUsed >= i.userDayMax) return { ok: false, reason: "user_day_limit" };
  if (i.globalDayUsed >= i.globalDayMax) return { ok: false, reason: "global_day_limit" };
  return { ok: true };
}

/** Idempotency key of one delivery: the event and the channel, nothing else – the same pair always gives the same key. */
export const deliveryKey = (eventId: string, channel: AlertChannel): string => `${eventId}:${channel}`;
