import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEvent, AnswerMode, ActionPreview, MemoryProposal, RetrievalResult } from '@jarvis/shared'
import { api, streamChat, type ChatMessage } from '../api'
import { Badge, Btn, Card, Empty, Markdown, RiskBadge, Spinner, cx, inputCls, relTime } from '../components/ui'
import { createListener, speak, stopSpeaking, voiceCapabilities, type ListenState } from '../voice'

/**
 * The conversation view.
 *
 * Two commitments show up directly in this UI:
 *  - Nothing claims to be sourced unless a citation card backs it. Coverage is
 *    rendered honestly, including "die Unterlagen decken das nicht ab".
 *  - Consequential actions render as a confirmation card with the exact payload
 *    and are inert until the owner presses "Ausführen".
 */

interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: RetrievalResult['citations']
  retrieval?: RetrievalResult | null
  statuses?: string[]
  actions?: ActionPreview[]
  proposals?: MemoryProposal[]
  usage?: { input: number; output: number; cacheRead: number }
  streaming?: boolean
  error?: string
}

export const CONFLICT_DE: Record<RetrievalResult['conflicts'][number]['reason'], string> = {
  superseded_version: 'Ältere Fassung',
  contradictory_values: 'Widersprüchliche Werte',
  divergent_dates: 'Abweichende Daten',
}

const MODES: Array<{ id: AnswerMode; label: string; hint: string }> = [
  { id: 'concise', label: 'Knapp', hint: 'Kurze Antwort, wenige Sätze' },
  { id: 'standard', label: 'Normal', hint: 'Vollständig, ohne Füllmaterial' },
  { id: 'deep', label: 'Gründlich', hint: 'Mehr Quellen, Widersprüche, Risiken' },
]

export function ChatView({ notify }: { notify: (m: string, tone?: 'info' | 'bad' | 'good') => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<AnswerMode>('standard')
  const [allowWeb, setAllowWeb] = useState(true)
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [listenState, setListenState] = useState<ListenState>('idle')
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const caps = useMemo(() => voiceCapabilities(), [])

  const listener = useMemo(() => createListener({
    onPartial: setInput,
    onFinal: (t) => { setInput(t); textareaRef.current?.focus() },
    onState: (s, detail) => {
      setListenState(s)
      if (s === 'error' && detail) notify(detail, 'bad')
    },
  }), [notify])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || busy) return

    setInput('')
    stopSpeaking()
    const assistantId = `a_${Date.now()}`
    setTurns((t) => [
      ...t,
      { id: `u_${Date.now()}`, role: 'user', text: message },
      { id: assistantId, role: 'assistant', text: '', streaming: true, statuses: [], actions: [], proposals: [] },
    ])
    setBusy(true)

    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((all) => all.map((t) => (t.id === assistantId ? fn(t) : t)))

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let spoken = ''
    try {
      await streamChat(
        { message, mode, allow_web: allowWeb, language: 'auto', conversation_id: conversationId, project_id: null },
        (e: ChatEvent) => {
          switch (e.type) {
            case 'start': setConversationId(e.conversation_id); break
            case 'status': patch((t) => ({ ...t, statuses: [...(t.statuses ?? []), e.detail ?? e.stage] })); break
            case 'text': spoken += e.text; patch((t) => ({ ...t, text: t.text + e.text })); break
            case 'citations': patch((t) => ({ ...t, citations: e.retrieval.citations, retrieval: e.retrieval })); break
            case 'action_preview': patch((t) => ({ ...t, actions: [...(t.actions ?? []), e.action] })); break
            case 'memory_proposal': patch((t) => ({ ...t, proposals: [...(t.proposals ?? []), e.proposal] })); break
            case 'tool_call': patch((t) => ({ ...t, statuses: [...(t.statuses ?? []), `Werkzeug: ${e.tool} — ${e.summary}`] })); break
            case 'tool_result': patch((t) => ({ ...t, statuses: [...(t.statuses ?? []), `${e.ok ? '✓' : '✗'} ${e.tool}: ${e.summary}`] })); break
            case 'usage': patch((t) => ({ ...t, usage: { input: e.input_tokens, output: e.output_tokens, cacheRead: e.cache_read_input_tokens } })); break
            case 'error': patch((t) => ({ ...t, error: e.message_de })); notify(e.message_de, 'bad'); break
            case 'done':
              patch((t) => ({ ...t, streaming: false, id: e.message_id }))
              if (autoSpeak && spoken) speak(spoken)
              break
          }
        },
        ctrl.signal,
      )
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : 'Verbindung unterbrochen'
        patch((t) => ({ ...t, error: msg, streaming: false }))
        notify(msg, 'bad')
      } else {
        patch((t) => ({ ...t, streaming: false }))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [busy, mode, allowWeb, conversationId, autoSpeak, notify])

  const toggleMic = () => {
    if (!listener) { notify(caps.reason, 'bad'); return }
    if (listenState === 'listening' || listenState === 'starting') listener.stop()
    else listener.start()
  }

  const startNew = () => {
    stopSpeaking()
    setTurns([]); setConversationId(null); setInput('')
  }

  const loadConversation = async (id: string) => {
    try {
      const { messages } = await api.conversation(id)
      setTurns(messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m: ChatMessage) => ({
        id: m.id, role: m.role as 'user' | 'assistant', text: m.text, citations: m.citations,
      })))
      setConversationId(id)
      setShowHistory(false)
    } catch (e) { notify((e as Error).message, 'bad') }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/6 px-3 py-2">
        <div className="flex rounded-lg border border-white/8 bg-ink-900/60 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id} title={m.hint} onClick={() => setMode(m.id)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition',
                mode === m.id ? 'bg-accent text-white' : 'text-mist-400 hover:text-mist-200')}
            >{m.label}</button>
          ))}
        </div>
        <button
          onClick={() => setAllowWeb((v) => !v)}
          title={allowWeb ? 'Live-Recherche erlaubt' : 'Nur private Quellen'}
          className={cx('rounded-lg border px-2.5 py-1 text-xs font-medium transition',
            allowWeb ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-white/8 text-mist-400')}
        >{allowWeb ? 'Web an' : 'Web aus'}</button>
        {caps.synthesis && (
          <button
            onClick={() => { setAutoSpeak((v) => !v); stopSpeaking() }}
            className={cx('rounded-lg border px-2.5 py-1 text-xs font-medium transition',
              autoSpeak ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-white/8 text-mist-400')}
          >{autoSpeak ? 'Vorlesen an' : 'Vorlesen aus'}</button>
        )}
        <div className="ml-auto flex gap-1">
          <Btn size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>Verlauf</Btn>
          <Btn size="sm" variant="ghost" onClick={startNew}>Neu</Btn>
        </div>
      </div>

      {showHistory && <HistoryStrip onPick={loadConversation} notify={notify} />}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg pt-6">
            <Empty
              title="Womit fangen wir an?"
              hint="Frag etwas zu deinen Unterlagen — die Antwort kommt mit Quellenangabe. Beispiele: „Was kostet eine Fahrstunde?“, „Was habe ich zu Projekt X entschieden?“, „Was ist heute fällig?“"
            />
          </div>
        )}
        {turns.map((t) => <TurnBubble key={t.id} turn={t} notify={notify} canSpeak={caps.synthesis} />)}
      </div>

      <Composer
        input={input} setInput={setInput} onSend={() => void send(input)}
        busy={busy} onStop={() => abortRef.current?.abort()}
        listenState={listenState} onMic={toggleMic} micAvailable={!!listener}
        micHint={caps.reason} textareaRef={textareaRef}
      />
    </div>
  )
}

/* ── Turn ────────────────────────────────────────────────────────────────── */

function TurnBubble({ turn, notify, canSpeak }: {
  turn: Turn; notify: (m: string, t?: 'info' | 'bad' | 'good') => void; canSpeak: boolean
}) {
  const [showSources, setShowSources] = useState(false)
  const [showTrace, setShowTrace] = useState(false)

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="fade-up max-w-[85%] rounded-2xl rounded-br-sm bg-accent/85 px-3.5 py-2 text-sm text-white shadow">
          {turn.text}
        </div>
      </div>
    )
  }

  const cov = turn.retrieval?.coverage
  return (
    <div className="fade-up space-y-2">
      {turn.statuses && turn.statuses.length > 0 && (
        <button onClick={() => setShowTrace((v) => !v)} className="text-[11px] text-mist-400 hover:text-mist-200">
          {showTrace ? '▾' : '▸'} {turn.statuses.length} Arbeitsschritte
        </button>
      )}
      {showTrace && (
        <div className="space-y-0.5 rounded-lg border border-white/6 bg-ink-900/50 p-2 text-[11px] text-mist-400">
          {turn.statuses!.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      )}

      <Card className="px-3.5 py-3">
        {turn.text ? <Markdown text={turn.text} /> : turn.streaming ? (
          <div className="flex items-center gap-2 text-sm text-mist-400"><Spinner /> denkt nach …</div>
        ) : null}

        {turn.error && (
          <p className="mt-2 rounded-lg border border-rose-500/25 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
            {turn.error}
          </p>
        )}

        {(turn.citations?.length || cov) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/6 pt-2">
            <CoverageBadge coverage={cov} />
            {turn.citations && turn.citations.length > 0 && (
              <button onClick={() => setShowSources((v) => !v)} className="text-xs text-accent-soft hover:underline">
                {turn.citations.length} Quelle{turn.citations.length === 1 ? '' : 'n'} {showSources ? 'ausblenden' : 'anzeigen'}
              </button>
            )}
            {turn.retrieval && !turn.retrieval.semantic_enabled && (
              <Badge tone="warn">nur Volltextsuche</Badge>
            )}
            {turn.usage && (turn.usage.input > 0) && (
              <span className="ml-auto text-[10px] text-mist-400/70">
                {turn.usage.input} ein / {turn.usage.output} aus
                {turn.usage.cacheRead > 0 && ` · ${turn.usage.cacheRead} aus Cache`}
              </span>
            )}
            {canSpeak && turn.text && (
              <Btn size="sm" variant="ghost" onClick={() => speak(turn.text)}>Vorlesen</Btn>
            )}
          </div>
        )}

        {showSources && turn.citations && (
          <div className="mt-2 space-y-2">
            {turn.citations.map((c) => <SourceCard key={c.chunk_id} c={c} />)}
            {turn.retrieval?.conflicts.map((k, i) => (
              <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-950/25 px-2.5 py-1.5 text-xs text-amber-200">
                <strong>{CONFLICT_DE[k.reason]}:</strong> {k.topic} — {k.a} ↔ {k.b}
              </div>
            ))}
          </div>
        )}
      </Card>

      {turn.actions?.map((a) => <ActionCard key={a.id} action={a} notify={notify} />)}
      {turn.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} notify={notify} />)}
    </div>
  )
}

function CoverageBadge({ coverage }: { coverage?: RetrievalResult['coverage'] }) {
  if (!coverage) return null
  const map = {
    good: { tone: 'good' as const, text: 'Belegt' },
    partial: { tone: 'info' as const, text: 'Teilweise belegt' },
    insufficient: { tone: 'warn' as const, text: 'Unterlagen decken das kaum ab' },
    none: { tone: 'bad' as const, text: 'Kein Beleg in den Unterlagen' },
  }
  const m = map[coverage]
  return <Badge tone={m.tone}>{m.text}</Badge>
}

function SourceCard({ c }: { c: RetrievalResult['citations'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-white/8 bg-ink-900/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-mist-200">{c.source_title}</span>
        <span className="text-[11px] text-mist-400">{c.loc}</span>
        {c.superseded_by && <Badge tone="warn">ersetzt</Badge>}
        {c.freshness === 'stale' && <Badge tone="warn">veraltet</Badge>}
        <button onClick={() => setOpen((v) => !v)} className="ml-auto text-[11px] text-accent-soft hover:underline">
          {open ? 'weniger' : 'Textstelle'}
        </button>
      </div>
      {open && (
        <>
          <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent/40 pl-2 text-[11px] leading-relaxed text-mist-400">
            {c.passage}
          </p>
          <p className="mt-1.5 text-[10px] text-mist-400/60">
            {c.source_uri} · geändert {relTime(c.modified_at)} · Score {c.score.toFixed(4)}
          </p>
        </>
      )}
    </div>
  )
}

/* ── Confirmation cards ──────────────────────────────────────────────────── */

export function ActionCard({ action, notify, onDecided }: {
  action: ActionPreview
  notify: (m: string, t?: 'info' | 'bad' | 'good') => void
  onDecided?: () => void
}) {
  const [state, setState] = useState(action.status)
  const [busy, setBusy] = useState(false)

  const decide = async (approve: boolean) => {
    setBusy(true)
    try {
      const { action: updated, result } = await api.decideAction(action.id, approve)
      setState(updated.status)
      notify(
        !approve ? 'Aktion abgelehnt.'
          : result?.ok ? `Ausgeführt: ${result.summary}`
            : `Nicht ausgeführt: ${result?.summary ?? updated.error ?? 'unbekannter Fehler'}`,
        !approve ? 'info' : result?.ok ? 'good' : 'bad',
      )
      onDecided?.()
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  const blocked = state === 'rejected' && action.safety_review.verdict === 'block'
  const critical = action.safety_review.findings.filter((f) => f.severity === 'critical')

  return (
    <Card className={cx('border-l-2 px-3.5 py-3',
      blocked ? 'border-l-rose-500' : state === 'executed' ? 'border-l-emerald-500' : 'border-l-amber-400')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{action.title_de}</span>
        <RiskBadge risk={action.risk} />
        {action.reversible ? <Badge tone="good">umkehrbar</Badge> : <Badge tone="bad">nicht umkehrbar</Badge>}
      </div>

      <p className="mt-1 text-xs text-mist-400">Ziel: {action.target}</p>

      <ul className="mt-2 space-y-0.5 text-xs text-mist-200">
        {action.effects.map((e, i) => <li key={i} className="flex gap-1.5"><span className="text-accent-soft">→</span>{e}</li>)}
      </ul>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-mist-400 hover:text-mist-200">Exakte Nutzlast anzeigen</summary>
        <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-ink-950/70 p-2 text-[10px] leading-relaxed text-mist-400">
{JSON.stringify(action.payload, null, 2)}
        </pre>
      </details>

      {critical.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg border border-rose-500/25 bg-rose-950/30 p-2">
          {critical.map((f, i) => <p key={i} className="text-[11px] text-rose-200">⚠ {f.message}</p>)}
        </div>
      )}
      {action.safety_review.injection_score > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-300">
          Injektions-Score des Kontexts: {action.safety_review.injection_score}
        </p>
      )}
      {action.rollback && <p className="mt-1.5 text-[11px] text-mist-400">Rückgängig: {action.rollback}</p>}

      <div className="mt-3 flex items-center gap-2">
        {state === 'pending' ? (
          <>
            <Btn variant="primary" size="sm" disabled={busy} onClick={() => void decide(true)}>
              {busy && <Spinner />} Ausführen
            </Btn>
            <Btn variant="ghost" size="sm" disabled={busy} onClick={() => void decide(false)}>Ablehnen</Btn>
            <span className="ml-auto text-[10px] text-mist-400/70">läuft ab {relTime(action.expires_at)}</span>
          </>
        ) : (
          <Badge tone={state === 'executed' ? 'good' : state === 'failed' || blocked ? 'bad' : 'neutral'}>
            {{
              executed: 'ausgeführt', failed: 'fehlgeschlagen', rejected: blocked ? 'blockiert' : 'abgelehnt',
              expired: 'abgelaufen', approved: 'freigegeben', executing: 'Ausgang unbekannt', pending: 'offen',
            }[state]}
          </Badge>
        )}
      </div>
      {action.error && <p className="mt-1.5 text-[11px] text-rose-300">{action.error}</p>}
    </Card>
  )
}

export function ProposalCard({ proposal, notify, onDecided }: {
  proposal: MemoryProposal
  notify: (m: string, t?: 'info' | 'bad' | 'good') => void
  onDecided?: () => void
}) {
  const [content, setContent] = useState(proposal.draft.content)
  const [state, setState] = useState(proposal.status)
  const [busy, setBusy] = useState(false)

  const decide = async (approve: boolean) => {
    setBusy(true)
    try {
      await api.decideProposal(proposal.id, approve, approve && content !== proposal.draft.content ? { content } : undefined)
      setState(approve ? 'approved' : 'rejected')
      notify(approve ? 'Gemerkt.' : 'Verworfen.', approve ? 'good' : 'info')
      onDecided?.()
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  return (
    <Card className="border-l-2 border-l-indigo-400 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">Soll ich mir das merken?</span>
        <Badge tone={proposal.draft.kind === 'hypothesis' ? 'warn' : 'info'}>{proposal.draft.kind}</Badge>
        <Badge tone={['private', 'secret'].includes(proposal.draft.sensitivity) ? 'warn' : 'neutral'}>
          {proposal.draft.sensitivity}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-mist-400">{proposal.draft.subject}</p>
      {state === 'pending' ? (
        <textarea
          value={content} onChange={(e) => setContent(e.target.value)} rows={3}
          className={cx(inputCls, 'mt-2 resize-y font-normal')}
        />
      ) : (
        <p className="mt-2 text-sm text-mist-200">{content}</p>
      )}
      <p className="mt-1.5 text-[11px] text-mist-400/80">Begründung: {proposal.rationale}</p>
      <div className="mt-2.5 flex items-center gap-2">
        {state === 'pending' ? (
          <>
            <Btn variant="primary" size="sm" disabled={busy} onClick={() => void decide(true)}>Merken</Btn>
            <Btn variant="ghost" size="sm" disabled={busy} onClick={() => void decide(false)}>Verwerfen</Btn>
            <span className="text-[10px] text-mist-400/70">Text ist vor dem Speichern editierbar</span>
          </>
        ) : (
          <Badge tone={state === 'rejected' ? 'neutral' : 'good'}>
            {state === 'rejected' ? 'verworfen' : 'gespeichert'}
          </Badge>
        )}
      </div>
    </Card>
  )
}

/* ── Composer ────────────────────────────────────────────────────────────── */

function Composer(p: {
  input: string; setInput: (v: string) => void; onSend: () => void
  busy: boolean; onStop: () => void
  listenState: ListenState; onMic: () => void; micAvailable: boolean; micHint: string
  textareaRef: React.RefObject<HTMLTextAreaElement>
}) {
  const listening = p.listenState === 'listening' || p.listenState === 'starting'
  return (
    <div className="border-t border-white/6 bg-ink-900/80 px-3 pb-[calc(0.75rem+var(--safe-b))] pt-3 backdrop-blur">
      <div className="flex items-end gap-2">
        <textarea
          ref={p.textareaRef}
          value={p.input}
          onChange={(e) => p.setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line. On touch keyboards the
            // send button is the reliable path, which is why it is always shown.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault(); p.onSend()
            }
          }}
          rows={1}
          placeholder={listening ? 'Ich höre zu …' : 'Frag mich etwas …'}
          className={cx(inputCls, 'max-h-40 min-h-[2.6rem] flex-1 resize-none py-2.5')}
        />
        <button
          onClick={p.onMic}
          title={p.micAvailable ? 'Zum Sprechen gedrückt halten oder antippen' : p.micHint}
          disabled={!p.micAvailable}
          aria-pressed={listening}
          className={cx('grid h-[2.6rem] w-[2.6rem] shrink-0 place-items-center rounded-lg border transition',
            listening ? 'listening border-accent bg-accent text-white'
              : p.micAvailable ? 'border-white/8 bg-ink-700/70 text-mist-400 hover:text-mist-200'
                : 'border-white/5 bg-ink-800/50 text-mist-400/30')}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
        </button>
        {p.busy ? (
          <Btn variant="danger" onClick={p.onStop} className="h-[2.6rem]">Stopp</Btn>
        ) : (
          <Btn variant="primary" onClick={p.onSend} disabled={!p.input.trim()} className="h-[2.6rem]">Senden</Btn>
        )}
      </div>
      {!p.micAvailable && <p className="mt-1 text-[10px] text-mist-400/60">{p.micHint}</p>}
    </div>
  )
}

function HistoryStrip({ onPick, notify }: {
  onPick: (id: string) => void; notify: (m: string, t?: 'info' | 'bad' | 'good') => void
}) {
  const [items, setItems] = useState<Array<{ id: string; title: string; updated_at: string; messages: number }>>([])
  useEffect(() => {
    api.conversations().then((r) => setItems(r.conversations)).catch((e: Error) => notify(e.message, 'bad'))
  }, [notify])
  if (!items.length) return <div className="border-b border-white/6 px-3 py-2 text-xs text-mist-400">Noch keine Gespräche.</div>
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-white/6 px-3 py-2">
      {items.map((c) => (
        <button
          key={c.id} onClick={() => onPick(c.id)}
          className="shrink-0 rounded-lg border border-white/8 bg-ink-800/60 px-2.5 py-1.5 text-left hover:border-accent/40"
        >
          <span className="block max-w-44 truncate text-xs text-mist-200">{c.title}</span>
          <span className="text-[10px] text-mist-400">{c.messages} Nachrichten · {relTime(c.updated_at)}</span>
        </button>
      ))}
    </div>
  )
}
