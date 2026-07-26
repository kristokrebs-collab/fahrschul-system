import { createDatabase, createRawClient } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { createNotificationsAdapter } from "@fahrschul/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildConsumers } from "../workers/consumers.js";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  JOB_TYPES,
  recoverExpiredJobLeases,
  resumeDeadLetter,
} from "../workers/job-store.js";
import { runJobsOnce, scheduleRecurringJobs } from "../workers/runner.js";
import { TEST_JOB_TYPE } from "../workers/job-handlers.js";
import {
  buildTestApp,
  enableMfa,
  ensureMigrated,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

/**
 * PROMPT -1 §13 – Absturzsicherheit für Worker und Jobs, plus §9 Serverseite.
 *
 * Beweisziele:
 *   - Lease/Lock mit Ablauf, Re-Claim nach Absturz, Heartbeat, Maximallaufzeit
 *   - idempotente Einplanung (dedupe_key) und idempotente Ausführung
 *   - gespeichertes Ergebnis/Fehler
 *   - Retry NUR bei transienten Fehlern, danach Dead-Letter + Alarm + manuelle
 *     Wiederaufnahme
 *   - alle sieben geforderten Job-Arten sind registriert UND lauffähig
 */
describe("PROMPT -1 §13 – Job-Store mit Absturz-Wiederaufnahme", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let db: Database;
  let fixtures: SeededFixtures;
  let sql: ReturnType<typeof createRawClient>;
  let opsCookie: string;
  let officeCookie: string;

  beforeAll(async () => {
    process.env.FAHRSCHUL_ENABLE_TEST_JOBS = "1";
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
    db = createDatabase(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.FAHRSCHUL_ENABLE_TEST_JOBS;
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    sql = createRawClient(databaseUrl);
    await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
      select ${fixtures.standortId}, 'systemdienst@test.local', password_hash, 'systemdienst', 'Sys', 'Dienst', true, mfa_secret
        from benutzer where id = ${fixtures.bueroBenutzerId}`;
    opsCookie = await loginAs(app, "systemdienst@test.local", fixtures.password, fixtures.bueroTotpSecret);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterEach(async () => {
    await sql.end();
  });

  const deps = () => ({
    db,
    notifications: createNotificationsAdapter("mock"),
    consumers: buildConsumers(createNotificationsAdapter("mock")),
  });

  // -----------------------------------------------------------------------
  // Lease / Re-Claim / Heartbeat / Maximallaufzeit
  // -----------------------------------------------------------------------
  describe("lease, crash recovery, heartbeat, max runtime", () => {
    it("claims a job with a lease and prevents a second worker from taking it", async () => {
      await enqueueJob(db, { jobType: TEST_JOB_TYPE, payload: { mode: "ok" }, maxRuntimeSeconds: 60 });

      const workerA = await claimJobs(db, { owner: "A", limit: 5 });
      expect(workerA).toHaveLength(1);
      expect(workerA[0].attempts).toBe(1);

      const workerB = await claimJobs(db, { owner: "B", limit: 5 });
      expect(workerB).toHaveLength(0);

      const row = await sql`select status, lease_owner, lease_expires_at, heartbeat_at, started_at from jobs`;
      expect(row[0].status).toBe("in_flight");
      expect(row[0].lease_owner).toBe("A");
      expect(row[0].lease_expires_at).toBeTruthy();
      expect(row[0].heartbeat_at).toBeTruthy();
      expect(row[0].started_at).toBeTruthy();
    });

    it("RE-CLAIMS a job after the worker crashed (expired lease) and finishes it", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "ok" },
        maxRuntimeSeconds: 60,
      });

      // Worker A beansprucht und stirbt (kein complete/fail).
      await claimJobs(db, { owner: "A-crashed", limit: 5 });
      await sql`update jobs set lease_expires_at = now() - interval '1 minute' where id = ${job!.id}`;

      const recovery = await recoverExpiredJobLeases(db);
      expect(recovery.recovered).toBe(1);
      expect(recovery.deadLettered).toBe(0);

      const nachRecovery = await sql`select status, lease_owner, attempts, last_error from jobs where id = ${job!.id}`;
      expect(nachRecovery[0].status).toBe("pending");
      expect(nachRecovery[0].lease_owner).toBeNull();
      // attempts wird NICHT zurückgesetzt: ein dauerhaft hängender Job landet
      // irgendwann in der DLQ statt endlos zu kreisen.
      expect(nachRecovery[0].attempts).toBe(1);
      expect(String(nachRecovery[0].last_error)).toContain("Lease abgelaufen");

      // Backoff aufheben, dann läuft der Job durch.
      await sql`update jobs set run_at = now() where id = ${job!.id}`;
      const result = await runJobsOnce(deps(), { owner: "B", limit: 5 });
      expect(result.succeeded).toBe(1);
      const finished = await sql`select status, result, attempts from jobs where id = ${job!.id}`;
      expect(finished[0].status).toBe("succeeded");
      expect(finished[0].attempts).toBe(2);
      expect(finished[0].result).toMatchObject({ ok: true });
    });

    it("treats an exceeded MAX RUNTIME as a transient failure and re-queues the job", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "hang", ms: 250 },
        maxRuntimeSeconds: 1,
      });
      // maxRuntimeSeconds muss integer sein -> direkt in der DB auf 0 setzen,
      // damit jede Laufzeit > 0 ms als Überschreitung gilt.
      await sql`update jobs set max_runtime_seconds = 0 where id = ${job!.id}`;

      const result = await runJobsOnce(deps(), { owner: "slow", limit: 5 });
      expect(result.retried).toBe(1);
      const row = await sql`select status, error_class, last_error from jobs where id = ${job!.id}`;
      expect(row[0].status).toBe("pending");
      expect(row[0].error_class).toBe("TIMEOUT");
      expect(String(row[0].last_error)).toContain("Maximallaufzeit");
    });

    it("extends the lease via heartbeat, and only for the owning worker", async () => {
      const { job } = await enqueueJob(db, { jobType: TEST_JOB_TYPE, payload: { mode: "ok" } });
      await claimJobs(db, { owner: "owner-1", limit: 5 });
      const before = await sql`select lease_expires_at, heartbeat_at from jobs where id = ${job!.id}`;
      await sql`update jobs set lease_expires_at = now() + interval '1 second' where id = ${job!.id}`;

      expect(await heartbeatJob(db, job!.id, "owner-1")).toBe(true);
      const after = await sql`select lease_expires_at from jobs where id = ${job!.id}`;
      expect(new Date(after[0].lease_expires_at).getTime()).toBeGreaterThan(
        new Date(before[0].lease_expires_at).getTime() - 1000,
      );

      // Ein fremder Worker darf den Lease NICHT verlängern.
      expect(await heartbeatJob(db, job!.id, "owner-2")).toBe(false);
    });

    it("dead-letters a job whose lease keeps expiring until attempts are exhausted", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "ok" },
        maxAttempts: 1,
      });
      await claimJobs(db, { owner: "A", limit: 5 });
      await sql`update jobs set lease_expires_at = now() - interval '1 minute' where id = ${job!.id}`;

      const recovery = await recoverExpiredJobLeases(db);
      expect(recovery.deadLettered).toBe(1);
      const row = await sql`select status from jobs where id = ${job!.id}`;
      expect(row[0].status).toBe("dead");
      const dl = await sql`select source, kind, alarm_emitted_at from dead_letters where source = 'job'`;
      expect(dl).toHaveLength(1);
      expect(dl[0].kind).toBe(TEST_JOB_TYPE);
      expect(dl[0].alarm_emitted_at).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Idempotente Einplanung + Ausführung
  // -----------------------------------------------------------------------
  describe("idempotent scheduling and execution", () => {
    it("does not enqueue a second open job for the same dedupe key", async () => {
      const first = await enqueueJob(db, { jobType: JOB_TYPES.reporting, dedupeKey: "tag-2026-07-26" });
      expect(first.deduplicated).toBe(false);
      const second = await enqueueJob(db, { jobType: JOB_TYPES.reporting, dedupeKey: "tag-2026-07-26" });
      expect(second.deduplicated).toBe(true);
      expect(second.job!.id).toBe(first.job!.id);

      const rows = await sql`select count(*)::int as n from jobs where job_type = ${JOB_TYPES.reporting}`;
      expect(rows[0].n).toBe(1);
    });

    it("allows re-scheduling the same dedupe key after the job finished", async () => {
      const first = await enqueueJob(db, { jobType: JOB_TYPES.reporting, dedupeKey: "tag-x" });
      await completeJob(db, first.job!.id, { ok: true });
      const second = await enqueueJob(db, { jobType: JOB_TYPES.reporting, dedupeKey: "tag-x" });
      expect(second.deduplicated).toBe(false);
      expect(second.job!.id).not.toBe(first.job!.id);
    });

    it("schedules all recurring jobs exactly once per window", async () => {
      const first = await scheduleRecurringJobs(db, { now: new Date("2026-07-26T10:02:00Z") });
      expect(first.eingeplant.length).toBe(first.gesamt);
      const second = await scheduleRecurringJobs(db, { now: new Date("2026-07-26T10:03:00Z") });
      // Dieselben 5-Minuten-/Stunden-/Tagesfenster -> keine Dopplung.
      expect(second.eingeplant).toEqual([]);

      const rows = await sql`select job_type, count(*)::int as n from jobs group by job_type`;
      for (const row of rows) {
        expect(row.n, `${row.job_type} doppelt eingeplant`).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // §9 Retry/DLQ-Politik
  // -----------------------------------------------------------------------
  describe("§9 retry policy on the server side", () => {
    it("retries a TRANSIENT failure with backoff and stores the error", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "transient" },
        maxAttempts: 3,
      });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.retried).toBe(1);
      expect(result.deadLettered).toBe(0);

      const row = await sql`select status, attempts, error_class, last_error, run_at from jobs where id = ${job!.id}`;
      expect(row[0].status).toBe("pending");
      expect(row[0].error_class).toBe("TIMEOUT");
      expect(String(row[0].last_error)).toContain("transienter Testfehler");
      expect(new Date(row[0].run_at).getTime()).toBeGreaterThan(Date.now() - 1000);

      const dl = await sql`select count(*)::int as n from dead_letters`;
      expect(dl[0].n).toBe(0);
    });

    it("NEVER retries a permanent (validation) failure – straight to the DLQ", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "permanent" },
        maxAttempts: 10,
      });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.retried).toBe(0);
      expect(result.deadLettered).toBe(1);

      const row = await sql`select status, attempts, error_class from jobs where id = ${job!.id}`;
      expect(row[0].status).toBe("failed");
      expect(row[0].attempts).toBe(1); // KEIN zweiter Versuch
      expect(row[0].error_class).toBe("VALIDATION");

      const dl = await sql`select kind, error_class, attempts, audit_kontext from dead_letters where source = 'job'`;
      expect(dl).toHaveLength(1);
      expect(dl[0].error_class).toBe("VALIDATION");
      expect(String((dl[0].audit_kontext as { reason: string }).reason)).toContain("dauerhafter Fehler");
    });

    it("dead-letters after exhausting the attempts of a transient failure", async () => {
      const { job } = await enqueueJob(db, {
        jobType: TEST_JOB_TYPE,
        payload: { mode: "transient" },
        maxAttempts: 2,
      });
      await runJobsOnce(deps(), { owner: "w", limit: 5 });
      await sql`update jobs set run_at = now() where id = ${job!.id}`;
      const second = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(second.deadLettered).toBe(1);
      const dl = await sql`select attempts from dead_letters where source = 'job'`;
      expect(dl[0].attempts).toBe(2);
    });

    it("dead-letters an unknown job type instead of retrying forever", async () => {
      await enqueueJob(db, { jobType: "gibt.es.nicht", maxAttempts: 5 });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.deadLettered).toBe(1);
      const rows = await sql`select status, error_class from jobs where job_type = 'gibt.es.nicht'`;
      expect(rows[0].status).toBe("dead");
      expect(rows[0].error_class).toBe("UNKNOWN_PERMANENT");
    });

    it("supports MANUAL resume of a dead-lettered job as a NEW job (history preserved)", async () => {
      const { job } = await enqueueJob(db, { jobType: TEST_JOB_TYPE, payload: { mode: "permanent" } });
      await runJobsOnce(deps(), { owner: "w", limit: 5 });
      const dl = await sql`select id from dead_letters where source = 'job'`;

      const resume = await resumeDeadLetter(db, {
        deadLetterId: dl[0].id as string,
        akteurBenutzerId: fixtures.bueroBenutzerId,
      });
      expect(resume.ok).toBe(true);
      expect(resume.jobId).toBeTruthy();
      expect(resume.jobId).not.toBe(job!.id);

      const alt = await sql`select status from jobs where id = ${job!.id}`;
      expect(alt[0].status).toBe("failed"); // Historie bleibt erhalten

      const eintrag = await sql`select resumed_at, resumed_by_benutzer_id, resumed_job_id from dead_letters where id = ${dl[0].id}`;
      expect(eintrag[0].resumed_at).toBeTruthy();
      expect(eintrag[0].resumed_by_benutzer_id).toBe(fixtures.bueroBenutzerId);
      expect(eintrag[0].resumed_job_id).toBe(resume.jobId);

      const zweiteWiederaufnahme = await resumeDeadLetter(db, {
        deadLetterId: dl[0].id as string,
        akteurBenutzerId: fixtures.bueroBenutzerId,
      });
      expect(zweiteWiederaufnahme).toEqual({ ok: false, reason: "already_resumed" });
    });

    it("classifies a business-constraint violation (FS00x) as permanent, never retried", async () => {
      const outcome = await failJob(
        db,
        {
          id: (await enqueueJob(db, { jobType: TEST_JOB_TYPE })).job!.id,
          job_type: TEST_JOB_TYPE,
          payload: {},
          attempts: 1,
          max_attempts: 10,
          correlation_id: null,
        },
        Object.assign(new Error("Fahrzeug gesperrt"), { code: "FS005" }),
      );
      expect(outcome.retried).toBe(false);
      expect(outcome.deadLettered).toBe(true);
      expect(outcome.errorClass).toBe("BUSINESS_CONFLICT");
    });
  });

  // -----------------------------------------------------------------------
  // Die sieben geforderten Job-Arten
  // -----------------------------------------------------------------------
  describe("all mandated job kinds exist and actually run", () => {
    it("registers a handler for Benachrichtigungen, Bankimport, Dokumentprüfung, Reporting, Integrationssync, Erinnerungen and Angebotsablauf", async () => {
      const pflicht = [
        JOB_TYPES.notifications,
        JOB_TYPES.bankImport,
        JOB_TYPES.documentReview,
        JOB_TYPES.reporting,
        JOB_TYPES.integrationSync,
        JOB_TYPES.reminders,
        JOB_TYPES.offerExpiry,
      ];
      for (const jobType of pflicht) {
        await enqueueJob(db, { jobType });
      }
      const result = await runJobsOnce(deps(), { owner: "w", limit: 20 });
      expect(result.claimed).toBe(pflicht.length);
      expect(result.succeeded, JSON.stringify(result.ergebnisse)).toBe(pflicht.length);
      for (const entry of result.ergebnisse) {
        expect(entry.status).toBe("succeeded");
        expect(entry.result).toBeTruthy();
      }
    });

    it("Angebotsablauf: expires overdue offers as a REAL, audited state transition", async () => {
      // Vorher war der Ablauf nur ein Lesefilter – jetzt ein persistierter
      // Zustandsübergang mit Ereignis.
      const beginn = new Date(Date.now() + 800 * 3600_000);
      const created = await app.inject({
        method: "POST",
        url: "/appointment-offers",
        headers: { cookie: officeCookie },
        payload: {
          fahrlehrerId: fixtures.fahrlehrerId,
          klasse: "B",
          beginnAt: beginn.toISOString(),
          endeAt: new Date(beginn.getTime() + 3600_000).toISOString(),
          ablaufAt: new Date(Date.now() - 60_000).toISOString(),
        },
      });
      expect(created.statusCode).toBe(201);
      const offerId = created.json().offer.id as string;

      await enqueueJob(db, { jobType: JOB_TYPES.offerExpiry });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.succeeded).toBe(1);
      expect(result.ergebnisse[0].result).toMatchObject({ terminangeboteAbgelaufen: 1 });

      const rows = await sql`select angebot_status, status from terminangebote where id = ${offerId}`;
      expect(rows[0].angebot_status).toBe("expired");
      expect(rows[0].status).toBe("abgelaufen"); // Alt-Spalte synchron

      const transitions = await sql`
        select von_status, nach_status from state_transitions
         where machine = 'terminangebot' and entitaet_id = ${offerId} order by created_at`;
      expect(transitions.map((t) => t.nach_status)).toContain("expired");

      const events = await sql`select count(*)::int as n from event_outbox where event_type = 'lesson.offer.expired'`;
      expect(events[0].n).toBe(1);

      // Zweiter Lauf ist ein No-Op (idempotent).
      await enqueueJob(db, { jobType: JOB_TYPES.offerExpiry });
      const again = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(again.ergebnisse[0].result).toMatchObject({ terminangeboteAbgelaufen: 0 });
    });

    it("Bankimport: only konfidenz='sicher' is auto-matched, everything else waits for a human", async () => {
      await sql`
        insert into banktransaktionen (standort_id, external_id, amount_cent, booked_at, konfidenz, auto_gebucht, rechnung_ids, zahlung_status)
        values
          (${fixtures.standortId}, 'sicher-1', 5000, current_date, 'sicher', true, '["11111111-1111-1111-1111-111111111111"]'::jsonb, 'imported'),
          (${fixtures.standortId}, 'wahrsch-1', 5000, current_date, 'wahrscheinlich', false, '[]'::jsonb, 'imported'),
          (${fixtures.standortId}, 'unklar-1', 5000, current_date, 'unklar', false, '[]'::jsonb, 'imported')`;

      await enqueueJob(db, { jobType: JOB_TYPES.bankImport });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.succeeded).toBe(1);
      expect(result.ergebnisse[0].result).toMatchObject({
        automatischGebucht: 1,
        vorgeschlagen: 1,
        zurPruefung: 1,
      });

      const rows = await sql`select external_id, zahlung_status from banktransaktionen order by external_id`;
      const byId = Object.fromEntries(rows.map((r) => [r.external_id, r.zahlung_status]));
      expect(byId["sicher-1"]).toBe("matched");
      expect(byId["wahrsch-1"]).toBe("suggested");
      expect(byId["unklar-1"]).toBe("review_required");
    });

    it("Dokumentprüfung: never auto-verifies – it only moves uploads to submitted", async () => {
      await sql`
        insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'a.pdf', 'mock://a', 'uploaded', 'sauber'),
               (${fixtures.standortId}, ${fixtures.schuelerId}, 'passbild', 'b.pdf', 'mock://b', 'uploaded', 'verdaechtig')`;

      await enqueueJob(db, { jobType: JOB_TYPES.documentReview });
      const result = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(result.ergebnisse[0].result).toMatchObject({ zurPruefungEingereicht: 1, inQuarantaene: 1 });

      const rows = await sql`select typ, dokument_status from dokumente order by typ`;
      const byTyp = Object.fromEntries(rows.map((r) => [r.typ, r.dokument_status]));
      expect(byTyp["sehtest"]).toBe("submitted");
      expect(byTyp["passbild"]).toBe("quarantined");
      // KEIN automatisches "verified" – das braucht ein Prüfprotokoll (§3).
      expect(Object.values(byTyp)).not.toContain("verified");
    });

    it("Erinnerungen: queues one reminder per upcoming lesson and is idempotent", async () => {
      const beginn = new Date(Date.now() + 30 * 3600_000);
      await sql`
        insert into terminbuchungen (standort_id, schueler_id, fahrlehrer_id, beginn_at, ende_at, art, status)
        values (${fixtures.standortId}, ${fixtures.schuelerId}, ${fixtures.fahrlehrerId},
                ${beginn.toISOString()}, ${new Date(beginn.getTime() + 3600_000).toISOString()}, 'Übungsstunde', 'bestaetigt')`;

      await enqueueJob(db, { jobType: JOB_TYPES.reminders, dedupeKey: "r1" });
      const first = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(first.ergebnisse[0].result).toMatchObject({ erinnerungenEingeplant: 1 });

      await enqueueJob(db, { jobType: JOB_TYPES.reminders, dedupeKey: "r2" });
      const second = await runJobsOnce(deps(), { owner: "w", limit: 5 });
      expect(second.ergebnisse[0].result).toMatchObject({ erinnerungenEingeplant: 0 });

      const rows = await sql`select count(*)::int as n from nachrichten where status = 'warteschlange'`;
      expect(rows[0].n).toBe(1);
    });

    it("stores the result of every successful job run and audits it", async () => {
      await enqueueJob(db, { jobType: JOB_TYPES.reporting });
      await runJobsOnce(deps(), { owner: "w", limit: 5 });
      const rows = await sql`select status, result, finished_at from jobs where job_type = ${JOB_TYPES.reporting}`;
      expect(rows[0].status).toBe("succeeded");
      expect(rows[0].finished_at).toBeTruthy();
      expect(rows[0].result).toHaveProperty("dauerMs");
      const audit = await sql`select count(*)::int as n from audit_events where type = ${"job." + JOB_TYPES.reporting}`;
      expect(audit[0].n).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Ops-Oberfläche
  // -----------------------------------------------------------------------
  describe("ops surface for jobs", () => {
    it("enqueues, deduplicates and runs jobs over HTTP", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/ops/jobs",
        headers: { cookie: opsCookie },
        payload: { jobType: JOB_TYPES.reporting, dedupeKey: "http-1" },
      });
      expect(create.statusCode).toBe(201);

      const dupe = await app.inject({
        method: "POST",
        url: "/ops/jobs",
        headers: { cookie: opsCookie },
        payload: { jobType: JOB_TYPES.reporting, dedupeKey: "http-1" },
      });
      expect(dupe.statusCode).toBe(200);
      expect(dupe.json().deduplicated).toBe(true);

      const run = await app.inject({
        method: "POST",
        url: "/ops/jobs/run",
        headers: { cookie: opsCookie },
        payload: { limit: 10 },
      });
      expect(run.statusCode).toBe(200);
      expect(run.json().succeeded).toBe(1);

      const list = await app.inject({ method: "GET", url: "/ops/jobs", headers: { cookie: opsCookie } });
      expect(list.statusCode).toBe(200);
      expect(list.json().jobs.length).toBeGreaterThan(0);
    });

    it("denies job management to non-ops roles", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/ops/jobs/run",
        headers: { cookie: officeCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });

    it("runs outbox + jobs in one combined pass", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/ops/workers/run",
        headers: { cookie: opsCookie },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("outbox");
      expect(res.json()).toHaveProperty("jobs");
    });
  });
});
