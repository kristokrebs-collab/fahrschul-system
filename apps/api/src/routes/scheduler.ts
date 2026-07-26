import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { deploymentIdentity, uptimeSeconds } from "../lib/deployment.js";
import type { Scheduler } from "../workers/scheduler.js";

declare module "fastify" {
  interface FastifyInstance {
    scheduler: Scheduler;
  }
}

/**
 * PROMPT -1 §15 (Phase 4) – `GET /ops/scheduler`.
 *
 * Die eine Frage, die vor Phase 4 nicht beantwortbar war: **läuft in diesem
 * Prozess überhaupt ein Takt?** Ohne diese Antwort ist jeder andere
 * Betriebsblick irreführend – eine leere Dead-Letter-Queue bei stehendem
 * Scheduler bedeutet nicht "alles gut", sondern "es wurde nie zugestellt".
 *
 * Deshalb liefert die Route nicht nur `aktiv: true|false`, sondern auch das
 * ALTER des letzten Takts. Ein Scheduler, der als aktiv gemeldet ist, aber seit
 * zwanzig Minuten nicht getickt hat, ist der gefährlichere Fall, weil er still
 * ist (siehe Alarm `scheduler_stalled`).
 */
export function registerSchedulerRoute(
  app: FastifyInstance,
  scheduler: Scheduler,
  aktiviert: boolean,
): void {
  app.get(
    "/ops/scheduler",
    { preHandler: [requireAuth, requirePermission("ops:reliability:read")] },
    async (_request, reply) => {
      const stats = scheduler.stats();
      const alter = (iso: string | null) =>
        iso === null ? null : Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
      const id = deploymentIdentity();
      return reply.send({
        aktiv: aktiviert && scheduler.running,
        konfiguriert: aktiviert,
        instanceId: id.instanceId,
        deploymentId: id.deploymentId,
        prozessLaufzeitSekunden: uptimeSeconds(),
        takte: {
          arbeit: {
            anzahl: stats.workTicks,
            fehler: stats.workFailures,
            letzterTakt: stats.lastWorkAt,
            alterSekunden: alter(stats.lastWorkAt),
          },
          einplanung: {
            anzahl: stats.scheduleTicks,
            fehler: stats.scheduleFailures,
            letzterTakt: stats.lastScheduleAt,
            alterSekunden: alter(stats.lastScheduleAt),
          },
        },
        aufeinanderfolgendeFehler: stats.consecutiveFailures,
        letzterFehler: stats.lastError,
        zugestellteEreignisse: stats.deliveredEvents,
        erfolgreicheJobs: stats.succeededJobs,
        eingeplanteJobs: stats.scheduledJobs,
        hinweis: aktiviert
          ? "Dieser Prozess fährt die wiederkehrenden Jobs."
          : "Dieser Prozess fährt KEINE Jobs (RUN_WORKERS nicht gesetzt). Ein anderer Prozess muss es tun – " +
            "sonst laufen Outbox-Zustellung, Angebotsablauf und Wiederaufnahme nicht. " +
            "Siehe docs/recovery-runbook.md#runbook-scheduler-steht.",
      });
    },
  );
}
