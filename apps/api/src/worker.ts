import {
  createBankFeedAdapter,
  createDocumentStorageAdapter,
  createMalwareScanAdapter,
  createNotificationsAdapter,
} from "@fahrschul/integrations";
import { getDb } from "./db.js";
import { env } from "./env.js";
import { deploymentIdentity } from "./lib/deployment.js";
import { log, newCorrelationId } from "./lib/observability.js";
import { configureAlarmSinksFromEnv } from "./workers/alarm.js";
import { createScheduler, schedulerOptionsFromEnv } from "./workers/scheduler.js";

/**
 * PROMPT -1 §15 (Phase 4) – der GETRENNTE Worker-Prozess.
 *
 * ## Warum es diesen Einstiegspunkt gibt, obwohl der API-Prozess es auch kann
 *
 * `buildApp({ startWorkers: true })` bzw. `RUN_WORKERS=1` lässt den
 * API-Prozess die Jobs mitfahren. Das ist für den Pilot richtig: ein Prozess,
 * ein Betriebsteil, nichts zu koordinieren.
 *
 * Sobald aber mehr als eine API-Instanz läuft (Rolling-Deployment, Skalierung),
 * ist es die falsche Aufteilung – nicht weil es unsicher wäre (der Anspruch
 * sitzt über Lease + `FOR UPDATE SKIP LOCKED` in der Datenbank, §13), sondern
 * weil:
 *
 *  - **HTTP-Last und Hintergrundlast konkurrieren im selben Event-Loop.** Ein
 *    Bankimport-Job würde die p95-Latenz der Anfragen mitziehen – genau die
 *    Kennzahl, die §21 zusichert.
 *  - **Beim Rolling-Deployment werden Instanzen absichtlich getötet.** Ein
 *    Job, der dabei mitten im Lauf abbricht, ist zwar sicher (Lease läuft ab,
 *    Re-Claim greift, §13), aber jeder Rollout erzeugt so vermeidbare
 *    Wiederholungen.
 *  - **Der Takt soll nicht mit der Repliken-Anzahl skalieren.** Zehn
 *    API-Instanzen sollen nicht zehnmal `scheduleRecurringJobs` fahren.
 *
 * Der Worker teilt sich den GESAMTEN Code mit dem API-Prozess (`createScheduler`,
 * dieselben Handler, dieselben Adapter). Es gibt keine zweite Job-Logik – das
 * wäre der konkurrierende Mechanismus, den PROMPT -1 durchgehend vermeidet.
 *
 * ## Betrieb
 *
 * ```bash
 * node dist/worker.js              # gebaut
 * pnpm --filter @fahrschul/api worker   # aus dem Quellcode (tsx)
 * ```
 *
 * Der Prozess hat KEINEN HTTP-Server und damit keinen Health-Endpunkt. Seine
 * Lebendigkeit ist über die Datenbank sichtbar: `GET /ops/scheduler` auf einer
 * API-Instanz zeigt `aktiv: false` für sich selbst, und
 * `fahrschul_scheduler_last_tick_age_seconds` bzw. die Warteschlangentiefen in
 * `GET /ops/jobs` zeigen, ob überhaupt jemand arbeitet. Für einen Orchestrator
 * ist die Probe deshalb ein `select` auf `jobs`, nicht ein HTTP-Aufruf – so
 * steht es in docs/recovery-runbook.md.
 */

const identity = deploymentIdentity();
const db = getDb(env.databaseUrl());

configureAlarmSinksFromEnv();

const scheduler = createScheduler(
  {
    db,
    notifications: createNotificationsAdapter("mock"),
    storage: createDocumentStorageAdapter("mock"),
    malwareScan: createMalwareScanAdapter("mock"),
    bankFeed: createBankFeedAdapter("mock"),
  },
  schedulerOptionsFromEnv(),
);

log({
  requestId: "worker-boot",
  correlationId: newCorrelationId(),
  operation: "worker.start",
  message: "Worker-Prozess gestartet (kein HTTP-Server)",
  details: { instanceId: identity.instanceId, releaseChannel: identity.releaseChannel },
});

scheduler.start();

/**
 * Sauberes Herunterfahren: `stop()` beendet die Timer, aber ein LAUFENDER Takt
 * darf zu Ende gehen. Ein Job, der mitten im Schreiben abgebrochen wird, ist
 * durch die Transaktion sicher – aber ein sauberes Ende erspart eine
 * Wiederholung und eine irritierende Lease-Wiederaufnahme im Log.
 */
function shutdown(signal: string) {
  log({
    requestId: "worker-shutdown",
    correlationId: newCorrelationId(),
    operation: "worker.stop",
    message: `Worker-Prozess beendet (${signal})`,
    details: { stats: scheduler.stats() },
  });
  scheduler.stop();
  // Kurze Kulanzzeit für einen noch laufenden Takt, dann Ende.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
