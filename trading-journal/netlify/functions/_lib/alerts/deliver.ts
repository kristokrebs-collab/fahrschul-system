/**
 * The delivery worker of the four alarms: takes due jobs (`alert.deliver`, one per event and channel) and delivers them.
 *
 * Crash and restart without a double booking – the two channels differ on purpose:
 *
 *   E-mail  at-least-once with an idempotency key. The key is the delivery id (the same for every attempt): a worker that died after the
 *           mail went out and sends it again gets the first answer from Resend, not a second mail. Failures that can pass (rate limit, 5xx,
 *           network) are retried with back-off (`RETRY_BACKOFF_SEC`), the last one ends in the dead letter (delivery `dead`, job `dead`) –
 *           the Zustellprotokoll shows it.
 *   Phone   AT-MOST-ONCE. The call is COMMITTED before it is dialed (`phoneReserve`: budget check + `dialed_at`, one locked step). A job taken
 *           over after a crash finds `dialed_at`: with a call id it is simply done (callbacks keep the status), without one the outcome is
 *           unknown – it is logged `unclear` and NOT dialed again. A retry happens only when Twilio refused and created no call (429): the
 *           commitment is taken back first. A 5xx / timeout may have created the call, so it is `unclear`, never retried.
 *
 * Everything is fenced by the lease token: a worker that lost its lease changes nothing. Logs: counts and codes only.
 */
import { createHash } from "node:crypto";
import { channelOn, alertPrefsOf } from "../../../../src/domain/alerts/config";
import { alertCallText, buildTwiml, testCallText } from "../../../../src/domain/alerts/phone";
import { backoffSec, LEASE_SEC, mapCallStatus, MAX_ATTEMPTS, type DeliveryReason } from "../../../../src/domain/alerts/delivery";
import { isQuiet, safeZone } from "../../../../src/domain/alerts/quiet";
import { decrypt } from "../crypto";
import { sendMail, type MailConfig, type SendCode } from "../alertWatch/mail";
import { appOrigin, mailConfig } from "../alertWatch/mail";
import { recipientOf, type Recipient } from "../alertWatch/recipient";
import { killed } from "../killswitch";
import { alertLimits, phoneBrakes } from "./limits";
import { buildEventMail } from "./mail";
import type { AlertStore, DeliveryRecord, JobRecord } from "./store";
import { createCall, getCall, twilioConfig, type TwilioConfig } from "./twilio";
import { costPlanOf } from "../plan";
import type { PlanId } from "../../../../src/billing/types";

export const WORKER_BUDGET_MS = 20_000;
const TERMINAL = new Set(["answered", "sent", "shown", "failed", "skipped", "dead"]);

export const phoneAad = (userId: string): string => `${userId}:alert-phone:number`;

export interface DeliverDeps {
  store: AlertStore;
  now(): number;
  mail: MailConfig | null;
  twilio: TwilioConfig | null;
  recipient(userId: string): Promise<Recipient | null>;
  plan(userId: string): Promise<PlanId>;
  decryptNumber(userId: string, blob: string): string;
  appUrl: string | null;
  brakes: { userDayMax: number; globalDayMax: number };
  sendFetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function defaultDeliverDeps(store: AlertStore): DeliverDeps {
  return {
    store,
    now: () => Date.now(),
    mail: mailConfig(),
    twilio: twilioConfig(),
    recipient: recipientOf,
    plan: async (u) => (await costPlanOf(u)).plan, // a subscription in dunning (past_due) places no calls on the operator's money
    decryptNumber: (u, blob) => decrypt(blob, phoneAad(u)),
    appUrl: appOrigin(),
    brakes: phoneBrakes(),
  };
}

export interface WorkerSummary {
  claimed: number;
  sent: number;
  dialed: number;
  skipped: number;
  retried: number;
  failed: number;
  dead: number;
  unclear: number;
  /** jobs whose handling threw (their lease runs out, they are taken again) */
  errors: number;
  /** calls whose status was asked from Twilio because no callback arrived */
  reconciled: number;
}

export const emptyWorkerSummary = (): WorkerSummary => ({ claimed: 0, sent: 0, dialed: 0, skipped: 0, retried: 0, failed: 0, dead: 0, unclear: 0, errors: 0, reconciled: 0 });

const RETRYABLE_MAIL: ReadonlySet<SendCode> = new Set(["resend_rate", "resend_busy", "resend_5xx", "resend_network", "resend_auth"]);

async function done(d: DeliverDeps, job: JobRecord, code: string | null): Promise<void> {
  await d.store.complete(job, "done", code);
}

/** Handles ONE claimed job. May throw (the caller counts it; the lease expires and the job is taken again). */
export async function processJob(job: JobRecord, d: DeliverDeps, tally: WorkerSummary): Promise<void> {
  const delivery = job.deliveryId ? await d.store.delivery(job.deliveryId) : null;
  if (!delivery || delivery.userId !== job.userId) return void (await done(d, job, "gone"));
  if (delivery.channel === "phone") return phoneJob(job, delivery, d, tally);
  if (delivery.channel === "email") return emailJob(job, delivery, d, tally);
  await done(d, job, "unsupported");
}

async function giveUp(d: DeliverDeps, job: JobRecord, delivery: DeliveryRecord, reason: DeliveryReason, tally: WorkerSummary): Promise<void> {
  await d.store.patchDelivery(delivery.id, { status: "dead", reason, attempts: job.attempts });
  await d.store.complete(job, "dead", reason);
  tally.dead += 1;
}

// ------------------------------------------------------------------------------------------ e-mail

async function emailJob(job: JobRecord, delivery: DeliveryRecord, d: DeliverDeps, tally: WorkerSummary): Promise<void> {
  if (TERMINAL.has(delivery.status)) return void (await done(d, job, "already"));
  if (!delivery.event) return void (await done(d, job, "no_event")); // a test mail is sent by its own function, not by a job
  if (job.attempts > job.maxAttempts) return giveUp(d, job, delivery, "retries_used_up", tally);
  const stored = await d.store.prefsOf(delivery.userId);
  const prefs = alertPrefsOf(stored?.prefs);
  if (!channelOn(prefs, "email") || !prefs.channels.email[delivery.event.event]) {
    await d.store.patchDelivery(delivery.id, { status: "skipped", reason: "switched_off" });
    tally.skipped += 1;
    return void (await done(d, job, "switched_off"));
  }
  // the operator's emergency switch (KILL_MAIL): no mail, the log says why. Not retried – an alarm that arrives hours late is worse than none
  if (killed("mail")) return skip(d, job, delivery, "mail_off", tally);
  if (!d.mail) {
    await d.store.patchDelivery(delivery.id, { status: "failed", reason: "not_configured" });
    tally.failed += 1;
    return void (await done(d, job, "not_configured"));
  }
  const rcpt = await d.recipient(delivery.userId);
  if (!rcpt || !rcpt.confirmed) {
    const reason: DeliveryReason = rcpt ? "email_unconfirmed" : "no_recipient";
    await d.store.patchDelivery(delivery.id, { status: "failed", reason });
    tally.failed += 1;
    return void (await done(d, job, reason));
  }
  const content = buildEventMail({
    lang: prefs.lang,
    event: delivery.event.event,
    market: delivery.event.market,
    source: delivery.event.source,
    detail: delivery.event.detail,
    at: Date.parse(delivery.event.occurredAt) || d.now(),
    tz: safeZone(stored?.tz),
    appUrl: d.appUrl,
  });
  // the idempotency key is the delivery: every attempt of this mail carries it
  const sent = await sendMail(d.mail, { to: rcpt.email, subject: content.subject, text: content.text, idempotencyKey: createHash("sha256").update(`alert-delivery:${delivery.id}`).digest("hex").slice(0, 40) }, d.sendFetch);
  if (sent.ok) {
    await d.store.patchDelivery(delivery.id, { status: "sent", reason: null, attempts: job.attempts, providerRef: sent.id });
    tally.sent += 1;
    return void (await done(d, job, null));
  }
  console.error("[fn] alerts mail failed", sent.code);
  if (RETRYABLE_MAIL.has(sent.code) && job.attempts < Math.min(job.maxAttempts, MAX_ATTEMPTS)) {
    const wait = backoffSec(job.attempts) ?? 3600;
    await d.store.patchDelivery(delivery.id, { status: "queued", reason: sent.code, attempts: job.attempts });
    await d.store.retry(job, wait, sent.code);
    tally.retried += 1;
    return;
  }
  if (RETRYABLE_MAIL.has(sent.code)) return giveUp(d, job, delivery, sent.code, tally);
  await d.store.patchDelivery(delivery.id, { status: "failed", reason: sent.code, attempts: job.attempts });
  tally.failed += 1;
  await done(d, job, sent.code);
}

// ------------------------------------------------------------------------------------------ phone

async function phoneJob(job: JobRecord, delivery: DeliveryRecord, d: DeliverDeps, tally: WorkerSummary): Promise<void> {
  // 1) a call that may already be on its way is never dialed again
  if (delivery.dialedAt) {
    if (delivery.providerRef) return void (await done(d, job, "already_dialed"));
    if (!TERMINAL.has(delivery.status)) {
      await d.store.patchDelivery(delivery.id, { status: "failed", reason: "unclear" });
      tally.unclear += 1;
    }
    return void (await done(d, job, "unclear"));
  }
  if (TERMINAL.has(delivery.status)) return void (await done(d, job, "already"));
  if (job.attempts > job.maxAttempts) return giveUp(d, job, delivery, "retries_used_up", tally);

  // the operator's emergency switch (KILL_CALLS): no call, no budget used, the log says why. Not retried – an alarm that arrives hours late is worse than none
  if (killed("calls")) return skip(d, job, delivery, "calls_off", tally);

  const stored = await d.store.prefsOf(delivery.userId);
  const prefs = alertPrefsOf(stored?.prefs);
  const test = delivery.kind === "test";
  if (!test) {
    if (!delivery.event || !prefs.channels.phone[delivery.event.event]) return skip(d, job, delivery, "switched_off", tally);
    if (isQuiet(prefs.quiet, d.now(), safeZone(stored?.tz))) return skip(d, job, delivery, "quiet_hours", tally);
  }
  if (!d.twilio) {
    await d.store.patchDelivery(delivery.id, { status: "failed", reason: "not_configured" });
    tally.failed += 1;
    return void (await done(d, job, "not_configured"));
  }
  const secret = await d.store.phoneSecret(delivery.userId);
  if (!secret?.verified) return skip(d, job, delivery, "phone_opted_out", tally);
  let to: string;
  try {
    to = d.decryptNumber(delivery.userId, secret.numberEnc);
  } catch {
    await d.store.patchDelivery(delivery.id, { status: "failed", reason: "not_configured" });
    tally.failed += 1;
    return void (await done(d, job, "not_configured"));
  }

  // 2) commit the call (budget and `dialed_at` in one step) BEFORE dialing
  const limits = alertLimits(await d.plan(delivery.userId));
  const reserved = await d.store.phoneReserve(delivery.id, delivery.userId, limits.phoneCallsPerMonth, d.brakes.userDayMax, d.brakes.globalDayMax);
  if (reserved !== "ok") {
    if (reserved !== "already") tally.skipped += 1;
    return void (await done(d, job, reserved));
  }

  // 3) dial
  const text = test || !delivery.event ? testCallText(prefs.lang) : alertCallText(prefs.lang, delivery.event.event, delivery.event.market);
  const res = await createCall(d.twilio, { to, twiml: buildTwiml(prefs.lang, text), statusCallback: d.appUrl ? `${d.appUrl}/api/v1/alerts/twilio/status` : null });
  if (res.ok) {
    const mapped = mapCallStatus(res.status);
    await d.store.patchDelivery(delivery.id, { status: mapped && mapped.status !== "failed" ? mapped.status : "queued", reason: null, providerRef: res.sid });
    tally.dialed += 1;
    return void (await done(d, job, null));
  }
  console.error("[fn] alerts call failed", res.reason);
  if (res.reason === "unclear") {
    // Twilio may have created the call: keep the commitment (it counts), never dial again
    await d.store.patchDelivery(delivery.id, { status: "failed", reason: "unclear" });
    tally.unclear += 1;
    return void (await done(d, job, "unclear"));
  }
  // a definitive refusal: no call exists – the commitment is taken back, so it neither counts nor blocks a retry
  if (res.retryable && job.attempts < Math.min(job.maxAttempts, MAX_ATTEMPTS)) {
    await d.store.patchDelivery(delivery.id, { status: "queued", reason: res.reason, dialedAt: null, attempts: job.attempts });
    await d.store.retry(job, backoffSec(job.attempts) ?? 3600, res.reason);
    tally.retried += 1;
    return;
  }
  if (res.retryable) {
    await d.store.patchDelivery(delivery.id, { dialedAt: null });
    return giveUp(d, job, delivery, res.reason, tally);
  }
  await d.store.patchDelivery(delivery.id, { status: "failed", reason: res.reason, dialedAt: null });
  tally.failed += 1;
  await done(d, job, res.reason);
}

async function skip(d: DeliverDeps, job: JobRecord, delivery: DeliveryRecord, reason: DeliveryReason, tally: WorkerSummary): Promise<void> {
  await d.store.patchDelivery(delivery.id, { status: "skipped", reason });
  tally.skipped += 1;
  await done(d, job, reason);
}

// ------------------------------------------------------------------------------------------ run

/** Takes due jobs and delivers them. `userId`: only that account's jobs (the test call delivers right away). */
export async function runWorker(d: DeliverDeps, opts: { userId?: string; limit?: number; budgetMs?: number } = {}): Promise<WorkerSummary> {
  const tally = emptyWorkerSummary();
  const started = Date.now();
  const budget = opts.budgetMs ?? WORKER_BUDGET_MS;
  const jobs = await d.store.claim(opts.limit ?? 20, LEASE_SEC, opts.userId);
  tally.claimed = jobs.length;
  for (const job of jobs) {
    if (Date.now() - started > budget) break; // the rest keeps its lease and is taken again after it
    try {
      await processJob(job, d, tally);
    } catch (e) {
      tally.errors += 1;
      console.error("[fn] alerts job failed", e instanceof Error ? e.name : typeof e);
    }
  }
  return tally;
}

/** Asks Twilio for the state of calls whose callback did not arrive (older than `olderThanMs`). Quiet when nothing is open. */
export async function reconcileCalls(d: DeliverDeps, tally: WorkerSummary, olderThanMs = 3 * 60_000, limit = 10): Promise<void> {
  if (!d.twilio) return;
  const open = await d.store.openCalls(d.now() - olderThanMs, limit);
  for (const c of open) {
    const status = await getCall(d.twilio, c.providerRef);
    const mapped = status ? mapCallStatus(status) : null;
    if (!mapped) continue;
    if (await d.store.advanceByRef(c.providerRef, mapped.status, mapped.reason)) tally.reconciled += 1;
  }
}
