import { useState } from 'react'
import { api, type EvalRun } from '../api'
import { Badge, Btn, Card, Empty, Field, Spinner, StatusDot, cx, inputCls, relTime, useAsync } from '../components/ui'

type Notify = (m: string, t?: 'info' | 'bad' | 'good') => void

/* ── System status, jobs, audit, integrations ────────────────────────────── */

export function SystemView({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<'status' | 'jobs' | 'audit' | 'tools'>('status')
  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex gap-1 rounded-lg border border-white/8 bg-ink-900/60 p-0.5">
        {([['status', 'Zustand'], ['jobs', 'Jobs'], ['audit', 'Audit'], ['tools', 'Werkzeuge']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cx('flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
              tab === id ? 'bg-accent text-white' : 'text-mist-400 hover:text-mist-200')}>{label}</button>
        ))}
      </div>
      {tab === 'status' && <StatusPanel notify={notify} />}
      {tab === 'jobs' && <JobsPanel notify={notify} />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'tools' && <ToolsPanel />}
    </div>
  )
}

function StatusPanel({ notify }: { notify: Notify }) {
  const { data, loading, reload } = useAsync(() => api.status(), [])
  const backup = async () => {
    try { const r = await api.backup(); notify(`Sicherung erstellt (${Math.round(r.backup.bytes / 1024)} KB).`, 'good') }
    catch (e) { notify((e as Error).message, 'bad') }
  }
  if (loading) return <Spinner className="h-5 w-5 text-mist-400" />
  if (!data) return <Empty title="Status nicht verfügbar" />
  const s = data.status

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">JARVIS {s.version}</p>
          <p className="text-[11px] text-mist-400">
            läuft seit {Math.floor(s.uptime_s / 3600)} h {Math.floor((s.uptime_s % 3600) / 60)} min
          </p>
        </div>
        {s.offline_mode && <Badge tone="warn">Offline-Modus</Badge>}
        <div className="ml-auto flex gap-1.5">
          <Btn size="sm" variant="ghost" onClick={reload}>Aktualisieren</Btn>
          <Btn size="sm" onClick={() => void backup()}>Sicherung erstellen</Btn>
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2">
        {s.components.map((c) => (
          <Card key={c.name} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <StatusDot status={c.status} />
              <span className="flex-1 text-sm text-mist-200">{c.name}</span>
              <span className="text-[10px] uppercase text-mist-400">{c.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-mist-400">{c.detail_de}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card className="px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-mist-400">Index</p>
          <p className="mt-1 text-sm text-mist-200">
            {s.index.sources} Quellen · {s.index.chunks} Abschnitte · {s.index.embedded} Vektoren
          </p>
        </Card>
        <Card className="px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-mist-400">Warteschlange</p>
          <p className="mt-1 text-sm text-mist-200">
            {s.queue.pending} wartend · {s.queue.running} laufend
            {s.queue.dead > 0 && <span className="text-rose-300"> · {s.queue.dead} tot</span>}
          </p>
        </Card>
        <Card className="px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-mist-400">Audit</p>
          <p className="mt-1 text-sm text-mist-200">
            {s.audit.entries} Einträge{' '}
            {s.audit.chain_valid
              ? <Badge tone="good">Kette intakt</Badge>
              : <Badge tone="bad">Kette gebrochen</Badge>}
          </p>
        </Card>
      </div>

      <Card className="px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-mist-400">Konfiguration (ohne Geheimnisse)</p>
        <pre className="mt-1.5 overflow-x-auto text-[11px] text-mist-400">{JSON.stringify(data.config, null, 2)}</pre>
      </Card>
    </div>
  )
}

function JobsPanel({ notify }: { notify: Notify }) {
  const { data, loading, reload } = useAsync(() => api.jobs(), [])
  if (loading) return <Spinner className="h-5 w-5 text-mist-400" />
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(data?.stats ?? {}).map(([k, v]) => (
          <Badge key={k} tone={k === 'dead' && v > 0 ? 'bad' : 'neutral'}>{k}: {v}</Badge>
        ))}
        <Btn size="sm" variant="ghost" className="ml-auto" onClick={reload}>Aktualisieren</Btn>
      </div>
      {data?.jobs.map((j) => (
        <Card key={j.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
          <span className="font-medium text-mist-200">{j.kind}</span>
          <Badge tone={j.status === 'done' ? 'good' : j.status === 'dead' ? 'bad' : j.status === 'running' ? 'info' : 'neutral'}>
            {j.status}
          </Badge>
          <span className="text-mist-400">{j.attempts}/{j.max_attempts} Versuche</span>
          <span className="text-[10px] text-mist-400/60">{relTime(j.created_at)}</span>
          {['pending', 'running'].includes(j.status) && (
            <Btn size="sm" variant="ghost" className="ml-auto"
              onClick={() => void api.cancelJob(j.id).then(() => { notify('Abbruch angefordert.', 'info'); reload() })}>
              Abbrechen
            </Btn>
          )}
          {j.last_error && <p className="w-full text-[11px] text-rose-300">{j.last_error}</p>}
        </Card>
      ))}
    </div>
  )
}

function AuditPanel() {
  const [filter, setFilter] = useState('')
  const { data, loading } = useAsync(() => api.audit(filter || undefined, 150), [filter])
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Nach Aktion filtern, z. B. memory. oder action." className={cx(inputCls, 'flex-1')} />
        {data && (data.chain.valid
          ? <Badge tone="good">Kette intakt ({data.chain.entries})</Badge>
          : <Badge tone="bad">Kette gebrochen</Badge>)}
      </div>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      <Card className="divide-y divide-white/4">
        {data?.entries.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[11px]">
            <span className="w-32 shrink-0 text-mist-400/70">{new Date(e.at).toLocaleString('de-DE')}</span>
            <span className="font-medium text-mist-200">{e.action}</span>
            <span className="text-mist-400">{e.actor}</span>
            {e.subject && <span className="truncate text-mist-400/70">{e.subject}</span>}
            <Badge tone={e.outcome === 'ok' ? 'good' : e.outcome === 'denied' ? 'warn' : 'bad'}>{e.outcome}</Badge>
          </div>
        ))}
      </Card>
    </div>
  )
}

function ToolsPanel() {
  const { data, loading } = useAsync(() => api.tools(), [])
  const tones = {
    read_only: 'good', reversible_write: 'info', external_comm: 'warn',
    destructive: 'bad', financial_security: 'bad',
  } as const
  if (loading) return <Spinner className="h-5 w-5 text-mist-400" />
  return (
    <div className="space-y-2">
      <p className="text-xs text-mist-400">
        Vollständige Liste der Werkzeuge mit Risikoklasse. Alles außer „Nur lesen“ braucht eine Bestätigung.
      </p>
      {data?.tools.map((t) => (
        <Card key={t.name} className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-mist-200">{t.title_de}</span>
            <code className="text-[10px] text-mist-400/70">{t.name}</code>
            <Badge tone={tones[t.risk]}>{t.risk}</Badge>
            <Badge tone="neutral">{t.domain}</Badge>
            {t.requires_integration && <Badge tone="warn">braucht {t.requires_integration}</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-mist-400">{t.description}</p>
        </Card>
      ))}
    </div>
  )
}

/* ── Learning loop ───────────────────────────────────────────────────────── */

export function LearningView({ notify }: { notify: Notify }) {
  const [run, setRun] = useState<EvalRun | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, loading, reload } = useAsync(() => api.evalMetrics(30), [])
  const proposals = useAsync(() => api.proposals(), [])

  const doRun = async (tier: 'retrieval' | 'full') => {
    setBusy(true)
    try {
      const r = await api.runEval(tier)
      setRun(r.run)
      notify(`${r.run.passed}/${r.run.passed + r.run.failed} Tests bestanden.`, r.run.failed ? 'bad' : 'good')
      reload()
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    try { await api.decideImprovement(id, status); proposals.reload(); notify('Entschieden.', 'good') }
    catch (e) { notify((e as Error).message, 'bad') }
  }

  if (loading) return <div className="p-5"><Spinner className="h-5 w-5 text-mist-400" /></div>
  const m = data?.metrics

  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Interaktionen (30 T)" value={m?.interactions ?? 0} />
        <Metric label="Korrekturen" value={m?.corrections ?? 0}
          tone={(m?.corrections ?? 0) > 0 ? 'warn' : 'good'} />
        <Metric label="Belegt-Quote"
          value={m?.grounded_rate === null || m?.grounded_rate === undefined ? '—' : `${Math.round(m.grounded_rate * 100)} %`} />
        <Metric label="Antwortzeit p95" value={`${Math.round((m?.p95_latency_ms ?? 0) / 100) / 10} s`} />
      </div>

      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-white">Regressionstests</h3>
          <Btn size="sm" disabled={busy} onClick={() => void doRun('retrieval')}>
            {busy && <Spinner />} Nur Quellen (offline)
          </Btn>
          <Btn size="sm" variant="primary" disabled={busy} onClick={() => void doRun('full')}>Vollständig (Modell)</Btn>
        </div>
        <p className="mt-1 text-[11px] text-mist-400">
          Der Quellen-Lauf braucht kein Sprachmodell und kostet nichts — er fängt die meisten echten Regressionen ab.
        </p>
        {run && (
          <div className="mt-2 space-y-1">
            <Badge tone={run.failed ? 'bad' : 'good'}>{run.passed}/{run.passed + run.failed} bestanden</Badge>
            {run.cases.filter((c) => !c.passed).map((c, i) => (
              <p key={i} className="text-[11px] text-rose-300">✗ {c.name}: {c.failures.join('; ')}</p>
            ))}
          </div>
        )}
        {data && data.runs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.runs.map((r) => (
              <span key={r.id} className="rounded-md border border-white/8 px-1.5 py-0.5 text-[10px] text-mist-400">
                {r.label}: {Math.round(r.score * 100)} %
              </span>
            ))}
          </div>
        )}
      </Card>

      <CorrectionForm notify={notify} onDone={() => { reload(); proposals.reload() }} />

      <Card className="px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Verbesserungsvorschläge</h3>
        <p className="mt-0.5 text-[11px] text-mist-400">
          JARVIS darf Vorschläge erzeugen und bewerten — aktiv wird nichts ohne deine Freigabe.
        </p>
        <div className="mt-2 space-y-2">
          {proposals.data?.proposals.length === 0 && (
            <p className="text-xs text-mist-400">Keine offenen Vorschläge. Sie entstehen, sobald sich Korrekturen häufen.</p>
          )}
          {proposals.data?.proposals.map((p) => (
            <div key={p.id} className="rounded-lg border border-white/8 bg-ink-900/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-mist-200">{p.title_de}</span>
                <Badge tone="neutral">{p.target}: {p.target_key}</Badge>
                <Badge tone={p.status === 'approved' ? 'good' : p.status === 'rejected' ? 'bad' : 'info'}>{p.status}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-mist-400">{p.rationale}</p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-ink-950/60 p-2 text-[10px] text-mist-400">{p.diff}</pre>
              {p.status === 'draft' && (
                <div className="mt-2 flex gap-1.5">
                  <Btn size="sm" variant="primary" onClick={() => void decide(p.id, 'approved')}>Freigeben</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void decide(p.id, 'rejected')}>Ablehnen</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {data && data.corrections.length > 0 && (
        <Card className="px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Letzte Korrekturen</h3>
          <div className="mt-1.5 space-y-1">
            {data.corrections.map((c) => (
              <p key={c.id} className="text-[11px] text-mist-400">
                <Badge tone="neutral">{c.category}</Badge> {c.what_went_wrong} · {relTime(c.created_at)}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' }) {
  return (
    <Card className="px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-mist-400">{label}</p>
      <p className={cx('mt-0.5 text-xl font-semibold',
        tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-300' : 'text-white')}>{value}</p>
    </Card>
  )
}

function CorrectionForm({ notify, onDone }: { notify: Notify; onDone: () => void }) {
  const [f, setF] = useState({ category: 'retrieval', what_went_wrong: '', expected: '', question: '' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (f.what_went_wrong.trim().length < 3) return
    setBusy(true)
    try {
      const r = await api.correction(f)
      notify(r.proposals.length
        ? `Korrektur erfasst. ${r.proposals.length} Verbesserungsvorschlag erzeugt.`
        : 'Korrektur erfasst.', 'good')
      setF({ category: 'retrieval', what_went_wrong: '', expected: '', question: '' })
      onDone()
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  return (
    <Card className="space-y-2 px-4 py-3">
      <h3 className="text-sm font-semibold text-white">Korrektur melden</h3>
      <p className="text-[11px] text-mist-400">
        Das ist das wertvollste Signal, das JARVIS bekommt. Retrieval- und Wissensfehler werden automatisch
        zu einem Regressionsfall, damit derselbe Fehler nicht zweimal passiert.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Kategorie">
          <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="retrieval">Quellensuche</option>
            <option value="knowledge_source">Wissensquelle fehlt</option>
            <option value="reasoning_instruction">Denk-/Formulierungsregel</option>
            <option value="tool_use">Werkzeugwahl</option>
            <option value="memory">Erinnerung</option>
            <option value="integration">Integration</option>
            <option value="ui_wording">Formulierung in der Oberfläche</option>
            <option value="security_policy">Sicherheitsregel</option>
          </select>
        </Field>
        <Field label="Ursprüngliche Frage (optional)">
          <input className={inputCls} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
        </Field>
      </div>
      <Field label="Was war falsch?">
        <textarea rows={2} className={inputCls} value={f.what_went_wrong}
          onChange={(e) => setF({ ...f, what_went_wrong: e.target.value })} />
      </Field>
      <Field label="Was wäre richtig gewesen?">
        <textarea rows={2} className={inputCls} value={f.expected}
          onChange={(e) => setF({ ...f, expected: e.target.value })} />
      </Field>
      <Btn variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>{busy && <Spinner />} Senden</Btn>
    </Card>
  )
}
