import type { DB } from '../db/index.js'
import { newId } from '../util/id.js'
import { nowIso, plus, MINUTE } from '../util/time.js'
import { log, errText } from './logger.js'
import { audit } from './audit.js'

/**
 * Durable job queue on SQLite.
 *
 * Guarantees:
 *  - **Persistence**: jobs survive process death; they live in the same file as
 *    the data they mutate, so enqueue-and-write is one transaction.
 *  - **At-least-once with idempotency**: `idempotency_key` is UNIQUE, so a
 *    duplicate enqueue returns the existing job instead of creating a second.
 *  - **Crash recovery**: a claim takes a *lease*. If a worker dies, the lease
 *    expires and the job is re-claimable — no job is stuck in `running` forever.
 *  - **Backoff**: exponential with jitter, capped; exhausted jobs go to `dead`,
 *    never silently disappear.
 *  - **Cancellation**: cooperative via `cancel_requested`, checked by handlers.
 */

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead' | 'cancelled'

export interface JobRow {
  id: string
  kind: string
  payload: string
  status: JobStatus
  priority: number
  attempts: number
  max_attempts: number
  run_at: string
  lease_until: string | null
  lease_owner: string | null
  timeout_ms: number
  idempotency_key: string | null
  last_error: string | null
  result: string | null
  created_at: string
  updated_at: string
  cancel_requested: number
}

export interface JobContext {
  db: DB
  job: JobRow
  payload: Record<string, unknown>
  /** Throws `JobCancelled` if the owner requested cancellation. Call it in loops. */
  checkCancelled(): void
  heartbeat(): void
}

export class JobCancelled extends Error {
  constructor() { super('Job abgebrochen'); this.name = 'JobCancelled' }
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>

export interface EnqueueOpts {
  priority?: number
  runAt?: string
  maxAttempts?: number
  timeoutMs?: number
  idempotencyKey?: string
}

const LEASE_MS = 5 * MINUTE

export function enqueue(
  db: DB, kind: string, payload: Record<string, unknown>, opts: EnqueueOpts = {},
): JobRow {
  const key = opts.idempotencyKey ?? null
  if (key) {
    const existing = db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as JobRow | undefined
    // Only dedupe against work that is still live or already succeeded. A dead
    // or cancelled job with the same key should be retryable by the owner.
    if (existing && ['pending', 'running', 'done'].includes(existing.status)) return existing
    if (existing) db.prepare('DELETE FROM jobs WHERE id = ?').run(existing.id)
  }
  const now = nowIso()
  const row: JobRow = {
    id: newId('job'), kind, payload: JSON.stringify(payload), status: 'pending',
    priority: opts.priority ?? 5, attempts: 0, max_attempts: opts.maxAttempts ?? 5,
    run_at: opts.runAt ?? now, lease_until: null, lease_owner: null,
    timeout_ms: opts.timeoutMs ?? 120_000, idempotency_key: key,
    last_error: null, result: null, created_at: now, updated_at: now, cancel_requested: 0,
  }
  db.prepare(
    `INSERT INTO jobs (id, kind, payload, status, priority, attempts, max_attempts, run_at,
       lease_until, lease_owner, timeout_ms, idempotency_key, last_error, result,
       created_at, updated_at, cancel_requested)
     VALUES (@id, @kind, @payload, @status, @priority, @attempts, @max_attempts, @run_at,
       @lease_until, @lease_owner, @timeout_ms, @idempotency_key, @last_error, @result,
       @created_at, @updated_at, @cancel_requested)`,
  ).run(row)
  return row
}

/**
 * Atomically claim one runnable job. The UPDATE ... WHERE status='pending'
 * inside an IMMEDIATE transaction is what makes this safe against a second
 * worker (or a second process) racing for the same row.
 */
export function claim(db: DB, owner: string, kinds?: string[]): JobRow | null {
  const claimTx = db.transaction((): JobRow | null => {
    const now = nowIso()
    const kindFilter = kinds?.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : ''
    const candidate = db.prepare(
      `SELECT * FROM jobs
        WHERE ( status = 'pending'
                OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?) )
          AND run_at <= ? ${kindFilter}
        ORDER BY priority ASC, run_at ASC
        LIMIT 1`,
    ).get(...[now, now, ...(kinds ?? [])]) as JobRow | undefined
    if (!candidate) return null

    const res = db.prepare(
      `UPDATE jobs SET status='running', lease_owner=?, lease_until=?, attempts=attempts+1, updated_at=?
        WHERE id=? AND (status='pending' OR (status='running' AND lease_until < ?))`,
    ).run(owner, plus(LEASE_MS), now, candidate.id, now)
    if (res.changes === 0) return null
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(candidate.id) as JobRow
  })
  // IMMEDIATE avoids the upgrade-deadlock a deferred read→write transaction hits.
  return claimTx.immediate()
}

function backoffMs(attempt: number): number {
  const base = Math.min(2 ** attempt * 1000, 10 * MINUTE)
  return Math.round(base * (0.5 + Math.random()))   // full jitter avoids thundering herds
}

export function complete(db: DB, id: string, result: Record<string, unknown> | void): void {
  db.prepare(
    `UPDATE jobs SET status='done', result=?, lease_until=NULL, lease_owner=NULL,
       last_error=NULL, updated_at=? WHERE id=?`,
  ).run(JSON.stringify(result ?? {}), nowIso(), id)
}

export function fail(db: DB, job: JobRow, error: string): 'retry' | 'dead' {
  const exhausted = job.attempts >= job.max_attempts
  if (exhausted) {
    db.prepare(
      `UPDATE jobs SET status='dead', last_error=?, lease_until=NULL, lease_owner=NULL, updated_at=? WHERE id=?`,
    ).run(error, nowIso(), job.id)
    audit(db, {
      actor: `job:${job.kind}`, action: 'job.dead', subject: job.id, outcome: 'error',
      detail: { attempts: job.attempts, error },
    })
    return 'dead'
  }
  db.prepare(
    `UPDATE jobs SET status='pending', last_error=?, run_at=?, lease_until=NULL, lease_owner=NULL, updated_at=? WHERE id=?`,
  ).run(error, plus(backoffMs(job.attempts)), nowIso(), job.id)
  return 'retry'
}

export function requestCancel(db: DB, id: string): boolean {
  const r = db.prepare(
    `UPDATE jobs SET cancel_requested=1, updated_at=? WHERE id=? AND status IN ('pending','running')`,
  ).run(nowIso(), id)
  if (r.changes > 0) {
    // Pending jobs can be cancelled outright; running ones stop cooperatively.
    db.prepare(`UPDATE jobs SET status='cancelled' WHERE id=? AND status='pending'`).run(id)
  }
  return r.changes > 0
}

export function queueStats(db: DB) {
  const rows = db.prepare('SELECT status, count(*) n FROM jobs GROUP BY status').all() as
    Array<{ status: JobStatus; n: number }>
  const out = { pending: 0, running: 0, done: 0, failed: 0, dead: 0, cancelled: 0 }
  for (const r of rows) out[r.status] = r.n
  return out
}

/**
 * Called once at boot. Jobs left `running` by a crashed process have no live
 * worker, so their lease is void: return them to `pending` immediately instead
 * of waiting out the full lease window.
 */
export function recoverOrphans(db: DB): number {
  const r = db.prepare(
    `UPDATE jobs SET status='pending', lease_until=NULL, lease_owner=NULL,
       last_error=COALESCE(last_error,'') || ' [nach Neustart wiederhergestellt]', updated_at=?
      WHERE status='running'`,
  ).run(nowIso())
  if (r.changes > 0) {
    log.warn('Verwaiste Jobs nach Neustart wiederhergestellt', { count: r.changes })
    audit(db, { actor: 'system', action: 'queue.recover', outcome: 'ok', detail: { count: r.changes } })
  }
  return r.changes
}

/* ── Worker ──────────────────────────────────────────────────────────────── */

export class Worker {
  private handlers = new Map<string, JobHandler>()
  private timer: NodeJS.Timeout | null = null
  private stopping = false
  private active = 0

  constructor(
    private db: DB,
    private readonly id = `worker-${process.pid}`,
    private readonly concurrency = 2,
    private readonly pollMs = 500,
  ) {}

  register(kind: string, handler: JobHandler): this {
    this.handlers.set(kind, handler)
    return this
  }

  start(): void {
    recoverOrphans(this.db)
    this.timer = setInterval(() => void this.tick(), this.pollMs)
    log.info('Job-Worker gestartet', { worker: this.id, kinds: [...this.handlers.keys()] })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    // Give in-flight handlers a moment to finish before the process exits.
    const deadline = Date.now() + 5000
    while (this.active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.active >= this.concurrency) return
    const job = claim(this.db, this.id, [...this.handlers.keys()])
    if (!job) return
    this.active++
    try { await this.execute(job) } finally { this.active-- }
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.kind)
    if (!handler) { fail(this.db, job, `Kein Handler für Job-Typ ${job.kind}`); return }

    const started = Date.now()
    const ctx: JobContext = {
      db: this.db, job,
      payload: JSON.parse(job.payload || '{}'),
      checkCancelled: () => {
        const r = this.db.prepare('SELECT cancel_requested FROM jobs WHERE id=?').get(job.id) as
          { cancel_requested: number } | undefined
        if (r?.cancel_requested) throw new JobCancelled()
      },
      heartbeat: () => {
        this.db.prepare('UPDATE jobs SET lease_until=?, updated_at=? WHERE id=?')
          .run(plus(LEASE_MS), nowIso(), job.id)
      },
    }

    try {
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Zeitüberschreitung nach ${job.timeout_ms}ms`)), job.timeout_ms).unref())
      const result = await Promise.race([handler(ctx), timeout])
      complete(this.db, job.id, result ?? undefined)
      log.debug('Job erledigt', { kind: job.kind, id: job.id, ms: Date.now() - started })
    } catch (e) {
      if (e instanceof JobCancelled) {
        this.db.prepare(`UPDATE jobs SET status='cancelled', lease_until=NULL, updated_at=? WHERE id=?`)
          .run(nowIso(), job.id)
        log.info('Job abgebrochen', { kind: job.kind, id: job.id })
        return
      }
      const msg = errText(e)
      const outcome = fail(this.db, job, msg)
      log.warn('Job fehlgeschlagen', { kind: job.kind, id: job.id, attempt: job.attempts, outcome, error: msg })
    }
  }
}
