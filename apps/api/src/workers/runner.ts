import type { Database } from "@fahrschul/database";
import type { NotificationsAdapter } from "@fahrschul/integrations";
import { auditJobRun, resolveJobHandler, type JobContext } from "./job-handlers.js";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  JOB_TYPES,
  recoverExpiredJobLeases,
  workerId,
} from "./job-store.js";
import { buildConsumers } from "./consumers.js";
import { runOutboxOnce, type EventConsumer } from "./outbox.js";

/**
 * PROMPT -1 §13 – Der Job-Runner.
 *
 * Bewusst als "einen Durchlauf ausführen"-Funktion gebaut (`runJobsOnce`)
 * statt als daueraktive Endlosschleife im HTTP-Prozess:
 *   - deterministisch testbar (Absturz simulieren = Durchlauf abbrechen),
 *   - von außen treibbar (Cron/Scheduler/Ops-Route),
 *   - `startJobLoop` ergänzt die Schleife für den Serverbetrieb.
 *
 * Was der Runner NICHT tut: einen laufenden Job "abbrechen". Ein hängender
 * Job wird über Lease-Ablauf + Maximallaufzeit erkannt und neu beansprucht
 * (`recoverExpiredJobLeases`), weil ein echtes Abbrechen fremder Prozesse
 * hier nicht zuverlässig möglich wäre.
 */

export interface JobRunnerDeps {
  db: Database;
  notifications: NotificationsAdapter;
  consumers?: readonly EventConsumer[];
}

export interface JobRunResult {
  recovered: number;
  recoveredDeadLettered: number;
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  ergebnisse: Array<{ jobId: string; jobType: string; status: "succeeded" | "retried" | "dead"; result?: Record<string, unknown>; error?: string }>;
}

export async function runJobsOnce(
  deps: JobRunnerDeps,
  options: { owner?: string; limit?: number; jobTypes?: readonly string[] } = {},
): Promise<JobRunResult> {
  const db = deps.db;
  const consumers = deps.consumers ?? buildConsumers(deps.notifications);
  const owner = options.owner ?? workerId("jobs");

  const recovery = await recoverExpiredJobLeases(db);
  const result: JobRunResult = {
    recovered: recovery.recovered,
    recoveredDeadLettered: recovery.deadLettered,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    ergebnisse: [],
  };

  const batch = await claimJobs(db, { owner, limit: options.limit, jobTypes: options.jobTypes });
  result.claimed = batch.length;

  for (const job of batch) {
    const handler = resolveJobHandler(job.job_type);
    const ctx: JobContext = {
      db,
      notifications: deps.notifications,
      consumers,
      heartbeat: async () => {
        await heartbeatJob(db, job.id, owner);
      },
    };

    if (!handler) {
      const outcome = await failJob(
        db,
        job,
        Object.assign(new Error(`Kein Handler für Job-Typ "${job.job_type}" registriert`), {
          errorClass: "UNKNOWN_PERMANENT" as const,
        }),
      );
      result.deadLettered += outcome.deadLettered ? 1 : 0;
      result.ergebnisse.push({ jobId: job.id, jobType: job.job_type, status: "dead", error: "kein Handler" });
      continue;
    }

    try {
      const started = Date.now();
      const handlerResult = await handler(job.payload ?? {}, ctx);
      const dauerMs = Date.now() - started;

      // Maximallaufzeit ist eine harte Zusage: wurde sie überschritten, gilt
      // der Lauf als transient fehlgeschlagen (er könnte parallel neu
      // beansprucht worden sein), nicht als Erfolg.
      if (dauerMs > job.max_runtime_seconds * 1000) {
        const outcome = await failJob(
          db,
          job,
          Object.assign(
            new Error(`Maximallaufzeit überschritten (${dauerMs} ms > ${job.max_runtime_seconds * 1000} ms)`),
            { errorClass: "TIMEOUT" as const },
          ),
        );
        if (outcome.retried) result.retried += 1;
        if (outcome.deadLettered) result.deadLettered += 1;
        result.ergebnisse.push({
          jobId: job.id,
          jobType: job.job_type,
          status: outcome.retried ? "retried" : "dead",
          error: "max_runtime_exceeded",
        });
        continue;
      }

      const enriched = { ...handlerResult, dauerMs };
      await completeJob(db, job.id, enriched);
      await auditJobRun(db, {
        jobId: job.id,
        jobType: job.job_type,
        result: enriched,
        akteurBenutzerId: job.akteur_benutzer_id,
        standortId: job.standort_id,
      });
      result.succeeded += 1;
      result.ergebnisse.push({ jobId: job.id, jobType: job.job_type, status: "succeeded", result: enriched });
    } catch (err) {
      const outcome = await failJob(db, job, err);
      if (outcome.retried) result.retried += 1;
      if (outcome.deadLettered) result.deadLettered += 1;
      result.ergebnisse.push({
        jobId: job.id,
        jobType: job.job_type,
        status: outcome.retried ? "retried" : "dead",
        error: (err as Error).message,
      });
    }
  }

  return result;
}

/** Ein kombinierter Durchlauf: erst Outbox zustellen, dann Jobs abarbeiten. */
export async function runWorkersOnce(deps: JobRunnerDeps, options: { limit?: number } = {}) {
  const consumers = deps.consumers ?? buildConsumers(deps.notifications);
  const outbox = await runOutboxOnce(deps.db, consumers, { limit: options.limit });
  const jobs = await runJobsOnce({ ...deps, consumers }, { limit: options.limit });
  return { outbox, jobs };
}

/**
 * Die wiederkehrenden Jobs. Bewusst mit `dedupeKey` je Zeitfenster: ein
 * erneuter Aufruf innerhalb desselben Fensters legt keinen zweiten Job an.
 * §15 (Deployment/Scheduler-Verdrahtung) gehört zu Phase 4 – hier existiert
 * die einplanbare Funktion, nicht der Cron-Eintrag.
 */
export async function scheduleRecurringJobs(
  db: Database,
  options: { now?: Date; akteurBenutzerId?: string | null } = {},
) {
  const now = options.now ?? new Date();
  const tag = now.toISOString().slice(0, 10);
  const stunde = now.toISOString().slice(0, 13);
  const fuenfMinuten = `${stunde}:${String(Math.floor(now.getUTCMinutes() / 5) * 5).padStart(2, "0")}`;

  const geplant = [
    { jobType: JOB_TYPES.offerExpiry, dedupeKey: `offer-expiry:${fuenfMinuten}`, maxRuntimeSeconds: 60 },
    { jobType: JOB_TYPES.notifications, dedupeKey: `notifications:${fuenfMinuten}`, maxRuntimeSeconds: 120 },
    { jobType: JOB_TYPES.outboxDispatch, dedupeKey: `outbox:${fuenfMinuten}`, maxRuntimeSeconds: 120 },
    { jobType: JOB_TYPES.documentReview, dedupeKey: `document-review:${stunde}`, maxRuntimeSeconds: 120 },
    { jobType: JOB_TYPES.bankImport, dedupeKey: `bank-import:${stunde}`, maxRuntimeSeconds: 300 },
    { jobType: JOB_TYPES.integrationSync, dedupeKey: `integration-sync:${stunde}`, maxRuntimeSeconds: 300 },
    { jobType: JOB_TYPES.reminders, dedupeKey: `reminders:${tag}`, maxRuntimeSeconds: 300 },
    { jobType: JOB_TYPES.reporting, dedupeKey: `reporting:${tag}`, maxRuntimeSeconds: 300 },
    { jobType: JOB_TYPES.consistencyCheck, dedupeKey: `consistency:${tag}`, maxRuntimeSeconds: 300 },
    { jobType: JOB_TYPES.idempotencyCleanup, dedupeKey: `idempotency-cleanup:${tag}`, maxRuntimeSeconds: 60 },
  ];

  const created: string[] = [];
  for (const spec of geplant) {
    const { job, deduplicated } = await enqueueJob(db, {
      ...spec,
      akteurBenutzerId: options.akteurBenutzerId ?? null,
    });
    if (!deduplicated && job) created.push(spec.jobType);
  }
  return { eingeplant: created, gesamt: geplant.length };
}

/**
 * Dauerbetrieb für den Server. Nicht in Tests verwendet (dort wird
 * `runWorkersOnce` deterministisch aufgerufen).
 */
export function startWorkerLoop(deps: JobRunnerDeps, intervalMs = 5000) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await scheduleRecurringJobs(deps.db);
      await runWorkersOnce(deps);
    } catch (err) {
      process.stderr.write(`[worker-loop] ${(err as Error).message}\n`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
