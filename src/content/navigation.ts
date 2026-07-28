import { classesByCategory, categories, classCategoryOrder } from './classes'
import { serviceGroupOrder, serviceGroups, servicesByGroup } from './services'

export interface NavLink {
  readonly href: string
  readonly label: string
  readonly hint?: string
}

export interface NavColumn {
  readonly title: string
  readonly blurb?: string
  readonly links: readonly NavLink[]
}

export interface NavSection {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly columns?: readonly NavColumn[]
  readonly feature?: { readonly title: string; readonly body: string; readonly href: string; readonly cta: string }
}

const classColumns: NavColumn[] = classCategoryOrder.map((category) => ({
  title: categories[category].label,
  blurb: categories[category].blurb,
  links: classesByCategory(category).map((c) => ({
    href: `/fuehrerschein/${c.slug}`,
    label: c.name,
    hint: c.tagline,
  })),
}))

const serviceColumns: NavColumn[] = serviceGroupOrder.map((group) => ({
  title: serviceGroups[group].label,
  blurb: serviceGroups[group].blurb,
  links: servicesByGroup(group).map((s) => ({
    href: `/leistungen/${s.slug}`,
    label: s.name,
    hint: s.tagline,
  })),
}))

export const navigation: readonly NavSection[] = [
  {
    id: 'fuehrerschein',
    label: 'Führerschein',
    href: '/fuehrerschein',
    columns: classColumns,
    feature: {
      title: 'Du weißt noch nicht, welche Klasse?',
      body: 'Sechs kurze Fragen, und du weißt, welche Klasse zu dir passt und was als Nächstes zu tun ist.',
      href: '/fuehrerschein#finder',
      cta: 'Führerschein finden',
    },
  },
  {
    id: 'leistungen',
    label: 'Beruf & Seminare',
    href: '/leistungen',
    columns: serviceColumns,
    feature: {
      title: 'Angebote für Unternehmen',
      body: 'Berufskraftfahrer-Qualifikation, Weiterbildungsmodule, ADR, Ladungssicherung und Staplerschein — auch für ganze Teams.',
      href: '/leistungen',
      cta: 'Übersicht ansehen',
    },
  },
  {
    id: 'ausbildung',
    label: 'Ausbildung',
    href: '/ausbildungsablauf',
    columns: [
      {
        title: 'So läuft es ab',
        links: [
          { href: '/ausbildungsablauf', label: 'Ausbildungsablauf', hint: 'Von der Beratung bis zum Führerschein' },
          { href: '/digitalpaket', label: 'Digitalpaket', hint: 'Wie Theorie, Simulator und Praxis zusammenspielen' },
          { href: '/simulator', label: 'Simulator', hint: 'Üben, bevor es in den Verkehr geht' },
          { href: '/schueler-cockpit', label: 'Schüler-Cockpit', hint: 'Dein Ausbildungsstand auf einen Blick' },
        ],
      },
      {
        title: 'Kosten',
        links: [
          { href: '/preise', label: 'Preise und Kostenrechner', hint: 'Angebote fair vergleichen' },
        ],
      },
    ],
  },
  {
    id: 'fahrschule',
    label: 'Fahrschule',
    href: '/standorte/fulda',
    columns: [
      {
        title: 'Standorte',
        links: [
          { href: '/standorte/fulda', label: 'Fulda', hint: 'Am Bahnhof 3' },
          { href: '/standorte/bad-hersfeld', label: 'Bad Hersfeld', hint: 'Direkt am Bahnhof' },
        ],
      },
      {
        title: 'Über uns',
        links: [
          { href: '/team', label: 'Team und Fahrzeuge', hint: 'Wer hier unterrichtet' },
          { href: '/kontakt', label: 'Kontakt', hint: 'Beratung und Voranmeldung' },
        ],
      },
    ],
  },
]

export const footerLinks: readonly NavColumn[] = [
  {
    title: 'Führerschein',
    links: [
      { href: '/fuehrerschein/klasse-b', label: 'Klasse B' },
      { href: '/fuehrerschein/bf17', label: 'Begleitetes Fahren ab 17' },
      { href: '/fuehrerschein/b197', label: 'B197' },
      { href: '/fuehrerschein/be', label: 'Anhänger BE' },
      { href: '/fuehrerschein/a', label: 'Motorrad' },
      { href: '/fuehrerschein/ce', label: 'LKW CE' },
      { href: '/fuehrerschein/d', label: 'Bus D' },
      { href: '/fuehrerschein', label: 'Alle Klassen' },
    ],
  },
  {
    title: 'Beruf & Seminare',
    links: [
      { href: '/leistungen/berufskraftfahrer', label: 'Berufskraftfahrer' },
      { href: '/leistungen/bkf-weiterbildung', label: 'BKF-Weiterbildung' },
      { href: '/leistungen/adr', label: 'Gefahrgut ADR' },
      { href: '/leistungen/staplerschein', label: 'Staplerschein' },
      { href: '/leistungen/asf', label: 'ASF-Seminar' },
      { href: '/leistungen/fes', label: 'Fahreignungsseminar' },
      { href: '/leistungen/handicap', label: 'Handicap-Ausbildung' },
    ],
  },
  {
    title: 'Ausbildung',
    links: [
      { href: '/ausbildungsablauf', label: 'Ausbildungsablauf' },
      { href: '/digitalpaket', label: 'Digitalpaket' },
      { href: '/simulator', label: 'Simulator' },
      { href: '/schueler-cockpit', label: 'Schüler-Cockpit' },
      { href: '/preise', label: 'Preise' },
    ],
  },
  {
    title: 'Fahrschule',
    links: [
      { href: '/standorte/fulda', label: 'Standort Fulda' },
      { href: '/standorte/bad-hersfeld', label: 'Standort Bad Hersfeld' },
      { href: '/team', label: 'Team' },
      { href: '/kontakt', label: 'Kontakt' },
    ],
  },
]

export const legalLinks: readonly NavLink[] = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/datenschutz', label: 'Datenschutz' },
]
