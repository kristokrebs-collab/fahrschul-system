import {
  consistencyCheckRuns,
  consistencyFindings,
  deadLetters,
  eventCursors,
  eventInbox,
  eventOutbox,
  jobs,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import type {
  BankFeedAdapter,
  DocumentStorageAdapter,
  MalwareScanAdapter,
  NotificationsAdapter,
} from "@fahrschul/integrations";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  consistencyCheckCatalog,
  runConsistencyCheck,
} from "../services/consistency-check.js";
import { recentAlarms } from "../workers/alarm.js";
import { verifyAuditChain } from "../services/audit-chain.js";
import { listLockedThrottles, purgeExpiredThrottles } from "../lib/brute-force.js";
import {
  integrationRegistry,
  integrationStatus,
  resumeBufferedCalls,
  resumeFailedCall,
  type IntegrationServiceOptions,
} from "../services/integrations.js";
import { cleanupAbortedUploads } from "./uploads.js";
import { requireStepUp, STEP_UP_ACTIONS } from "../lib/step-up.js";
import { integrationOutboundCalls } from "@fahrschul/database";
import { buildConsumers } from "../workers/consumers.js";
import { enqueueJob, resumeDeadLetter } from "../workers/job-store.js";
import { openDeadLetterCount, runOutboxOnce } from "../workers/outbox.js";
import { runJobsOnce, scheduleRecurringJobs } from "../workers/runner.js";

/**
 * PROMPT -1 – Betriebsoberfläche für den Zuverlässigkeitskern.
 *
 * Warum überhaupt HTTP-Routen? Weil §13/§19 fordern, dass Jobs und der
 * Konsistenzcheck LAUFFÄHIG sind und ihre Ergebnisse nachvollziehbar –
 * ein reiner Cron-Eintrag wäre in dieser Umgebung nicht prüfbar. Die Routen
 * sind hinter `ops:*`-Permissions verriegelt (nur systemdienst und
 * geschaeftsfuehrung) und liefern ausschließlich technische Daten – keine
 * Schüler-Stammdaten, damit "systemdienst hat keinen Zugriff auf
 * Schülerdaten" gültig bleibt.
 *
 * SEAM Phase 3 (§16 Observability): diese Routen sind die natürliche Quelle
 * für Metriken (Outbox-Lag, DLQ-Tiefe, Job-Fehlerquote). SEAM Phase 4
 * (§15 Deployment, §20 Chaos, §21 SLOs): der Scheduler bzw. die
 * Chaos-Szenarien treiben `POST /ops/workers/run` und
 * `POST /ops/jobs/schedule-recurring`.
 */
export function registerOpsRoutes(
  app: FastifyInstance,
  db: Database,
  deps: {
    notifications: NotificationsAdapter;
    storage?: DocumentStorageAdapter;
    malwareScan?: MalwareScanAdapter;
    bankFeed?: BankFeedAdapter;
    resilience?: IntegrationServiceOptions;
  },
) {
  const consumers = buildConsumers(deps.notifications);
  const resilience = (): IntegrationServiceOptions => deps.resilience ?? { db };

  // -----------------------------------------------------------------------
  // §5 Outbox
  // -----------------------------------------------------------------------
  app.get(
    "/ops/outbox",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => {
      const byStatus = await db
        .select({ status: eventOutbox.status, n: sql<number>`count(*)` })
        .from(eventOutbox)
        .groupBy(eventOutbox.status);
      const oldest = await db
        .select({
          id: eventOutbox.id,
          eventType: eventOutbox.eventType,
          status: eventOutbox.status,
          attempts: eventOutbox.attempts,
          createdAt: eventOutbox.createdAt,
          lastError: eventOutbox.lastError,
        })
        .from(eventOutbox)
        .where(eq(eventOutbox.status, "pending"))
        .orderBy(eventOutbox.seq)
        .limit(20);
      const cursors = await db.select().from(eventCursors);
      const inboxCounts = await db
        .select({ consumer: eventInbox.consumer, n: sql<number>`count(*)` })
        .from(eventInbox)
        .groupBy(eventInbox.consumer);
      return reply.send({
        statusVerteilung: byStatus,
        aeltestePending: oldest,
        cursors,
        inbox: inboxCounts,
        offeneDeadLetters: await openDeadLetterCount(db),
      });
    },
  );

  app.post(
    "/ops/outbox/dispatch",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const body = z.object({ limit: z.number().int().positive().max(500).optional() }).safeParse(request.body ?? {});
      const result = await runOutboxOnce(db, consumers, { limit: body.success ? body.data.limit : undefined });
      return reply.send(result);
    },
  );

  // -----------------------------------------------------------------------
  // §13 Jobs
  // -----------------------------------------------------------------------
  app.get(
    "/ops/jobs",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (request, reply) => {
      const query = request.query as { jobType?: string; status?: string; limit?: string };
      const conditions = [];
      if (query.jobType) conditions.push(eq(jobs.jobType, query.jobType));
      if (query.status) conditions.push(eq(jobs.status, query.status));
      const rows = await db
        .select()
        .from(jobs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(jobs.createdAt))
        .limit(Number(query.limit ?? 50));
      const byStatus = await db
        .select({ status: jobs.status, jobType: jobs.jobType, n: sql<number>`count(*)` })
        .from(jobs)
        .groupBy(jobs.status, jobs.jobType);
      return reply.send({ jobs: rows, statusVerteilung: byStatus });
    },
  );

  app.post(
    "/ops/jobs",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const parsed = z
        .object({
          jobType: z.string().min(1),
          payload: z.record(z.unknown()).default({}),
          dedupeKey: z.string().min(1).nullable().optional(),
          runAt: z.coerce.date().optional(),
          maxAttempts: z.number().int().positive().max(20).optional(),
          maxRuntimeSeconds: z.number().int().positive().max(3600).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const { job, deduplicated } = await enqueueJob(db, {
        ...parsed.data,
        dedupeKey: parsed.data.dedupeKey ?? null,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
      });
      return reply.code(deduplicated ? 200 : 201).send({ job, deduplicated });
    },
  );

  app.post(
    "/ops/jobs/run",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const parsed = z
        .object({
          limit: z.number().int().positive().max(100).optional(),
          jobTypes: z.array(z.string().min(1)).optional(),
          owner: z.string().min(1).optional(),
        })
        .safeParse(request.body ?? {});
      const options = parsed.success ? parsed.data : {};
      const result = await runJobsOnce(
        {
          db,
          notifications: deps.notifications,
          consumers,
          storage: deps.storage,
          malwareScan: deps.malwareScan,
          bankFeed: deps.bankFeed,
        },
        options,
      );
      return reply.send(result);
    },
  );

  app.post(
    "/ops/jobs/schedule-recurring",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const result = await scheduleRecurringJobs(db, { akteurBenutzerId: request.user!.id });
      return reply.send(result);
    },
  );

  /** Ein kombinierter Durchlauf (Outbox + Jobs) – bequem für Betrieb und Chaos-Tests (Phase 4). */
  app.post(
    "/ops/workers/run",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const outbox = await runOutboxOnce(db, consumers, { limit: 100 });
      const jobResult = await runJobsOnce(
        {
          db,
          notifications: deps.notifications,
          consumers,
          storage: deps.storage,
          malwareScan: deps.malwareScan,
          bankFeed: deps.bankFeed,
        },
        { limit: 25 },
      );
      return reply.send({ outbox, jobs: jobResult, ausgeloestVon: request.user!.id });
    },
  );

  // -----------------------------------------------------------------------
  // §9 Dead-Letter-Queue + manuelle Wiederaufnahme
  // -----------------------------------------------------------------------
  app.get(
    "/ops/dead-letters",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (request, reply) => {
      const query = request.query as { offen?: string };
      const rows = await db
        .select()
        .from(deadLetters)
        .where(query.offen === "false" ? undefined : isNull(deadLetters.resumedAt))
        .orderBy(desc(deadLetters.createdAt))
        .limit(100);
      return reply.send({ deadLetters: rows, alarme: recentAlarms() });
    },
  );

  app.post(
    "/ops/dead-letters/:id/resume",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const result = await resumeDeadLetter(db, {
        deadLetterId: params.id,
        akteurBenutzerId: request.user!.id,
      });
      if (!result.ok) {
        return reply.code(result.reason === "not_found" ? 404 : 409).send({ error: result.reason });
      }
      return reply.send(result);
    },
  );

  // -----------------------------------------------------------------------
  // §19 Konsistenzprüfung
  // -----------------------------------------------------------------------
  app.get(
    "/ops/consistency/catalog",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => reply.send({ pruefungen: consistencyCheckCatalog() }),
  );

  app.post(
    "/ops/consistency/run",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const result = await runConsistencyCheck(db, {
        ausgeloestDurch: "api",
        akteurBenutzerId: request.user!.id,
      });
      return reply.code(201).send({
        runId: result.runId,
        anzahlBefunde: result.findings.length,
        zusammenfassung: result.zusammenfassung,
        fehlerhaftePruefungen: result.fehlerhaftePruefungen,
        befunde: result.findings,
        hinweis:
          "Riskante Reparaturen sind ausschließlich Vorschläge. Es gibt keinen Endpunkt, der sie anwendet.",
      });
    },
  );

  app.get(
    "/ops/consistency/runs",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => {
      const runs = await db
        .select()
        .from(consistencyCheckRuns)
        .orderBy(desc(consistencyCheckRuns.gestartetAt))
        .limit(20);
      return reply.send({ runs });
    },
  );

  // -----------------------------------------------------------------------
  // §11 Externe Schnittstellen: Gesundheit, Puffer, Fehlerwarteschlange
  // -----------------------------------------------------------------------
  app.get(
    "/ops/integrations",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => {
      const status = await integrationStatus(db);
      return reply.send({
        integrationen: status,
        hinweis:
          "Alle Integrationen laufen in dieser Umgebung im mock-Modus (docs/integration-gaps.md). Zeitlimit, Circuit Breaker, Retry, Idempotenzschlüssel und Fehlerwarteschlange sind echt und getestet; der ANBIETER ist es nicht.",
      });
    },
  );

  app.get(
    "/ops/integrations/error-queue",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (request, reply) => {
      const query = request.query as { integration?: string; status?: string; limit?: string };
      const conditions = [];
      if (query.integration) conditions.push(eq(integrationOutboundCalls.integration, query.integration));
      conditions.push(eq(integrationOutboundCalls.status, query.status ?? "failed"));
      const rows = await db
        .select()
        .from(integrationOutboundCalls)
        .where(and(...conditions))
        .orderBy(desc(integrationOutboundCalls.createdAt))
        .limit(Math.min(200, Number(query.limit ?? 50) || 50));
      return reply.send({ eintraege: rows });
    },
  );

  /** §11 "manuelle Wiederaufnahme". */
  app.post(
    "/ops/integrations/error-queue/:id/resume",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = z.object({ resetBreaker: z.boolean().optional() }).safeParse(request.body ?? {});
      const result = await resumeFailedCall(db, {
        callId: params.id,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
        correlationId: request.correlationId,
        resetBreaker: body.success ? body.data.resetBreaker : false,
      });
      if (!result.ok) {
        return reply.code(result.reason === "not_found" ? 404 : 409).send({ error: result.reason });
      }
      return reply.send(result);
    },
  );

  /** §11 "automatische Wiederaufnahme", von Hand ausgelöst (Betrieb/Chaos-Tests). */
  app.post(
    "/ops/integrations/resume",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const body = z
        .object({ integration: z.string().min(1).optional(), limit: z.number().int().positive().max(200).optional() })
        .safeParse(request.body ?? {});
      const result = await resumeBufferedCalls(resilience(), {
        integration: body.success ? (body.data.integration as never) : undefined,
        limit: body.success ? body.data.limit : undefined,
        execute: async (call) => resumeOutboundCall(call, deps),
      });
      return reply.send(result);
    },
  );

  /**
   * §11: Breaker von Hand schließen bzw. öffnen. Der Betrieb muss beides
   * können: "der Anbieter ist wieder da, versuch es sofort" und "der Anbieter
   * hat Wartung angekündigt, hör auf zu versuchen".
   */
  app.post(
    "/ops/integrations/:integration/breaker",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (request, reply) => {
      const params = request.params as { integration: string };
      const body = z.object({ aktion: z.enum(["schliessen", "oeffnen"]), grund: z.string().max(300).optional() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      const guard = integrationRegistry().get(params.integration);
      if (!guard) {
        return reply.code(404).send({
          error: "integration_unknown_or_not_used_yet",
          hinweis:
            "Für diese Integration existiert in diesem Prozess noch kein Wächter (es wurde noch kein Aufruf gemacht).",
        });
      }
      if (body.data.aktion === "schliessen") guard.reset();
      else guard.trip(body.data.grund ?? "manuell geöffnet");
      return reply.send({ integration: params.integration, zustand: guard.snapshot() });
    },
  );

  // -----------------------------------------------------------------------
  // §17 Manipulationssicheres Audit
  // -----------------------------------------------------------------------
  app.post(
    "/ops/audit/verify",
    {
      preHandler: [
        requireAuth,
        requirePermission("audit:read"),
      ],
    },
    async (request, reply) => {
      const body = z.object({ limit: z.number().int().positive().max(1000000).optional() }).safeParse(request.body ?? {});
      const result = await verifyAuditChain(db, { limit: body.success ? body.data.limit : undefined });
      return reply.code(result.ok ? 200 : 409).send(result);
    },
  );

  // -----------------------------------------------------------------------
  // §17 Brute-Force-Sperren (Betriebsansicht) + Aufräumen
  // -----------------------------------------------------------------------
  app.get(
    "/ops/auth/locks",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => reply.send({ sperren: await listLockedThrottles(db) }),
  );

  app.post(
    "/ops/auth/locks/purge",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage"), requireStepUp(db, STEP_UP_ACTIONS.authUnlock)] },
    async (_request, reply) => reply.send({ entfernt: await purgeExpiredThrottles(db) }),
  );

  // -----------------------------------------------------------------------
  // §12 Abgebrochene Uploads aufräumen (auch als Job verfügbar)
  // -----------------------------------------------------------------------
  app.post(
    "/ops/uploads/cleanup",
    { preHandler: [requireAuth, requirePermission("ops:jobs:manage")] },
    async (_request, reply) => reply.send(await cleanupAbortedUploads(db)),
  );

  app.get(
    "/ops/consistency/runs/:id",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [run] = await db
        .select()
        .from(consistencyCheckRuns)
        .where(eq(consistencyCheckRuns.id, params.id))
        .limit(1);
      if (!run) return reply.code(404).send({ error: "not_found" });
      const findings = await db
        .select()
        .from(consistencyFindings)
        .where(eq(consistencyFindings.runId, run.id));
      return reply.send({ run, befunde: findings });
    },
  );
}

/**
 * §11: die Wiederaufnahme eines gepufferten AUSGEHENDEN Aufrufs.
 *
 * Der Puffer speichert `integration`, `operation`, `idempotency_key` und
 * `payload` – bewusst NICHT eine Funktion. Diese Abbildung ist die Stelle, an
 * der aus diesen Daten wieder ein Adapteraufruf wird. Eine unbekannte
 * Kombination wirft absichtlich: sie darf nicht stillschweigend als "erledigt"
 * gelten.
 */
async function resumeOutboundCall(
  call: { integration: string; operation: string; idempotencyKey: string; payload: Record<string, unknown> },
  deps: {
    notifications: NotificationsAdapter;
    storage?: DocumentStorageAdapter;
    malwareScan?: MalwareScanAdapter;
    bankFeed?: BankFeedAdapter;
  },
): Promise<unknown> {
  if (call.integration === "notifications" && call.operation === "send") {
    return deps.notifications.send({
      to: String(call.payload.to ?? "unbekannt"),
      channel: call.payload.kanal === "email" ? "email" : "push",
      subject: String(call.payload.betreff ?? call.payload.kanal ?? "Nachricht"),
      body: String(call.payload.inhalt ?? ""),
    });
  }
  if (call.integration === "bank" && call.operation === "fetchTransactions" && deps.bankFeed) {
    return deps.bankFeed.fetchTransactions(String(call.payload.sinceIso ?? "1970-01-01T00:00:00Z"));
  }
  if (call.integration === "fahrschulverwaltung") {
    // Kein Zugang in dieser Umgebung (docs/integration-gaps.md). Ein
    // Wiederaufsetzen ohne Anbieter wäre eine Lüge, deshalb ein ehrlicher,
    // TRANSIENTER Fehler: der Eintrag bleibt gepuffert.
    throw Object.assign(new Error("Fahrschulverwaltung: kein Zugang (mock) – Aufruf bleibt gepuffert"), {
      errorClass: "SERVER_UNAVAILABLE" as const,
    });
  }
  throw Object.assign(
    new Error(`Kein Wiederaufnahmepfad für ${call.integration}.${call.operation}`),
    { errorClass: "UNKNOWN_PERMANENT" as const },
  );
}
