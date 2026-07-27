import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ChatRequest, roleAllows, type ChatEvent, API_ERROR_DE } from '@jarvis/shared'

import { config, redactedConfig } from '../config.js'
import { getDb, makeBackup } from '../db/index.js'
import { log, errText } from '../core/logger.js'
import { audit, recentAudit, verifyAuditChain } from '../core/audit.js'
import { enqueue, queueStats, requestCancel } from '../core/queue.js'
import {
  login, logout, resolveSession, createUser, userCount, changePassword,
  beginTotpEnrolment, confirmTotpEnrolment, disableTotp, listSessions, revokeAllSessions,
  type AuthedUser,
} from '../auth/service.js'
import { runTurn } from '../llm/orchestrator.js'
import { retrieve } from '../knowledge/retrieval.js'
import { indexStats } from '../knowledge/indexer.js'
import {
  listMemories, getMemory, updateMemory, forgetMemory, restoreMemory, purgeMemory,
  pendingProposals, decideProposal, exportMemories, writeMemory,
} from '../memory/service.js'
import {
  listProjects, createProject, updateProject, getProject, addProjectNote, projectNotes,
  listTasks, createTask, updateTask, deleteTask, buildBriefing, briefingToText,
} from '../projects/service.js'
import { pendingActions, decideAction, recentActions, loadAction } from '../tools/actions.js'
import { toolDescriptors } from '../tools/registry.js'
import { systemStatus } from './status.js'
import {
  evalMetrics, recordCorrection, listCorrections, synthesiseProposals,
  listProposals, decideProposalStatus, addRegressionCase, listRegressionCases,
} from '../eval/outcomes.js'
import { runEval, listEvalRuns, getEvalRun } from '../eval/runner.js'
import { listPromptVersions, createPromptVersion, activatePromptVersion } from '../llm/prompts.js'

const here = dirname(fileURLToPath(import.meta.url))

const COOKIE = 'jarvis_session'

declare module 'fastify' {
  interface FastifyRequest { user?: AuthedUser }
}

export async function buildServer(): Promise<FastifyInstance> {
  const db = getDb()
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024, trustProxy: false })

  // Several endpoints are pure commands with no payload (logout, backup,
  // revoke-all). Fastify's default JSON parser rejects an empty body with a
  // 400, which made `POST /api/auth/logout` fail for any client that did not
  // send `{}`. Treat an empty body as an empty object.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : ''
    if (!raw) return done(null, {})
    try { done(null, JSON.parse(raw)) }
    catch { done(Object.assign(new Error('Ungültiges JSON'), { statusCode: 400 }), undefined) }
  })

  await app.register(cookie, { secret: undefined })
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.id ?? req.ip,
  })

  /* ── Security headers ──────────────────────────────────────────────────── */
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self)')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; " +
      "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    return payload
  })

  /* ── Auth + CSRF ───────────────────────────────────────────────────────── */
  app.addHook('preHandler', async (req, reply) => {
    const token = req.cookies?.[COOKIE]
    req.user = resolveSession(db, token) ?? undefined

    const isApi = req.url.startsWith('/api/')
    const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)

    // CSRF: a cross-site form post cannot set a custom header, and browsers
    // always send Origin on cross-origin state-changing requests. Same-origin
    // requests from our own SPA always carry the header.
    if (isApi && stateChanging) {
      const origin = req.headers.origin
      const marker = req.headers['x-jarvis-client']
      if (!marker) {
        return reply.code(403).send({ error: 'csrf', message_de: 'Anfrage ohne Client-Kennung abgelehnt.' })
      }
      if (origin) {
        const allowed = [`http://${config.host}:${config.port}`, `http://localhost:${config.port}`,
          `http://127.0.0.1:${config.port}`, 'http://localhost:5173', 'http://127.0.0.1:5173']
        if (!allowed.includes(origin)) {
          return reply.code(403).send({ error: 'csrf_origin', message_de: `Herkunft ${origin} ist nicht freigegeben.` })
        }
      }
    }
  })

  function requireAuth(req: FastifyRequest, reply: FastifyReply): AuthedUser | null {
    if (!req.user) { void reply.code(401).send({ error: 'unauthorized', message_de: API_ERROR_DE.unauthorized }); return null }
    return req.user
  }

  function requireCap(req: FastifyRequest, reply: FastifyReply, cap: string): AuthedUser | null {
    const u = requireAuth(req, reply)
    if (!u) return null
    if (!roleAllows(u.role, cap)) {
      audit(db, { actor: `user:${u.id}`, action: 'authz.deny', subject: cap, outcome: 'denied' })
      void reply.code(403).send({ error: 'forbidden', message_de: API_ERROR_DE.forbidden })
      return null
    }
    return u
  }

  const actorOf = (u: AuthedUser) => `user:${u.id}`

  /* ────────────────────────────────────────────────────────────────────────
   * Auth
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    return { user: { id: req.user.id, username: req.user.username, role: req.user.role, totp_enabled: req.user.totp_enabled } }
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z.object({
      username: z.string().min(1), password: z.string().min(1), totp: z.string().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })

    const r = login(db, body.data.username, body.data.password, body.data.totp, {
      ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''),
    })
    if (!r.ok) return reply.code(401).send({ error: 'invalid', needs_totp: r.needsTotp ?? false, message_de: r.error })

    reply.setCookie(COOKIE, r.token!, {
      httpOnly: true, sameSite: 'strict', path: '/',
      secure: req.protocol === 'https', maxAge: 30 * 24 * 3600,
    })
    return { user: r.user }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    logout(db, req.cookies?.[COOKIE])
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.post('/api/auth/password', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return
    const body = z.object({ current: z.string(), next: z.string().min(12) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message_de: 'Neues Passwort braucht mindestens 12 Zeichen.' })
    const ok = changePassword(db, u.id, body.data.current, body.data.next)
    return ok ? { ok: true } : reply.code(400).send({ error: 'wrong_password', message_de: 'Aktuelles Passwort ist falsch.' })
  })

  app.post('/api/auth/totp/begin', async (req, reply) => {
    const u = requireCap(req, reply, 'auth.totp'); if (!u) return
    try { return beginTotpEnrolment(db, u.id, u.username) }
    catch (e) { return reply.code(400).send({ error: 'no_master_key', message_de: errText(e) }) }
  })

  app.post('/api/auth/totp/confirm', async (req, reply) => {
    const u = requireCap(req, reply, 'auth.totp'); if (!u) return
    const body = z.object({ code: z.string() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    const ok = confirmTotpEnrolment(db, u.id, body.data.code)
    return ok ? { ok: true } : reply.code(400).send({ error: 'bad_code', message_de: 'Code stimmt nicht.' })
  })

  app.post('/api/auth/totp/disable', async (req, reply) => {
    const u = requireCap(req, reply, 'auth.totp'); if (!u) return
    const body = z.object({ password: z.string() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    const ok = disableTotp(db, u.id, body.data.password)
    return ok ? { ok: true } : reply.code(400).send({ error: 'wrong_password' })
  })

  app.get('/api/auth/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return
    return { sessions: listSessions(db, u.id) }
  })

  app.post('/api/auth/sessions/revoke-all', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return
    const n = revokeAllSessions(db, u.id, actorOf(u))
    reply.clearCookie(COOKIE, { path: '/' })
    return { revoked: n }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Chat (SSE)
   * ──────────────────────────────────────────────────────────────────────── */

  app.post('/api/chat', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = requireCap(req, reply, 'chat.write'); if (!u) return
    const parsed = ChatRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', detail: parsed.error.flatten() })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const controller = new AbortController()
    req.raw.on('close', () => controller.abort())

    const send = (e: ChatEvent) => {
      if (reply.raw.writableEnded) return
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)
    }
    // Keeps proxies and mobile radios from dropping an idle stream.
    const ping = setInterval(() => { if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n') }, 15_000)

    try {
      await runTurn({ db, actor: actorOf(u), req: parsed.data, emit: send, signal: controller.signal })
    } catch (e) {
      log.error('Chat-Turn fehlgeschlagen', { error: errText(e) })
      send({ type: 'error', code: 'internal', message_de: `Interner Fehler: ${errText(e)}`, recoverable: false })
    } finally {
      clearInterval(ping)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })

  app.get('/api/conversations', async (req, reply) => {
    if (!requireCap(req, reply, 'chat.read')) return
    return {
      conversations: db.prepare(
        `SELECT c.id, c.title, c.project_id, c.created_at, c.updated_at,
                (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS messages
           FROM conversations c WHERE archived = 0 ORDER BY updated_at DESC LIMIT 100`,
      ).all(),
    }
  })

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    if (!requireCap(req, reply, 'chat.read')) return
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
    if (!conv) return reply.code(404).send({ error: 'not_found' })
    const messages = (db.prepare(
      `SELECT id, role, text, citations, mode, model, input_tokens, output_tokens,
              cache_read_tokens, latency_ms, created_at
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    ).all(req.params.id) as Array<Record<string, unknown>>)
      .map((m) => ({ ...m, citations: JSON.parse(String(m.citations ?? '[]')) }))
    return { conversation: conv, messages }
  })

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'chat.write'); if (!u) return
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id)
    audit(db, { actor: actorOf(u), action: 'conversation.delete', subject: req.params.id, outcome: 'ok' })
    return { ok: true }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Knowledge
   * ──────────────────────────────────────────────────────────────────────── */

  app.post('/api/search', async (req, reply) => {
    if (!requireCap(req, reply, 'sources.read')) return
    const body = z.object({
      query: z.string().min(1), limit: z.number().int().min(1).max(25).optional(),
      project_id: z.string().nullable().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    return retrieve(db, body.data.query, { limit: body.data.limit ?? 10, projectId: body.data.project_id ?? null })
  })

  app.get('/api/sources', async (req, reply) => {
    if (!requireCap(req, reply, 'sources.read')) return
    const q = (req.query as { q?: string }).q
    const rows = q
      ? db.prepare(
        `SELECT id, title, uri, kind, modified_at, indexed_at, active, error, superseded_by, tags, bytes
           FROM sources WHERE title LIKE ? OR uri LIKE ? ORDER BY modified_at DESC LIMIT 500`,
      ).all(`%${q}%`, `%${q}%`)
      : db.prepare(
        `SELECT id, title, uri, kind, modified_at, indexed_at, active, error, superseded_by, tags, bytes
           FROM sources ORDER BY active DESC, modified_at DESC LIMIT 500`,
      ).all()
    return { sources: rows, stats: indexStats(db) }
  })

  app.get<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
    if (!requireCap(req, reply, 'sources.read')) return
    const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id)
    if (!src) return reply.code(404).send({ error: 'not_found' })
    const chunks = db.prepare('SELECT id, ord, loc, text FROM chunks WHERE source_id = ? ORDER BY ord')
      .all(req.params.id)
    const related = db.prepare(
      `SELECT r.kind, s.id, s.title FROM relations r JOIN sources s ON s.id = r.to_id
        WHERE r.from_id = ? LIMIT 25`,
    ).all(req.params.id)
    return { source: src, chunks, related }
  })

  app.post('/api/sources/reindex', async (req, reply) => {
    const u = requireCap(req, reply, 'sources.write'); if (!u) return
    const body = z.object({ force: z.boolean().optional() }).safeParse(req.body ?? {})
    const job = enqueue(db, 'index.scan', { force: body.success ? !!body.data.force : false },
      { idempotencyKey: `index.scan.${new Date().toISOString().slice(0, 16)}`, timeoutMs: 30 * 60_000 })
    audit(db, { actor: actorOf(u), action: 'index.request', outcome: 'ok', detail: { job: job.id } })
    return { job_id: job.id, status: job.status }
  })

  app.get('/api/graph', async (req, reply) => {
    if (!requireCap(req, reply, 'sources.read')) return
    const nodes = db.prepare(
      `SELECT s.id, s.title, s.kind, s.modified_at, s.superseded_by,
              (SELECT count(*) FROM chunks c WHERE c.source_id = s.id) AS chunks
         FROM sources s WHERE s.active = 1 LIMIT 400`,
    ).all()
    const edges = db.prepare(
      `SELECT from_id, to_id, kind, weight FROM relations
        WHERE from_id IN (SELECT id FROM sources WHERE active = 1)
          AND to_id IN (SELECT id FROM sources WHERE active = 1) LIMIT 2000`,
    ).all()
    return { nodes, edges }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Memory
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/memory', async (req, reply) => {
    if (!requireCap(req, reply, 'memory.read')) return
    const q = req.query as { q?: string; kind?: string; include_deleted?: string }
    return {
      memories: listMemories(db, {
        q: q.q, kind: q.kind as never, includeDeleted: q.include_deleted === 'true',
      }),
      proposals: pendingProposals(db),
    }
  })

  app.post('/api/memory', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.write'); if (!u) return
    const body = z.object({
      kind: z.enum(['preference', 'fact', 'decision', 'commitment', 'hypothesis']),
      subject: z.string().min(1), content: z.string().min(1),
      sensitivity: z.enum(['public', 'internal', 'private', 'secret']),
      confidence: z.number().min(0).max(1).optional(),
      project_id: z.string().nullable().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request', detail: body.error.flatten() })
    try {
      const m = writeMemory(db, {
        ...body.data, confidence: body.data.confidence ?? 1,
        provenance: 'Direkt vom Besitzer eingetragen',
      }, null, actorOf(u))
      return { memory: m }
    } catch (e) {
      return reply.code(400).send({ error: 'write_failed', message_de: errText(e) })
    }
  })

  app.patch<{ Params: { id: string } }>('/api/memory/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.write'); if (!u) return
    if (!getMemory(db, req.params.id)) return reply.code(404).send({ error: 'not_found' })
    try { return { memory: updateMemory(db, req.params.id, req.body as never, actorOf(u)) } }
    catch (e) { return reply.code(400).send({ error: 'update_failed', message_de: errText(e) }) }
  })

  app.delete<{ Params: { id: string } }>('/api/memory/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.write'); if (!u) return
    const hard = (req.query as { purge?: string }).purge === 'true'
    const ok = hard ? purgeMemory(db, req.params.id, actorOf(u)) : forgetMemory(db, req.params.id, actorOf(u), 'UI')
    return ok ? { ok: true, purged: hard } : reply.code(404).send({ error: 'not_found' })
  })

  app.post<{ Params: { id: string } }>('/api/memory/:id/restore', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.write'); if (!u) return
    return restoreMemory(db, req.params.id, actorOf(u)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.post<{ Params: { id: string } }>('/api/memory/proposals/:id/decide', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.write'); if (!u) return
    const body = z.object({ approve: z.boolean(), edited: z.record(z.unknown()).optional() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    try {
      const m = decideProposal(db, req.params.id, body.data.approve, actorOf(u), body.data.edited as never)
      return { memory: m }
    } catch (e) { return reply.code(400).send({ error: 'decide_failed', message_de: errText(e) }) }
  })

  app.get('/api/memory/export', async (req, reply) => {
    const u = requireCap(req, reply, 'memory.export'); if (!u) return
    reply.header('Content-Disposition', `attachment; filename="jarvis-erinnerungen-${Date.now()}.json"`)
    return { exported_at: new Date().toISOString(), memories: exportMemories(db, actorOf(u)) }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Projects, tasks, briefing
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/projects', async (req, reply) => {
    if (!requireCap(req, reply, 'projects.read')) return
    return { projects: listProjects(db, (req.query as { all?: string }).all === 'true') }
  })

  app.post('/api/projects', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    const body = z.object({
      name: z.string().min(1), category: z.string().optional(), objective: z.string().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    return { project: createProject(db, body.data, actorOf(u)) }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!requireCap(req, reply, 'projects.read')) return
    const p = getProject(db, req.params.id)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    return { project: p, notes: projectNotes(db, p.id), tasks: listTasks(db, { projectId: p.id }) }
  })

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    const p = updateProject(db, req.params.id, req.body as never, actorOf(u))
    return p ? { project: p } : reply.code(404).send({ error: 'not_found' })
  })

  app.post<{ Params: { id: string } }>('/api/projects/:id/notes', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    const body = z.object({
      kind: z.enum(['decision', 'open_question', 'risk', 'next_action']), body: z.string().min(1),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    return { id: addProjectNote(db, req.params.id, body.data.kind, body.data.body) }
  })

  app.get('/api/tasks', async (req, reply) => {
    if (!requireCap(req, reply, 'projects.read')) return
    const q = req.query as { status?: string; project_id?: string }
    return { tasks: listTasks(db, { status: q.status, projectId: q.project_id }) }
  })

  app.post('/api/tasks', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    const body = z.object({
      title: z.string().min(1), detail: z.string().optional(),
      project_id: z.string().nullable().optional(), due_at: z.string().nullable().optional(),
      priority: z.number().int().min(1).max(5).optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    return {
      task: createTask(db, {
        title: body.data.title, detail: body.data.detail,
        projectId: body.data.project_id ?? null, dueAt: body.data.due_at ?? null,
        priority: body.data.priority,
      }, actorOf(u)),
    }
  })

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    const t = updateTask(db, req.params.id, req.body as never, actorOf(u))
    return t ? { task: t } : reply.code(404).send({ error: 'not_found' })
  })

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const u = requireCap(req, reply, 'projects.write'); if (!u) return
    return deleteTask(db, req.params.id, actorOf(u)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.get('/api/briefing', async (req, reply) => {
    if (!requireCap(req, reply, 'projects.read')) return
    const b = buildBriefing(db)
    return { briefing: b, text: briefingToText(b) }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Actions & approvals
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/actions', async (req, reply) => {
    if (!requireCap(req, reply, 'actions.read')) return
    return { pending: pendingActions(db), recent: recentActions(db, 40) }
  })

  app.get<{ Params: { id: string } }>('/api/actions/:id', async (req, reply) => {
    if (!requireCap(req, reply, 'actions.read')) return
    const a = loadAction(db, req.params.id)
    return a ? { action: a } : reply.code(404).send({ error: 'not_found' })
  })

  app.post<{ Params: { id: string } }>('/api/actions/:id/decide', async (req, reply) => {
    const u = requireCap(req, reply, 'actions.decide'); if (!u) return
    const body = z.object({ approve: z.boolean() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    try {
      const out = await decideAction(db, req.params.id, body.data.approve, {
        db, actor: actorOf(u), conversationId: null, projectId: null,
      })
      return { action: out.preview, result: out.result }
    } catch (e) {
      return reply.code(400).send({ error: 'decide_failed', message_de: errText(e) })
    }
  })

  app.get('/api/tools', async (req, reply) => {
    if (!requireCap(req, reply, 'status.read')) return
    return { tools: toolDescriptors() }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * System
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/status', async (req, reply) => {
    if (!requireCap(req, reply, 'status.read')) return
    return { status: await systemStatus(db), config: redactedConfig() }
  })

  /** Unauthenticated liveness probe. Deliberately reveals nothing. */
  app.get('/api/health', async () => ({ ok: true, version: config.version }))

  app.get('/api/audit', async (req, reply) => {
    if (!requireCap(req, reply, 'audit.read')) return
    const q = req.query as { action?: string; limit?: string }
    return {
      entries: recentAudit(db, Math.min(500, Number(q.limit) || 100), q.action),
      chain: verifyAuditChain(db),
    }
  })

  app.get('/api/jobs', async (req, reply) => {
    if (!requireCap(req, reply, 'status.read')) return
    return {
      stats: queueStats(db),
      jobs: db.prepare(
        `SELECT id, kind, status, attempts, max_attempts, run_at, last_error, created_at, updated_at
           FROM jobs ORDER BY created_at DESC LIMIT 100`,
      ).all(),
    }
  })

  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) => {
    const u = requireCap(req, reply, 'jobs.write'); if (!u) return
    const ok = requestCancel(db, req.params.id)
    if (ok) audit(db, { actor: actorOf(u), action: 'job.cancel', subject: req.params.id, outcome: 'ok' })
    return { ok }
  })

  app.post('/api/backup', async (req, reply) => {
    const u = requireCap(req, reply, 'backup.write'); if (!u) return
    const b = makeBackup(db)
    audit(db, { actor: actorOf(u), action: 'backup.create', outcome: 'ok', detail: { bytes: b.bytes } })
    return { backup: b }
  })

  /* ────────────────────────────────────────────────────────────────────────
   * Learning loop
   * ──────────────────────────────────────────────────────────────────────── */

  app.get('/api/eval/metrics', async (req, reply) => {
    if (!requireCap(req, reply, 'eval.read')) return
    return {
      metrics: evalMetrics(db, Number((req.query as { days?: string }).days) || 30),
      runs: listEvalRuns(db, 10),
      corrections: listCorrections(db, 25),
    }
  })

  app.post('/api/eval/corrections', async (req, reply) => {
    const u = requireCap(req, reply, 'eval.write'); if (!u) return
    const body = z.object({
      message_id: z.string().nullable().optional(),
      category: z.enum(['knowledge_source', 'retrieval', 'reasoning_instruction', 'tool_use',
        'memory', 'integration', 'ui_wording', 'security_policy']),
      what_went_wrong: z.string().min(3),
      expected: z.string().optional(),
      severity: z.enum(['low', 'medium', 'high']).optional(),
      question: z.string().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request', detail: body.error.flatten() })
    const id = recordCorrection(db, {
      message_id: body.data.message_id ?? null, category: body.data.category,
      what_went_wrong: body.data.what_went_wrong, expected: body.data.expected,
      severity: body.data.severity,
    }, actorOf(u), body.data.question)
    return { id, proposals: synthesiseProposals(db, actorOf(u)) }
  })

  app.get('/api/eval/proposals', async (req, reply) => {
    if (!requireCap(req, reply, 'eval.read')) return
    return { proposals: listProposals(db) }
  })

  app.post<{ Params: { id: string } }>('/api/eval/proposals/:id/decide', async (req, reply) => {
    const u = requireCap(req, reply, 'eval.approve'); if (!u) return
    const body = z.object({
      status: z.enum(['approved', 'rejected', 'deployed', 'rolled_back']),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    decideProposalStatus(db, req.params.id, body.data.status, actorOf(u))
    return { ok: true }
  })

  app.get('/api/eval/regression', async (req, reply) => {
    if (!requireCap(req, reply, 'eval.read')) return
    return { cases: listRegressionCases(db) }
  })

  app.post('/api/eval/regression', async (req, reply) => {
    const u = requireCap(req, reply, 'eval.write'); if (!u) return
    const body = z.object({
      name: z.string().min(1), question: z.string().min(1),
      expectation: z.object({
        must_contain: z.array(z.string()).default([]),
        must_cite: z.array(z.string()).default([]),
        must_not_contain: z.array(z.string()).default([]),
        must_refuse: z.boolean().default(false),
      }),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request', detail: body.error.flatten() })
    return { id: addRegressionCase(db, body.data) }
  })

  app.post('/api/eval/run', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const u = requireCap(req, reply, 'eval.write'); if (!u) return
    const body = z.object({ tier: z.enum(['retrieval', 'full']).optional() }).safeParse(req.body ?? {})
    return { run: await runEval(db, { tier: body.success ? body.data.tier : undefined, actor: actorOf(u) }) }
  })

  app.get<{ Params: { id: string } }>('/api/eval/runs/:id', async (req, reply) => {
    if (!requireCap(req, reply, 'eval.read')) return
    const r = getEvalRun(db, req.params.id)
    return r ? { run: r } : reply.code(404).send({ error: 'not_found' })
  })

  app.get<{ Params: { key: string } }>('/api/prompts/:key', async (req, reply) => {
    if (!requireCap(req, reply, 'eval.read')) return
    return { versions: listPromptVersions(db, req.params.key) }
  })

  app.post<{ Params: { key: string } }>('/api/prompts/:key', async (req, reply) => {
    const u = requireCap(req, reply, 'eval.approve'); if (!u) return
    const body = z.object({ body: z.string().min(20), notes: z.string().optional() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    return { version: createPromptVersion(db, req.params.key, body.data.body, body.data.notes ?? '', actorOf(u)) }
  })

  app.post<{ Params: { key: string } }>('/api/prompts/:key/activate', async (req, reply) => {
    const u = requireCap(req, reply, 'eval.approve'); if (!u) return
    const body = z.object({ version: z.number().int().min(1) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'bad_request' })
    try {
      activatePromptVersion(db, req.params.key, body.data.version, actorOf(u))
      return { ok: true }
    } catch (e) { return reply.code(400).send({ error: 'activate_failed', message_de: errText(e) }) }
  })

  /* ── Static SPA ────────────────────────────────────────────────────────── */
  // `here` differs between `tsx src/main.ts` (…/server/src/http) and the built
  // bundle (…/server/dist), so probe both rather than hard-coding one depth.
  const webDist = [
    join(here, '..', '..', '..', 'web', 'dist'),   // running from src/http
    join(here, '..', '..', 'web', 'dist'),         // running from dist
    join(config.root, 'packages', 'web', 'dist'),  // explicit JARVIS_ROOT
  ].find((p) => existsSync(p))

  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' })
      return reply.sendFile('index.html')   // client-side routing
    })
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' })
      return reply.code(200).type('text/html').send(
        '<!doctype html><meta charset="utf-8"><title>JARVIS</title>' +
        '<body style="font-family:system-ui;padding:2rem;max-width:40rem">' +
        '<h1>JARVIS – Backend läuft</h1>' +
        '<p>Die Weboberfläche ist noch nicht gebaut. Führe <code>npm run build</code> aus, ' +
        'oder starte im Entwicklungsmodus <code>npm run dev</code> (Vite auf Port 5173).</p></body>',
      )
    })
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    log.error('Unbehandelter Fehler', { url: req.url, error: err.message })
    void reply.code(err.statusCode ?? 500).send({
      error: 'internal', message_de: 'Interner Fehler. Details stehen im Serverprotokoll.',
    })
  })

  /** First-run bootstrap: create the owner account from env, once. */
  if (userCount(db) === 0) {
    const pw = process.env.JARVIS_OWNER_PASSWORD
    const name = process.env.JARVIS_OWNER_USERNAME ?? 'michael'
    if (pw && pw.length >= 12) {
      createUser(db, name, pw, 'owner', 'bootstrap')
      log.info('Besitzerkonto angelegt', { username: name })
    } else {
      log.warn(
        'Kein Benutzerkonto vorhanden. Lege eines an mit: npm run jarvis -- user:create <name> <passwort>',
      )
    }
  }

  return app
}
