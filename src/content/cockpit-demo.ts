/**
 * Demo data for the Schüler-Cockpit showcase.
 *
 * Every figure here is invented for illustration — no real student data is
 * used, and the UI labels the whole chapter as a demonstration. The *rules*
 * behind it, however, are the genuine ones the driving school works to:
 *
 *   · 12 Doppelstunden Grundstoff, reduced to 6 with an existing licence
 *   · Sonderfahrten for class B: 5 Überland, 4 Autobahn, 3 Nacht
 *   · Simulator units before the first lessons in real traffic
 *   · Basic training completed before Sonderfahrten begin
 *   · Documents and open invoices gate the exam registration
 *
 * "PrüfungsReady" is therefore an explainable checklist, never a predicted
 * probability of passing.
 */

export type StepState = 'done' | 'active' | 'open'

export interface CockpitStep {
  readonly id: string
  readonly label: string
  readonly state: StepState
  readonly detail: string
}

export interface CockpitState {
  readonly id: string
  readonly tab: string
  readonly title: string
  readonly narrative: string
  readonly bullets: readonly string[]
}

export const demoStudent = {
  greeting: 'Hallo Lena',
  classCode: 'B',
  trainingType: 'B197',
  location: 'Fulda',
  instructor: 'Fahrlehrer M.',
} as const

export const trainingSteps: readonly CockpitStep[] = [
  { id: 'anmeldung', label: 'Anmeldung', state: 'done', detail: 'Abgeschlossen' },
  { id: 'unterlagen', label: 'Unterlagen', state: 'done', detail: 'Vollständig' },
  { id: 'theorie', label: 'Theorieunterricht', state: 'done', detail: '14 von 14 Doppelstunden' },
  { id: 'theoriepruefung', label: 'Theorieprüfung', state: 'done', detail: 'Bestanden' },
  { id: 'simulator', label: 'Simulator', state: 'done', detail: 'Abgeschlossen' },
  { id: 'uebungsfahrten', label: 'Übungsfahrten', state: 'done', detail: 'Grundausbildung abgeschlossen' },
  { id: 'sonderfahrten', label: 'Sonderfahrten', state: 'active', detail: '9 von 12 absolviert' },
  { id: 'freigabe', label: 'Freigabe zur Prüfung', state: 'open', detail: 'Durch die Fahrschule' },
  { id: 'praxispruefung', label: 'Praktische Prüfung', state: 'open', detail: 'Noch kein Termin' },
]

export const sonderfahrtenProgress = [
  { label: 'Überlandfahrten', done: 5, required: 5 },
  { label: 'Autobahnfahrten', done: 3, required: 4 },
  { label: 'Nachtfahrten', done: 1, required: 3 },
] as const

export const documents = [
  { label: 'Sehtest', state: 'done' as const, detail: 'Geprüft' },
  { label: 'Erste Hilfe', state: 'done' as const, detail: 'Geprüft' },
  { label: 'Passbild', state: 'done' as const, detail: 'Geprüft' },
  { label: 'Antrag bei der Behörde', state: 'active' as const, detail: 'Genehmigt' },
]

export const readinessChecks = [
  { label: 'Theorieprüfung bestanden', ok: true },
  { label: 'Unterlagen vollständig', ok: true },
  { label: 'Keine offenen Rechnungen', ok: true },
  { label: 'Alle Sonderfahrten absolviert', ok: false, missing: '3 Fahrten offen' },
  { label: 'Freigabe der Fahrschule', ok: false, missing: 'Erfolgt nach den Sonderfahrten' },
]

export const cockpitStates: readonly CockpitState[] = [
  {
    id: 'heute',
    tab: 'Heute',
    title: 'Was heute ansteht',
    narrative:
      'Statt „Wie weit bin ich eigentlich?" beginnt der Tag mit einer klaren Antwort: der nächste Termin, die nächste offene Aufgabe, der aktuelle Stand.',
    bullets: ['Nächster Termin und Treffpunkt', 'Eine konkrete nächste Aufgabe', 'Fortschritt auf einen Blick'],
  },
  {
    id: 'ausbildung',
    tab: 'Ausbildung',
    title: 'Der ganze Weg auf einen Blick',
    narrative:
      'Die Ausbildung ist keine Blackbox. Jede Station — von der Anmeldung bis zur praktischen Prüfung — ist sichtbar, mit dem Stand, an dem sie gerade steht.',
    bullets: ['Neun Stationen von der Anmeldung bis zur Prüfung', 'Erledigt, läuft, offen', 'Keine Nachfragen im Büro nötig'],
  },
  {
    id: 'praxis',
    tab: 'Praxis',
    title: 'Rückmeldung nach jeder Fahrstunde',
    narrative:
      'Nach der Fahrstunde bleibt oft nur ein Gefühl. Hier steht, was gut lief, woran ihr arbeitet und was das Ziel der nächsten Stunde ist — in Worten, nicht in Noten.',
    bullets: ['Das lief gut', 'Daran arbeiten wir', 'Ziel der nächsten Fahrstunde'],
  },
  {
    id: 'sonderfahrten',
    tab: 'Sonderfahrten',
    title: 'Pflichtfahrten, exakt gezählt',
    narrative:
      'Überland, Autobahn und Nacht sind gesetzlich vorgeschrieben und nicht verhandelbar. Wie viele noch fehlen, muss niemand schätzen.',
    bullets: ['Fünf Überlandfahrten', 'Vier Autobahnfahrten', 'Drei Nachtfahrten'],
  },
  {
    id: 'dokumente',
    tab: 'Unterlagen',
    title: 'Papierkram ohne Rückfragen',
    narrative:
      'Sehtest, Erste Hilfe, Passbild, Antrag bei der Behörde: Jedes Dokument hat einen Status. Wer etwas nachreichen muss, sieht es sofort — und wer nichts tun muss, auch.',
    bullets: ['Status je Dokument', 'Offene Beträge transparent', 'Kein Stapel im Büro'],
  },
  {
    id: 'pruefungsready',
    tab: 'PrüfungsReady',
    title: 'Bereit — und zwar nachvollziehbar',
    narrative:
      'Kein Prozentwert, keine Prognose. Eine Liste von Bedingungen, die erfüllt sein müssen, und die Freigabe kommt am Ende von einem Menschen, nicht von einem Algorithmus.',
    bullets: ['Was erfüllt ist', 'Was noch fehlt', 'Wer die Freigabe erteilt'],
  },
]
