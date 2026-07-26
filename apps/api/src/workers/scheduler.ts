import { log, newCorrelationId } from "../lib/observability.js";
import { recordSchedulerTick, setSchedulerTickAge } from "../lib/metrics.js";
import { deploymentIdentity } from "../lib/deployment.js";
import { emitAlarm } from "./alarm.js";
import { runWorkersOnce, scheduleRecurringJobs, type JobRunnerDeps } from "./runner.js";

/**
 * PROMPT -1 §15 (Phase 4) – DER SCHEDULER. Die von allen drei Vorphasen
 * verschobene Verdrahtung.
 *
 * ## Was vorher fehlte, und warum das mehr als Kosmetik war
 *
 * `scheduleRecurringJobs()` existiert seit Phase 1 und ist getestet, aber
 * NICHTS rief sie periodisch auf: `startWorkerLoop` tat es, wurde aber nur über
 * `buildApp({ startWorkers: true })` erreicht – und `server.ts` setzte die
 * Option nicht. Damit lief in einem echten Serverprozess kein einziger
 * wiederkehrender Job. Betroffen waren unter anderem:
 *
 *  | Job | Was ohne Scheduler NICHT passiert |
 *  |---|---|
 *  | `outbox.dispatch` | keine Zustellung, kein Realtime-Fanout (§5/§6) |
 *  | `appointment_offer.expire` | Angebote laufen nie ab (§13) |
 *  | `integration.resume` | gepufferte Aufrufe bleiben liegen (§11) |
 *  | `consistency.check` | kein täglicher Bericht (§19) |
 *  | `audit.verify` | Hash-Kette wird nie geprüft (§17) |
 *  | `document.review` | Quarantäne läuft nie leer (§12) |
 *  | `idempotency.cleanup` / `uploads.cleanup` / `realtime.prune` | Aufräumen bleibt aus |
 *
 * Die „automatische Wiederaufnahme" aus `docs/failure-modes.md` war also nur so
 * automatisch wie ein Mensch, der `POST /ops/workers/run` drückt.
 *
 * ## Warum in-process und nicht cron
 *
 * Beides ist gebaut, weil beides ehrlich gebraucht wird:
 *
 *  - **In-process** (`startScheduler`, hier): der Standardfall für den Pilot,
 *    ein Prozess, kein zusätzliches Betriebsteil. `RUN_WORKERS=1` schaltet ihn
 *    ein.
 *  - **Getrennter Prozess** (`apps/api/src/worker.ts`): derselbe Code ohne
 *    HTTP-Server. Für den Mehrinstanzbetrieb der richtige Weg, weil dann
 *    genau EIN Worker-Container läuft und die API-Repliken frei skalieren.
 *    Sicher ist beides, weil der Anspruch über `FOR UPDATE SKIP LOCKED` +
 *    Lease in der Datenbank sitzt und nicht im Prozess (§13).
 *  - **Systemd/cron** als dritter Weg ist dokumentiert
 *    (`docs/recovery-runbook.md`) und braucht keinen Code: er ruft
 *    `POST /ops/jobs/schedule-recurring` und `POST /ops/workers/run`.
 *
 * ## Zwei Takte, nicht einer
 *
 * `startWorkerLoop` rief `scheduleRecurringJobs` bei JEDEM Durchlauf (alle 5 s)
 * auf. Das ist nicht falsch – die Funktion ist über `dedupeKey` je Zeitfenster
 * idempotent –, aber es sind 14 `insert … on conflict`-Versuche alle fünf
 * Sekunden, also ~240.000 überflüssige Anweisungen pro Tag, deren Ergebnis in
 * 99,6 % der Fälle „schon eingeplant" ist. Deshalb getrennte Takte:
 *
 *  - **Arbeitstakt** (`workIntervalMs`, Standard 5 s): Outbox zustellen und
 *    fällige Jobs abarbeiten. Das bestimmt die Sync-Verzögerung (§21) und
 *    muss kurz sein.
 *  - **Einplanungstakt** (`scheduleIntervalMs`, Standard 60 s): die
 *    wiederkehrenden Jobs eintakten. Das feinste Fenster in
 *    `scheduleRecurringJobs` ist fünf Minuten – ein Takt von einer Minute ist
 *    fünffach überdeckt und damit robust gegen einen verpassten Tick.
 *
 * ## Jitter, und warum er hier nicht optional ist
 *
 * Beide Takte streuen um ±20 %. Ohne Streuung starten n Instanzen nach einem
 * gleichzeitigen Rollout im Gleichschritt und schlagen im selben Millisekunden-
 * fenster auf dieselben Zeilen – das erzeugt genau die Lease-Konkurrenz, die
 * `SKIP LOCKED` zwar korrekt, aber unnötig behandelt.
 *
 * ## Fehler dürfen den Scheduler nicht töten
 *
 * Jeder Tick ist einzeln umschlossen. Ein Fehler wird protokolliert, gezählt
 * und – nach `alarmAfterConsecutiveFailures` aufeinanderfolgenden Fehlschlägen
 * – alarmiert (`scheduler_stalled`). Was NICHT passiert: der Prozess bricht ab.
 * Ein Scheduler, der beim ersten transienten DB-Fehler stirbt, ist schlimmer
 * als keiner, weil niemand es merkt.
 */

export interface SchedulerOptions {
  /** Takt für Outbox + Jobs. Bestimmt die Sync-Verzögerung (§21). */
  workIntervalMs?: number;
  /** Takt für `scheduleRecurringJobs`. */
  scheduleIntervalMs?: number;
  /** Streuung je Takt, Anteil von 0…1. */
  jitterRatio?: number;
  /** Wie viele Jobs/Ereignisse je Durchlauf. */
  batchLimit?: number;
  /** Nach so vielen Fehlschlägen in Folge wird alarmiert. */
  alarmAfterConsecutiveFailures?: number;
  /** Testbarkeit: eigene Zeitquelle/Timer. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SchedulerStats {
  workTicks: number;
  scheduleTicks: number;
  workFailures: number;
  scheduleFailures: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastWorkAt: string | null;
  lastScheduleAt: string | null;
  deliveredEvents: number;
  succeededJobs: number;
  scheduledJobs: number;
}

export interface Scheduler {
  /** Ein Arbeitstakt (Outbox + Jobs) – deterministisch aufrufbar aus Tests. */
  runWorkTick(): Promise<void>;
  /** Ein Einplanungstakt – deterministisch aufrufbar aus Tests. */
  runScheduleTick(): Promise<void>;
  /** Startet beide Timer. Ohne diesen Aufruf tickt nichts von selbst. */
  start(): void;
  stop(): void;
  stats(): SchedulerStats;
  readonly running: boolean;
}

const DEFAULTS = {
  workIntervalMs: 5000,
  scheduleIntervalMs: 60_000,
  jitterRatio: 0.2,
  batchLimit: 50,
  alarmAfterConsecutiveFailures: 5,
} as const;

/**
 * Baut den Scheduler, startet ihn aber NICHT. Getrennt, damit ein Test die
 * beiden Takte einzeln und ohne echte Timer auslösen kann – ein Scheduler, der
 * nur über `setTimeout` prüfbar wäre, wäre in einer Testsuite entweder langsam
 * oder unzuverlässig.
 */
export function createScheduler(deps: JobRunnerDeps, options: SchedulerOptions = {}): Scheduler {
  const workIntervalMs = options.workIntervalMs ?? DEFAULTS.workIntervalMs;
  const scheduleIntervalMs = options.scheduleIntervalMs ?? DEFAULTS.scheduleIntervalMs;
  const jitterRatio = options.jitterRatio ?? DEFAULTS.jitterRatio;
  const batchLimit = options.batchLimit ?? DEFAULTS.batchLimit;
  const alarmAfter = options.alarmAfterConsecutiveFailures ?? DEFAULTS.alarmAfterConsecutiveFailures;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));

  const stats: SchedulerStats = {
    workTicks: 0,
    scheduleTicks: 0,
    workFailures: 0,
    scheduleFailures: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastWorkAt: null,
    lastScheduleAt: null,
    deliveredEvents: 0,
    succeededJobs: 0,
    scheduledJobs: 0,
  };

  let stopped = true;
  let workHandle: unknown = null;
  let scheduleHandle: unknown = null;
  let alarmed = false;

  function jittered(base: number): number {
    const spread = base * jitterRatio;
    return Math.max(1, Math.round(base - spread + Math.random() * spread * 2));
  }

  function noteFailure(kind: "work" | "schedule", err: unknown) {
    const message = (err as Error)?.message ?? String(err);
    stats.lastError = message;
    stats.consecutiveFailures += 1;
    if (kind === "work") stats.workFailures += 1;
    else stats.scheduleFailures += 1;
    log({
      severity: "error",
      requestId: `scheduler-${kind}`,
      correlationId: newCorrelationId(),
      operation: `scheduler.${kind}`,
      errorCode: "SCHEDULER_TICK_FAILED",
      message,
    });
    if (stats.consecutiveFailures >= alarmAfter && !alarmed) {
      alarmed = true;
      emitAlarm({
        kind: "scheduler_stalled",
        subject: "Scheduler-Takt schlägt wiederholt fehl",
        message:
          `${stats.consecutiveFailures} aufeinanderfolgende Fehlschläge. Wiederkehrende Jobs ` +
          `(Outbox-Zustellung, Angebotsablauf, Wiederaufnahme) laufen möglicherweise nicht.`,
        details: {
          consecutiveFailures: stats.consecutiveFailures,
          lastError: message,
          deploymentId: deploymentIdentity().deploymentId,
          instanceId: deploymentIdentity().instanceId,
        },
      });
    }
  }

  function noteSuccess() {
    stats.consecutiveFailures = 0;
    alarmed = false;
  }

  async function runWorkTick(): Promise<void> {
    stats.workTicks += 1;
    stats.lastWorkAt = new Date(now()).toISOString();
    setSchedulerTickAge("work", 0);
    try {
      const result = await runWorkersOnce(deps, { limit: batchLimit });
      stats.deliveredEvents += result.outbox.delivered ?? 0;
      stats.succeededJobs += result.jobs.succeeded;
      recordSchedulerTick("work", "ok");
      noteSuccess();
    } catch (err) {
      recordSchedulerTick("work", "error");
      noteFailure("work", err);
    }
  }

  async function runScheduleTick(): Promise<void> {
    stats.scheduleTicks += 1;
    stats.lastScheduleAt = new Date(now()).toISOString();
    setSchedulerTickAge("schedule", 0);
    try {
      const result = await scheduleRecurringJobs(deps.db, { now: new Date(now()) });
      stats.scheduledJobs += result.eingeplant.length;
      recordSchedulerTick("schedule", "ok");
      noteSuccess();
    } catch (err) {
      recordSchedulerTick("schedule", "error");
      noteFailure("schedule", err);
    }
  }

  function armWork() {
    if (stopped) return;
    workHandle = setTimer(() => {
      void runWorkTick().finally(armWork);
    }, jittered(workIntervalMs));
  }

  function armSchedule() {
    if (stopped) return;
    scheduleHandle = setTimer(() => {
      void runScheduleTick().finally(armSchedule);
    }, jittered(scheduleIntervalMs));
  }

  return {
    runWorkTick,
    runScheduleTick,
    start() {
      if (!stopped) return;
      stopped = false;
      const id = deploymentIdentity();
      log({
        requestId: "scheduler-start",
        correlationId: newCorrelationId(),
        operation: "scheduler.start",
        message: "Scheduler gestartet",
        details: { workIntervalMs, scheduleIntervalMs, batchLimit, instanceId: id.instanceId },
      });
      // Der erste Einplanungstakt läuft SOFORT, nicht erst nach einer Minute:
      // ein Neustart soll die Warteschlange nicht zusätzlich verzögern.
      void runScheduleTick();
      armWork();
      armSchedule();
    },
    stop() {
      stopped = true;
      if (workHandle !== null) clearTimer(workHandle);
      if (scheduleHandle !== null) clearTimer(scheduleHandle);
      workHandle = null;
      scheduleHandle = null;
    },
    stats: () => ({ ...stats }),
    get running() {
      return !stopped;
    },
  };
}

/**
 * §15: Soll dieser Prozess Worker fahren? Eine Umgebungsvariable und nicht ein
 * Vorgabewert, weil BEIDE Betriebsarten legitim sind und ein stiller Standard
 * die falsche wäre:
 *
 *  - `RUN_WORKERS=1` in genau EINEM Prozess (Pilot: dem API-Prozess selbst;
 *    Mehrinstanzbetrieb: dem getrennten Worker).
 *  - Ohne die Variable läuft nichts von selbst – der bisherige Zustand, jetzt
 *    aber eine bewusste Entscheidung statt eines Versehens, und
 *    `GET /ops/scheduler` sagt es.
 */
export function workersEnabledFromEnv(): boolean {
  const raw = (process.env.RUN_WORKERS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function schedulerOptionsFromEnv(): SchedulerOptions {
  const num = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    workIntervalMs: num("WORKER_INTERVAL_MS", DEFAULTS.workIntervalMs),
    scheduleIntervalMs: num("SCHEDULER_INTERVAL_MS", DEFAULTS.scheduleIntervalMs),
    batchLimit: num("WORKER_BATCH_LIMIT", DEFAULTS.batchLimit),
  };
}
