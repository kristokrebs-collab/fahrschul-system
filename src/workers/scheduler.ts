/**
 * Hintergrundprozesse.
 *
 * Alle Aufgaben sind so gebaut, dass ein Fehlschlag protokolliert wird, aber
 * den Zeitplan nicht anhaelt. Ein abgestuerzter Kennzahlenabruf darf die
 * Veroeffentlichungs-Warteschlange nicht mitreissen.
 */
import { log, recordEvent, raiseAlert } from '../observability/logger.js';
import { tick } from '../queue/publisher.js';
import { collectDueMetrics } from '../domain/analytics.js';
import { refreshAccountStatus } from '../integrations/registry.js';
import { expireStaleFacts } from '../domain/brand.js';
import { applyRetention } from '../domain/inbox.js';
import { purgeExpiredSessions } from '../security/auth.js';
import { revalidatePending } from '../agents/orchestrator.js';
import { generateLearningReport } from '../domain/learning.js';
import { get, run, nowIso } from '../db/index.js';

interface Task {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown> | unknown;
  /** true = nur einmal pro Kalendertag ausfuehren */
  daily?: boolean;
  /** true = nur einmal pro Kalenderwoche ausfuehren */
  weekly?: boolean;
}

const TASKS: Task[] = [
  {
    name: 'publish_queue',
    intervalMs: 30_000,
    run: () => tick(5),
  },
  {
    name: 'collect_metrics',
    intervalMs: 10 * 60_000,
    run: () => collectDueMetrics(),
  },
  {
    name: 'account_status',
    intervalMs: 60 * 60_000,
    run: () => refreshAccountStatus(),
  },
  {
    name: 'expire_facts',
    intervalMs: 6 * 60 * 60_000,
    daily: true,
    run: () => expireStaleFacts(),
  },
  {
    name: 'revalidate_pending',
    intervalMs: 6 * 60 * 60_000,
    daily: true,
    run: () => revalidatePending('system:scheduler'),
  },
  {
    name: 'privacy_retention',
    intervalMs: 12 * 60 * 60_000,
    daily: true,
    run: () => applyRetention(),
  },
  {
    name: 'purge_sessions',
    intervalMs: 60 * 60_000,
    run: () => purgeExpiredSessions(),
  },
  {
    name: 'weekly_learning_report',
    intervalMs: 60 * 60_000,
    weekly: true,
    run: () => generateLearningReport('system:scheduler', 7),
  },
];

const timers: NodeJS.Timeout[] = [];
let running = false;

function lastRunKey(name: string): string {
  return `scheduler:last_run:${name}`;
}

function shouldRun(task: Task): boolean {
  if (!task.daily && !task.weekly) return true;
  const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', lastRunKey(task.name));
  if (!row) return true;
  const last = new Date(row.value);
  const now = new Date();
  if (task.daily) return last.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
  if (task.weekly) {
    const weekOf = (d: Date) => {
      const t = new Date(d);
      t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      return t.toISOString().slice(0, 10);
    };
    return weekOf(last) !== weekOf(now);
  }
  return true;
}

function markRun(name: string): void {
  run(
    `INSERT INTO kv (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    lastRunKey(name),
    nowIso(),
    nowIso(),
  );
}

async function execute(task: Task): Promise<void> {
  if (!shouldRun(task)) return;
  const started = Date.now();
  try {
    const result = await task.run();
    markRun(task.name);
    log.debug('Hintergrundaufgabe abgeschlossen.', {
      task: task.name,
      ms: Date.now() - started,
      result: typeof result === 'object' ? result : String(result),
    });
  } catch (err) {
    const message = (err as Error).message;
    log.error('Hintergrundaufgabe fehlgeschlagen.', { task: task.name, error: message });
    raiseAlert(
      `TASK_FAILED_${task.name.toUpperCase()}`,
      `Hintergrundaufgabe "${task.name}" ist fehlgeschlagen: ${message}`,
      'error',
    );
  }
}

export function startScheduler(): void {
  if (running) return;
  running = true;
  for (const task of TASKS) {
    // Erster Lauf leicht versetzt, damit nicht alles gleichzeitig startet.
    const jitter = Math.floor(TASKS.indexOf(task) * 1500);
    setTimeout(() => void execute(task), jitter);
    timers.push(setInterval(() => void execute(task), task.intervalMs));
  }
  recordEvent({
    kind: 'scheduler.started',
    actor: 'system',
    message: `${TASKS.length} Hintergrundaufgaben geplant.`,
    detail: { tasks: TASKS.map((t) => ({ name: t.name, intervalMs: t.intervalMs })) },
  });
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  running = false;
}

export function schedulerTasks() {
  return TASKS.map((t) => ({
    name: t.name,
    intervalMs: t.intervalMs,
    cadence: t.weekly ? 'woechentlich' : t.daily ? 'taeglich' : 'laufend',
    lastRun: get<{ value: string }>('SELECT value FROM kv WHERE key = ?', lastRunKey(t.name))?.value ?? null,
  }));
}
