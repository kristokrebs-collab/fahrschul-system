import type { DB } from '../db/index.js'
import type { ActionPreview } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso, plus, MINUTE, isPast } from '../util/time.js'
import { audit } from '../core/audit.js'
import { errText, log } from '../core/logger.js'
import { getTool, type ToolExecContext, type ToolResult } from './registry.js'
import { reviewAction, mayAutoExecute, type SafetyReview } from './safety.js'

/**
 * Action lifecycle: propose → review → (card) → approve → execute → verify.
 *
 * The invariant this file exists to protect: **an action is only ever reported
 * as done after `execute` actually returned success.** Every status transition
 * is a row update, so a crash between "approved" and "executed" leaves the
 * action visibly pending rather than silently claimed as complete.
 */

const TTL_MS = 30 * MINUTE

interface Row {
  id: string; tool: string; risk: string; domain: string; target: string
  payload: string; effects: string; reversible: number; rollback: string | null
  safety_review: string; status: string; conversation_id: string | null
  idempotency_key: string | null; created_at: string; expires_at: string
  decided_at: string | null; decided_by: string | null; executed_at: string | null
  result: string | null; error: string | null
}

function toPreview(row: Row): ActionPreview {
  const spec = getTool(row.tool)
  return {
    id: row.id, tool: row.tool, title_de: spec?.titleDe ?? row.tool,
    risk: row.risk as ActionPreview['risk'], target: row.target,
    payload: JSON.parse(row.payload), effects: JSON.parse(row.effects),
    reversible: !!row.reversible, rollback: row.rollback,
    safety_review: JSON.parse(row.safety_review),
    status: row.status as ActionPreview['status'],
    conversation_id: row.conversation_id, created_at: row.created_at,
    expires_at: row.expires_at,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
  }
}

export interface ProposeResult {
  preview: ActionPreview
  /** Set when the review permitted immediate execution. */
  executed: ToolResult | null
}

/**
 * Runs the Action Safety Reviewer and persists the outcome.
 *
 * Read-only tools with a clean review execute straight away — asking the owner
 * to approve a search would make the confirmation habit meaningless, and
 * habituated clicking is how a real confirmation gets waved through.
 */
export async function proposeAction(
  db: DB, toolName: string, input: Record<string, unknown>,
  ctx: ToolExecContext, untrustedContext: string, ruleCovered = false,
): Promise<ProposeResult> {
  const spec = getTool(toolName)
  if (!spec) throw new Error(`Unbekanntes Werkzeug: ${toolName}`)

  const review: SafetyReview = reviewAction({ spec, payload: input, untrustedContext, ruleCovered })
  const id = newId('act')
  const now = nowIso()
  const target = spec.describeTarget(input)
  const effects = spec.describeEffects(input)

  const autoOk = mayAutoExecute(review) && spec.risk === 'read_only'
  const status = review.verdict === 'block' ? 'rejected' : autoOk ? 'approved' : 'pending'

  db.prepare(
    `INSERT INTO actions (id, tool, risk, domain, target, payload, effects, reversible, rollback,
       safety_review, status, conversation_id, idempotency_key, created_at, expires_at,
       decided_at, decided_by, executed_at, result, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,NULL,NULL,?)`,
  ).run(id, spec.name, spec.risk, spec.domain, target, JSON.stringify(input),
    JSON.stringify(effects), spec.reversible ? 1 : 0, spec.rollbackHint,
    JSON.stringify(review), status, ctx.conversationId, now, plus(TTL_MS),
    status === 'pending' ? null : now, status === 'pending' ? null : 'safety-reviewer',
    review.verdict === 'block' ? blockReason(review) : null)

  audit(db, {
    actor: ctx.actor, action: 'action.propose', domain: spec.domain, subject: spec.name,
    outcome: review.verdict === 'block' ? 'denied' : 'ok',
    detail: { id, verdict: review.verdict, risk: spec.risk, injection_score: review.injection_score },
  })

  if (review.verdict === 'block') {
    log.warn('Aktion blockiert', { tool: spec.name, findings: review.findings.map((f) => f.code) })
    return { preview: loadAction(db, id)!, executed: null }
  }
  if (!autoOk) return { preview: loadAction(db, id)!, executed: null }

  const result = await runAction(db, id, ctx)
  return { preview: loadAction(db, id)!, executed: result }
}

function blockReason(review: SafetyReview): string {
  const crit = review.findings.filter((f) => f.severity === 'critical')
  return (crit.length ? crit : review.findings).map((f) => f.message).join(' ')
}

/** Executes an approved action exactly once and records the true outcome. */
export async function runAction(db: DB, actionId: string, ctx: ToolExecContext): Promise<ToolResult> {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Row | undefined
  if (!row) throw new Error('Aktion nicht gefunden')
  if (row.status === 'executed') {
    return { ok: true, summary: 'Bereits ausgeführt', data: row.result ? JSON.parse(row.result) : null }
  }
  if (row.status !== 'approved') throw new Error(`Aktion ist ${row.status}, nicht genehmigt`)
  if (isPast(row.expires_at)) {
    db.prepare(`UPDATE actions SET status='expired' WHERE id=?`).run(actionId)
    throw new Error('Bestätigung abgelaufen – bitte neu anfordern')
  }

  const spec = getTool(row.tool)
  if (!spec) throw new Error(`Unbekanntes Werkzeug: ${row.tool}`)

  // Claim the row before running, so a concurrent approve cannot double-execute.
  const claimed = db.prepare(`UPDATE actions SET status='executing' WHERE id=? AND status='approved'`)
    .run(actionId)
  if (claimed.changes === 0) {
    const fresh = db.prepare('SELECT status, result FROM actions WHERE id=?').get(actionId) as Row
    return { ok: fresh.status === 'executed', summary: `Aktion ist ${fresh.status}`, data: fresh.result ? JSON.parse(fresh.result) : null }
  }

  const payload = JSON.parse(row.payload) as Record<string, unknown>
  try {
    const result = await spec.execute(ctx, payload)
    if (result.ok) {
      db.prepare(`UPDATE actions SET status='executed', executed_at=?, result=?, error=NULL WHERE id=?`)
        .run(nowIso(), JSON.stringify(result.data ?? {}), actionId)
    } else {
      // A tool that returns ok:false has NOT done the thing. Record failure —
      // never let a soft failure be rendered as success in the transcript.
      db.prepare(`UPDATE actions SET status='failed', executed_at=?, error=? WHERE id=?`)
        .run(nowIso(), result.error ?? result.summary, actionId)
    }
    audit(db, {
      actor: ctx.actor, action: 'action.execute', domain: spec.domain, subject: spec.name,
      outcome: result.ok ? 'ok' : 'error', detail: { id: actionId, summary: result.summary },
    })
    return result
  } catch (e) {
    const msg = errText(e)
    db.prepare(`UPDATE actions SET status='failed', executed_at=?, error=? WHERE id=?`)
      .run(nowIso(), msg, actionId)
    audit(db, {
      actor: ctx.actor, action: 'action.execute', domain: spec.domain, subject: spec.name,
      outcome: 'error', detail: { id: actionId, error: msg },
    })
    return { ok: false, summary: `Fehlgeschlagen: ${msg}`, data: null, error: msg }
  }
}

export async function decideAction(
  db: DB, actionId: string, approve: boolean, ctx: ToolExecContext,
): Promise<{ preview: ActionPreview; result: ToolResult | null }> {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Row | undefined
  if (!row) throw new Error('Aktion nicht gefunden')
  if (row.status !== 'pending') throw new Error(`Aktion ist bereits ${row.status}`)
  if (isPast(row.expires_at)) {
    db.prepare(`UPDATE actions SET status='expired' WHERE id=?`).run(actionId)
    throw new Error('Bestätigung abgelaufen – bitte neu anfordern')
  }

  db.prepare(`UPDATE actions SET status=?, decided_at=?, decided_by=? WHERE id=?`)
    .run(approve ? 'approved' : 'rejected', nowIso(), ctx.actor, actionId)
  audit(db, {
    actor: ctx.actor, action: approve ? 'action.approve' : 'action.reject',
    domain: row.domain, subject: row.tool, outcome: 'ok', detail: { id: actionId },
  })

  if (!approve) return { preview: loadAction(db, actionId)!, result: null }
  const result = await runAction(db, actionId, ctx)
  return { preview: loadAction(db, actionId)!, result }
}

export function loadAction(db: DB, id: string): ActionPreview | null {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as Row | undefined
  return row ? toPreview(row) : null
}

export function pendingActions(db: DB): ActionPreview[] {
  expireStaleActions(db)
  const rows = db.prepare(`SELECT * FROM actions WHERE status='pending' ORDER BY created_at DESC LIMIT 50`)
    .all() as Row[]
  return rows.map(toPreview)
}

export function recentActions(db: DB, limit = 50): ActionPreview[] {
  const rows = db.prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]
  return rows.map(toPreview)
}

export function expireStaleActions(db: DB): number {
  return db.prepare(`UPDATE actions SET status='expired' WHERE status='pending' AND expires_at < ?`)
    .run(nowIso()).changes
}

/**
 * Boot-time recovery: an action left in `executing` means the process died
 * mid-flight. We cannot know whether the side effect landed, so we mark it
 * `failed` with an explicit "unknown outcome" note rather than guessing.
 */
export function recoverInFlightActions(db: DB): number {
  const r = db.prepare(
    `UPDATE actions SET status='failed', error=? WHERE status='executing'`,
  ).run('Serverneustart während der Ausführung – Ergebnis unbekannt, bitte manuell prüfen.')
  if (r.changes > 0) {
    log.warn('Aktionen mit unklarem Ausgang nach Neustart', { count: r.changes })
    audit(db, { actor: 'system', action: 'action.recover', outcome: 'error', detail: { count: r.changes } })
  }
  return r.changes
}
