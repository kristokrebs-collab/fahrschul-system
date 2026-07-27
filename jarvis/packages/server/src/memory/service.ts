import type { DB } from '../db/index.js'
import type { MemoryRecord, MemoryProposal, MemoryKind, Sensitivity } from '@jarvis/shared'
import { ENCRYPTED_AT_REST } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso, plus, DAY } from '../util/time.js'
import { encryptSecret, decryptSecret, hasMasterKey, isEncrypted } from '../core/crypto.js'
import { audit } from '../core/audit.js'
import { log } from '../core/logger.js'

/**
 * Memory Curator.
 *
 * Rules that are enforced here rather than asked of the model:
 *  - Nothing durable is written without an approved proposal (or a narrow,
 *    owner-authored rule that matches).
 *  - `private` / `secret` content is encrypted at rest; without a master key we
 *    refuse the write rather than storing it in cleartext.
 *  - `hypothesis` is a first-class kind and is never presented as fact.
 *  - Every mutation snapshots the previous state, so "forget that" is auditable
 *    and "you remembered it wrong" is correctable.
 */

interface Row {
  id: string; kind: string; subject: string; content: string; encrypted: number
  sensitivity: string; confidence: number; provenance: string
  source_conversation_id: string | null; project_id: string | null
  created_at: string; updated_at: string; expires_at: string | null
  revision: number; deleted_at: string | null
}

function decode(row: Row): MemoryRecord {
  let content = row.content
  if (row.encrypted) {
    try { content = decryptSecret(row.content) } catch {
      content = '[Inhalt nicht entschlüsselbar – Master-Key fehlt oder wurde geändert]'
    }
  }
  return {
    id: row.id, kind: row.kind as MemoryKind, subject: row.subject, content,
    sensitivity: row.sensitivity as Sensitivity, confidence: row.confidence,
    provenance: row.provenance, source_conversation_id: row.source_conversation_id,
    project_id: row.project_id, created_at: row.created_at, updated_at: row.updated_at,
    expires_at: row.expires_at, revision: row.revision, deleted_at: row.deleted_at,
  }
}

export interface MemoryDraft {
  kind: MemoryKind
  subject: string
  content: string
  sensitivity: Sensitivity
  confidence: number
  provenance: string
  project_id?: string | null
  expires_at?: string | null
}

/* ── Proposals ───────────────────────────────────────────────────────────── */

/**
 * Returns a proposal. If a narrow owner rule matches, it is auto-approved and
 * committed immediately; otherwise it waits for an explicit decision.
 */
export function proposeMemory(
  db: DB, op: 'create' | 'update' | 'delete', draft: MemoryDraft,
  rationale: string, conversationId: string | null = null, targetId: string | null = null,
): { proposal: MemoryProposal; committed: MemoryRecord | null } {
  const id = newId('mprop')
  const now = nowIso()
  const auto = op !== 'delete' && matchesRule(db, draft)

  db.prepare(
    `INSERT INTO memory_proposals (id, op, target_id, draft, rationale, status, conversation_id, created_at, decided_at, decided_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, op, targetId, JSON.stringify(draft), rationale,
    auto ? 'auto_approved' : 'pending', conversationId, now,
    auto ? now : null, auto ? 'rule' : null)

  const proposal: MemoryProposal = {
    id, op, target_id: targetId,
    draft: {
      kind: draft.kind, subject: draft.subject, content: draft.content,
      sensitivity: draft.sensitivity, confidence: draft.confidence,
      provenance: draft.provenance, project_id: draft.project_id ?? null,
    },
    rationale, status: auto ? 'auto_approved' : 'pending', created_at: now,
  }

  audit(db, {
    actor: 'system', action: 'memory.propose', subject: draft.subject,
    outcome: 'ok', detail: { op, auto, kind: draft.kind, sensitivity: draft.sensitivity },
  })

  return { proposal, committed: auto ? commitDraft(db, op, draft, targetId, conversationId, 'rule') : null }
}

/**
 * Narrow automation rules. Deliberately restrictive: a rule can never
 * auto-approve a deletion, and never anything above its declared sensitivity
 * ceiling. `secret` can never be automated at all.
 */
function matchesRule(db: DB, draft: MemoryDraft): boolean {
  if (draft.sensitivity === 'secret') return false
  const rules = db.prepare('SELECT * FROM memory_rules WHERE auto_approve = 1').all() as Array<{
    pattern: string; kind: string; max_sensitivity: string
  }>
  const order: Sensitivity[] = ['public', 'internal', 'private', 'secret']
  for (const r of rules) {
    if (r.kind !== draft.kind && r.kind !== '*') continue
    if (order.indexOf(draft.sensitivity) > order.indexOf(r.max_sensitivity as Sensitivity)) continue
    const re = new RegExp(r.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*'), 'i')
    if (re.test(draft.subject)) return true
  }
  return false
}

export function decideProposal(
  db: DB, proposalId: string, approve: boolean, actor: string, edited?: Partial<MemoryDraft>,
): MemoryRecord | null {
  const row = db.prepare('SELECT * FROM memory_proposals WHERE id = ?').get(proposalId) as
    { id: string; op: 'create' | 'update' | 'delete'; target_id: string | null; draft: string; status: string; conversation_id: string | null } | undefined
  if (!row) throw new Error('Vorschlag nicht gefunden')
  if (row.status !== 'pending') throw new Error(`Vorschlag ist bereits ${row.status}`)

  db.prepare('UPDATE memory_proposals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .run(approve ? 'approved' : 'rejected', nowIso(), actor, proposalId)

  audit(db, {
    actor, action: approve ? 'memory.approve' : 'memory.reject',
    subject: proposalId, outcome: 'ok', detail: { op: row.op, edited: !!edited },
  })
  if (!approve) return null

  // The owner may correct the draft before approving — that is the whole point
  // of showing it verbatim first.
  const draft = { ...(JSON.parse(row.draft) as MemoryDraft), ...(edited ?? {}) }
  return commitDraft(db, row.op, draft, row.target_id, row.conversation_id, actor)
}

function commitDraft(
  db: DB, op: 'create' | 'update' | 'delete', draft: MemoryDraft,
  targetId: string | null, conversationId: string | null, actor: string,
): MemoryRecord | null {
  if (op === 'delete') {
    if (!targetId) throw new Error('Löschvorschlag ohne Ziel')
    forgetMemory(db, targetId, actor, 'Vorschlag genehmigt')
    return null
  }
  if (op === 'update') {
    if (!targetId) throw new Error('Aktualisierungsvorschlag ohne Ziel')
    return updateMemory(db, targetId, draft, actor)
  }
  return writeMemory(db, draft, conversationId, actor)
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

export function writeMemory(
  db: DB, draft: MemoryDraft, conversationId: string | null, actor: string,
): MemoryRecord {
  const mustEncrypt = ENCRYPTED_AT_REST.includes(draft.sensitivity)
  if (mustEncrypt && !hasMasterKey()) {
    // Refusing is the honest outcome: silently downgrading to cleartext would
    // break the promise the sensitivity label makes to the owner.
    throw new Error(
      `Erinnerung mit Stufe "${draft.sensitivity}" kann nicht gespeichert werden: ` +
      'JARVIS_MASTER_KEY ist nicht gesetzt. Ohne Master-Key wird nichts unverschlüsselt abgelegt.',
    )
  }

  const id = newId('mem')
  const now = nowIso()
  const stored = mustEncrypt ? encryptSecret(draft.content) : draft.content

  db.prepare(
    `INSERT INTO memories (id, kind, subject, content, encrypted, sensitivity, confidence,
       provenance, source_conversation_id, project_id, created_at, updated_at, expires_at, revision, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)`,
  ).run(id, draft.kind, draft.subject, stored, mustEncrypt ? 1 : 0, draft.sensitivity,
    draft.confidence, draft.provenance, conversationId, draft.project_id ?? null,
    now, now, draft.expires_at ?? null)

  audit(db, {
    actor, action: 'memory.create', subject: draft.subject, outcome: 'ok',
    detail: { id, kind: draft.kind, sensitivity: draft.sensitivity, encrypted: mustEncrypt },
  })
  return getMemory(db, id)!
}

export function updateMemory(db: DB, id: string, patch: Partial<MemoryDraft>, actor: string): MemoryRecord {
  const row = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!row) throw new Error('Erinnerung nicht gefunden')

  snapshot(db, row, actor, 'update')

  const next = { ...decode(row), ...patch }
  const sensitivity = (patch.sensitivity ?? row.sensitivity) as Sensitivity
  const mustEncrypt = ENCRYPTED_AT_REST.includes(sensitivity)
  if (mustEncrypt && !hasMasterKey()) throw new Error('JARVIS_MASTER_KEY fehlt – verschlüsselte Erinnerung nicht möglich')
  const content = patch.content ?? decode(row).content
  const stored = mustEncrypt ? encryptSecret(content) : content

  db.prepare(
    `UPDATE memories SET kind=?, subject=?, content=?, encrypted=?, sensitivity=?, confidence=?,
       provenance=?, project_id=?, expires_at=?, updated_at=?, revision=revision+1 WHERE id=?`,
  ).run(next.kind, next.subject, stored, mustEncrypt ? 1 : 0, sensitivity, next.confidence,
    patch.provenance ?? row.provenance, patch.project_id ?? row.project_id,
    patch.expires_at ?? row.expires_at, nowIso(), id)

  audit(db, { actor, action: 'memory.update', subject: next.subject, outcome: 'ok', detail: { id } })
  return getMemory(db, id)!
}

/** Soft delete: reversible for 30 days, then `purgeMemory` removes it for good. */
export function forgetMemory(db: DB, id: string, actor: string, reason = ''): boolean {
  const row = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!row) return false
  snapshot(db, row, actor, reason || 'forget')
  db.prepare('UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id)
  audit(db, { actor, action: 'memory.forget', subject: row.subject, outcome: 'ok', detail: { id, reason } })
  return true
}

/** Irreversible. Removes the row *and* its revision history. */
export function purgeMemory(db: DB, id: string, actor: string): boolean {
  const row = db.prepare('SELECT subject FROM memories WHERE id = ?').get(id) as { subject: string } | undefined
  if (!row) return false
  db.transaction(() => {
    db.prepare('DELETE FROM memory_revisions WHERE memory_id = ?').run(id)
    db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  })()
  audit(db, { actor, action: 'memory.purge', subject: row.subject, outcome: 'ok', detail: { id } })
  return true
}

export function restoreMemory(db: DB, id: string, actor: string): boolean {
  const r = db.prepare('UPDATE memories SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
    .run(nowIso(), id)
  if (r.changes) audit(db, { actor, action: 'memory.restore', subject: id, outcome: 'ok' })
  return r.changes > 0
}

function snapshot(db: DB, row: Row, actor: string, reason: string): void {
  db.prepare(
    `INSERT INTO memory_revisions (id, memory_id, revision, snapshot, changed_by, reason, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(newId('mrev'), row.id, row.revision, JSON.stringify(row), actor, reason, nowIso())
}

/* ── Read ────────────────────────────────────────────────────────────────── */

export function getMemory(db: DB, id: string): MemoryRecord | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
  return row ? decode(row) : null
}

export interface MemoryQuery {
  q?: string
  kind?: MemoryKind
  projectId?: string
  includeDeleted?: boolean
  limit?: number
}

export function listMemories(db: DB, query: MemoryQuery = {}): MemoryRecord[] {
  const conds: string[] = []
  const params: unknown[] = []
  if (!query.includeDeleted) conds.push('deleted_at IS NULL')
  if (query.kind) { conds.push('kind = ?'); params.push(query.kind) }
  if (query.projectId) { conds.push('project_id = ?'); params.push(query.projectId) }
  // Encrypted rows cannot be matched in SQL, so subject-only there; cleartext
  // rows match on content too. Filtering happens again in JS after decrypt.
  if (query.q) {
    conds.push('(subject LIKE ? OR (encrypted = 0 AND content LIKE ?))')
    params.push(`%${query.q}%`, `%${query.q}%`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  params.push(query.limit ?? 200)
  const rows = db.prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params) as Row[]
  return rows.map(decode)
}

/**
 * Recall for the model. Encrypted rows are decrypted in memory and matched
 * here, which is why an encrypted memory is still findable by content.
 */
export function recall(db: DB, query: string, limit = 8): MemoryRecord[] {
  const all = listMemories(db, { limit: 500 })
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  if (!terms.length) return all.slice(0, limit)

  const scored = all.map((m) => {
    const hay = `${m.subject} ${m.content}`.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (m.subject.toLowerCase().includes(t)) score += 3
      else if (hay.includes(t)) score += 1
    }
    // Hypotheses rank below verified knowledge so they never crowd out facts.
    if (m.kind === 'hypothesis') score *= 0.5
    return { m, score: score * (0.5 + m.confidence / 2) }
  }).filter((s) => s.score > 0)

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.m)
}

/** Formats recalled memories for the prompt, keeping hypotheses clearly marked. */
export function memoriesToContext(memories: MemoryRecord[]): string {
  if (!memories.length) return ''
  return memories.map((m) => {
    const tag = m.kind === 'hypothesis' ? 'VERMUTUNG – NICHT ALS TATSACHE BEHANDELN' : m.kind
    return `[${tag}] ${m.subject}: ${m.content} (Konfidenz ${m.confidence.toFixed(2)}, seit ${m.created_at.slice(0, 10)}, Quelle: ${m.provenance})`
  }).join('\n')
}

export function pendingProposals(db: DB): MemoryProposal[] {
  const rows = db.prepare(
    `SELECT * FROM memory_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`,
  ).all() as Array<Record<string, string>>
  return rows.map((r) => ({
    id: r.id!, op: r.op as MemoryProposal['op'], target_id: r.target_id ?? null,
    draft: JSON.parse(r.draft!), rationale: r.rationale!,
    status: r.status as MemoryProposal['status'], created_at: r.created_at!,
  }))
}

/**
 * Retention sweep: expire time-bounded memories, hard-purge soft-deleted rows
 * after the grace period. Runs from the scheduled maintenance job.
 */
export function applyRetention(db: DB, graceDays = 30): { expired: number; purged: number } {
  const now = nowIso()
  const expired = db.prepare(
    `UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?`,
  ).run(now, now).changes

  const cutoff = plus(-graceDays * DAY)
  const stale = db.prepare('SELECT id FROM memories WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff) as Array<{ id: string }>
  for (const s of stale) purgeMemory(db, s.id, 'system:retention')

  if (expired || stale.length) {
    log.info('Aufbewahrungslauf', { expired, purged: stale.length })
    audit(db, {
      actor: 'system', action: 'memory.retention', outcome: 'ok',
      detail: { expired, purged: stale.length, grace_days: graceDays },
    })
  }
  return { expired, purged: stale.length }
}

/** Full export for the privacy dashboard — decrypted, so it is owner-only. */
export function exportMemories(db: DB, actor: string): MemoryRecord[] {
  const all = listMemories(db, { includeDeleted: true, limit: 100_000 })
  audit(db, { actor, action: 'memory.export', outcome: 'ok', detail: { count: all.length } })
  return all
}
