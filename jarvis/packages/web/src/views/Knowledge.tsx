import { useEffect, useRef, useState } from 'react'
import { api, type SourceRow, type GraphNode, type GraphEdge } from '../api'
import { Badge, Btn, Card, Empty, Field, Spinner, cx, inputCls, relTime, useAsync } from '../components/ui'
import type { RetrievalResult } from '@jarvis/shared'
import { CONFLICT_DE } from './Chat'

/** Sources list + detail + a 2D knowledge map. */
export function SourcesView({ notify }: { notify: (m: string, t?: 'info' | 'bad' | 'good') => void }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const { data, loading, reload } = useAsync(() => api.sources(q || undefined), [q])

  const reindex = async (force: boolean) => {
    setReindexing(true)
    try {
      await api.reindex(force)
      notify('Indexlauf gestartet. Der Fortschritt steht unter „System“ → Jobs.', 'good')
      setTimeout(reload, 3000)
    } catch (e) { notify((e as Error).message, 'bad') }
    finally { setReindexing(false) }
  }

  if (selected) return <SourceDetail id={selected} onBack={() => setSelected(null)} />

  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Quellen filtern …" className={cx(inputCls, 'max-w-xs flex-1')}
        />
        <Btn size="sm" disabled={reindexing} onClick={() => void reindex(false)}>
          {reindexing && <Spinner />} Neu einlesen
        </Btn>
        <Btn size="sm" variant="ghost" disabled={reindexing} onClick={() => void reindex(true)}>
          Vollständig neu
        </Btn>
        {data && (
          <span className="ml-auto text-xs text-mist-400">
            {data.stats.sources} Quellen · {data.stats.chunks} Abschnitte · {data.stats.embedded} Vektoren
          </span>
        )}
      </div>

      {loading && <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-mist-400" /></div>}
      {data && data.sources.length === 0 && (
        <Empty
          title="Keine Quellen indexiert"
          hint="Lege Dateien in den freigegebenen Quellordner (Standard: ./sources) und starte „Neu einlesen“. Unterstützt: Markdown, PDF, DOCX, XLSX, CSV, JSON, HTML, Text und Bild-Metadaten."
        />
      )}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {data?.sources.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)} className="text-left">
            <Card className="h-full px-3 py-2.5 transition hover:border-accent/30">
              <div className="flex items-start gap-2">
                <span className="flex-1 text-sm font-medium text-mist-200">{s.title}</span>
                <Badge tone="neutral">{s.kind}</Badge>
              </div>
              <p className="mt-1 truncate text-[11px] text-mist-400/70">{s.uri}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {!s.active && <Badge tone="bad">inaktiv</Badge>}
                {s.superseded_by && <Badge tone="warn">ersetzt</Badge>}
                {s.error && <Badge tone="bad">Fehler</Badge>}
                <span className="text-[10px] text-mist-400">geändert {relTime(s.modified_at)}</span>
              </div>
              {s.error && <p className="mt-1 text-[11px] text-rose-300">{s.error}</p>}
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}

function SourceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, loading } = useAsync(() => api.source(id), [id])
  return (
    <div className="space-y-3 p-3 sm:p-5">
      <Btn size="sm" variant="ghost" onClick={onBack}>← Zurück</Btn>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && (
        <>
          <Card className="px-4 py-3">
            <h2 className="text-base font-semibold text-white">{data.source.title}</h2>
            <p className="mt-0.5 break-all text-[11px] text-mist-400">{data.source.uri}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{data.source.kind}</Badge>
              <Badge tone="neutral">{Math.round(data.source.bytes / 1024)} KB</Badge>
              <Badge tone="neutral">geändert {relTime(data.source.modified_at)}</Badge>
              <Badge tone="neutral">indexiert {relTime(data.source.indexed_at)}</Badge>
              {data.source.superseded_by && <Badge tone="warn">durch neuere Fassung ersetzt</Badge>}
            </div>
            {data.related.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.related.map((r) => (
                  <span key={r.id + r.kind} className="rounded-md border border-white/8 px-1.5 py-0.5 text-[10px] text-mist-400">
                    {r.kind}: {r.title}
                  </span>
                ))}
              </div>
            )}
          </Card>
          <div className="space-y-2">
            {data.chunks.map((c) => (
              <Card key={c.id} className="px-3 py-2.5">
                <p className="text-[11px] font-medium text-accent-soft">{c.loc}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mist-400">{c.text}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Search view ─────────────────────────────────────────────────────────── */

export function SearchView({ notify }: { notify: (m: string, t?: 'info' | 'bad' | 'good') => void }) {
  const [q, setQ] = useState('')
  const [result, setResult] = useState<RetrievalResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    try { setResult(await api.search(q, 15)) }
    catch (e) { notify((e as Error).message, 'bad') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3 p-3 sm:p-5">
      <div className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          placeholder="Volltext + semantische Suche über alle Quellen …"
          className={cx(inputCls, 'flex-1')}
        />
        <Btn variant="primary" disabled={busy} onClick={() => void run()}>{busy && <Spinner />} Suchen</Btn>
      </div>

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-mist-400">
            <Badge tone={result.coverage === 'good' ? 'good' : result.coverage === 'none' ? 'bad' : 'warn'}>
              Abdeckung: {result.coverage}
            </Badge>
            <span>{result.took_ms} ms</span>
            <span>Begriffe: {result.query_terms.join(', ') || '—'}</span>
            {!result.semantic_enabled && <Badge tone="warn">semantische Suche inaktiv</Badge>}
          </div>
          {result.conflicts.map((c, i) => (
            <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
              <strong>{CONFLICT_DE[c.reason]}:</strong> {c.topic} — {c.a} ↔ {c.b}
            </div>
          ))}
          {result.citations.length === 0 && <Empty title="Keine Treffer" hint="Formuliere die Suche anders oder lies neue Quellen ein." />}
          <div className="space-y-2">
            {result.citations.map((c) => (
              <Card key={c.chunk_id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-mist-200">{c.source_title}</span>
                  <span className="text-[11px] text-mist-400">{c.loc}</span>
                  {c.superseded_by && <Badge tone="warn">ersetzt</Badge>}
                  {c.freshness === 'stale' && <Badge tone="warn">veraltet</Badge>}
                  <span className="ml-auto text-[10px] text-mist-400/60">
                    lex {c.lexical_score.toFixed(1)} · sem {c.semantic_score.toFixed(3)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-mist-400">{c.passage}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Knowledge map ───────────────────────────────────────────────────────── */

/**
 * A 2D force-directed map, drawn on canvas with a hand-rolled simulation.
 *
 * The spec offers a 3D galaxy as an *optional* mode; this is the practical
 * version: it runs at 60fps on a tablet, needs no WebGL, and adds no dependency.
 * It is explicitly a secondary way to explore — search and the source list are
 * the primary ones.
 */
export function GraphView({ notify }: { notify: (m: string, t?: 'info' | 'bad' | 'good') => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const { data, loading } = useAsync(() => api.graph(), [])

  useEffect(() => {
    if (!data || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) { notify('Canvas nicht verfügbar', 'bad'); return }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = r.width * dpr; canvas.height = r.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const W = () => canvas.width / dpr, H = () => canvas.height / dpr
    type P = GraphNode & { x: number; y: number; vx: number; vy: number; r: number }
    const nodes: P[] = data.nodes.map((n, i) => ({
      ...n,
      x: W() / 2 + Math.cos(i) * (60 + i * 3),
      y: H() / 2 + Math.sin(i) * (60 + i * 3),
      vx: 0, vy: 0,
      r: Math.min(16, 4 + Math.sqrt(n.chunks || 1) * 2),
    }))
    const index = new Map(nodes.map((n) => [n.id, n]))
    const edges = data.edges
      .map((e: GraphEdge) => ({ a: index.get(e.from_id), b: index.get(e.to_id), kind: e.kind, w: e.weight }))
      .filter((e): e is { a: P; b: P; kind: string; w: number } => !!e.a && !!e.b)

    let frame = 0
    let raf = 0
    const step = () => {
      // Repulsion between all pairs, springs along edges, gentle centring.
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!
          const dx = b.x - a.x, dy = b.y - a.y
          const d2 = Math.max(64, dx * dx + dy * dy)
          const f = 900 / d2
          const d = Math.sqrt(d2)
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f
          b.vx += (dx / d) * f; b.vy += (dy / d) * f
        }
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = (d - 90) * 0.0035 * e.w
        e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f
        e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f
      }
      for (const n of nodes) {
        n.vx += (W() / 2 - n.x) * 0.0012
        n.vy += (H() / 2 - n.y) * 0.0012
        n.vx *= 0.86; n.vy *= 0.86
        n.x = Math.max(n.r, Math.min(W() - n.r, n.x + n.vx))
        n.y = Math.max(n.r, Math.min(H() - n.r, n.y + n.vy))
      }

      ctx.clearRect(0, 0, W(), H())
      ctx.lineWidth = 1
      for (const e of edges) {
        ctx.strokeStyle = e.kind === 'supersedes' ? 'rgba(245,158,11,0.35)' : 'rgba(99,102,241,0.13)'
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke()
      }
      for (const n of nodes) {
        const isSel = selected?.id === n.id
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = n.superseded_by ? 'rgba(245,158,11,0.75)' : isSel ? '#a5b4fc' : 'rgba(99,102,241,0.85)'
        ctx.fill()
        if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke() }
        if (n.r > 8 || isSel) {
          ctx.fillStyle = 'rgba(200,208,228,0.75)'
          ctx.font = '10px system-ui'
          ctx.textAlign = 'center'
          ctx.fillText(n.title.slice(0, 22), n.x, n.y + n.r + 11)
        }
      }
      // Settle after ~6s so an idle tab stops burning CPU.
      if (++frame < 400) raf = requestAnimationFrame(step)
    }
    step()

    const pick = (ev: MouseEvent | TouchEvent) => {
      const r = canvas.getBoundingClientRect()
      const pt = 'touches' in ev ? ev.touches[0] : ev
      if (!pt) return
      const x = pt.clientX - r.left, y = pt.clientY - r.top
      const hit = nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= n.r + 6)
      setSelected(hit ?? null)
      frame = 0; cancelAnimationFrame(raf); step()
    }
    canvas.addEventListener('click', pick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('click', pick)
    }
  }, [data, selected, notify])

  return (
    <div className="flex h-full flex-col p-3 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-mist-400">
        <span>Wissenskarte</span>
        {data && <Badge tone="neutral">{data.nodes.length} Quellen · {data.edges.length} Verbindungen</Badge>}
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-amber-400" /> ersetzt</span>
        <span className="ml-auto text-[11px]">Optionale Ansicht — Suche und Quellenliste bleiben der Hauptweg.</span>
      </div>
      {loading && <Spinner className="h-5 w-5 text-mist-400" />}
      {data && data.nodes.length === 0 && <Empty title="Noch nichts zu zeigen" hint="Lies zuerst Quellen ein." />}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/6 bg-ink-950/40">
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
        {selected && (
          <Card className="absolute bottom-3 left-3 right-3 px-3 py-2 sm:right-auto sm:max-w-sm">
            <p className="text-sm font-medium text-mist-200">{selected.title}</p>
            <p className="text-[11px] text-mist-400">
              {selected.kind} · {selected.chunks} Abschnitte · geändert {relTime(selected.modified_at)}
            </p>
            {selected.superseded_by && <Badge tone="warn">durch neuere Fassung ersetzt</Badge>}
          </Card>
        )}
      </div>
    </div>
  )
}
