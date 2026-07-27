import type { DB } from '../db/index.js'
import { newId } from '../util/id.js'
import { nowIso } from '../util/time.js'
import { sha256 } from './crypto.js'

/**
 * Append-only, hash-chained audit log.
 *
 * Each entry hashes (prev_hash + its own canonical fields). Rewriting or
 * deleting any historical row breaks every subsequent hash, so
 * `verifyAuditChain` turns silent tampering into a visible integrity failure.
 * This is tamper-*evident*, not tamper-proof — an attacker with write access to
 * the file can recompute the chain. Off-box backups are what close that gap.
 */

export type AuditOutcome = 'ok' | 'denied' | 'error'

export interface AuditEntry {
  actor: string
  action: string
  domain?: string
  subject?: string
  outcome: AuditOutcome
  detail?: Record<string, unknown>
}

const GENESIS = '0'.repeat(64)

/** Keys whose values must never reach the audit log in cleartext. */
const SECRET_KEYS = /^(password|passwort|token|secret|api_?key|authorization|cookie|credential|totp)/i

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[tief verschachtelt]'
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…[gekürzt]'
    return v
  }
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redigiert]' : scrub(val, depth + 1)
  }
  return out
}

function canonical(e: {
  id: string; at: string; actor: string; action: string; domain: string
  subject: string; outcome: string; detail: string; prev: string
}): string {
  return [e.prev, e.id, e.at, e.actor, e.action, e.domain, e.subject, e.outcome, e.detail].join('')
}

export function audit(db: DB, entry: AuditEntry): string {
  const prevRow = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
    | { hash: string } | undefined
  const prev = prevRow?.hash ?? GENESIS
  const id = newId('aud')
  const at = nowIso()
  const detail = JSON.stringify(scrub(entry.detail ?? {}))
  const row = {
    id, at,
    actor: entry.actor,
    action: entry.action,
    domain: entry.domain ?? 'general-jarvis',
    subject: entry.subject ?? '',
    outcome: entry.outcome,
    detail, prev,
  }
  const hash = sha256(canonical(row))
  db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, domain, subject, outcome, detail, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.at, row.actor, row.action, row.domain, row.subject, row.outcome, row.detail, prev, hash)
  return id
}

export function verifyAuditChain(db: DB): { valid: boolean; entries: number; brokenAt: string | null } {
  const rows = db.prepare(
    'SELECT id, at, actor, action, domain, subject, outcome, detail, prev_hash, hash FROM audit_log ORDER BY seq ASC',
  ).all() as Array<Record<string, string>>
  let prev = GENESIS
  for (const r of rows) {
    if (r.prev_hash !== prev) return { valid: false, entries: rows.length, brokenAt: r.id! }
    const expect = sha256(canonical({
      id: r.id!, at: r.at!, actor: r.actor!, action: r.action!, domain: r.domain!,
      subject: r.subject!, outcome: r.outcome!, detail: r.detail!, prev,
    }))
    if (expect !== r.hash) return { valid: false, entries: rows.length, brokenAt: r.id! }
    prev = r.hash!
  }
  return { valid: true, entries: rows.length, brokenAt: null }
}

export function recentAudit(db: DB, limit = 100, action?: string) {
  const sql = action
    ? 'SELECT * FROM audit_log WHERE action LIKE ? ORDER BY seq DESC LIMIT ?'
    : 'SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?'
  const rows = action
    ? db.prepare(sql).all(`${action}%`, limit)
    : db.prepare(sql).all(limit)
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    ...r, detail: JSON.parse(String(r.detail ?? '{}')),
  }))
}
