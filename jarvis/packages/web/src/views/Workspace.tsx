import { useState } from 'react'
import type { MemoryRecord, TaskItem } from '@jarvis/shared'
import { api } from '../api'
import { ActionCard, ProposalCard } from './Chat'
import { Badge, Btn, Card, Empty, Field, Spinner, cx, inputCls, relTime, useAsync } from '../components/ui'

type Notify = (m: string, t?: 'info' | 'bad' | 'good') => void

/* ── Memory & privacy dashboard ──────────────────────────────────────────── */

export function MemoryView({ notify }: { notify: Notify }) {
  const [q, setQ] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [adding, setAdding] = useState(false)
  const { data, loading, reload } = useAsync(() => api.memory(q || undefined, showDeleted), [q, showDeleted])

  const exportAll = async () => {
    try {
      const r = await api.exportMemory()
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `jarvis-erinnerungen-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      notify('Export heruntergeladen.', 'good')
    } catch (e) { notify((e as Error).message, 'bad') }
  }

  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Erinnerungen durchsuchen …"
          className={cx(inputCls, 'max-w-xs flex-1')} />
        <Btn size="sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Abbrechen' : 'Neu'}</Btn>
        <Btn size="sm" variant="ghost" onClick={() => setShowDeleted((v) => !v)}>
          {showDeleted ? 'Gelöschte ausblenden' : 'Gelöschte zeigen'}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => void exportAll()}>Exportieren</Btn>
      </div>

      {adding && <MemoryForm notify={notify} onDone={() => { setAdding(false); reload() }} />}

      {data && data.proposals.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mist-400">
            Offene Vorschläge ({data.proposals.length})
          </h3>
          {data.proposals.map((p) => <ProposalCard key={p.id} proposal={p} notify={notify} onDecided={reload} />)}
        </section>
      )}

      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && data.memories.length === 0 && (
        <Empty title="Noch nichts gemerkt"
          hint="JARVIS merkt sich nichts von allein. Sag „Merk dir …“ im Chat oder lege hier etwas an — du siehst den Wortlaut immer vor dem Speichern." />
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {data?.memories.map((m) => <MemoryCard key={m.id} m={m} notify={notify} reload={reload} />)}
      </div>
    </div>
  )
}

function MemoryCard({ m, notify, reload }: { m: MemoryRecord; notify: Notify; reload: () => void }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(m.content)

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); notify(msg, 'good'); reload() }
    catch (e) { notify((e as Error).message, 'bad') }
  }

  return (
    <Card className={cx('px-3 py-2.5', m.deleted_at && 'opacity-50')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-mist-200">{m.subject}</span>
        <Badge tone={m.kind === 'hypothesis' ? 'warn' : 'info'}>{m.kind}</Badge>
        <Badge tone={['private', 'secret'].includes(m.sensitivity) ? 'warn' : 'neutral'}>{m.sensitivity}</Badge>
        {m.deleted_at && <Badge tone="bad">gelöscht</Badge>}
      </div>

      {editing ? (
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} className={cx(inputCls, 'mt-2')} />
      ) : (
        <p className="mt-1.5 text-sm text-mist-200">{m.content}</p>
      )}

      <p className="mt-1.5 text-[10px] text-mist-400/70">
        Konfidenz {m.confidence.toFixed(2)} · Rev. {m.revision} · {relTime(m.updated_at)} · {m.provenance}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.deleted_at ? (
          <>
            <Btn size="sm" onClick={() => void act(() => api.restoreMemory(m.id), 'Wiederhergestellt.')}>Wiederherstellen</Btn>
            <Btn size="sm" variant="danger"
              onClick={() => confirm('Endgültig löschen? Das kann nicht rückgängig gemacht werden.') &&
                void act(() => api.forgetMemory(m.id, true), 'Endgültig gelöscht.')}>Endgültig löschen</Btn>
          </>
        ) : editing ? (
          <>
            <Btn size="sm" variant="primary"
              onClick={() => { setEditing(false); void act(() => api.updateMemory(m.id, { content }), 'Korrigiert.') }}>
              Speichern
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => { setEditing(false); setContent(m.content) }}>Abbrechen</Btn>
          </>
        ) : (
          <>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>Korrigieren</Btn>
            <Btn size="sm" variant="ghost"
              onClick={() => void act(() => api.forgetMemory(m.id), 'Vergessen (30 Tage wiederherstellbar).')}>
              Vergessen
            </Btn>
          </>
        )}
      </div>
    </Card>
  )
}

function MemoryForm({ notify, onDone }: { notify: Notify; onDone: () => void }) {
  const [f, setF] = useState({
    kind: 'preference', subject: '', content: '', sensitivity: 'internal', confidence: 1,
  })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!f.subject.trim() || !f.content.trim()) return
    setBusy(true)
    try { await api.createMemory(f as never); notify('Gespeichert.', 'good'); onDone() }
    catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  return (
    <Card className="space-y-2 px-3.5 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Thema"><input className={inputCls} value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="z. B. Bevorzugte Anrede" /></Field>
        <Field label="Art">
          <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="preference">Präferenz</option>
            <option value="fact">Tatsache</option>
            <option value="decision">Entscheidung</option>
            <option value="commitment">Zusage</option>
            <option value="hypothesis">Vermutung</option>
          </select>
        </Field>
      </div>
      <Field label="Inhalt">
        <textarea rows={3} className={inputCls} value={f.content}
          onChange={(e) => setF({ ...f, content: e.target.value })} />
      </Field>
      <Field label="Vertraulichkeit" hint="private und secret werden verschlüsselt gespeichert (braucht JARVIS_MASTER_KEY).">
        <select className={inputCls} value={f.sensitivity} onChange={(e) => setF({ ...f, sensitivity: e.target.value })}>
          <option value="public">öffentlich</option>
          <option value="internal">intern</option>
          <option value="private">privat</option>
          <option value="secret">geheim</option>
        </select>
      </Field>
      <Btn variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>{busy && <Spinner />} Speichern</Btn>
    </Card>
  )
}

/* ── Projects & tasks ────────────────────────────────────────────────────── */

export function ProjectsView({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<'briefing' | 'tasks' | 'projects'>('briefing')
  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex gap-1 rounded-lg border border-white/8 bg-ink-900/60 p-0.5">
        {([['briefing', 'Briefing'], ['tasks', 'Aufgaben'], ['projects', 'Projekte']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cx('flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
              tab === id ? 'bg-accent text-white' : 'text-mist-400 hover:text-mist-200')}>{label}</button>
        ))}
      </div>
      {tab === 'briefing' && <BriefingPanel notify={notify} />}
      {tab === 'tasks' && <TasksPanel notify={notify} />}
      {tab === 'projects' && <ProjectsPanel notify={notify} />}
    </div>
  )
}

function BriefingPanel({ notify }: { notify: Notify }) {
  const { data, loading, reload } = useAsync(() => api.briefing(), [])
  if (loading) return <Spinner className="h-5 w-5 text-mist-400" />
  if (!data) return <Empty title="Briefing nicht verfügbar" />
  const b = data.briefing

  return (
    <div className="space-y-3">
      <Card className="px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-base font-semibold text-white">{b.greeting_de}</h2>
          <Btn size="sm" variant="ghost" onClick={reload}>Aktualisieren</Btn>
        </div>
        <p className="mt-0.5 text-[11px] text-mist-400">Stand {relTime(b.generated_at)}</p>
      </Card>

      {b.blind_spot && (
        <Card className="border-l-2 border-l-amber-400 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Blinder Fleck</p>
          <p className="mt-1 text-sm text-mist-200">{b.blind_spot.risk}</p>
          <p className="mt-0.5 text-xs text-mist-400">{b.blind_spot.why}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <TaskGroup title="Überfällig" tone="bad" tasks={b.overdue} notify={notify} onChange={reload} />
        <TaskGroup title="Heute fällig" tone="warn" tasks={b.due_today} notify={notify} onChange={reload} />
      </div>
      {b.upcoming.length > 0 && <TaskGroup title="Diese Woche" tone="info" tasks={b.upcoming} notify={notify} onChange={reload} />}

      {(b.open_approvals > 0 || b.open_memory_proposals > 0) && (
        <Card className="flex flex-wrap gap-3 px-4 py-3 text-sm text-mist-200">
          {b.open_approvals > 0 && <span>{b.open_approvals} Aktion(en) warten auf Bestätigung</span>}
          {b.open_memory_proposals > 0 && <span>{b.open_memory_proposals} Erinnerungsvorschlag/-vorschläge offen</span>}
        </Card>
      )}

      {b.projects.length > 0 && (
        <Card className="px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mist-400">Projekte</h3>
          <div className="mt-2 space-y-2">
            {b.projects.map((p) => (
              <div key={p.project.id} className="border-l-2 border-white/8 pl-2.5">
                <p className="text-sm font-medium text-mist-200">{p.project.name}</p>
                <p className="text-[11px] text-mist-400">
                  {p.open_tasks} offene Aufgaben
                  {p.next_best_action && <> · Nächster Schritt: {p.next_best_action}</>}
                </p>
                {p.open_questions.map((q, i) => <p key={i} className="text-[11px] text-amber-300/80">? {q}</p>)}
              </div>
            ))}
          </div>
        </Card>
      )}

      {b.conflicts.length > 0 && (
        <Card className="px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Konflikte</h3>
          {b.conflicts.map((c, i) => <p key={i} className="mt-1 text-xs text-mist-200">• {c}</p>)}
        </Card>
      )}

      {b.degraded.length > 0 && (
        <Card className="px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mist-400">Eingeschränkt</h3>
          {b.degraded.map((d, i) => <p key={i} className="mt-1 text-xs text-mist-400">• {d}</p>)}
        </Card>
      )}
    </div>
  )
}

function TaskGroup({ title, tone, tasks, notify, onChange }: {
  title: string; tone: 'bad' | 'warn' | 'info'; tasks: TaskItem[]; notify: Notify; onChange: () => void
}) {
  if (!tasks.length) return null
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-[11px] text-mist-400">{tasks.length}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {tasks.map((t) => <TaskRow key={t.id} t={t} notify={notify} onChange={onChange} />)}
      </div>
    </Card>
  )
}

function TaskRow({ t, notify, onChange }: { t: TaskItem; notify: Notify; onChange: () => void }) {
  const toggle = async () => {
    try {
      await api.updateTask(t.id, { status: t.status === 'done' ? 'open' : 'done' })
      onChange()
    } catch (e) { notify((e as Error).message, 'bad') }
  }
  return (
    <div className="flex items-start gap-2">
      <input type="checkbox" checked={t.status === 'done'} onChange={() => void toggle()}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-ink-900 accent-indigo-500" />
      <div className="min-w-0 flex-1">
        <p className={cx('text-sm', t.status === 'done' ? 'text-mist-400 line-through' : 'text-mist-200')}>{t.title}</p>
        {t.due_at && <p className="text-[10px] text-mist-400">fällig {relTime(t.due_at)}</p>}
      </div>
    </div>
  )
}

function TasksPanel({ notify }: { notify: Notify }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const { data, loading, reload } = useAsync(() => api.tasks(), [])

  const add = async () => {
    if (!title.trim()) return
    try {
      await api.createTask({ title, due_at: due ? new Date(due).toISOString() : null })
      setTitle(''); setDue(''); reload(); notify('Aufgabe angelegt.', 'good')
    } catch (e) { notify((e as Error).message, 'bad') }
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap gap-2 px-3 py-2.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="Neue Aufgabe …" className={cx(inputCls, 'min-w-40 flex-1')} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cx(inputCls, 'w-40')} />
        <Btn variant="primary" size="sm" onClick={() => void add()}>Anlegen</Btn>
      </Card>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && data.tasks.length === 0 && <Empty title="Keine Aufgaben" />}
      <Card className="space-y-1.5 px-3.5 py-3">
        {data?.tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 border-b border-white/4 py-1 last:border-0">
            <TaskRow t={t} notify={notify} onChange={reload} />
            <Btn size="sm" variant="ghost" className="ml-auto"
              onClick={() => void api.deleteTask(t.id).then(reload)}>Löschen</Btn>
          </div>
        ))}
      </Card>
    </div>
  )
}

function ProjectsPanel({ notify }: { notify: Notify }) {
  const [name, setName] = useState('')
  const { data, loading, reload } = useAsync(() => api.projects(), [])

  const add = async () => {
    if (!name.trim()) return
    try { await api.createProject({ name }); setName(''); reload(); notify('Projekt angelegt.', 'good') }
    catch (e) { notify((e as Error).message, 'bad') }
  }

  return (
    <div className="space-y-3">
      <Card className="flex gap-2 px-3 py-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="Neues Projekt …" className={cx(inputCls, 'flex-1')} />
        <Btn variant="primary" size="sm" onClick={() => void add()}>Anlegen</Btn>
      </Card>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && data.projects.length === 0 && (
        <Empty title="Keine Projekte" hint="Projekte bündeln Ziel, Stand, Entscheidungen, offene Fragen und Aufgaben." />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {data?.projects.map((p) => (
          <Card key={p.id} className="px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-mist-200">{p.name}</span>
              <Badge tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status}</Badge>
            </div>
            {p.objective && <p className="mt-1 text-xs text-mist-400">{p.objective}</p>}
            <p className="mt-1 text-[10px] text-mist-400/70">{p.category} · {relTime(p.updated_at)}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ── Approvals ───────────────────────────────────────────────────────────── */

export function ApprovalsView({ notify }: { notify: Notify }) {
  const { data, loading, reload } = useAsync(() => api.actions(), [])
  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">Freigaben</h2>
        <Btn size="sm" variant="ghost" onClick={reload}>Aktualisieren</Btn>
      </div>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && data.pending.length === 0 && (
        <Empty title="Nichts wartet auf dich"
          hint="Aktionen, die nach außen wirken, etwas löschen oder Geld betreffen, landen hier — mit der exakten Nutzlast, bevor irgendetwas passiert." />
      )}
      {data?.pending.map((a) => <ActionCard key={a.id} action={a} notify={notify} onDecided={reload} />)}

      {data && data.recent.length > 0 && (
        <section className="space-y-2 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mist-400">Zuletzt</h3>
          {data.recent.filter((a) => a.status !== 'pending').slice(0, 15).map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="text-mist-200">{a.title_de}</span>
              <span className="text-mist-400">{a.target}</span>
              <Badge tone={a.status === 'executed' ? 'good' : a.status === 'rejected' || a.status === 'failed' ? 'bad' : 'neutral'}>
                {a.status}
              </Badge>
              <span className="ml-auto text-[10px] text-mist-400/60">{relTime(a.created_at)}</span>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
