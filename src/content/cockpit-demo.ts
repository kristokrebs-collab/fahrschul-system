/**
 * Content model for the Cockpit showcase — reconstructed from screenshots of
 * the real "Fahrschule Krebs Cockpit" app prototype (docs/app-reference/).
 *
 * Everything below mirrors the actual product: its section names (EBENE A /
 * FAHRSTIL / PROTOKOLL), its wording ("Besuchte Pflichtthemen", "empfohlene
 * Einheiten", "Bewertung des Fahrlehrers", "automatisch geführt"), its demo
 * identity ("Hallo, Michael." · Klasse B · Erst-Erwerb · Herr Schäfer) and its
 * figures (11/14 theory topics, Sonderfahrten 3/5 · 2/4 · 0/3, 22 practice
 * hours, simulator 5/6, 73 % Prüfungsreife, 17 units / 26,3 h history).
 *
 * The Prüfungsreife ring is the *instructor's* running assessment — the real
 * app labels it "Bewertung des Fahrlehrers", and so do we. It is not an
 * algorithmic pass prediction, and the copy must never present it as one.
 */

export const appIdentity = {
  appName: 'Cockpit',
  brand: 'Fahrschule Krebs',
  greetingSmall: 'Willkommen zurück',
  greeting: 'Hallo, Michael.',
  initials: 'MK',
  chips: ['Klasse B', 'Erst-Erwerb', 'Herr Schäfer'],
} as const

export const theory = {
  title: 'Theorieunterricht',
  metric: 'Besuchte Pflichtthemen',
  done: 11,
  required: 14,
} as const

export const sonderfahrten = [
  { key: 'ueberland', label: 'Überland', done: 3, required: 5 },
  { key: 'autobahn', label: 'Autobahn', done: 2, required: 4 },
  { key: 'nacht', label: 'Nacht', done: 0, required: 3 },
] as const

export const practice = {
  hours: 22,
  hoursLabel: 'reguläre Fahrten absolviert',
  simulatorDone: 5,
  simulatorRequired: 6,
  simulatorLabel: 'empfohlene Einheiten',
  simulatorCta: 'Platz wählen',
} as const

export const fahrstil = {
  section: 'Fahrstil',
  title: 'Bewertung des Fahrlehrers',
  cadence: 'nach jeder Fahrstunde',
  readiness: 73,
  readinessLabel: 'Prüfungsreife',
  note: 'Solide Fortschritte – dranbleiben',
  skills: [
    { label: 'Vorausschauendes Fahren', score: 4 },
    { label: 'Kupplung & Schaltung', score: 3 },
    { label: 'Parken & Rangieren', score: 4 },
  ],
} as const

export const protokoll = {
  section: 'Protokoll',
  title: 'Deine Historie',
  cadence: 'automatisch geführt',
  tabs: ['Fahrstunden', 'Theorie'],
  stats: ['17 Einheiten', '26,3 Std. gesamt'],
  entries: [
    {
      kind: 'Übungsfahrt',
      detail: 'Prüfungsstrecken-Training Fulda',
      date: 'Mi, 15.07.',
      time: '15:00–16:30 Uhr',
      instructor: 'Herr Schäfer',
      duration: '90 min',
    },
    {
      kind: 'Autobahnfahrt',
      detail: 'A7 / A66 – Auffahren, Überholen, Abstand halten',
      date: 'Mo, 13.07.',
      time: '10:00–11:30 Uhr',
      instructor: 'Herr Schäfer',
      duration: '90 min',
    },
    {
      kind: 'Überlandfahrt',
      detail: 'Landstraßen & Ortsdurchfahrten in der Rhön',
      date: 'Do, 09.07.',
      time: '14:00–16:15 Uhr',
      instructor: 'Herr Schäfer',
      duration: '135 min',
    },
  ],
} as const

/**
 * The training route milestones as the app's onboarding presents them —
 * used by the scroll narrative to show where the demo student stands.
 */
export const routeMilestones = [
  { label: 'Anmeldung', state: 'done' },
  { label: 'Unterlagen', state: 'done' },
  { label: 'Theorie', state: 'active' },
  { label: 'Theorieprüfung', state: 'open' },
  { label: 'Simulator', state: 'active' },
  { label: 'Übungsfahrten', state: 'active' },
  { label: 'Sonderfahrten', state: 'active' },
  { label: 'Prüfungsreife', state: 'open' },
  { label: 'Praxisprüfung', state: 'open' },
] as const

/** The narrative beats of the scroll sequence, in order. */
export interface CockpitScene {
  readonly id: 'entry' | 'fortschritt' | 'fahrstil' | 'protokoll' | 'finale'
  readonly eyebrow: string
  readonly title: string
  readonly body: string
  readonly bullets: readonly string[]
}

export const cockpitScenes: readonly CockpitScene[] = [
  {
    id: 'entry',
    eyebrow: 'Die echte App',
    title: 'Dein Cockpit macht auf',
    body:
      'Kein Rätselraten mehr, wo du stehst. Das Cockpit begrüßt dich mit deinem Stand — Klasse, Ausbildungsart und wer dich unterrichtet.',
    bullets: ['Persönlicher Stand beim Öffnen', 'Klasse, Ausbildungsart, Fahrlehrer', 'Ein Blick statt Nachfragen'],
  },
  {
    id: 'fortschritt',
    eyebrow: 'Ebene A — Fortschritt',
    title: 'Jede Pflicht, exakt gezählt',
    body:
      'Theoriethemen, gesetzliche Sonderfahrten, Übungsstunden, Simulatoreinheiten: Das Cockpit zählt mit — du siehst live, was erledigt ist und was noch fehlt.',
    bullets: ['Besuchte Pflichtthemen im Soll-Ist-Vergleich', 'Überland, Autobahn, Nacht einzeln gezählt', 'Simulatorplatz direkt aus der App wählen'],
  },
  {
    id: 'fahrstil',
    eyebrow: 'Fahrstil — nach jeder Fahrstunde',
    title: 'Deine Fahrlehrerin bewertet, du siehst es',
    body:
      'Nach jeder Fahrstunde fließt die Einschätzung ein: Vorausschau, Kupplung und Schaltung, Parken und Rangieren. Die Prüfungsreife ist die Bewertung deines Fahrlehrers — kein Algorithmus, ein Mensch.',
    bullets: ['Bewertung nach jeder Fahrstunde', 'Stärken und Baustellen benannt', 'Prüfungsreife als ehrliche Einschätzung'],
  },
  {
    id: 'protokoll',
    eyebrow: 'Protokoll — automatisch geführt',
    title: 'Deine Historie schreibt sich selbst',
    body:
      'Jede Fahrt, jede Theoriestunde, jede Strecke: automatisch protokolliert, mit Datum, Dauer und Inhalt. Prüfungsstrecken-Training in Fulda, Autobahnfahrten auf A7 und A66 — alles nachlesbar.',
    bullets: ['Jede Einheit mit Datum und Dauer', 'Echte Strecken, echte Inhalte', 'Gesamtstunden immer aktuell'],
  },
  {
    id: 'finale',
    eyebrow: 'Ein System',
    title: 'Und alles greift ineinander',
    body:
      'Theorie, Simulator, Fahrstunden, Bewertung, Protokoll — das Cockpit verbindet sie zu einem Weg. Deinem Weg zur Prüfung.',
    bullets: ['Ein Stand statt fünf Zettel', 'Nächster Schritt immer sichtbar', 'Vom ersten Tag bis zur Prüfung'],
  },
]
