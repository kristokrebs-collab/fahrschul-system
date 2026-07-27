import type { DB } from '../db/index.js'
import type { CorrectionCategory, OutcomeFlag, ImprovementProposal } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso, plus, DAY } from '../util/time.js'
import { sha256 } from '../core/crypto.js'
import { audit } from '../core/audit.js'
import { log } from '../core/logger.js'

/**
 * Evaluation & controlled improvement.
 *
 * Privacy stance: we record the *shape* of every interaction (latency, citation
 * count, which tools ran, whether it looked grounded) but store only a hash of
 * the question. Corrections are the exception — the owner writes those
 * deliberately, so their text is kept, because a correction without its content
 * teaches nothing.
 */

export interface InteractionInput {
  conversation_id: string
  message_id: string
  mode: string
  model: string
  prompt_version: string
  question: string
  citations_count: number
  grounded: boolean | null
  used_web: boolean
  used_tools: string[]
  latency_ms: number
  flags: string[]
}

export function recordInteraction(db: DB, input: InteractionInput): string {
  const id = newId('ix')
  db.prepare(
    `INSERT INTO interactions (id, conversation_id, message_id, mode, model, prompt_version,
       question_hash, citations_count, grounded, used_web, used_tools, latency_ms, flags, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, input.conversation_id, input.message_id, input.mode, input.model, input.prompt_version,
    sha256(input.question.toLowerCase().trim()), input.citations_count,
    input.grounded === null ? null : input.grounded ? 1 : 0,
    input.used_web ? 1 : 0, JSON.stringify(input.used_tools), input.latency_ms,
    JSON.stringify(input.flags), nowIso())
  return id
}

export function flagInteraction(db: DB, messageId: string, flag: OutcomeFlag): void {
  const row = db.prepare('SELECT id, flags FROM interactions WHERE message_id = ?').get(messageId) as
    { id: string; flags: string } | undefined
  if (!row) return
  const flags: string[] = JSON.parse(row.flags || '[]')
  if (!flags.includes(flag)) flags.push(flag)
  db.prepare('UPDATE interactions SET flags = ? WHERE id = ?').run(JSON.stringify(flags), row.id)
}

/* ── Corrections ─────────────────────────────────────────────────────────── */

export interface CorrectionInput {
  message_id: string | null
  category: CorrectionCategory
  what_went_wrong: string
  expected?: string
  severity?: 'low' | 'medium' | 'high'
}

/**
 * A correction is the highest-value signal the system gets. Recording it also
 * flags the interaction and, for retrieval/knowledge failures, seeds a
 * regression case so the same question is checked on every future eval run.
 */
export function recordCorrection(db: DB, input: CorrectionInput, actor: string, question?: string): string {
  const id = newId('corr')
  const interaction = input.message_id
    ? db.prepare('SELECT id FROM interactions WHERE message_id = ?').get(input.message_id) as { id: string } | undefined
    : undefined

  db.prepare(
    `INSERT INTO corrections (id, interaction_id, message_id, category, what_went_wrong, expected,
       severity, created_at, created_by, resolved_by_proposal)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
  ).run(id, interaction?.id ?? null, input.message_id, input.category, input.what_went_wrong,
    input.expected ?? '', input.severity ?? 'medium', nowIso(), actor)

  if (input.message_id) flagInteraction(db, input.message_id, 'user_correction')

  if (question && ['retrieval', 'knowledge_source', 'reasoning_instruction'].includes(input.category)) {
    addRegressionCase(db, {
      name: `Korrektur ${id}`,
      question,
      expectation: { must_contain: input.expected ? [input.expected.slice(0, 60)] : [], must_cite: [], must_not_contain: [], must_refuse: false },
      origin: `correction:${id}`,
    })
  }

  audit(db, {
    actor, action: 'eval.correction', subject: input.category, outcome: 'ok',
    detail: { id, severity: input.severity ?? 'medium' },
  })
  log.info('Korrektur erfasst', { id, category: input.category })
  return id
}

export function listCorrections(db: DB, limit = 100) {
  return db.prepare('SELECT * FROM corrections ORDER BY created_at DESC LIMIT ?').all(limit)
}

/* ── Regression cases ────────────────────────────────────────────────────── */

export interface Expectation {
  must_contain: string[]
  must_cite: string[]
  must_not_contain: string[]
  must_refuse: boolean
}

export function addRegressionCase(db: DB, c: {
  name: string; question: string; expectation: Expectation; origin?: string
}): string {
  const id = newId('rc')
  db.prepare(
    `INSERT INTO regression_cases (id, name, question, expectation, origin, created_at, enabled)
     VALUES (?,?,?,?,?,?,1)`,
  ).run(id, c.name, c.question, JSON.stringify(c.expectation), c.origin ?? 'manual', nowIso())
  return id
}

export interface RegressionCase {
  id: string
  name: string
  question: string
  expectation: Expectation
  origin: string
  created_at: string
}

export function listRegressionCases(db: DB): RegressionCase[] {
  const rows = db.prepare('SELECT * FROM regression_cases WHERE enabled = 1 ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), question: String(r.question),
    expectation: JSON.parse(String(r.expectation)) as Expectation,
    origin: String(r.origin ?? 'manual'), created_at: String(r.created_at),
  }))
}

/* ── Metrics ─────────────────────────────────────────────────────────────── */

export interface EvalMetrics {
  window_days: number
  interactions: number
  corrections: number
  correction_rate: number
  grounded_rate: number | null
  avg_citations: number
  p50_latency_ms: number
  p95_latency_ms: number
  flag_counts: Record<string, number>
  by_category: Record<string, number>
}

export function evalMetrics(db: DB, windowDays = 30): EvalMetrics {
  const since = plus(-windowDays * DAY)
  const rows = db.prepare(
    'SELECT grounded, citations_count, latency_ms, flags FROM interactions WHERE created_at >= ?',
  ).all(since) as Array<{ grounded: number | null; citations_count: number; latency_ms: number; flags: string }>

  const latencies = rows.map((r) => r.latency_ms).sort((a, b) => a - b)
  const pct = (p: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]! : 0

  const flagCounts: Record<string, number> = {}
  for (const r of rows) for (const f of JSON.parse(r.flags || '[]') as string[]) flagCounts[f] = (flagCounts[f] ?? 0) + 1

  const groundedRows = rows.filter((r) => r.grounded !== null)
  const corrections = db.prepare('SELECT category FROM corrections WHERE created_at >= ?')
    .all(since) as Array<{ category: string }>
  const byCategory: Record<string, number> = {}
  for (const c of corrections) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1

  return {
    window_days: windowDays,
    interactions: rows.length,
    corrections: corrections.length,
    correction_rate: rows.length ? Number((corrections.length / rows.length).toFixed(3)) : 0,
    grounded_rate: groundedRows.length
      ? Number((groundedRows.filter((r) => r.grounded === 1).length / groundedRows.length).toFixed(3))
      : null,
    avg_citations: rows.length ? Number((rows.reduce((s, r) => s + r.citations_count, 0) / rows.length).toFixed(2)) : 0,
    p50_latency_ms: pct(0.5),
    p95_latency_ms: pct(0.95),
    flag_counts: flagCounts,
    by_category: byCategory,
  }
}

/* ── Improvement proposals ───────────────────────────────────────────────── */

/**
 * Turns clusters of corrections into concrete, reviewable proposals.
 *
 * This is the boundary the master spec draws: JARVIS may *propose* a prompt or
 * config change and may run evals against it, but the change is inert until the
 * owner approves it. Nothing here writes to the active prompt.
 */
export function synthesiseProposals(db: DB, actor = 'system'): ImprovementProposal[] {
  const since = plus(-30 * DAY)
  const rows = db.prepare(
    `SELECT category, what_went_wrong, expected, id FROM corrections
      WHERE created_at >= ? AND resolved_by_proposal IS NULL`,
  ).all(since) as Array<{ category: string; what_went_wrong: string; expected: string; id: string }>

  const byCategory = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? []
    list.push(r)
    byCategory.set(r.category, list)
  }

  const created: ImprovementProposal[] = []
  for (const [category, items] of byCategory) {
    // Two corrections in one category is a pattern; one is an incident.
    if (items.length < 2) continue

    const target = category === 'retrieval' ? 'retrieval_config'
      : category === 'tool_use' ? 'tool_config'
        : 'prompt'
    const targetKey = target === 'prompt' ? 'system.core' : category

    const already = db.prepare(
      `SELECT 1 FROM improvement_proposals WHERE category = ? AND status IN ('draft','evaluated','approved')`,
    ).get(category)
    if (already) continue

    const id = newId('imp')
    const proposal: ImprovementProposal = {
      id, category: category as CorrectionCategory,
      title_de: `${items.length} Korrekturen zu "${category}" – Anpassung vorschlagen`,
      rationale:
        `In den letzten 30 Tagen gab es ${items.length} Korrekturen in der Kategorie "${category}". ` +
        `Häufigste Rückmeldungen: ${items.slice(0, 3).map((i) => `„${i.what_went_wrong.slice(0, 90)}“`).join('; ')}.`,
      diff: buildDiffSketch(category, items),
      target: target as ImprovementProposal['target'],
      target_key: targetKey,
      evidence_correction_ids: items.map((i) => i.id),
      eval_before: null, eval_after: null, status: 'draft', created_at: nowIso(),
    }
    db.prepare(
      `INSERT INTO improvement_proposals (id, category, title, rationale, diff, target, target_key,
         evidence, eval_before, eval_after, status, created_at, decided_at, decided_by)
       VALUES (?,?,?,?,?,?,?,?,NULL,NULL,'draft',?,NULL,NULL)`,
    ).run(id, category, proposal.title_de, proposal.rationale, proposal.diff, target, targetKey,
      JSON.stringify(proposal.evidence_correction_ids), nowIso())
    created.push(proposal)
  }

  if (created.length) {
    audit(db, {
      actor, action: 'eval.propose_improvement', outcome: 'ok',
      detail: { count: created.length, categories: created.map((c) => c.category) },
    })
  }
  return created
}

function buildDiffSketch(category: string, items: Array<{ what_went_wrong: string; expected: string }>): string {
  const wants = items.map((i) => i.expected).filter(Boolean).slice(0, 5)
  const header = `# Vorschlag für "${category}"\n# Basierend auf ${items.length} Korrekturen.\n`
  if (category === 'retrieval') {
    return header +
      '- Trefferzahl im Modus "deep" von 12 auf 16 erhöhen\n' +
      '- Relevanzschwelle für rein semantische Treffer anheben\n' +
      (wants.length ? `# Erwartungen des Besitzers:\n${wants.map((w) => `#   ${w}`).join('\n')}\n` : '')
  }
  if (category === 'tool_use') {
    return header +
      '- Werkzeugbeschreibungen um explizite "Nutze dies, wenn …"-Bedingungen ergänzen\n' +
      (wants.length ? `# Erwartungen:\n${wants.map((w) => `#   ${w}`).join('\n')}\n` : '')
  }
  return header +
    '+ Ergänzung im Systemprompt (Abschnitt „Herkunft von Aussagen“):\n' +
    wants.map((w) => `+   ${w}`).join('\n') +
    (wants.length ? '' : '+   (Bitte konkreten Wortlaut ergänzen)') + '\n'
}

export function listProposals(db: DB): ImprovementProposal[] {
  const rows = db.prepare('SELECT * FROM improvement_proposals ORDER BY created_at DESC LIMIT 100')
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id), category: r.category as CorrectionCategory, title_de: String(r.title),
    rationale: String(r.rationale), diff: String(r.diff),
    target: r.target as ImprovementProposal['target'], target_key: String(r.target_key),
    evidence_correction_ids: JSON.parse(String(r.evidence ?? '[]')),
    eval_before: r.eval_before === null ? null : Number(r.eval_before),
    eval_after: r.eval_after === null ? null : Number(r.eval_after),
    status: r.status as ImprovementProposal['status'], created_at: String(r.created_at),
  }))
}

export function decideProposalStatus(
  db: DB, id: string, status: 'approved' | 'rejected' | 'deployed' | 'rolled_back', actor: string,
): void {
  db.prepare('UPDATE improvement_proposals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .run(status, nowIso(), actor, id)
  if (status === 'approved' || status === 'deployed') {
    const ev = db.prepare('SELECT evidence FROM improvement_proposals WHERE id = ?').get(id) as { evidence: string }
    for (const cid of JSON.parse(ev?.evidence ?? '[]') as string[]) {
      db.prepare('UPDATE corrections SET resolved_by_proposal = ? WHERE id = ?').run(id, cid)
    }
  }
  audit(db, { actor, action: `eval.proposal_${status}`, subject: id, outcome: 'ok' })
}
