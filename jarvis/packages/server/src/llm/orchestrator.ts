import { randomBytes } from 'node:crypto'
import type { DB } from '../db/index.js'
import type { ChatEvent, ChatRequest, RetrievalResult, AnswerMode } from '@jarvis/shared'
import { API_ERROR_DE } from '@jarvis/shared'
import { config } from '../config.js'
import { newId } from '../util/id.js'
import { nowIso } from '../util/time.js'
import { sha256 } from '../core/crypto.js'
import { log, errText } from '../core/logger.js'
import { audit } from '../core/audit.js'
import { retrieve, citationsToContext } from '../knowledge/retrieval.js'
import { recall, memoriesToContext } from '../memory/service.js'
import { wrapUntrusted, scanForInjection } from '../security/injection.js'
import { llm, llmConfigured, webTools } from './client.js'
import { buildSystemPrompt } from './prompts.js'
import { classifyIntent } from './intent.js'
import { toolsForModel, getTool } from '../tools/registry.js'
import { proposeAction, loadAction } from '../tools/actions.js'
import { recordInteraction } from '../eval/outcomes.js'

/**
 * Conversation Orchestrator.
 *
 * One turn = classify → retrieve → recall → prompt → stream → tool loop →
 * persist. Every stage emits a `ChatEvent` so the UI can show what is happening
 * instead of a spinner, and every stage degrades independently: no model key
 * still gives sourced passages, a failed retrieval still gives an answer marked
 * as unsourced.
 */

export type Emit = (e: ChatEvent) => void

const MAX_TOOL_ROUNDS = 6

const EFFORT: Record<AnswerMode, 'low' | 'medium' | 'high' | 'xhigh'> = {
  concise: 'low', standard: 'high', deep: 'xhigh',
}
const MAX_TOKENS: Record<AnswerMode, number> = {
  concise: 4_000, standard: 16_000, deep: 32_000,
}

export interface TurnContext {
  db: DB
  actor: string
  req: ChatRequest
  emit: Emit
  signal?: AbortSignal
}

export async function runTurn(ctx: TurnContext): Promise<{ messageId: string }> {
  const { db, req, emit } = ctx
  const started = Date.now()
  const conversationId = ensureConversation(db, req)
  const userMessageId = persistUserMessage(db, conversationId, req)
  const assistantMessageId = newId('msg')

  emit({ type: 'start', conversation_id: conversationId, message_id: assistantMessageId, model: config.llm.model })

  /* 1 ─ Intent */
  const intent = classifyIntent(req.message)
  emit({ type: 'status', stage: 'intent', detail: `${intent.intent}: ${intent.reason}` })

  /* 2 ─ Private retrieval */
  let retrieval: RetrievalResult | null = null
  if (intent.retrieve) {
    emit({ type: 'status', stage: 'retrieval', detail: 'Durchsuche private Quellen …' })
    try {
      retrieval = await retrieve(db, req.message, { limit: req.mode === 'deep' ? 12 : 7, projectId: req.project_id ?? null })
      emit({ type: 'citations', retrieval })
    } catch (e) {
      log.warn('Retrieval fehlgeschlagen', { error: errText(e) })
      emit({ type: 'status', stage: 'retrieval', detail: `Quellensuche fehlgeschlagen: ${errText(e)}` })
    }
  }

  /* 3 ─ Memory recall */
  const memories = recall(db, req.message, 6)
  if (memories.length) emit({ type: 'status', stage: 'memory', detail: `${memories.length} Erinnerungen berücksichtigt` })

  /* 4 ─ Injection posture for this turn */
  const untrusted = [
    retrieval ? citationsToContext(retrieval.citations) : '',
    memoriesToContext(memories),
  ].filter(Boolean).join('\n\n')
  const scan = scanForInjection(untrusted)
  if (scan.findings.length) {
    emit({
      type: 'status', stage: 'security',
      detail: `Hinweis: abgerufener Inhalt enthält verdächtige Muster (${scan.findings.map((f) => f.code).join(', ')}). ` +
              'Er wird als Daten behandelt, nicht als Anweisung.',
    })
    audit(db, {
      actor: ctx.actor, action: 'security.injection_detected', outcome: 'ok',
      subject: conversationId, detail: { score: scan.score, codes: scan.findings.map((f) => f.code) },
    })
  }

  /* 5 ─ Degraded path: no model key */
  if (!llmConfigured() || config.offline && !llmConfigured()) {
    return degradedAnswer(ctx, { conversationId, assistantMessageId, retrieval, started })
  }

  /* 6 ─ Build the request */
  const nonce = randomBytes(6).toString('hex')
  const { text: systemText, version: promptVersion } = buildSystemPrompt(db, req.mode)

  const contextBlocks: string[] = []
  if (retrieval?.citations.length) {
    contextBlocks.push(
      `ABGERUFENE PRIVATE PASSAGEN (Abdeckung: ${retrieval.coverage}, ` +
      `semantische Suche: ${retrieval.semantic_enabled ? 'aktiv' : 'inaktiv'}):\n` +
      wrapUntrusted(citationsToContext(retrieval.citations), 'quellen', nonce),
    )
    if (retrieval.conflicts.length) {
      contextBlocks.push(
        'ERKANNTE WIDERSPRÜCHE (dem Besitzer nennen, nicht auflösen):\n' +
        retrieval.conflicts.map((c) => `- ${c.reason}: ${c.topic} → ${c.a} vs. ${c.b}`).join('\n'),
      )
    }
  } else if (intent.retrieve) {
    contextBlocks.push('ABGERUFENE PRIVATE PASSAGEN: keine Treffer. Die Unterlagen decken diese Frage nicht ab.')
  }
  if (memories.length) {
    contextBlocks.push('DAUERHAFTE ERINNERUNGEN:\n' + wrapUntrusted(memoriesToContext(memories), 'memory', nonce))
  }
  contextBlocks.push(`AKTUELLE ZEIT: ${nowIso()}`)

  const history = loadHistory(db, conversationId, userMessageId)
  const messages: Array<Record<string, unknown>> = [
    ...history,
    {
      role: 'user',
      content: [{ type: 'text', text: [...contextBlocks, `\nFRAGE DES BESITZERS:\n${req.message}`].join('\n\n') }],
    },
  ]

  const allowWeb = req.allow_web && intent.allowWeb && !config.offline
  const tools: Array<Record<string, unknown>> = [
    ...toolsForModel({ allowWrites: true }),
    ...(allowWeb ? webTools() : []),
  ]

  const client = llm()!
  let finalText = ''
  let stopReason: string | null = null
  const usage = { input: 0, output: 0, cacheRead: 0 }
  const usedTools: string[] = []

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      ctx.signal?.throwIfAborted()

      const stream = client.messages.stream({
        model: config.llm.model,
        max_tokens: MAX_TOKENS[req.mode],
        // The system prompt is the stable prefix; cache_control here is what
        // makes repeated turns cheap. Volatile content lives in `messages`.
        system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: EFFORT[req.mode] },
        tools: tools as never,
        messages: messages as never,
      } as never, { signal: ctx.signal })

      stream.on('text', (delta: string) => {
        finalText += delta
        emit({ type: 'text', text: delta })
      })

      const message = await stream.finalMessage()
      stopReason = message.stop_reason ?? null
      usage.input += message.usage?.input_tokens ?? 0
      usage.output += message.usage?.output_tokens ?? 0
      usage.cacheRead += message.usage?.cache_read_input_tokens ?? 0

      // A server-side tool (web search) paused the turn — resend to continue.
      if (stopReason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content })
        continue
      }
      if (stopReason === 'refusal') {
        emit({
          type: 'error', code: 'refusal', recoverable: true,
          message_de: 'Die Anfrage wurde von den Sicherheitsfiltern abgelehnt. Bitte formuliere sie anders.',
        })
        break
      }
      if (stopReason !== 'tool_use') break

      const toolUses = (message.content as unknown as Array<Record<string, unknown>>)
        .filter((b) => b.type === 'tool_use')
      if (!toolUses.length) break

      messages.push({ role: 'assistant', content: message.content })

      const results: Array<Record<string, unknown>> = []
      for (const use of toolUses) {
        ctx.signal?.throwIfAborted()
        const name = String(use.name)
        const input = (use.input ?? {}) as Record<string, unknown>
        usedTools.push(name)

        const spec = getTool(name)
        if (!spec) {
          results.push({
            type: 'tool_result', tool_use_id: use.id, is_error: true,
            content: `Unbekanntes Werkzeug "${name}". Es wurde nichts ausgeführt.`,
          })
          continue
        }

        emit({ type: 'tool_call', tool: name, risk: spec.risk, summary: spec.describeTarget(input) })

        const { preview, executed } = await proposeAction(
          db, name, input,
          { db, actor: ctx.actor, conversationId, projectId: req.project_id ?? null },
          untrusted,
        )

        if (preview.status === 'rejected') {
          emit({ type: 'tool_result', tool: name, ok: false, summary: `Blockiert: ${preview.error ?? ''}` })
          results.push({
            type: 'tool_result', tool_use_id: use.id, is_error: true,
            content: `Die Sicherheitsprüfung hat diese Aktion blockiert: ${preview.error}. ` +
                     'Sie wurde NICHT ausgeführt. Erkläre dem Besitzer, warum.',
          })
          continue
        }
        if (preview.status === 'pending') {
          emit({ type: 'action_preview', action: preview })
          emit({ type: 'tool_result', tool: name, ok: false, summary: 'Wartet auf Bestätigung' })
          results.push({
            type: 'tool_result', tool_use_id: use.id,
            content: `Diese Aktion erfordert die ausdrückliche Bestätigung des Besitzers und wurde ` +
                     `NICHT ausgeführt. Eine Bestätigungskarte (ID ${preview.id}) wird angezeigt. ` +
                     'Beschreibe kurz, was passieren wird, und behaupte NICHT, es sei erledigt.',
          })
          continue
        }

        const ok = executed?.ok ?? false
        emit({ type: 'tool_result', tool: name, ok, summary: executed?.summary ?? 'kein Ergebnis' })
        results.push({
          type: 'tool_result', tool_use_id: use.id, is_error: !ok,
          content: JSON.stringify(ok ? executed?.data ?? {} : { fehler: executed?.error ?? 'unbekannt', ausgefuehrt: false })
            .slice(0, 60_000),
        })
      }

      messages.push({ role: 'user', content: results })
    }
  } catch (e) {
    if (ctx.signal?.aborted) {
      emit({ type: 'error', code: 'aborted', message_de: 'Abgebrochen.', recoverable: true })
    } else {
      const msg = errText(e)
      log.error('Modellaufruf fehlgeschlagen', { error: msg })
      emit({
        type: 'error', code: 'llm_unreachable', recoverable: true,
        message_de: `${API_ERROR_DE.llm_unreachable} (${msg})`,
      })
    }
  }

  emit({ type: 'usage', input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cacheRead })

  persistAssistantMessage(db, {
    id: assistantMessageId, conversationId, text: finalText, retrieval,
    mode: req.mode, usage, latency: Date.now() - started,
  })
  recordInteraction(db, {
    conversation_id: conversationId, message_id: assistantMessageId, mode: req.mode,
    model: config.llm.model, prompt_version: promptVersion, question: req.message,
    citations_count: retrieval?.citations.length ?? 0,
    grounded: groundedness(finalText, retrieval),
    used_web: usedTools.some((t) => t.startsWith('web_')) || Boolean(allowWeb && /https?:\/\//.test(finalText)),
    used_tools: usedTools, latency_ms: Date.now() - started,
    flags: buildFlags(finalText, retrieval, usedTools),
  })

  emit({ type: 'done', message_id: assistantMessageId, stop_reason: stopReason })
  return { messageId: assistantMessageId }
}

/* ── Degraded path ───────────────────────────────────────────────────────── */

/**
 * With no model key we still do real work: sources are retrieved and shown.
 * What we do not do is generate prose that looks like an answer.
 */
function degradedAnswer(
  ctx: TurnContext,
  s: { conversationId: string; assistantMessageId: string; retrieval: RetrievalResult | null; started: number },
): { messageId: string } {
  const { emit, db } = ctx
  const lines: string[] = [API_ERROR_DE.no_llm_key, '']

  // Only the summary goes here. The passages, freshness flags and conflicts are
  // rendered as source cards below the message — repeating them inline would
  // print everything twice.
  if (s.retrieval?.citations.length) {
    const n = s.retrieval.citations.length
    lines.push(
      `Ich habe ${n} passende Stelle${n === 1 ? '' : 'n'} in deinen Unterlagen gefunden ` +
      `(Abdeckung: ${s.retrieval.coverage}). Die Belege stehen unten — öffne „Quellen anzeigen“ für den Wortlaut.`,
    )
    const superseded = s.retrieval.citations.filter((c) => c.superseded_by).length
    if (superseded) {
      lines.push('', `Achtung: ${superseded} davon ${superseded === 1 ? 'ist' : 'sind'} durch eine neuere Fassung ersetzt.`)
    }
  } else {
    lines.push('In deinen Unterlagen habe ich dazu nichts gefunden.')
  }

  const text = lines.join('\n')
  emit({ type: 'text', text })
  persistAssistantMessage(db, {
    id: s.assistantMessageId, conversationId: s.conversationId, text,
    retrieval: s.retrieval, mode: ctx.req.mode,
    usage: { input: 0, output: 0, cacheRead: 0 }, latency: Date.now() - s.started,
  })
  emit({ type: 'done', message_id: s.assistantMessageId, stop_reason: 'degraded_no_llm' })
  return { messageId: s.assistantMessageId }
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

function ensureConversation(db: DB, req: ChatRequest): string {
  if (req.conversation_id) {
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.conversation_id)
    if (exists) {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), req.conversation_id)
      return req.conversation_id
    }
  }
  const id = newId('conv')
  const title = req.message.slice(0, 60).replace(/\s+/g, ' ').trim() || 'Neues Gespräch'
  db.prepare(
    `INSERT INTO conversations (id, title, project_id, parent_id, created_at, updated_at, archived)
     VALUES (?,?,?,NULL,?,?,0)`,
  ).run(id, title, req.project_id ?? null, nowIso(), nowIso())
  return id
}

function persistUserMessage(db: DB, conversationId: string, req: ChatRequest): string {
  const id = newId('msg')
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, text, citations, mode, model, created_at)
     VALUES (?,?,'user',?,?,'[]',?,NULL,?)`,
  ).run(id, conversationId, JSON.stringify([{ type: 'text', text: req.message }]), req.message, req.mode, nowIso())
  return id
}

function persistAssistantMessage(db: DB, a: {
  id: string; conversationId: string; text: string; retrieval: RetrievalResult | null
  mode: AnswerMode; usage: { input: number; output: number; cacheRead: number }; latency: number
}): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, text, citations, mode, model,
       input_tokens, output_tokens, cache_read_tokens, latency_ms, created_at)
     VALUES (?,?,'assistant',?,?,?,?,?,?,?,?,?,?)`,
  ).run(a.id, a.conversationId, JSON.stringify([{ type: 'text', text: a.text }]), a.text,
    JSON.stringify(a.retrieval?.citations ?? []), a.mode, config.llm.model,
    a.usage.input, a.usage.output, a.usage.cacheRead, a.latency, nowIso())
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), a.conversationId)
}

/** Prior turns, trimmed. The current user message is added by the caller. */
function loadHistory(db: DB, conversationId: string, excludeMessageId: string): Array<Record<string, unknown>> {
  const rows = db.prepare(
    `SELECT role, text FROM messages
      WHERE conversation_id = ? AND id != ? AND role IN ('user','assistant') AND text != ''
      ORDER BY created_at DESC LIMIT 12`,
  ).all(conversationId, excludeMessageId) as Array<{ role: string; text: string }>
  return rows.reverse().map((r) => ({ role: r.role, content: [{ type: 'text', text: r.text.slice(0, 8000) }] }))
}

/* ── Outcome signals ─────────────────────────────────────────────────────── */

/**
 * A weak, automatic groundedness signal: did an answer that had sources
 * available actually refer to them? Not a judge — a tripwire that feeds the
 * evaluation dashboard and flags turns worth a human look.
 */
function groundedness(text: string, retrieval: RetrievalResult | null): boolean | null {
  if (!retrieval || !retrieval.citations.length) return null
  const mentionsSource = retrieval.citations.some((c) => {
    const stem = c.source_title.replace(/\.[a-z0-9]+$/i, '').slice(0, 18)
    return stem.length > 4 && text.toLowerCase().includes(stem.toLowerCase())
  })
  return mentionsSource || /laut |gemäß |quelle|unterlagen|dokument/i.test(text)
}

function buildFlags(text: string, retrieval: RetrievalResult | null, tools: string[]): string[] {
  const flags: string[] = []
  if (retrieval && retrieval.coverage === 'insufficient' && text.length > 400 && !/nicht ab|keine (treffer|angaben)|finde ich nichts/i.test(text)) {
    flags.push('ungrounded_claim')
  }
  if (retrieval && retrieval.citations.length === 0 && tools.includes('search_private_knowledge')) {
    flags.push('retrieval_miss')
  }
  if (retrieval?.citations.some((c) => c.freshness === 'stale')) flags.push('stale_data')
  return flags
}
