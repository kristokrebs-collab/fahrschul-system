import type { DB } from '../db/index.js'
import type { Briefing, Project, TaskItem } from '@jarvis/shared'
import { newId } from '../util/id.js'
import { nowIso, relDe, DAY, isPast } from '../util/time.js'
import { audit } from '../core/audit.js'
import { llmConfigured } from '../llm/client.js'
import { embeddings } from '../knowledge/embeddings.js'
import { config } from '../config.js'

/**
 * Projects and the chief-of-staff briefing.
 *
 * The briefing is computed, not generated: every number in it comes from a
 * query, so it is correct even with no model available. The model's job — when
 * present — is to comment on it, not to produce it.
 */

export function createProject(db: DB, p: {
  name: string; category?: string; objective?: string; domain?: string
}, actor: string): Project {
  const id = newId('proj')
  const now = nowIso()
  db.prepare(
    `INSERT INTO projects (id, name, category, objective, current_state, status, domain, created_at, updated_at)
     VALUES (?,?,?,?,'','active',?,?,?)`,
  ).run(id, p.name, p.category ?? 'allgemein', p.objective ?? '', p.domain ?? 'general-jarvis', now, now)
  audit(db, { actor, action: 'project.create', subject: p.name, outcome: 'ok', detail: { id } })
  return getProject(db, id)!
}

export function getProject(db: DB, id: string): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined
  return r ?? null
}

export function listProjects(db: DB, includeArchived = false): Project[] {
  const sql = includeArchived
    ? 'SELECT * FROM projects ORDER BY updated_at DESC'
    : `SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC`
  return db.prepare(sql).all() as Project[]
}

export function updateProject(db: DB, id: string, patch: Partial<Project>, actor: string): Project | null {
  const cur = getProject(db, id)
  if (!cur) return null
  const next = { ...cur, ...patch, updated_at: nowIso() }
  db.prepare(
    `UPDATE projects SET name=?, category=?, objective=?, current_state=?, status=?, updated_at=? WHERE id=?`,
  ).run(next.name, next.category, next.objective, next.current_state, next.status, next.updated_at, id)
  audit(db, { actor, action: 'project.update', subject: next.name, outcome: 'ok', detail: { id } })
  return getProject(db, id)
}

export function addProjectNote(
  db: DB, projectId: string, kind: 'decision' | 'open_question' | 'risk' | 'next_action', body: string,
): string {
  const id = newId('pnote')
  db.prepare(
    `INSERT INTO project_notes (id, project_id, kind, body, resolved, created_at) VALUES (?,?,?,?,0,?)`,
  ).run(id, projectId, kind, body, nowIso())
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId)
  return id
}

export function projectNotes(db: DB, projectId: string) {
  return db.prepare(
    'SELECT id, kind, body, resolved, created_at FROM project_notes WHERE project_id = ? ORDER BY created_at DESC',
  ).all(projectId) as Array<{ id: string; kind: string; body: string; resolved: number; created_at: string }>
}

/* ── Tasks ───────────────────────────────────────────────────────────────── */

export function listTasks(db: DB, filter: { status?: string; projectId?: string } = {}): TaskItem[] {
  const conds: string[] = []; const params: unknown[] = []
  if (filter.status) { conds.push('status = ?'); params.push(filter.status) }
  if (filter.projectId) { conds.push('project_id = ?'); params.push(filter.projectId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(
    `SELECT * FROM tasks ${where} ORDER BY due_at IS NULL, due_at ASC, priority ASC LIMIT 500`,
  ).all(...params) as TaskItem[]
}

export function createTask(db: DB, t: {
  title: string; detail?: string; projectId?: string | null; dueAt?: string | null; priority?: number
}, actor: string): TaskItem {
  const id = newId('task')
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, detail, status, priority, due_at, created_at, completed_at)
     VALUES (?,?,?,?,'open',?,?,?,NULL)`,
  ).run(id, t.projectId ?? null, t.title, t.detail ?? '', t.priority ?? 3, t.dueAt ?? null, nowIso())
  audit(db, { actor, action: 'task.create', subject: t.title, outcome: 'ok', detail: { id } })
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem
}

export function updateTask(db: DB, id: string, patch: Partial<TaskItem>, actor: string): TaskItem | null {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem | undefined
  if (!cur) return null
  const next = { ...cur, ...patch }
  const completedAt = next.status === 'done' ? (cur.completed_at ?? nowIso()) : null
  db.prepare(
    `UPDATE tasks SET title=?, detail=?, status=?, priority=?, due_at=?, project_id=?, completed_at=? WHERE id=?`,
  ).run(next.title, next.detail, next.status, next.priority, next.due_at, next.project_id, completedAt, id)
  audit(db, { actor, action: 'task.update', subject: next.title, outcome: 'ok', detail: { id, status: next.status } })
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem
}

export function deleteTask(db: DB, id: string, actor: string): boolean {
  const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  if (r.changes) audit(db, { actor, action: 'task.delete', subject: id, outcome: 'ok' })
  return r.changes > 0
}

/* ── Briefing ────────────────────────────────────────────────────────────── */

export function buildBriefing(db: DB, now = Date.now()): Briefing {
  const open = listTasks(db, { status: 'open' })
    .concat(listTasks(db, { status: 'in_progress' }))
    .concat(listTasks(db, { status: 'blocked' }))

  const overdue = open.filter((t) => t.due_at && isPast(t.due_at, now))
  const dueToday = open.filter((t) => {
    if (!t.due_at || isPast(t.due_at, now)) return false
    return Date.parse(t.due_at) - now <= DAY
  })
  const upcoming = open.filter((t) => {
    if (!t.due_at) return false
    const d = Date.parse(t.due_at) - now
    return d > DAY && d <= 7 * DAY
  })

  const approvals = db.prepare(`SELECT count(*) n FROM actions WHERE status='pending'`).get() as { n: number }
  const memProps = db.prepare(`SELECT count(*) n FROM memory_proposals WHERE status='pending'`).get() as { n: number }

  const projects = listProjects(db).filter((p) => p.status === 'active').map((project) => {
    const notes = projectNotes(db, project.id)
    const openTasks = open.filter((t) => t.project_id === project.id)
    const nextAction = notes.find((n) => n.kind === 'next_action' && !n.resolved)?.body
      ?? openTasks.sort((a, b) => a.priority - b.priority)[0]?.title
      ?? null
    return {
      project,
      open_tasks: openTasks.length,
      open_questions: notes.filter((n) => n.kind === 'open_question' && !n.resolved).map((n) => n.body),
      next_best_action: nextAction,
    }
  })

  const conflicts: string[] = []
  const superseded = db.prepare(
    `SELECT s.title, n.title AS newer FROM sources s JOIN sources n ON n.id = s.superseded_by
      WHERE s.active = 1 LIMIT 5`,
  ).all() as Array<{ title: string; newer: string }>
  for (const s of superseded) conflicts.push(`"${s.title}" ist durch "${s.newer}" ersetzt – noch im Index aktiv.`)

  const dayCollisions = new Map<string, number>()
  for (const t of [...dueToday, ...upcoming]) {
    const day = t.due_at!.slice(0, 10)
    dayCollisions.set(day, (dayCollisions.get(day) ?? 0) + 1)
  }
  for (const [day, n] of dayCollisions) {
    if (n >= 4) conflicts.push(`${n} Aufgaben fällig am ${day} – das wird eng.`)
  }

  const degraded: string[] = []
  if (!llmConfigured(db)) degraded.push('Kein Sprachmodell konfiguriert – freie Antworten nicht möglich.')
  if (config.offline) degraded.push('Offline-Modus aktiv – keine Live-Recherche.')
  const emb = embeddings()
  if (emb.quality === 'none') degraded.push('Semantische Suche deaktiviert – nur Volltextsuche.')
  else if (emb.quality === 'lexical') degraded.push('Embeddings im lexikalischen Modus – Synonyme werden nicht erkannt.')
  if (!config.masterKey) degraded.push('Kein Master-Key – vertrauliche Erinnerungen können nicht gespeichert werden.')

  const hour = new Date(now).getHours()
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend'

  return {
    generated_at: nowIso(now),
    greeting_de: `${greeting}. ${briefLine(overdue.length, dueToday.length, approvals.n)}`,
    overdue, due_today: dueToday, upcoming,
    open_approvals: approvals.n,
    open_memory_proposals: memProps.n,
    projects,
    conflicts,
    blind_spot: findBlindSpot(db, { overdue, projects, now }),
    degraded,
  }
}

function briefLine(overdue: number, today: number, approvals: number): string {
  const parts: string[] = []
  if (overdue) parts.push(`${overdue} überfällig`)
  if (today) parts.push(`${today} heute fällig`)
  if (approvals) parts.push(`${approvals} Bestätigung${approvals === 1 ? '' : 'en'} offen`)
  return parts.length ? parts.join(', ') + '.' : 'Nichts brennt.'
}

/**
 * "One risk the owner may be missing."
 *
 * Deterministic heuristics over real state, checked in order of how much damage
 * the miss would cause. Returns null rather than inventing a concern when
 * nothing qualifies — a fabricated risk every morning trains the owner to
 * ignore this field.
 */
function findBlindSpot(
  db: DB,
  s: { overdue: TaskItem[]; projects: Array<{ project: Project; open_tasks: number; open_questions: string[] }>; now: number },
): Briefing['blind_spot'] {
  const longOverdue = s.overdue.filter((t) => Date.parse(t.due_at!) < s.now - 14 * DAY)
  if (longOverdue.length) {
    return {
      risk: `${longOverdue.length} Aufgabe(n) seit über zwei Wochen überfällig, z. B. "${longOverdue[0]!.title}".`,
      why: 'Was so lange liegt, ist meist entweder nicht mehr nötig oder blockiert etwas anderes. Beides lohnt eine Entscheidung.',
    }
  }

  const stalled = s.projects.filter((p) =>
    p.project.status === 'active' && Date.parse(p.project.updated_at) < s.now - 21 * DAY)
  if (stalled.length) {
    return {
      risk: `Projekt "${stalled[0]!.project.name}" ist seit ${Math.round((s.now - Date.parse(stalled[0]!.project.updated_at)) / DAY)} Tagen unverändert.`,
      why: 'Ein aktives Projekt ohne Bewegung bindet Aufmerksamkeit, ohne Fortschritt zu erzeugen.',
    }
  }

  const unanswered = s.projects.find((p) => p.open_questions.length >= 3)
  if (unanswered) {
    return {
      risk: `"${unanswered.project.name}" hat ${unanswered.open_questions.length} offene Fragen.`,
      why: 'Offene Fragen häufen sich, bis eine davon zur Blockade wird. Eine davon heute zu klären ist billiger als alle später.',
    }
  }

  const staleAge = db.prepare(
    `SELECT count(*) n FROM sources WHERE active = 1 AND modified_at IS NOT NULL AND modified_at < ?`,
  ).get(nowIso(s.now - 730 * DAY)) as { n: number }
  const total = db.prepare('SELECT count(*) n FROM sources WHERE active = 1').get() as { n: number }
  if (total.n >= 10 && staleAge.n / total.n > 0.6) {
    return {
      risk: `${Math.round((staleAge.n / total.n) * 100)} % der indexierten Quellen sind älter als zwei Jahre.`,
      why: 'Antworten aus deinen Unterlagen sind nur so aktuell wie die Unterlagen selbst.',
    }
  }

  const deadJobs = db.prepare(`SELECT count(*) n FROM jobs WHERE status='dead'`).get() as { n: number }
  if (deadJobs.n > 0) {
    return {
      risk: `${deadJobs.n} Hintergrundjob(s) endgültig fehlgeschlagen.`,
      why: 'Fehlgeschlagene Jobs bedeuten meist, dass etwas nicht indexiert oder nicht gesichert wurde.',
    }
  }

  return null
}

/** Compact German rendering for voice output and the morning push. */
export function briefingToText(b: Briefing): string {
  const lines = [b.greeting_de, '']
  if (b.overdue.length) {
    lines.push('Überfällig:')
    for (const t of b.overdue.slice(0, 5)) lines.push(`• ${t.title} (${relDe(t.due_at)})`)
    lines.push('')
  }
  if (b.due_today.length) {
    lines.push('Heute fällig:')
    for (const t of b.due_today) lines.push(`• ${t.title}`)
    lines.push('')
  }
  if (b.open_approvals) lines.push(`${b.open_approvals} Aktion(en) warten auf deine Bestätigung.`)
  if (b.open_memory_proposals) lines.push(`${b.open_memory_proposals} Erinnerungsvorschlag/-vorschläge offen.`)
  if (b.conflicts.length) {
    lines.push('', 'Konflikte:')
    for (const c of b.conflicts) lines.push(`• ${c}`)
  }
  if (b.blind_spot) lines.push('', `Blinder Fleck: ${b.blind_spot.risk} ${b.blind_spot.why}`)
  if (b.degraded.length) {
    lines.push('', 'Eingeschränkt:')
    for (const d of b.degraded) lines.push(`• ${d}`)
  }
  return lines.join('\n')
}
