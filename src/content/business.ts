import { fact, type Fact } from './truth'

/**
 * Single source of truth for company and location data.
 * No address, phone number or opening time may be written anywhere else.
 *
 * Sources and the reasoning behind every confidence level are documented in
 * docs/business-truth.md and docs/truth-conflicts.md. Anything not at least
 * `likely` is withheld from the rendered page by `publicValue()`.
 */

const REVIEWED = '2026-07-27'

const OWN_SITE = 'fulda.fahrschule-krebs.de (Impressum, Historie, Team, Theorie) und fahrschule-krebs.de'
const IMPRESSUM = 'fulda.fahrschule-krebs.de/impressum/'

export interface OfficeHours {
  readonly days: string
  readonly hours: string
}

export interface TheorySlot {
  readonly label: string
  readonly detail: string
}

export interface Location {
  readonly slug: string
  readonly name: string
  readonly city: string
  readonly street: Fact<string>
  readonly postalCode: Fact<string>
  readonly phone: Fact<string>
  readonly phoneHref: Fact<string>
  readonly email: Fact<string>
  readonly officeHours: Fact<readonly OfficeHours[]>
  readonly theorySchedule: Fact<readonly TheorySlot[]>
  readonly theoryNote: string
  readonly gettingHere: readonly string[]
  readonly intro: string
  readonly highlights: readonly string[]
  readonly focus: Fact<string>
}

export const locations: readonly Location[] = [
  {
    slug: 'fulda',
    name: 'Fulda',
    city: 'Fulda',
    street: fact('Am Bahnhof 3', `${IMPRESSUM}; übereinstimmend in Gelbe Seiten, 11880 und der Bahnhofsseite der Deutschen Bahn`, REVIEWED, 'confirmed'),
    postalCode: fact('36037', IMPRESSUM, REVIEWED, 'confirmed'),
    phone: fact('0661 22670', `${OWN_SITE}; Gelbe Seiten; 11880`, REVIEWED, 'confirmed'),
    phoneHref: fact('+4966122670', 'abgeleitet aus der bestätigten Rufnummer', REVIEWED, 'confirmed'),
    email: fact('info@fahrschule-krebs.de', `${OWN_SITE} (Theorie-Seite)`, REVIEWED, 'confirmed', 'Gemeinsames Postfach beider Standorte.'),
    officeHours: fact(
      [
        { days: 'Montag bis Donnerstag', hours: '09:00 – 18:00 Uhr' },
        { days: 'Freitag', hours: '09:00 – 17:00 Uhr' },
        { days: 'Samstag', hours: 'geschlossen' },
      ],
      'Eigene Website (Theorie-Seite), bestätigt durch Gelbe Seiten',
      REVIEWED,
      'likely',
      'Mehrere Branchenverzeichnisse nennen abweichend Mo–Fr 09–18 und Sa 10–14. Die Angabe der eigenen Website hat Vorrang, sollte aber bestätigt werden.',
    ),
    theorySchedule: fact(
      [
        { label: 'Grundstoff und Klasse B', detail: 'Montag bis Donnerstag, drei verschiedene Themen pro Tag' },
        { label: 'LKW-Theorie', detail: 'Montag und Donnerstag, 16:30 – 19:30 Uhr (zwei Unterrichtseinheiten)' },
        { label: 'Motorrad-Theorie', detail: 'Mittwoch alle zwei Wochen, 16:30 – 19:30 Uhr (zwei Unterrichtseinheiten)' },
      ],
      'Eigene Website, Theorie-Seite',
      REVIEWED,
      'likely',
      'Die genauen Uhrzeiten der Grundstoff-Termine liegen in drei widersprüchlichen Fassungen vor und werden deshalb nicht veröffentlicht. Struktur, LKW- und Motorradzeiten sind stabil belegt.',
    ),
    theoryNote:
      'Für alle Klassen ist eine Anmeldung zum Theorieunterricht erforderlich. Pro Tag sind höchstens zwei Unterrichtseinheiten möglich.',
    gettingHere: [
      'Direkt am Bahnhof Fulda — mit ICE, Regionalzug und Stadtbus in wenigen Minuten erreichbar.',
      'Aus dem Umland über die A7 und die B27 angebunden.',
      'Übungsplatz „Werk 2" in der Bellingerstraße für Rangier- und Grundfahraufgaben.',
    ],
    intro:
      'Der Hauptsitz liegt direkt am Bahnhof Fulda. Hier laufen Theorieunterricht, Simulatortraining und die Ausbildung bis hinauf zu LKW und Bus zusammen.',
    highlights: ['Alle Klassen vom Roller bis zum Bus', 'Simulatortraining vor Ort', 'Direkt am ICE-Bahnhof'],
    focus: fact('Alle Klassen: Zweirad, PKW, Anhänger, LKW, Bus und Traktor', OWN_SITE, REVIEWED, 'likely'),
  },
  {
    slug: 'bad-hersfeld',
    name: 'Bad Hersfeld',
    city: 'Bad Hersfeld',
    street: fact(
      'Bahnhofstraße 18A',
      'Eigene Website (Bad-Hersfeld-Seite) und eigene Facebook-Seite der Filiale — dort beschrieben als „in der alten Güterabfertigung"',
      REVIEWED,
      'likely',
      'Mehrere Branchenverzeichnisse nennen Bahnhofstraße 20. Beide Adressen liegen nebeneinander am Bahnhof; die Angabe des Unternehmens selbst hat Vorrang. Vor der Veröffentlichung bestätigen lassen.',
    ),
    postalCode: fact('36251', 'Übereinstimmend in allen Quellen', REVIEWED, 'confirmed'),
    phone: fact('06621 7991929', 'Übereinstimmend in mehreren Verzeichnissen', REVIEWED, 'likely', 'Nicht auf einer eindeutig unternehmenseigenen Seite bestätigt.'),
    phoneHref: fact('+4966217991929', 'abgeleitet aus der Rufnummer', REVIEWED, 'likely'),
    email: fact('info@fahrschule-krebs.de', `${OWN_SITE}`, REVIEWED, 'confirmed', 'Gemeinsames Postfach beider Standorte.'),
    officeHours: fact(
      [],
      'Zwei widersprüchliche Angaben: Di–Do 16:15–17:00 Uhr gegenüber Di–Do 15:00–18:00 Uhr',
      REVIEWED,
      'conflicting',
      'Bürozeiten Bad Hersfeld bestätigen. Einigkeit besteht nur darin, dass das Büro dienstags bis donnerstags nachmittags besetzt ist.',
    ),
    theorySchedule: fact(
      [
        { label: 'Theorieunterricht', detail: 'Dienstag, Mittwoch und Donnerstag, 17:00 – 18:30 und 18:30 – 20:00 Uhr' },
      ],
      'Eigene Website, Bad-Hersfeld-Seite — rechnerisch stimmig mit der unabhängig genannten Zahl von sechs Terminen pro Woche',
      REVIEWED,
      'likely',
    ),
    theoryNote: 'Sechs Theorietermine pro Woche. Eine Anmeldung ist erforderlich.',
    gettingHere: [
      'Direkt am Bahnhof Bad Hersfeld, in der alten Güterabfertigung.',
      'Über die A4 und die A7 aus dem gesamten Landkreis Hersfeld-Rotenburg erreichbar.',
    ],
    intro:
      'Die Filiale in Bad Hersfeld wurde 2009 eröffnet und liegt direkt am Bahnhof. Kurze Wege für alle, die aus dem Landkreis Hersfeld-Rotenburg kommen.',
    highlights: ['Sechs Theorietermine pro Woche', 'Direkt am Bahnhof', 'Schwerpunkt PKW und LKW'],
    focus: fact('Ausbildungsschwerpunkte PKW und LKW', 'Eigene Website, Historie-Seite', REVIEWED, 'likely'),
  },
]

export function locationBySlug(slug: string): Location | undefined {
  return locations.find((l) => l.slug === slug)
}

export const practiceGround = {
  name: 'Übungsplatz „Werk 2"',
  address: fact('Bellingerstraße 6, 36043 Fulda', 'Fahrschul-Lotse; Flächenangabe von der eigenen Ausbildungsseite', REVIEWED, 'likely'),
  size: fact('rund 2.000 m²', 'Eigene Website, Ausbildungsseite', REVIEWED, 'likely'),
  purpose: 'Eigener Abstell- und Übungsplatz für Grundfahraufgaben und Rangiertraining.',
} as const

export const business = {
  legalName: 'Fahrschule Krebs GmbH',
  shortName: 'Fahrschule Krebs',
  siteUrl: 'https://www.fahrschule-krebs.de',
  claim: 'Alle Klassen. Zwei Standorte. Ein Weg.',

  founded: fact(1964, 'Eigene Website, Historie-Seite', REVIEWED, 'confirmed', 'Ein Branchenverzeichnis nennt abweichend 1965; die eigene Seite hat Vorrang.'),
  founder: fact('Günter Krebs', 'Eigene Website, Historie-Seite', REVIEWED, 'confirmed'),
  successionYear: fact(1999, 'Eigene Website, Historie-Seite', REVIEWED, 'likely'),
  branchOpened: fact(2009, 'Eigene Website, Historie-Seite', REVIEWED, 'likely', 'Dort als „erste und einzige Filiale" beschrieben.'),
  generation: fact('zweite Generation', 'Eigene Website, Historie-Seite', REVIEWED, 'confirmed'),

  managingDirector: fact('Michael Krebs', IMPRESSUM, REVIEWED, 'confirmed'),
  register: fact('HRB 5374, Amtsgericht Fulda', IMPRESSUM, REVIEWED, 'confirmed'),
  vatId: fact('DE257818771', IMPRESSUM, REVIEWED, 'likely', 'Nur über einen Suchindex extrahiert. Vor der Veröffentlichung im Impressum am Original prüfen.'),
  supervisoryAuthority: fact('Regierungspräsidium Kassel', IMPRESSUM, REVIEWED, 'likely', 'Einzelquelle. Zuständige Aufsichtsbehörde nach Fahrlehrergesetz bestätigen.'),

  instructorTeam: fact(
    'rund 20 Fahrlehrerinnen und Fahrlehrer',
    'Eigene Team-Seite nennt 18, die Hauptseite „ca. 20" — vermutlich zwei Stände derselben Angabe',
    REVIEWED,
    'likely',
  ),
  instructorScope: fact('PKW, Motorrad, LKW und Bus', 'Eigene Team-Seite', REVIEWED, 'likely'),
  fleet: fact(
    ['Audi', 'BMW', 'Mercedes-Benz', 'Volkswagen'],
    'fahrschule-123; ergänzt durch die unternehmenseigene Angabe „eigene LKW und eigener Bus"',
    REVIEWED,
    'likely',
    'Keine belastbare Fahrzeuganzahl öffentlich verfügbar — es wird bewusst keine genannt.',
  ),
  fleetNote: fact(
    'Eigener Fuhrpark mit eigenen LKW und einem eigenen Bus. Alle Ausbildungsfahrzeuge außer der Klasse T auf aktuellem technischen Stand.',
    'Eigene Website, Ausbildungsseite',
    REVIEWED,
    'likely',
  ),

  /** Deliberately withheld — see docs/business-confirmations-needed.md */
  rating: fact(
    { score: 4.4, count: 82 },
    'ProvenExpert-Spiegelung einer anderen Quelle, Stand unbekannt',
    REVIEWED,
    'unverified',
    'Bewertungen werden nicht angezeigt, solange kein aktueller, direkt belegter Wert vorliegt.',
  ),
  sizeClaim: fact(
    'eine der größten Fahrschulen Deutschlands',
    'Selbstbeschreibung auf der eigenen Website',
    REVIEWED,
    'unverified',
    'Selbstaussage ohne unabhängigen Beleg — wird nicht als Tatsache veröffentlicht.',
  ),

  social: {
    facebookFulda: 'https://www.facebook.com/fahrschulekrebs/',
    instagram: 'https://www.instagram.com/fahrschulekrebs/',
  },
} as const

/** Years in business, computed rather than written down, so it never goes stale. */
export function yearsInBusiness(now = new Date()): number {
  return now.getFullYear() - business.founded.value
}
