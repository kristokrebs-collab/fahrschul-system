import { useMemo, useRef, useState } from 'react'
import { useSync } from './useSync.js'
import Tacho, { Ring } from './Tacho.jsx'
import {
  INSTRUCTORS, DAY_LABELS, PERIODS, PERIOD_LABELS, DOC_LABELS,
  canTeach, instructorOf, offen, theorieP, missingDocs, readinessOf,
  fmtEuro, fmtDate, initials,
} from './data.js'

const pid = () => 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export default function App() {
  const { records, online, write } = useSync()
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('alle')
  const [showDetail, setShowDetail] = useState(false)

  const students = useMemo(() => {
    let list = Object.values(records)
      .filter(r => r.profile && r.profile.name)
      .map(r => ({ ...r, name: r.profile.name, klasse: r.state.klasse || r.profile.klasse || 'B' }))
      .sort((a, b) => b.ts - a.ts)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.klasse.toLowerCase().includes(q))
    if (filter === 'reif') list = list.filter(s => readinessOf(s.state).pct >= 75)
    if (filter === 'offen') list = list.filter(s => offen(s.state) > 0)
    return list
  }, [records, query, filter])

  const sel = selected ? records[selected] : null
  const kpi = useMemo(() => {
    const all = Object.values(records).filter(r => r.profile && r.profile.name)
    const sum = all.reduce((a, r) => a + offen(r.state), 0)
    const ready = all.filter(r => readinessOf(r.state).pct >= 75).length
    const avg = all.length ? Math.round(all.reduce((a, r) => a + readinessOf(r.state).pct, 0) / all.length) : 0
    return { n: all.length, sum, ready, avg }
  }, [records])

  return (
    <div className="shell">
      <header className="hdr">
        <div className="logo">FK</div>
        <div className="wm"><b>Fahrschule Krebs</b><span>Zentrale · React-Variante</span></div>
        <div className="spacer" />
        <span className={online ? 'pill on' : 'pill'}>
          <span className="dot" />{online ? `${kpi.n} Schüler live über Server` : 'Server offline'}
        </span>
      </header>

      <div className="kpis">
        <div className="kpi"><div className="ic">🧑‍🎓</div><div><b>{kpi.n}</b><span>Live-Schüler</span></div></div>
        <div className="kpi"><div className="ic">💶</div><div><b>{fmtEuro(kpi.sum)}</b><span>Offene Posten</span></div></div>
        <div className="kpi"><div className="ic">🏁</div><div><b>{kpi.ready}</b><span>Fast prüfungsreif</span></div></div>
        <div className="kpi"><div className="ic">⚡</div><div><b>{kpi.avg} %</b><span>Ø Prüfungsreife</span></div></div>
      </div>

      <div className="toolbar">
        <input
          className="search" placeholder="Schüler suchen (Name, Klasse) …"
          value={query} onChange={e => setQuery(e.target.value)}
        />
        {[['alle', 'Alle'], ['reif', 'Fast reif'], ['offen', 'Offene Posten']].map(([k, l]) => (
          <button key={k} className={filter === k ? 'chip active' : 'chip'} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div className={showDetail ? 'main show-detail' : 'main'}>
        <div className="list-col">
          {!students.length && (
            <div className="empty-live">
              {online
                ? 'Noch keine Schüler-App verbunden. Registrierungen aus app.html erscheinen hier live.'
                : 'server.py starten – die React-Zentrale nutzt denselben Live-Sync wie das Dashboard.'}
            </div>
          )}
          {students.map((s, i) => (
            <StudentCard
              key={s.cid} s={s} i={i} sel={s.cid === selected}
              onSelect={() => { setSelected(s.cid); setShowDetail(true) }}
            />
          ))}
        </div>
        <div className="detail-col">
          {sel
            ? <Detail rec={sel} write={write} onBack={() => setShowDetail(false)} />
            : (
              <div className="d-empty">
                <div style={{ fontSize: 34 }}>🗂️</div>
                <b style={{ color: 'var(--text-dim)' }}>Kein Schüler ausgewählt</b>
                <span style={{ maxWidth: 300 }}>Wähle links einen Schüler – Tacho, Theorie, Praxis, Zahlungen und Nachweise erscheinen hier.</span>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function StudentCard({ s, i, sel, onSelect }) {
  const st = s.state
  const r = readinessOf(st)
  const tp = theorieP(st)
  const off = offen(st)
  const docs = missingDocs(st)
  return (
    <div className={sel ? 'card sel' : 'card'} style={{ animationDelay: `${Math.min(i * 45, 360)}ms` }} onClick={onSelect}>
      <div className="card-top">
        <div className="avatar hot">{initials(s.name)}</div>
        <div>
          <div className="card-name">{s.name}</div>
          <div className="card-meta">Klasse {s.klasse} · {instructorOf(st).name}</div>
        </div>
        <Ring pct={r.pct} color={r.color} />
        <span className="badge live">⚡ LIVE</span>
      </div>
      <div className="mini-rows">
        {st.theorie?.gesamt > 0 && (
          <div className="mini-row">
            <span className="lbl">Theorie</span>
            <div className="bar"><i className={tp >= 1 ? 'full' : ''} style={{ width: `${Math.round(tp * 100)}%` }} /></div>
            <span className="val">{st.theorie.besucht}/{st.theorie.gesamt}</span>
          </div>
        )}
        <div className="mini-row">
          <span className="lbl">Reife</span>
          <div className="bar"><i className={r.pct >= 100 ? 'full' : ''} style={{ width: `${r.pct}%` }} /></div>
          <span className="val">{r.pct} %</span>
        </div>
      </div>
      <div style={{ marginTop: 9, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {st.naechsteFahrstunde
          ? <span className="chipst ok">📅 {new Date(st.naechsteFahrstunde).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
          : <span className="chipst warn">Kein Termin</span>}
        {off > 0
          ? <span className={off >= 100 ? 'chipst bad' : 'chipst warn'}>{fmtEuro(off)} offen</span>
          : <span className="chipst ok">bezahlt</span>}
        {docs.length > 0 && <span className="chipst warn">{docs.length} Nachweis{docs.length > 1 ? 'e' : ''} offen</span>}
      </div>
    </div>
  )
}

function Detail({ rec, write, onBack }) {
  const st = rec.state
  const r = readinessOf(st)
  const name = rec.profile?.name || '–'
  const fl = instructorOf(st)
  const sf = st.sonderfahrten || {}
  const off = offen(st)
  const [week, setWeek] = useState(0)
  const labelRef = useRef(null)
  const betragRef = useRef(null)

  const w = mut => write(rec.cid, mut)
  const step = (fn, d) => {
    if (fn === 'theorie') w(x => { x.theorie.besucht = Math.max(0, Math.min(x.theorie.gesamt, x.theorie.besucht + d)) })
    else if (fn === 'uebung') w(x => { x.uebungsstunden = Math.max(0, (x.uebungsstunden || 0) + d) })
    else if (fn === 'sim') w(x => { x.simulator.ist = Math.max(0, Math.min(x.simulator.soll, x.simulator.ist + d)) })
    else w(x => { const o = x.sonderfahrten[fn]; o.ist = Math.max(0, Math.min(o.soll, o.ist + d)) })
  }
  const addPosten = () => {
    const label = (labelRef.current.value || '').trim()
    const betrag = parseFloat(betragRef.current.value)
    if (!label || !(betrag > 0)) return
    w(x => { x.finanzen.posten.push({ id: pid(), label, betrag }) })
    labelRef.current.value = ''; betragRef.current.value = ''
  }
  const payPosten = id => w(x => {
    const i = x.finanzen.posten.findIndex(p => p.id === id)
    if (i >= 0) {
      x.finanzen.bezahlt = (x.finanzen.bezahlt || 0) + x.finanzen.posten[i].betrag
      x.finanzen.posten.splice(i, 1)
    }
  })
  const setDoc = (k, status) => w(x => { x.dokumente[k].status = status })
  const assignFl = id => {
    const f = INSTRUCTORS.find(x => x.id === id)
    if (f) w(x => { x.fahrlehrerId = f.id; x.fahrlehrerName = f.name })
  }

  const verf = (st.verfWeeks && st.verfWeeks[week]) || st.verfuegbarkeit || {}
  const prog = (label, ist, soll, fn) => (
    <div className="prog-row" key={label}>
      <div className="prog-top">
        <span className="l">
          {label}
          {fn && (
            <span className="steps">
              <button onClick={() => step(fn, -1)} aria-label="verringern">−</button>
              <button onClick={() => step(fn, 1)} aria-label="erhöhen">＋</button>
            </span>
          )}
        </span>
        <span className="v">{ist}/{soll}</span>
      </div>
      <div className="bar big"><i className={soll > 0 && ist >= soll ? 'full' : ''} style={{ width: `${soll ? Math.min(100, Math.round(ist / soll * 100)) : 100}%` }} /></div>
    </div>
  )

  return (
    <>
      <button className="back-btn" onClick={onBack}>← Zur Liste</button>
      <div className="d-head">
        <div className="d-avatar">{initials(name)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="d-name">{name} <span className="badge live">⚡ LIVE aus Schüler-App</span></div>
          <div className="d-sub">Klasse {st.klasse} · Änderungen erscheinen sofort in der App</div>
        </div>
        <div className="fl-pick">
          <label>Fahrlehrer</label>
          <select value={fl.id} onChange={e => assignFl(e.target.value)}>
            {INSTRUCTORS.filter(f => canTeach(f, st.klasse)).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="d-grid">
        <div className="panel tacho-panel">
          <Tacho pct={r.pct} color={r.color} />
          <div className="tacho-side">
            <h3 style={{ marginBottom: 6 }}>Gesamt-Prüfungsreife</h3>
            <span
              className="tacho-verdict"
              style={{
                color: r.color,
                background: r.pct < 40 ? 'var(--accent-soft)' : r.pct < 75 ? 'var(--amber-soft)' : 'var(--emerald-soft)',
                border: `1px solid ${r.pct < 40 ? 'var(--accent-line)' : r.pct < 75 ? 'rgba(245,158,11,.35)' : 'var(--emerald-line)'}`,
              }}
            >
              {r.verdict} · {r.pct} %
            </span>
            <div className="tacho-parts">
              {r.parts.map(p => (
                <div className="tacho-part" key={p.l}>
                  <span className="pl">{p.l}</span>
                  <div className="bar"><i className={p.v >= 1 ? 'full' : ''} style={{ width: `${Math.round(p.v * 100)}%` }} /></div>
                  <span className="pv">{Math.round(p.v * 100)} %</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>📖 Theorie</h3>
          {st.theorie?.gesamt > 0
            ? (
              <>
                {prog('Doppelstunden besucht', st.theorie.besucht, st.theorie.gesamt, 'theorie')}
                <div className="row">
                  <span className="grow">Theorieprüfung</span>
                  {st.theoriePruefung?.bestanden
                    ? <span className="chipst ok">Bestanden</span>
                    : <span className="chipst warn">Offen</span>}
                  <button className="mini-btn ok" onClick={() => w(x => { x.theoriePruefung.bestanden = !x.theoriePruefung.bestanden })}>
                    {st.theoriePruefung?.bestanden ? 'Zurücksetzen' : 'Bestanden ✓'}
                  </button>
                </div>
              </>
            )
            : <div style={{ color: 'var(--text-faint)', fontWeight: 600 }}>Keine Theorieprüfung erforderlich.</div>}
        </div>

        <div className="panel">
          <h3>🚗 Praxis</h3>
          {prog('Übungsfahrstunden (à 45 min)', st.uebungsstunden || 0, Math.max(st.uebungsstunden || 0, 20), 'uebung')}
          {st.simulator?.soll > 0 && prog('Simulator-Einheiten', st.simulator.ist, st.simulator.soll, 'sim')}
          {sf.ueberland?.soll > 0 && prog('Überlandfahrten', sf.ueberland.ist, sf.ueberland.soll, 'ueberland')}
          {sf.autobahn?.soll > 0 && prog('Autobahnfahrten', sf.autobahn.ist, sf.autobahn.soll, 'autobahn')}
          {sf.nacht?.soll > 0 && prog('Nachtfahrten', sf.nacht.ist, sf.nacht.soll, 'nacht')}
          <div className="row">
            <span className="grow">Nächste Fahrstunde</span>
            {st.naechsteFahrstunde
              ? <span className="chipst ok">{fmtDate(st.naechsteFahrstunde)}</span>
              : <span className="chipst warn">Kein Termin</span>}
          </div>
          <div className="row">
            <span className="grow">Prüfungs-GO des Fahrlehrers</span>
            {st.fahrlehrerGo ? <span className="chipst ok">Erteilt ✓</span> : <span className="chipst warn">Offen</span>}
          </div>
        </div>

        <div className="panel">
          <h3>💶 Zahlungen</h3>
          {st.finanzen?.bezahlt != null && (
            <div className="row">
              <span className="grow">Bereits bezahlt</span>
              <span className="amount" style={{ color: 'var(--emerald-hi)' }}>{fmtEuro(st.finanzen.bezahlt)}</span>
            </div>
          )}
          {(st.finanzen?.posten || []).map(p => (
            <div className="row" key={p.id || p.label}>
              <span className="grow">{p.label}</span>
              <span className="amount" style={{ color: 'var(--amber)' }}>{fmtEuro(p.betrag)}</span>
              <button className="mini-btn ok" onClick={() => payPosten(p.id)}>Bezahlt</button>
            </div>
          ))}
          {!(st.finanzen?.posten || []).length && (
            <div className="row"><span className="grow">Keine offenen Posten</span><span className="chipst ok">Alles bezahlt</span></div>
          )}
          <div className="fin-total">
            <span>Offen gesamt</span>
            <span style={{ color: off > 0 ? 'var(--amber)' : 'var(--emerald-hi)' }}>{fmtEuro(off)}</span>
          </div>
          <div className="fin-add">
            <input ref={labelRef} placeholder="Neuer Posten (z. B. Fahrstunden Juli)" />
            <input ref={betragRef} type="number" min="1" step="5" placeholder="€" style={{ maxWidth: 76 }} />
            <button className="mini-btn" onClick={addPosten}>＋</button>
          </div>
        </div>

        <div className="panel">
          <h3>📋 Nachweise</h3>
          {Object.entries(DOC_LABELS).map(([k, label]) => {
            const d = st.dokumente?.[k] || { status: 'ausstehend' }
            return (
              <div className="row" key={k}>
                <span className="grow">{label}</span>
                {d.thumb && <img className="doc-thumb" src={d.thumb} alt={label} />}
                {d.status === 'verifiziert'
                  ? <span className="chipst ok">Verifiziert</span>
                  : d.status === 'pruefung'
                    ? <span className="chipst warn">Eingereicht</span>
                    : <span className="chipst bad">Fehlt</span>}
                {d.status !== 'verifiziert'
                  ? <button className="mini-btn ok" onClick={() => setDoc(k, 'verifiziert')}>Verifizieren</button>
                  : <button className="mini-btn" onClick={() => setDoc(k, 'ausstehend')}>Zurücksetzen</button>}
              </div>
            )
          })}
        </div>

        <div className="panel">
          <h3>🗓️ Wunschzeiten × Dienstplan {fl.name}</h3>
          <div className="wk-chips">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <button key={i} className={i === week ? 'chip active' : 'chip'} onClick={() => setWeek(i)}>Wo {i + 1}</button>
            ))}
          </div>
          <div className="avail-grid">
            <div className="ah" />
            {[1, 2, 3, 4, 5, 6].map(d => <div className="ah" key={d}>{DAY_LABELS[d]}</div>)}
            {PERIODS.map(p => [
              <div className="ah" key={p} style={{ textAlign: 'right', paddingRight: 4 }}>{PERIOD_LABELS[p]}</div>,
              ...[1, 2, 3, 4, 5, 6].map(d => {
                const wish = !!(verf[d] && verf[d][p])
                const plan = !!(fl.plan[d] && fl.plan[d][p])
                const cls = wish && plan ? 'avail-cell match' : wish ? 'avail-cell wish' : 'avail-cell'
                return <div className={cls} key={`${p}-${d}`}>{wish && plan ? '✓' : wish ? '·' : ''}</div>
              }),
            ])}
          </div>
        </div>
      </div>
    </>
  )
}
