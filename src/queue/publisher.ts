/**
 * Persistente Veroeffentlichungs-Warteschlange.
 *
 * Eigenschaften, die hier bewusst umgesetzt sind:
 *
 *  - **Idempotenz**: Der Schluessel ist sha256(itemId + approvalId). Eine
 *    Wiederholung nach Absturz erzeugt denselben Schluessel und wird von der
 *    UNIQUE-Bedingung abgewiesen. Eine neue Freigabe erzeugt einen neuen
 *    Schluessel und darf erneut senden.
 *  - **Neustartfestigkeit**: Der Zustand liegt vollstaendig in der Datenbank.
 *    Beim Start werden verwaiste `running`-Jobs wieder aufgenommen.
 *  - **Exponentielles Backoff mit Dead-Letter-Queue**: nach `max_attempts`
 *    landet ein Job sichtbar im Zustand `dead_letter` samt letzter Ursache.
 *  - **Zustellpruefung**: Nach dem Senden wird beim Anbieter nachgesehen, ob
 *    der Beitrag existiert. Erst danach gilt der Job als erfolgreich.
 *  - **Kein stiller Fehlschlag**: Jeder Zustandswechsel schreibt ein
 *    `job_events`-Ereignis und, bei Fehlern, einen Alarm.
 */
import { all, get, run, nowIso, tx, parseJson } from '../db/index.js';
import { newId, sha256 } from '../security/crypto.js';
import { recordEvent, raiseAlert, log } from '../observability/logger.js';
import {
  getContentItem,
  computeContentHash,
  setState,
  assetRightsBlockers,
  ContentItem,
} from '../domain/content.js';
import { validApproval } from '../domain/approval.js';
import { getAsset, MediaAsset } from '../domain/media.js';
import { adapterFor } from '../integrations/registry.js';
import { IntegrationError, RETRYABLE_CLASSES } from '../integrations/types.js';

export interface PublishJob {
  id: string;
  content_item_id: string;
  approval_id: string;
  platform: string;
  account_id: string;
  idempotency_key: string;
  approved_hash: string;
  state: 'queued' | 'running' | 'awaiting_verification' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';
  run_at: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  last_error_class: string | null;
  external_post_id: string | null;
  external_url: string | null;
  locked_by: string | null;
  locked_at: string | null;
  verified_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
  updated_at: string;
}

const WORKER_ID = `worker_${process.pid}_${Math.floor(Date.now() / 1000)}`;

function jobEvent(jobId: string, state: string, message: string, detail: Record<string, unknown> = {}) {
  run(
    'INSERT INTO job_events (job_id, at, state, message, detail_json) VALUES (?,?,?,?,?)',
    jobId,
    nowIso(),
    state,
    message,
    JSON.stringify(detail),
  );
}

export class QueueError extends Error {}

/**
 * Stellt einen freigegebenen Beitrag in die Warteschlange.
 * Prueft ein letztes Mal in der Anwendungsschicht; der DB-Trigger prueft
 * danach unabhaengig noch einmal.
 */
export function enqueue(itemId: string, actor: string, runAt?: string): PublishJob {
  const item = getContentItem(itemId);
  if (!item) throw new QueueError(`Content-Item ${itemId} nicht gefunden.`);

  const currentHash = computeContentHash(item);
  if (currentHash !== item.content_hash) {
    throw new QueueError(
      'Der gespeicherte Inhalts-Hash stimmt nicht mit dem Inhalt ueberein. Bitte erneut pruefen lassen.',
    );
  }
  const approval = validApproval(itemId);
  if (!approval) {
    throw new QueueError(
      'Keine gueltige Freigabe fuer den aktuellen Inhalt. Ohne Freigabe wird nichts veroeffentlicht.',
    );
  }
  if (!item.account_id) {
    throw new QueueError('Dem Beitrag ist kein Zielkonto zugeordnet.');
  }

  const idempotencyKey = sha256(`${itemId}::${approval.id}`);
  const existing = get<PublishJob>(
    'SELECT * FROM publish_jobs WHERE idempotency_key = ?',
    idempotencyKey,
  );
  if (existing) {
    log.info('Job existiert bereits, keine Doppelanlage.', { jobId: existing.id });
    return existing;
  }

  const scheduled = runAt ?? item.scheduled_for ?? nowIso();
  const id = newId('job');

  return tx(() => {
    run(
      `INSERT INTO publish_jobs
        (id, content_item_id, approval_id, platform, account_id, idempotency_key, approved_hash,
         state, run_at, attempts, max_attempts, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'queued',?,0,5,?,?)`,
      id,
      itemId,
      approval.id,
      item.platform,
      item.account_id,
      idempotencyKey,
      item.content_hash,
      scheduled,
      nowIso(),
      nowIso(),
    );
    jobEvent(id, 'queued', `Job angelegt, geplante Zustellung ${scheduled}.`, {
      approvalId: approval.id,
    });
    setState(itemId, 'scheduled', actor, `Zustellung geplant fuer ${scheduled}`);
    recordEvent({
      kind: 'publish.enqueued',
      actor,
      entityType: 'publish_job',
      entityId: id,
      message: `Beitrag "${item.title}" fuer ${item.platform} eingeplant (${scheduled}).`,
    });
    return get<PublishJob>('SELECT * FROM publish_jobs WHERE id = ?', id)!;
  });
}

/** Faellige Jobs holen und in einem Zug sperren, damit zwei Worker sich nicht ins Gehege kommen. */
function claimDueJobs(limit: number): PublishJob[] {
  return tx(() => {
    const due = all<PublishJob>(
      `SELECT * FROM publish_jobs
       WHERE state = 'queued'
         AND run_at <= ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY run_at ASC LIMIT ?`,
      nowIso(),
      nowIso(),
      limit,
    );
    for (const job of due) {
      run(
        `UPDATE publish_jobs SET state = 'running', locked_by = ?, locked_at = ?, updated_at = ?
         WHERE id = ? AND state = 'queued'`,
        WORKER_ID,
        nowIso(),
        nowIso(),
        job.id,
      );
    }
    return due;
  });
}

function backoffSeconds(attempt: number): number {
  // 30s, 60s, 120s, 240s, 480s - gedeckelt bei 15 Minuten.
  return Math.min(30 * Math.pow(2, attempt), 900);
}

function loadAssets(item: ContentItem): MediaAsset[] {
  const ids = parseJson<string[]>(item.asset_ids_json, []);
  const assets: MediaAsset[] = [];
  for (const id of ids) {
    const a = getAsset(id);
    if (a) assets.push(a);
  }
  return assets;
}

export async function runJob(job: PublishJob): Promise<void> {
  const item = getContentItem(job.content_item_id);
  if (!item) {
    failJob(job, 'Content-Item existiert nicht mehr.', 'validation', false);
    return;
  }

  // Letzte Verteidigung unmittelbar vor dem Senden: Hat sich der Inhalt
  // seit der Freigabe geaendert? Wurde die Freigabe widerrufen? Wurde eine
  // Einwilligung zurueckgezogen? Dann jetzt abbrechen, nicht spaeter erklaeren.
  const currentHash = computeContentHash(item);
  if (currentHash !== job.approved_hash) {
    cancelJob(
      job,
      'Der Inhalt hat sich nach der Freigabe geaendert. Veroeffentlichung abgebrochen, erneute Freigabe erforderlich.',
    );
    return;
  }
  const approval = validApproval(job.content_item_id);
  if (!approval || approval.id !== job.approval_id) {
    cancelJob(job, 'Die Freigabe wurde widerrufen oder ersetzt. Veroeffentlichung abgebrochen.');
    return;
  }

  const assets = loadAssets(item);
  const rightsBlockers = assetRightsBlockers(item);
  if (rightsBlockers.length > 0) {
    cancelJob(
      job,
      `Rechte- oder Einwilligungsstatus hat sich geaendert: ${rightsBlockers.join(' | ')}`,
    );
    return;
  }

  const adapter = adapterFor(job.platform);
  run(
    'UPDATE publish_jobs SET attempts = attempts + 1, updated_at = ? WHERE id = ?',
    nowIso(),
    job.id,
  );
  const attempt = job.attempts + 1;
  jobEvent(job.id, 'running', `Zustellversuch ${attempt} an ${job.platform}.`);
  setState(job.content_item_id, 'publishing', 'system:publisher');

  try {
    const result = await adapter.publish({
      item,
      assets,
      idempotencyKey: job.idempotency_key,
    });

    run(
      `UPDATE publish_jobs SET state = 'awaiting_verification', external_post_id = ?,
       external_url = ?, updated_at = ?, locked_by = NULL WHERE id = ?`,
      result.externalPostId,
      result.externalUrl,
      nowIso(),
      job.id,
    );
    jobEvent(job.id, 'awaiting_verification', 'Zustellung abgesetzt, Pruefung beim Anbieter folgt.', {
      externalPostId: result.externalPostId,
    });

    await verifyJob(get<PublishJob>('SELECT * FROM publish_jobs WHERE id = ?', job.id)!);
  } catch (err) {
    const isIntegration = err instanceof IntegrationError;
    const errorClass = isIntegration ? (err as IntegrationError).errorClass : 'provider_error';
    const retryable = isIntegration
      ? (err as IntegrationError).retryable && RETRYABLE_CLASSES.includes(errorClass)
      : true;
    failJob(job, (err as Error).message, errorClass, retryable, isIntegration ? (err as IntegrationError).retryAfterSeconds : undefined);
  }
}

/** Pruefung beim Anbieter: existiert der Beitrag wirklich? */
export async function verifyJob(job: PublishJob): Promise<boolean> {
  if (!job.external_post_id) return false;
  const adapter = adapterFor(job.platform);
  try {
    const result = await adapter.verify(job.external_post_id);
    if (result.exists) {
      run(
        `UPDATE publish_jobs SET state = 'succeeded', verified_at = ?, external_url = COALESCE(?, external_url),
         updated_at = ?, last_error = NULL WHERE id = ?`,
        nowIso(),
        result.url,
        nowIso(),
        job.id,
      );
      jobEvent(job.id, 'succeeded', `Zustellung beim Anbieter bestaetigt: ${result.detail}`);
      setState(job.content_item_id, 'published', 'system:publisher', result.detail);
      recordEvent({
        kind: 'publish.succeeded',
        actor: 'system:publisher',
        entityType: 'publish_job',
        entityId: job.id,
        message: `Veroeffentlicht auf ${job.platform}: ${result.url ?? job.external_post_id}`,
        detail: { externalPostId: job.external_post_id, url: result.url },
      });
      return true;
    }

    // Abgesetzt, aber nicht auffindbar - das ist der gefaehrlichste Fall und
    // wird deshalb ausdruecklich als Fehler gefuehrt, nicht als Erfolg.
    failJob(
      job,
      `Der Beitrag wurde abgesetzt, ist beim Anbieter aber nicht auffindbar: ${result.detail}`,
      'provider_error',
      true,
    );
    return false;
  } catch (err) {
    failJob(job, `Zustellpruefung fehlgeschlagen: ${(err as Error).message}`, 'network', true);
    return false;
  }
}

function failJob(
  job: PublishJob,
  message: string,
  errorClass: string,
  retryable: boolean,
  retryAfterSeconds?: number,
): void {
  const attempts = job.attempts + 1;
  const exhausted = attempts >= job.max_attempts;

  if (!retryable || exhausted) {
    run(
      `UPDATE publish_jobs SET state = 'dead_letter', last_error = ?, last_error_class = ?,
       dead_lettered_at = ?, updated_at = ?, locked_by = NULL WHERE id = ?`,
      message,
      errorClass,
      nowIso(),
      nowIso(),
      job.id,
    );
    jobEvent(job.id, 'dead_letter', message, { errorClass, attempts, retryable });
    setState(job.content_item_id, 'failed', 'system:publisher', message);
    raiseAlert(
      'PUBLISH_DEAD_LETTER',
      `Veroeffentlichung endgueltig fehlgeschlagen (${job.platform}): ${message}`,
      'critical',
      { type: 'publish_job', id: job.id },
    );
    recordEvent({
      kind: 'publish.dead_letter',
      actor: 'system:publisher',
      severity: 'error',
      entityType: 'publish_job',
      entityId: job.id,
      message: `Job in die Dead-Letter-Queue verschoben nach ${attempts} Versuch(en): ${message}`,
      detail: { errorClass, retryable },
    });
    return;
  }

  const delay = retryAfterSeconds ?? backoffSeconds(attempts);
  const nextRetry = new Date(Date.now() + delay * 1000).toISOString();
  run(
    `UPDATE publish_jobs SET state = 'queued', last_error = ?, last_error_class = ?,
     next_retry_at = ?, updated_at = ?, locked_by = NULL WHERE id = ?`,
    message,
    errorClass,
    nextRetry,
    nowIso(),
    job.id,
  );
  jobEvent(job.id, 'queued', `Fehlgeschlagen, naechster Versuch um ${nextRetry}: ${message}`, {
    errorClass,
    attempts,
    delaySeconds: delay,
  });
  setState(job.content_item_id, 'scheduled', 'system:publisher', 'Wiederholung eingeplant');
  log.warn('Zustellung fehlgeschlagen, Wiederholung eingeplant.', {
    jobId: job.id,
    attempts,
    nextRetry,
  });
}

function cancelJob(job: PublishJob, reason: string): void {
  run(
    `UPDATE publish_jobs SET state = 'cancelled', last_error = ?, updated_at = ?, locked_by = NULL WHERE id = ?`,
    reason,
    nowIso(),
    job.id,
  );
  jobEvent(job.id, 'cancelled', reason);
  setState(job.content_item_id, 'awaiting_approval', 'system:publisher', reason);
  raiseAlert('PUBLISH_CANCELLED', reason, 'warn', { type: 'publish_job', id: job.id });
  recordEvent({
    kind: 'publish.cancelled',
    actor: 'system:publisher',
    severity: 'warn',
    entityType: 'publish_job',
    entityId: job.id,
    message: reason,
  });
}

/** Ein Durchlauf des Workers. */
export async function tick(limit = 5): Promise<{ processed: number; recovered: number }> {
  const recovered = recoverStaleJobs();
  const jobs = claimDueJobs(limit);
  for (const job of jobs) {
    try {
      await runJob(job);
    } catch (err) {
      log.error('Unerwarteter Fehler im Job-Lauf.', { jobId: job.id, error: (err as Error).message });
      failJob(job, `Unerwarteter Fehler: ${(err as Error).message}`, 'provider_error', true);
    }
  }
  await verifyPendingJobs();
  return { processed: jobs.length, recovered };
}

/**
 * Jobs, die beim Absturz eines Workers in `running` haengen geblieben sind,
 * werden nach 15 Minuten wieder freigegeben. Ohne diesen Schritt wuerde ein
 * abgestuerzter Prozess Beitraege dauerhaft blockieren.
 */
export function recoverStaleJobs(): number {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const stale = all<PublishJob>(
    `SELECT * FROM publish_jobs WHERE state = 'running' AND locked_at < ?`,
    cutoff,
  );
  for (const job of stale) {
    run(
      `UPDATE publish_jobs SET state = 'queued', locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`,
      nowIso(),
      job.id,
    );
    jobEvent(job.id, 'queued', 'Verwaister Job nach Worker-Abbruch wieder aufgenommen.');
    raiseAlert(
      'JOB_RECOVERED',
      `Job ${job.id} hing seit ${job.locked_at} im Zustand running und wurde wieder eingereiht.`,
      'warn',
      { type: 'publish_job', id: job.id },
    );
  }
  return stale.length;
}

/**
 * Beitraege, die zwar abgesetzt, aber noch nicht bestaetigt sind, werden
 * erneut geprueft. Deckt den Fall ab, dass der Anbieter im ersten Moment
 * noch nichts ausliefert.
 */
export async function verifyPendingJobs(): Promise<number> {
  const pending = all<PublishJob>(
    `SELECT * FROM publish_jobs WHERE state = 'awaiting_verification'
     AND updated_at < ? LIMIT 20`,
    new Date(Date.now() - 60_000).toISOString(),
  );
  let ok = 0;
  for (const job of pending) {
    if (await verifyJob(job)) ok++;
  }
  return ok;
}

export function listJobs(filter?: { state?: string; limit?: number }): PublishJob[] {
  if (filter?.state) {
    return all<PublishJob>(
      'SELECT * FROM publish_jobs WHERE state = ? ORDER BY updated_at DESC LIMIT ?',
      filter.state,
      filter.limit ?? 100,
    );
  }
  return all<PublishJob>('SELECT * FROM publish_jobs ORDER BY updated_at DESC LIMIT ?', filter?.limit ?? 100);
}

export function jobHistory(jobId: string) {
  return all('SELECT * FROM job_events WHERE job_id = ? ORDER BY id DESC', jobId);
}

/** Manuelle Wiederaufnahme eines Jobs aus der Dead-Letter-Queue. */
export function requeueDeadLetter(jobId: string, actor: string): PublishJob {
  const job = get<PublishJob>('SELECT * FROM publish_jobs WHERE id = ?', jobId);
  if (!job) throw new QueueError(`Job ${jobId} nicht gefunden.`);
  if (job.state !== 'dead_letter' && job.state !== 'cancelled') {
    throw new QueueError(`Job ${jobId} ist im Zustand "${job.state}" und kann nicht neu eingereiht werden.`);
  }
  // Freigabe muss weiterhin gueltig sein - eine Wiederaufnahme umgeht das Gate nicht.
  const approval = validApproval(job.content_item_id);
  if (!approval || approval.id !== job.approval_id) {
    throw new QueueError(
      'Fuer diesen Beitrag liegt keine gueltige Freigabe mehr vor. Bitte erneut pruefen und freigeben.',
    );
  }
  run(
    `UPDATE publish_jobs SET state = 'queued', attempts = 0, next_retry_at = NULL,
     dead_lettered_at = NULL, last_error = NULL, run_at = ?, updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    jobId,
  );
  jobEvent(jobId, 'queued', 'Manuell aus der Dead-Letter-Queue wieder eingereiht.');
  recordEvent({
    kind: 'publish.requeued',
    actor,
    severity: 'warn',
    entityType: 'publish_job',
    entityId: jobId,
    message: 'Job manuell wieder eingereiht.',
  });
  return get<PublishJob>('SELECT * FROM publish_jobs WHERE id = ?', jobId)!;
}

export function queueStats() {
  const rows = all<{ state: string; n: number }>(
    'SELECT state, COUNT(*) AS n FROM publish_jobs GROUP BY state',
  );
  const stats: Record<string, number> = {
    queued: 0, running: 0, awaiting_verification: 0, succeeded: 0, failed: 0, dead_letter: 0, cancelled: 0,
  };
  for (const r of rows) stats[r.state] = Number(r.n);
  return stats;
}
