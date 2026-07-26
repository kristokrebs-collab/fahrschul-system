import { jobs } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { decideRetry } from "@fahrschul/events";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { pushDeadLetter, workerId } from "./outbox.js";
import { emitAlarm } from "./alarm.js";

/**
 * PROMPT -1 §13 – Persistenter Job-Store mit Absturzsicherheit.
 *
 * Eigenschaften (alle in der DB, nichts im Prozessspeicher):
 *  - LEASE/LOCK mit Ablauf: `lease_owner` + `lease_expires_at`. Ein Job wird
 *    beansprucht, nicht entnommen – stirbt der Worker, läuft der Lease ab.
 *  - RE-CLAIM nach Absturz: `recoverExpiredJobLeases()` gibt Jobs mit
 *    abgelaufenem Lease ODER überschrittener Maximallaufzeit wieder frei.
 *  - HEARTBEAT: ein laufender Job verlängert seinen Lease (`heartbeatJob`),
 *    damit lange, aber gesunde Läufe nicht fälschlich als tot gelten.
 *  - MAX-LAUFZEIT: `max_runtime_seconds` je Job; Überschreitung ist ein
 *    transienter Fehler und führt zu Re-Claim (bzw. nach Erschöpfung zur DLQ).
 *  - IDEMPOTENTE AUSFÜHRUNG: `dedupe_key` (partieller Unique-Index) verhindert
 *    doppelte Einplanung; die Handler selbst sind so gebaut, dass ein
 *    Wiederholungslauf denselben Endzustand erzeugt.
 *  - ERGEBNIS/FEHLER werden gespeichert (`result`, `last_error`, `error_class`).
 *  - Nach Erschöpfung: Dead-Letter-Queue + Alarm + manueller Wiederaufnahmepfad.
 */

export const JOB_TYPES = {
  notifications: "notifications.dispatch",
  bankImport: "bank.import",
  documentReview: "document.review",
  reporting: "reporting.daily",
  integrationSync: "integration.sync",
  reminders: "reminders.dispatch",
  offerExpiry: "appointment_offer.expire",
  consistencyCheck: "consistency.check",
  idempotencyCleanup: "idempotency.cleanup",
  outboxDispatch: "outbox.dispatch",
  /** PROMPT -1 §6 (Phase 2): Aufbewahrung der Realtime-Zustellzeilen. */
  realtimePrune: "realtime.prune",
  /** PROMPT -1 §12 (Phase 3): abgebrochene/abgelaufene Upload-Sitzungen räumen. */
  uploadsCleanup: "uploads.cleanup",
  /** PROMPT -1 §11 (Phase 3): gepufferte ausgehende Aufrufe wieder aufnehmen. */
  integrationResume: "integration.resume",
  /** PROMPT -1 §17 (Phase 3): Hash-Kette des Audit-Logs prüfen. */
  auditVerify: "audit.verify",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export interface EnqueueJobInput {
  jobType: JobType | string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  runAt?: Date;
  maxAttempts?: number;
  maxRuntimeSeconds?: number;
  priority?: number;
  correlationId?: string | null;
  standortId?: string | null;
  akteurBenutzerId?: string | null;
}

/**
 * Plant einen Job ein. Mit `dedupeKey` ist die Einplanung idempotent: ein
 * zweiter Aufruf mit demselben Schlüssel, während der erste noch offen ist,
 * legt KEINEN zweiten Job an, sondern liefert den vorhandenen zurück.
 */
export async function enqueueJob(db: Database, input: EnqueueJobInput) {
  const values = {
    jobType: input.jobType,
    payload: input.payload ?? {},
    dedupeKey: input.dedupeKey ?? null,
    runAt: input.runAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
    maxRuntimeSeconds: input.maxRuntimeSeconds ?? 60,
    priority: input.priority ?? 100,
    correlationId: input.correlationId ?? null,
    standortId: input.standortId ?? null,
    akteurBenutzerId: input.akteurBenutzerId ?? null,
  };

  if (!values.dedupeKey) {
    const [row] = await db.insert(jobs).values(values).returning();
    return { job: row, deduplicated: false as const };
  }

  const inserted = await db.insert(jobs).values(values).onConflictDoNothing().returning();
  if (inserted.length > 0) return { job: inserted[0], deduplicated: false as const };

  const [existing] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.jobType, values.jobType),
        eq(jobs.dedupeKey, values.dedupeKey),
        or(eq(jobs.status, "pending"), eq(jobs.status, "in_flight")),
      ),
    )
    .limit(1);
  return { job: existing, deduplicated: true as const };
}

/**
 * Gibt abgestürzte/hängende Jobs wieder frei. Zwei Fälle:
 *  1. Lease abgelaufen -> Worker ist weg.
 *  2. Maximallaufzeit überschritten, obwohl der Lease noch läuft -> Job hängt.
 * In beiden Fällen wird `attempts` NICHT zurückgesetzt, damit ein dauerhaft
 * hängender Job irgendwann in der Dead-Letter-Queue landet statt endlos zu
 * kreisen.
 */
export async function recoverExpiredJobLeases(db: Database): Promise<{ recovered: number; deadLettered: number }> {
  const stuck = await db.execute(sql`
    select * from jobs
     where status = 'in_flight'
       and (
         lease_expires_at is null
         or lease_expires_at <= now()
         or (started_at is not null and started_at + (max_runtime_seconds * interval '1 second') <= now())
       )
     for update skip locked
  `);
  const rows = stuck as unknown as Array<{
    id: string;
    job_type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string | null;
  }>;

  let recovered = 0;
  let deadLettered = 0;
  for (const row of rows) {
    const decision = decideRetry(
      Object.assign(new Error("Job-Lease abgelaufen oder Maximallaufzeit überschritten"), {
        errorClass: "LEASE_LOST" as const,
      }),
      row.attempts,
      row.max_attempts,
    );
    if (decision.retry) {
      await db
        .update(jobs)
        .set({
          status: "pending",
          leaseOwner: null,
          leaseExpiresAt: null,
          startedAt: null,
          runAt: new Date(Date.now() + decision.delayMs),
          lastError: "Lease abgelaufen – Worker vermutlich abgestürzt, Job neu eingeplant",
          errorClass: decision.errorClass,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, row.id));
      recovered += 1;
    } else {
      await db
        .update(jobs)
        .set({
          status: "dead",
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
          lastError: "Lease wiederholt verloren – Versuche erschöpft",
          errorClass: decision.errorClass,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, row.id));
      await pushDeadLetter(db, {
        source: "job",
        sourceId: row.id,
        kind: row.job_type,
        payload: row.payload,
        attempts: row.attempts,
        errorClass: decision.errorClass,
        lastError: "Lease wiederholt verloren – Versuche erschöpft",
        auditKontext: { reason: decision.reason, correlationId: row.correlation_id },
      });
      deadLettered += 1;
    }
  }
  return { recovered, deadLettered };
}

/** Beansprucht fällige Jobs (FOR UPDATE SKIP LOCKED -> mehrere Worker parallel möglich). */
export async function claimJobs(
  db: Database,
  options: { owner: string; limit?: number; jobTypes?: readonly string[] },
) {
  const limit = options.limit ?? 5;
  const typeFilter = options.jobTypes?.length
    ? sql` and job_type in ${sql.raw(`(${options.jobTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")})`)}`
    : sql``;
  const rows = await db.execute(sql`
    update jobs j
       set status = 'in_flight',
           lease_owner = ${options.owner},
           lease_expires_at = now() + (j.max_runtime_seconds * interval '1 second'),
           heartbeat_at = now(),
           started_at = now(),
           attempts = j.attempts + 1,
           updated_at = now()
     where j.id in (
       select id from jobs
        where status = 'pending' and run_at <= now()${typeFilter}
        order by priority, run_at
        for update skip locked
        limit ${limit}
     )
    returning j.*
  `);
  return rows as unknown as Array<{
    id: string;
    job_type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    max_runtime_seconds: number;
    correlation_id: string | null;
    standort_id: string | null;
    akteur_benutzer_id: string | null;
    dedupe_key: string | null;
  }>;
}

/** Verlängert den Lease eines laufenden Jobs. */
export async function heartbeatJob(db: Database, jobId: string, owner: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      heartbeatAt: new Date(),
      leaseExpiresAt: sql`now() + (${jobs.maxRuntimeSeconds} * interval '1 second')`,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, owner), eq(jobs.status, "in_flight")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function completeJob(
  db: Database,
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "succeeded",
      result,
      finishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      errorClass: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Verbucht einen fehlgeschlagenen Job nach der §9-Politik: transient ->
 * exponentieller Backoff mit Jitter; dauerhaft oder erschöpft -> DLQ + Alarm.
 */
export async function failJob(
  db: Database,
  job: { id: string; job_type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number; correlation_id: string | null },
  err: unknown,
): Promise<{ retried: boolean; deadLettered: boolean; errorClass: string }> {
  const decision = decideRetry(err, job.attempts, job.max_attempts);
  const message = (err as Error)?.message ?? String(err);

  if (decision.retry) {
    await db
      .update(jobs)
      .set({
        status: "pending",
        leaseOwner: null,
        leaseExpiresAt: null,
        runAt: new Date(Date.now() + decision.delayMs),
        lastError: message,
        errorClass: decision.errorClass,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    return { retried: true, deadLettered: false, errorClass: decision.errorClass };
  }

  await db
    .update(jobs)
    .set({
      status: decision.errorClass === "UNKNOWN_PERMANENT" ? "dead" : "failed",
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
      lastError: message,
      errorClass: decision.errorClass,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));

  await pushDeadLetter(db, {
    source: "job",
    sourceId: job.id,
    kind: job.job_type,
    payload: job.payload,
    attempts: job.attempts,
    errorClass: decision.errorClass,
    lastError: message,
    auditKontext: { reason: decision.reason, correlationId: job.correlation_id },
  });
  return { retried: false, deadLettered: true, errorClass: decision.errorClass };
}

/**
 * §9 Manueller Wiederaufnahmepfad: legt aus einem Dead-Letter-Eintrag einen
 * NEUEN Job an (statt den alten wiederzubeleben), damit die Historie des
 * Fehlschlags erhalten bleibt.
 */
export async function resumeDeadLetter(
  db: Database,
  input: { deadLetterId: string; akteurBenutzerId: string },
): Promise<{ ok: boolean; jobId?: string; reason?: string }> {
  const { deadLetters } = await import("@fahrschul/database");
  const [dl] = await db.select().from(deadLetters).where(eq(deadLetters.id, input.deadLetterId)).limit(1);
  if (!dl) return { ok: false, reason: "not_found" };
  if (dl.resumedAt) return { ok: false, reason: "already_resumed" };

  if (dl.source === "job") {
    const { job } = await enqueueJob(db, {
      jobType: dl.kind,
      payload: dl.payload as Record<string, unknown>,
      akteurBenutzerId: input.akteurBenutzerId,
      // Bewusst OHNE dedupeKey: eine manuelle Wiederaufnahme soll auch dann
      // greifen, wenn noch ein gleichnamiger Job offen ist.
    });
    await db
      .update(deadLetters)
      .set({ resumedAt: new Date(), resumedByBenutzerId: input.akteurBenutzerId, resumedJobId: job.id })
      .where(eq(deadLetters.id, dl.id));
    return { ok: true, jobId: job.id };
  }

  // Outbox-Dead-Letter: die Ereigniszeile wieder auf 'pending' setzen. Die
  // Inbox verhindert, dass ein bereits verarbeiteter Konsument doppelt läuft.
  const { eventOutbox } = await import("@fahrschul/database");
  await db
    .update(eventOutbox)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null, errorClass: null })
    .where(eq(eventOutbox.id, dl.sourceId));
  await db
    .update(deadLetters)
    .set({ resumedAt: new Date(), resumedByBenutzerId: input.akteurBenutzerId })
    .where(eq(deadLetters.id, dl.id));
  return { ok: true };
}

/** Diagnose: Jobs, die auffällig lange laufen (Basis für §16/§21 in späteren Phasen). */
export async function stuckJobs(db: Database) {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "in_flight"),
        or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, sql`now()`)),
      ),
    );
}

export { workerId, emitAlarm };
