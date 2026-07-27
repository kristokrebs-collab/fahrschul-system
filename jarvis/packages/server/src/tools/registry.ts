import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { DB } from '../db/index.js'
import type { RiskClass, PermissionDomain, ToolDescriptor } from '@jarvis/shared'
import { config } from '../config.js'
import { newId } from '../util/id.js'
import { nowIso } from '../util/time.js'
import { retrieve } from '../knowledge/retrieval.js'
import { recall, proposeMemory, forgetMemory, listMemories } from '../memory/service.js'
import { querySibling, siblingToContext } from '../adapters/sibling.js'
import { audit } from '../core/audit.js'
import { errText } from '../core/logger.js'
import { assertInsideRoots } from '../knowledge/indexer.js'

const execFileAsync = promisify(execFile)

/**
 * The tool registry: the complete set of things JARVIS can do, each carrying
 * the metadata the safety layer needs. A tool that is not in this table cannot
 * be invoked — the model's output is matched against it by name, and an
 * unknown name is an error, not an improvisation.
 */

export interface ToolExecContext {
  db: DB
  actor: string
  conversationId: string | null
  projectId: string | null
}

export interface ToolResult {
  ok: boolean
  /** Shown to the owner in the transcript. */
  summary: string
  /** Returned to the model as the tool result. */
  data: unknown
  error?: string
}

export interface ToolSpec {
  name: string
  titleDe: string
  description: string
  domain: PermissionDomain
  risk: RiskClass
  reversible: boolean
  rollbackHint: string | null
  inputSchema: Record<string, unknown>
  /** Human-readable "what this touches", rendered on the confirmation card. */
  describeTarget(input: Record<string, unknown>): string
  describeEffects(input: Record<string, unknown>): string[]
  execute(ctx: ToolExecContext, input: Record<string, unknown>): Promise<ToolResult>
  requiresIntegration?: string
  integrationReady?: () => boolean
  enabled?: () => boolean
}

const obj = (props: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties: props, required, additionalProperties: false,
})
const str = (description: string) => ({ type: 'string', description })

/* ────────────────────────────────────────────────────────────────────────────
 * read_only
 * ──────────────────────────────────────────────────────────────────────────── */

const searchKnowledge: ToolSpec = {
  name: 'search_private_knowledge',
  titleDe: 'Private Quellen durchsuchen',
  description:
    'Durchsucht die indexierten privaten Dokumente des Besitzers (Notizen, PDFs, Tabellen). ' +
    'Liefert Passagen mit exakter Quellenangabe. Nutze dies IMMER, bevor du eine Frage zu ' +
    'persönlichen oder geschäftlichen Inhalten beantwortest.',
  domain: 'general-jarvis', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({
    query: str('Suchanfrage in natürlicher Sprache'),
    limit: { type: 'integer', description: 'Maximale Trefferzahl (1–15)', minimum: 1, maximum: 15 },
  }, ['query']),
  describeTarget: (i) => `Private Wissensbasis – "${String(i.query).slice(0, 80)}"`,
  describeEffects: () => ['Liest den lokalen Index. Keine Änderung.'],
  async execute(ctx, input) {
    const r = await retrieve(ctx.db, String(input.query), {
      limit: Math.min(15, Math.max(1, Number(input.limit) || 6)),
      projectId: ctx.projectId,
    })
    return {
      ok: true,
      summary: `${r.citations.length} Passagen (Abdeckung: ${r.coverage})`,
      data: {
        coverage: r.coverage,
        conflicts: r.conflicts,
        semantic_enabled: r.semantic_enabled,
        results: r.citations.map((c) => ({
          quelle: c.source_title, fundstelle: c.loc, uri: c.source_uri,
          geaendert: c.modified_at, frische: c.freshness,
          ersetzt_durch: c.superseded_by, text: c.passage,
        })),
      },
    }
  },
}

const readSource: ToolSpec = {
  name: 'read_source',
  titleDe: 'Quelle vollständig lesen',
  description: 'Liest den vollständigen indexierten Text einer Quelle anhand ihrer ID oder ihres Titels.',
  domain: 'general-jarvis', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({ source: str('Quellen-ID oder exakter Titel') }, ['source']),
  describeTarget: (i) => `Quelle "${String(i.source)}"`,
  describeEffects: () => ['Liest eine indexierte Quelle. Keine Änderung.'],
  async execute(ctx, input) {
    const key = String(input.source)
    const src = ctx.db.prepare(
      'SELECT id, title, uri, modified_at FROM sources WHERE id = ? OR title = ? LIMIT 1',
    ).get(key, key) as { id: string; title: string; uri: string; modified_at: string | null } | undefined
    if (!src) return { ok: false, summary: 'Quelle nicht gefunden', data: null, error: `Keine Quelle: ${key}` }
    const chunks = ctx.db.prepare('SELECT loc, text FROM chunks WHERE source_id = ? ORDER BY ord')
      .all(src.id) as Array<{ loc: string; text: string }>
    return {
      ok: true, summary: `${src.title} (${chunks.length} Abschnitte)`,
      data: { titel: src.title, uri: src.uri, geaendert: src.modified_at, abschnitte: chunks },
    }
  },
}

const recallMemory: ToolSpec = {
  name: 'recall_memory',
  titleDe: 'Erinnerungen abrufen',
  description: 'Durchsucht die dauerhaften Erinnerungen (Präferenzen, Fakten, Entscheidungen, Zusagen).',
  domain: 'general-jarvis', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({ query: str('Wonach gesucht wird') }, ['query']),
  describeTarget: (i) => `Erinnerungen – "${String(i.query).slice(0, 60)}"`,
  describeEffects: () => ['Liest den Erinnerungsspeicher. Keine Änderung.'],
  async execute(ctx, input) {
    const hits = recall(ctx.db, String(input.query), 10)
    return {
      ok: true, summary: `${hits.length} Erinnerungen`,
      data: hits.map((m) => ({
        id: m.id, art: m.kind, thema: m.subject, inhalt: m.content,
        konfidenz: m.confidence, seit: m.created_at, herkunft: m.provenance,
        hinweis: m.kind === 'hypothesis' ? 'VERMUTUNG – keine bestätigte Tatsache' : undefined,
      })),
    }
  },
}

const listTasks: ToolSpec = {
  name: 'list_tasks',
  titleDe: 'Aufgaben auflisten',
  description: 'Listet Aufgaben, optional gefiltert nach Status oder Projekt.',
  domain: 'general-jarvis', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({
    status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'] },
    project_id: str('Projekt-ID (optional)'),
  }, []),
  describeTarget: () => 'Aufgabenliste',
  describeEffects: () => ['Liest Aufgaben. Keine Änderung.'],
  async execute(ctx, input) {
    const conds: string[] = []; const params: unknown[] = []
    if (input.status) { conds.push('status = ?'); params.push(input.status) }
    const pid = input.project_id ?? ctx.projectId
    if (pid) { conds.push('project_id = ?'); params.push(pid) }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const rows = ctx.db.prepare(
      `SELECT id, title, status, priority, due_at, project_id FROM tasks ${where} ORDER BY due_at IS NULL, due_at ASC LIMIT 100`,
    ).all(...params)
    return { ok: true, summary: `${rows.length} Aufgaben`, data: rows }
  },
}

/* ── Sibling systems (read-only by contract) ─────────────────────────────── */

const querySocial: ToolSpec = {
  name: 'query_social_autopilot',
  titleDe: 'Social Autopilot abfragen',
  description:
    'Ruft eine schreibgeschützte Zusammenfassung aus dem Fahrschule-Krebs-Social-Media-Autopilot ab. ' +
    'Nur Lesen: Veröffentlichen oder Planen ist über JARVIS nicht möglich.',
  domain: 'social-autopilot', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({
    endpoint: {
      type: 'string', enum: ['/api/status', '/api/summary', '/api/posts/recent', '/api/schedule/upcoming'],
      description: 'Freigegebener Lesepfad',
    },
  }, ['endpoint']),
  describeTarget: (i) => `Social Autopilot ${String(i.endpoint)}`,
  describeEffects: () => ['Liest aus dem Schwestersystem (nur GET).'],
  requiresIntegration: 'social_autopilot',
  integrationReady: () => !!config.adapters.social.url,
  async execute(_ctx, input) {
    const r = await querySibling('social-autopilot', String(input.endpoint))
    return {
      ok: r.ok,
      summary: r.ok ? `Social Autopilot: Daten von ${r.fetched_at}` : (r.error ?? 'nicht verfügbar'),
      data: { context: siblingToContext(r), raw: r.data, konfiguriert: r.configured, abgerufen: r.fetched_at },
      ...(r.ok ? {} : { error: r.error ?? 'nicht verfügbar' }),
    }
  },
}

const queryFinance: ToolSpec = {
  name: 'query_finance_crypto',
  titleDe: 'Finance & Crypto abfragen',
  description:
    'Ruft eine schreibgeschützte Zusammenfassung aus dem Finance-&-Crypto-Intelligence-System ab. ' +
    'Nur Lesen: Es können über JARVIS keine Transaktionen ausgelöst werden.',
  domain: 'finance-crypto', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({
    endpoint: {
      type: 'string', enum: ['/api/status', '/api/summary', '/api/portfolio/overview', '/api/alerts/active'],
      description: 'Freigegebener Lesepfad',
    },
  }, ['endpoint']),
  describeTarget: (i) => `Finance & Crypto ${String(i.endpoint)}`,
  describeEffects: () => ['Liest aus dem Schwestersystem (nur GET).'],
  requiresIntegration: 'finance_crypto',
  integrationReady: () => !!config.adapters.finance.url,
  async execute(_ctx, input) {
    const r = await querySibling('finance-crypto', String(input.endpoint))
    return {
      ok: r.ok,
      summary: r.ok ? `Finance & Crypto: Daten von ${r.fetched_at}` : (r.error ?? 'nicht verfügbar'),
      data: { context: siblingToContext(r), raw: r.data, konfiguriert: r.configured, abgerufen: r.fetched_at },
      ...(r.ok ? {} : { error: r.error ?? 'nicht verfügbar' }),
    }
  },
}

/* ────────────────────────────────────────────────────────────────────────────
 * reversible_write
 * ──────────────────────────────────────────────────────────────────────────── */

const rememberTool: ToolSpec = {
  name: 'remember',
  titleDe: 'Etwas dauerhaft merken',
  description:
    'Schlägt eine dauerhafte Erinnerung vor. Wird dem Besitzer zur Bestätigung angezeigt, ' +
    'bevor sie gespeichert wird. Nutze "hypothesis" für Vermutungen – niemals "fact".',
  domain: 'general-jarvis', risk: 'reversible_write', reversible: true,
  rollbackHint: 'Erinnerung kann jederzeit gelöscht oder korrigiert werden.',
  inputSchema: obj({
    kind: { type: 'string', enum: ['preference', 'fact', 'decision', 'commitment', 'hypothesis'] },
    subject: str('Kurzes Thema, z. B. "Bevorzugte Anrede"'),
    content: str('Der zu merkende Inhalt'),
    sensitivity: { type: 'string', enum: ['public', 'internal', 'private', 'secret'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: str('Warum das gemerkt werden soll'),
  }, ['kind', 'subject', 'content', 'sensitivity', 'rationale']),
  describeTarget: (i) => `Erinnerung "${String(i.subject)}"`,
  describeEffects: (i) => [
    `Speichert eine ${String(i.kind)}-Erinnerung`,
    `Vertraulichkeit: ${String(i.sensitivity)}`,
    'Jederzeit einsehbar, korrigierbar und löschbar',
  ],
  async execute(ctx, input) {
    const { proposal, committed } = proposeMemory(ctx.db, 'create', {
      kind: input.kind as never, subject: String(input.subject), content: String(input.content),
      sensitivity: input.sensitivity as never,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.85,
      provenance: `Gespräch ${ctx.conversationId ?? '—'}`,
      project_id: ctx.projectId,
    }, String(input.rationale), ctx.conversationId)
    return {
      ok: true,
      summary: committed ? 'Erinnerung gespeichert (Regel greift)' : 'Erinnerung wartet auf Bestätigung',
      data: { proposal_id: proposal.id, status: proposal.status, gespeichert: !!committed },
    }
  },
}

const createTask: ToolSpec = {
  name: 'create_task',
  titleDe: 'Aufgabe anlegen',
  description: 'Legt eine Aufgabe an, optional mit Fälligkeit und Projektzuordnung.',
  domain: 'general-jarvis', risk: 'reversible_write', reversible: true,
  rollbackHint: 'Aufgabe kann gelöscht werden.',
  inputSchema: obj({
    title: str('Aufgabentitel'),
    detail: str('Zusätzliche Beschreibung'),
    due_at: str('Fälligkeit als ISO-8601-Datum'),
    priority: { type: 'integer', minimum: 1, maximum: 5 },
    project_id: str('Projekt-ID'),
  }, ['title']),
  describeTarget: (i) => `Aufgabe "${String(i.title)}"`,
  describeEffects: (i) => [
    'Legt eine neue Aufgabe an',
    i.due_at ? `Fällig: ${String(i.due_at)}` : 'Ohne Fälligkeit',
  ],
  async execute(ctx, input) {
    const id = newId('task')
    ctx.db.prepare(
      `INSERT INTO tasks (id, project_id, title, detail, status, priority, due_at, created_at, completed_at)
       VALUES (?,?,?,?,'open',?,?,?,NULL)`,
    ).run(id, input.project_id ?? ctx.projectId ?? null, String(input.title),
      String(input.detail ?? ''), Number(input.priority) || 3,
      input.due_at ? String(input.due_at) : null, nowIso())
    audit(ctx.db, { actor: ctx.actor, action: 'task.create', subject: String(input.title), outcome: 'ok', detail: { id } })
    return { ok: true, summary: `Aufgabe angelegt: ${String(input.title)}`, data: { id } }
  },
}

const completeTask: ToolSpec = {
  name: 'complete_task',
  titleDe: 'Aufgabe abschließen',
  description: 'Markiert eine Aufgabe als erledigt.',
  domain: 'general-jarvis', risk: 'reversible_write', reversible: true,
  rollbackHint: 'Status kann zurückgesetzt werden.',
  inputSchema: obj({ task_id: str('Aufgaben-ID') }, ['task_id']),
  describeTarget: (i) => `Aufgabe ${String(i.task_id)}`,
  describeEffects: () => ['Setzt den Status auf "erledigt"'],
  async execute(ctx, input) {
    const r = ctx.db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`)
      .run(nowIso(), String(input.task_id))
    if (!r.changes) return { ok: false, summary: 'Aufgabe nicht gefunden', data: null, error: 'not_found' }
    return { ok: true, summary: 'Aufgabe abgeschlossen', data: { id: input.task_id } }
  },
}

const draftEmail: ToolSpec = {
  name: 'draft_email',
  titleDe: 'E-Mail entwerfen',
  description:
    'Erstellt einen E-Mail-Entwurf. Der Entwurf wird NICHT versendet – er wird nur gespeichert ' +
    'und angezeigt. Zum Versenden ist "send_email" nötig.',
  domain: 'general-jarvis', risk: 'reversible_write', reversible: true,
  rollbackHint: 'Entwurf kann verworfen werden.',
  inputSchema: obj({
    to: { type: 'array', items: { type: 'string' }, description: 'Empfängeradressen' },
    subject: str('Betreff'),
    body: str('Nachrichtentext'),
  }, ['to', 'subject', 'body']),
  describeTarget: (i) => `Entwurf an ${(i.to as string[] | undefined)?.join(', ') ?? '—'}`,
  describeEffects: () => ['Speichert einen Entwurf lokal', 'Versendet NICHTS'],
  async execute(ctx, input) {
    const id = newId('draft')
    ctx.db.prepare(
      `INSERT INTO settings (key, value, encrypted, updated_at) VALUES (?,?,0,?)`,
    ).run(`draft.email.${id}`, JSON.stringify(input), nowIso())
    audit(ctx.db, { actor: ctx.actor, action: 'email.draft', subject: String(input.subject), outcome: 'ok', detail: { id } })
    return { ok: true, summary: `Entwurf gespeichert: "${String(input.subject)}"`, data: { draft_id: id, versendet: false } }
  },
}

/* ────────────────────────────────────────────────────────────────────────────
 * external_comm / destructive — always confirmed
 * ──────────────────────────────────────────────────────────────────────────── */

const sendEmail: ToolSpec = {
  name: 'send_email',
  titleDe: 'E-Mail versenden',
  description:
    'Versendet eine E-Mail über den konfigurierten SMTP-Zugang. Erfordert immer eine ' +
    'ausdrückliche Bestätigung des Besitzers.',
  domain: 'general-jarvis', risk: 'external_comm', reversible: false,
  rollbackHint: null,
  inputSchema: obj({
    to: { type: 'array', items: { type: 'string' } },
    subject: str('Betreff'),
    body: str('Nachrichtentext'),
  }, ['to', 'subject', 'body']),
  describeTarget: (i) => `E-Mail an ${(i.to as string[] | undefined)?.join(', ') ?? '—'}`,
  describeEffects: (i) => [
    `Versendet eine E-Mail an ${(i.to as string[] | undefined)?.length ?? 0} Empfänger`,
    'Nicht widerrufbar, sobald zugestellt',
    `Betreff: ${String(i.subject)}`,
  ],
  requiresIntegration: 'smtp',
  integrationReady: () => false,   // no SMTP integration ships in this build
  async execute() {
    // Reached only if an SMTP integration is added later. Until then the safety
    // reviewer blocks on `integration_missing`, and we never claim success.
    return {
      ok: false, summary: 'Kein SMTP-Zugang konfiguriert – nichts versendet', data: null,
      error: 'Die SMTP-Integration ist in dieser Installation nicht eingerichtet. Es wurde keine E-Mail versendet.',
    }
  },
}

const forgetMemoryTool: ToolSpec = {
  name: 'forget_memory',
  titleDe: 'Erinnerung löschen',
  description: 'Löscht eine dauerhafte Erinnerung. Erfordert immer eine Bestätigung.',
  domain: 'general-jarvis', risk: 'destructive', reversible: true,
  rollbackHint: '30 Tage lang über die Datenschutz-Ansicht wiederherstellbar.',
  inputSchema: obj({ memory_id: str('ID der Erinnerung'), reason: str('Begründung') }, ['memory_id']),
  describeTarget: (i) => `Erinnerung ${String(i.memory_id)}`,
  describeEffects: () => ['Markiert die Erinnerung als gelöscht', 'Endgültige Entfernung nach 30 Tagen'],
  async execute(ctx, input) {
    const ok = forgetMemory(ctx.db, String(input.memory_id), ctx.actor, String(input.reason ?? ''))
    return ok
      ? { ok: true, summary: 'Erinnerung gelöscht', data: { id: input.memory_id } }
      : { ok: false, summary: 'Erinnerung nicht gefunden', data: null, error: 'not_found' }
  },
}

const runScript: ToolSpec = {
  name: 'run_local_script',
  titleDe: 'Lokales Skript ausführen',
  description:
    'Führt ein vom Besitzer freigegebenes lokales Skript aus. Es können ausschließlich Skripte ' +
    'gestartet werden, die zuvor in der Allowlist eingetragen wurden. Freie Befehle sind nicht möglich.',
  domain: 'general-jarvis', risk: 'destructive', reversible: false, rollbackHint: null,
  inputSchema: obj({
    script: str('Name des freigegebenen Skripts (ohne Pfad)'),
    args: { type: 'array', items: { type: 'string' }, description: 'Argumente' },
  }, ['script']),
  describeTarget: (i) => `Skript "${String(i.script)}"`,
  describeEffects: (i) => [
    `Startet ${String(i.script)} mit ${((i.args as string[]) ?? []).length} Argumenten`,
    'Wirkung hängt vom Skript ab – vor Freigabe prüfen',
  ],
  requiresIntegration: 'script_allowlist',
  integrationReady: () => existsSync(join(config.dataDir, 'scripts')),
  async execute(ctx, input) {
    const allowRow = ctx.db.prepare(`SELECT value FROM settings WHERE key = 'tools.scripts.allowlist'`)
      .get() as { value: string } | undefined
    const allow: string[] = allowRow ? JSON.parse(allowRow.value) : []
    const name = String(input.script)
    if (!allow.includes(name)) {
      return {
        ok: false, summary: 'Skript nicht freigegeben', data: null,
        error: `"${name}" steht nicht auf der Allowlist. Freigegeben sind: ${allow.join(', ') || '(keine)'}`,
      }
    }
    // Resolve inside the scripts dir only — no traversal, no shell, no globbing.
    const scriptsDir = resolve(join(config.dataDir, 'scripts'))
    const target = resolve(join(scriptsDir, name))
    if (target !== scriptsDir && !target.startsWith(scriptsDir + sep)) {
      return { ok: false, summary: 'Ungültiger Skriptpfad', data: null, error: 'Pfad außerhalb des Skriptordners' }
    }
    if (!existsSync(target)) return { ok: false, summary: 'Skript fehlt', data: null, error: `Nicht gefunden: ${name}` }

    try {
      const { stdout, stderr } = await execFileAsync(target, (input.args as string[]) ?? [], {
        timeout: 60_000, maxBuffer: 1024 * 1024, cwd: scriptsDir, shell: false,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },  // no secrets inherited
      })
      audit(ctx.db, { actor: ctx.actor, action: 'script.run', subject: name, outcome: 'ok' })
      return { ok: true, summary: `Skript ${name} ausgeführt`, data: { stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) } }
    } catch (e) {
      audit(ctx.db, { actor: ctx.actor, action: 'script.run', subject: name, outcome: 'error', detail: { error: errText(e) } })
      return { ok: false, summary: `Skript ${name} fehlgeschlagen`, data: null, error: errText(e) }
    }
  },
}

const readFileTool: ToolSpec = {
  name: 'read_file',
  titleDe: 'Datei lesen',
  description: 'Liest eine Datei aus den freigegebenen Quellordnern (auch wenn sie noch nicht indexiert ist).',
  domain: 'general-jarvis', risk: 'read_only', reversible: true, rollbackHint: null,
  inputSchema: obj({ path: str('Absoluter Pfad innerhalb der Quellordner') }, ['path']),
  describeTarget: (i) => `Datei ${String(i.path)}`,
  describeEffects: () => ['Liest eine Datei. Keine Änderung.'],
  async execute(_ctx, input) {
    try {
      const abs = assertInsideRoots(String(input.path))
      const text = await readFile(abs, 'utf8')
      return { ok: true, summary: `Gelesen: ${abs}`, data: { pfad: abs, inhalt: text.slice(0, 20000) } }
    } catch (e) {
      return { ok: false, summary: 'Datei nicht lesbar', data: null, error: errText(e) }
    }
  },
}

/* ── Registry ────────────────────────────────────────────────────────────── */

const ALL: ToolSpec[] = [
  searchKnowledge, readSource, recallMemory, listTasks, readFileTool,
  querySocial, queryFinance,
  rememberTool, createTask, completeTask, draftEmail,
  sendEmail, forgetMemoryTool, runScript,
]

const BY_NAME = new Map(ALL.map((t) => [t.name, t]))

export function getTool(name: string): ToolSpec | undefined {
  return BY_NAME.get(name)
}

export function allTools(): ToolSpec[] {
  return ALL.filter((t) => t.enabled?.() !== false)
}

/** Tools offered to the model this turn. Web research is added by the caller. */
export function toolsForModel(opts: { allowWrites: boolean } = { allowWrites: true }) {
  return allTools()
    .filter((t) => opts.allowWrites || t.risk === 'read_only')
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

export function toolDescriptors(): ToolDescriptor[] {
  return allTools().map((t) => ({
    name: t.name, title_de: t.titleDe, description: t.description,
    domain: t.domain, risk: t.risk, reversible: t.reversible,
    rollback_hint: t.rollbackHint, input_schema: t.inputSchema,
    enabled: t.enabled?.() !== false,
    requires_integration: t.requiresIntegration ?? null,
  }))
}
