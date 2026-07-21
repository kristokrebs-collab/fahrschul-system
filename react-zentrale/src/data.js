const P = (v, n, a) => ({ vormittag: !!v, nachmittag: !!n, abend: !!a })

export const INSTRUCTORS = [
  { id: 'FL-01', name: 'Björn Eifert', klassen: ['B', 'BE', 'C', 'CE', 'T'], extra: 'Dozent',
    plan: { 1: P(1, 1, 0), 2: P(1, 0, 1), 3: P(0, 1, 1), 4: P(1, 1, 0), 5: P(1, 0, 0), 6: P(1, 0, 0) } },
  { id: 'FL-02', name: 'Bertram Feulner', klassen: ['A', 'B', 'BE', 'C', 'CE', 'T'], extra: '',
    plan: { 1: P(0, 1, 1), 2: P(1, 1, 0), 3: P(1, 0, 0), 4: P(0, 1, 1), 5: P(1, 1, 0), 6: P(0, 0, 0) } },
  { id: 'FL-03', name: 'Christian Ricken', klassen: ['B', 'BE'], extra: '',
    plan: { 1: P(1, 0, 0), 2: P(1, 1, 0), 3: P(1, 1, 0), 4: P(1, 0, 1), 5: P(0, 1, 1), 6: P(1, 0, 0) } },
  { id: 'FL-04', name: 'Enis Alijoski', klassen: ['B', 'BE'], extra: '',
    plan: { 1: P(0, 1, 1), 2: P(0, 1, 1), 3: P(1, 1, 0), 4: P(1, 0, 0), 5: P(1, 1, 0), 6: P(0, 1, 0) } },
  { id: 'FL-05', name: 'Harald Manger', klassen: ['A', 'B', 'BE'], extra: 'Handicap-Ausbildung',
    plan: { 1: P(1, 1, 0), 2: P(1, 0, 0), 3: P(0, 1, 1), 4: P(1, 1, 0), 5: P(1, 0, 1), 6: P(0, 0, 0) } },
  { id: 'FL-06', name: 'Sabine Krautwald', klassen: ['B', 'BE'], extra: '',
    plan: { 1: P(1, 0, 1), 2: P(1, 1, 0), 3: P(1, 0, 0), 4: P(0, 1, 1), 5: P(1, 1, 0), 6: P(1, 0, 0) } },
  { id: 'FL-07', name: 'Markus Dehler', klassen: ['B'], extra: 'Automatik-Spezialist',
    plan: { 1: P(0, 1, 0), 2: P(1, 1, 1), 3: P(1, 1, 0), 4: P(1, 0, 0), 5: P(0, 1, 1), 6: P(0, 0, 0) } },
  { id: 'FL-08', name: 'Jutta Simon', klassen: ['B'], extra: '',
    plan: { 1: P(1, 1, 0), 2: P(0, 0, 1), 3: P(1, 1, 0), 4: P(1, 1, 0), 5: P(1, 0, 0), 6: P(1, 1, 0) } },
  { id: 'FL-09', name: 'Peter Wingenfeld', klassen: ['B', 'C', 'CE'], extra: '',
    plan: { 1: P(1, 0, 0), 2: P(1, 1, 0), 3: P(0, 1, 1), 4: P(1, 1, 0), 5: P(1, 1, 0), 6: P(0, 0, 0) } },
  { id: 'FL-10', name: 'Miriam Otto', klassen: ['A', 'B'], extra: '',
    plan: { 1: P(0, 1, 1), 2: P(1, 0, 1), 3: P(1, 1, 0), 4: P(0, 1, 0), 5: P(1, 1, 0), 6: P(1, 0, 0) } },
  { id: 'FL-11', name: 'Timo Baumgart', klassen: ['B', 'BE', 'T'], extra: '',
    plan: { 1: P(1, 1, 0), 2: P(1, 1, 0), 3: P(1, 0, 0), 4: P(1, 0, 1), 5: P(0, 1, 1), 6: P(0, 1, 0) } },
  { id: 'FL-12', name: 'Karin Möller', klassen: ['B'], extra: '',
    plan: { 1: P(1, 0, 1), 2: P(0, 1, 0), 3: P(1, 1, 0), 4: P(1, 1, 0), 5: P(1, 0, 0), 6: P(1, 0, 0) } },
  { id: 'FL-13', name: 'Stefan Hohmann', klassen: ['B', 'BE', 'C'], extra: '',
    plan: { 1: P(0, 1, 1), 2: P(1, 1, 0), 3: P(1, 0, 1), 4: P(0, 1, 0), 5: P(1, 1, 0), 6: P(0, 0, 0) } },
  { id: 'FL-14', name: 'Aylin Kaya', klassen: ['A', 'B'], extra: '',
    plan: { 1: P(1, 1, 0), 2: P(1, 0, 0), 3: P(0, 1, 1), 4: P(1, 1, 0), 5: P(0, 1, 1), 6: P(1, 0, 0) } },
  { id: 'FL-15', name: 'Dominik Frank', klassen: ['B', 'BE'], extra: '',
    plan: { 1: P(1, 0, 0), 2: P(0, 1, 1), 3: P(1, 1, 0), 4: P(1, 0, 1), 5: P(1, 1, 0), 6: P(1, 1, 0) } },
]

export const DAY_LABELS = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa' }
export const PERIODS = ['vormittag', 'nachmittag', 'abend']
export const PERIOD_LABELS = { vormittag: 'Vorm.', nachmittag: 'Nachm.', abend: 'Abend' }
export const DOC_LABELS = { sehtest: 'Sehtest', ersteHilfe: 'Erste-Hilfe-Kurs', passbild: 'Passbild' }

export function baseKlasse(k) {
  if (k === 'B197') return 'B'
  if (k === 'A1' || k === 'A2' || k === 'AM') return 'A'
  return k
}
export function canTeach(fl, klasse) { return fl.klassen.includes(baseKlasse(klasse)) }
export function flById(id) { return INSTRUCTORS.find(f => f.id === id) || null }
export function instructorOf(st) { return flById(st.fahrlehrerId) || INSTRUCTORS[0] }

export function offen(st) { return (st.finanzen?.posten || []).reduce((a, p) => a + p.betrag, 0) }
export function theorieP(st) { return st.theorie?.gesamt ? Math.min(1, st.theorie.besucht / st.theorie.gesamt) : 1 }
export function praxisP(st) {
  const sf = st.sonderfahrten || {}
  const g = k => sf[k] || { ist: 0, soll: 0 }
  const ist = g('ueberland').ist + g('autobahn').ist + g('nacht').ist + (st.simulator?.ist || 0)
  const soll = g('ueberland').soll + g('autobahn').soll + g('nacht').soll + (st.simulator?.soll || 0)
  return soll ? Math.min(1, ist / soll) : 1
}
export function missingDocs(st) {
  return Object.keys(DOC_LABELS).filter(k => st.dokumente?.[k]?.status !== 'verifiziert')
}

/* Gesamt-Prüfungsreife – identisches Modell wie Variante 1:
   Theorie 30 · Fahrpraxis 25 · Sonderfahrten/Sim 25 · Nachweise 10 · Finanzen 10 */
export function readinessOf(st) {
  const theorie = st.theorie?.gesamt > 0
    ? 0.75 * theorieP(st) + 0.25 * (st.theoriePruefung?.bestanden ? 1 : 0)
    : 1
  const praxis = Math.min(1, (st.uebungsstunden || 0) / 20)
  const sonder = praxisP(st)
  const docs = (3 - missingDocs(st).length) / 3
  const off = offen(st), paid = st.finanzen?.bezahlt || 0
  const fin = off <= 0 ? 1 : (paid + off > 0 ? paid / (paid + off) : 0)
  const pct = Math.round(100 * (0.30 * theorie + 0.25 * praxis + 0.25 * sonder + 0.10 * docs + 0.10 * fin))
  const color = pct < 40 ? 'var(--accent-hi)' : pct < 75 ? 'var(--amber)' : 'var(--emerald-hi)'
  const verdict = pct < 40 ? 'Am Anfang' : pct < 75 ? 'Auf Kurs' : pct < 100 ? 'Fast prüfungsreif' : 'Prüfungsreif'
  return {
    pct, color, verdict,
    parts: [
      { l: 'Theorie', v: theorie }, { l: 'Fahrpraxis', v: praxis }, { l: 'Sonderfahrten', v: sonder },
      { l: 'Nachweise', v: docs }, { l: 'Finanzen', v: fin },
    ],
  }
}

export const fmtEuro = n => {
  try { return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) }
  catch { return n.toFixed(2).replace('.', ',') + ' €' }
}
export const fmtDate = iso => {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
      + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
  } catch { return '' }
}
export const initials = name => {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  return p.length ? ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : p[0][1] || '')).toUpperCase() : '–'
}
