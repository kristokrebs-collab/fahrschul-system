import { fact, type Fact } from './truth'

/**
 * The licence-class catalogue.
 *
 * Legal figures (minimum ages, compulsory theory, Sonderfahrten) live here as
 * dated facts and nowhere else. Every class page, the licence finder, the
 * training guide and the structured data read from this single table.
 */

const REVIEWED = '2026-07-27'
const FEV = 'Fahrerlaubnis-Verordnung (FeV) Anlage 7 / §§ 5–6, abgeglichen mit den Angaben von TÜV, DEKRA und Fahrlehrerverband'

export type ClassCategory = 'pkw' | 'zweirad' | 'lkw' | 'bus' | 'spezial'

export interface Sonderfahrten {
  readonly ueberland: number
  readonly autobahn: number
  readonly nacht: number
}

export interface TheoryRequirement {
  /** Doppelstunden à 90 Minuten */
  readonly grundstoff: number
  readonly zusatzstoff: number
  /** Grundstoff bei Vorbesitz einer anderen Klasse */
  readonly grundstoffMitVorbesitz?: number
}

export interface LicenceClass {
  readonly slug: string
  readonly code: string
  readonly name: string
  readonly category: ClassCategory
  /** Shown in the route system; lower sorts first. */
  readonly order: number
  readonly tagline: string
  readonly summary: string
  readonly minAge: Fact<string>
  readonly theory: Fact<TheoryRequirement> | null
  readonly sonderfahrten: Fact<Sonderfahrten> | null
  readonly allows: readonly string[]
  readonly prerequisites: readonly string[]
  readonly goodToKnow: readonly string[]
  readonly simulatorSupported: boolean
  readonly calculatorSupported: boolean
  readonly related: readonly string[]
  readonly seoTitle: string
  readonly seoDescription: string
}

/** Sonderfahrten are identical for every class in a group; declared once. */
const SF_B: Sonderfahrten = { ueberland: 5, autobahn: 4, nacht: 3 }
const SF_A: Sonderfahrten = { ueberland: 5, autobahn: 4, nacht: 3 }
const SF_BE: Sonderfahrten = { ueberland: 3, autobahn: 1, nacht: 1 }
const SF_C: Sonderfahrten = { ueberland: 5, autobahn: 2, nacht: 3 }
const SF_C1: Sonderfahrten = { ueberland: 3, autobahn: 1, nacht: 1 }

/**
 * The bus classes are the exception: their compulsory practical training is
 * governed by Anlage 5 FahrschAusbO rather than the flat Sonderfahrten table,
 * and the required volume depends on which classes the applicant already holds
 * and for how long. Publishing a single triple would be wrong for most people,
 * so the figure is withheld and the page directs to a consultation instead.
 */
const BUS_SF_WITHHELD = fact(
  { ueberland: 0, autobahn: 0, nacht: 0 },
  'Anlage 5 FahrschAusbO — Umfang abhängig von Vorbesitz und Vorbesitzdauer',
  REVIEWED,
  'conflicting',
  'Der Pflichtumfang für D, D1, DE und D1E ist nicht pauschal angebbar und wird deshalb nicht als feste Zahl veröffentlicht.',
)

const sf = (v: Sonderfahrten) => fact(v, FEV, REVIEWED, 'confirmed')
const th = (v: TheoryRequirement) => fact(v, FEV, REVIEWED, 'confirmed')
const age = (v: string, note?: string) =>
  fact(v, FEV, REVIEWED, 'confirmed', note)

export const licenceClasses: readonly LicenceClass[] = [
  // ─── PKW & ANHÄNGER ──────────────────────────────────────────────────────
  {
    slug: 'klasse-b',
    code: 'B',
    name: 'Klasse B',
    category: 'pkw',
    order: 10,
    tagline: 'Der Autoführerschein',
    summary:
      'Die Klasse B ist der klassische Autoführerschein. Du lernst auf modernen Schulfahrzeugen, kannst durch mehrere Theorietermine pro Tag zügig durch den Unterricht kommen und startest die Praxis am Simulator, bevor es in den echten Verkehr geht.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 2, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_B),
    allows: [
      'Kraftfahrzeuge bis 3.500 kg zulässige Gesamtmasse',
      'Höchstens acht Sitzplätze außer dem Fahrersitz',
      'Anhänger bis 750 kg — schwerere Anhänger, solange die Kombination 3.500 kg nicht überschreitet',
    ],
    prerequisites: [
      'Sehtest',
      'Erste-Hilfe-Kurs',
      'Biometrisches Passbild',
      'Antrag bei der Führerscheinstelle',
    ],
    goodToKnow: [
      'Wer bereits eine andere Fahrerlaubnisklasse besitzt, braucht statt zwölf nur sechs Doppelstunden Grundstoff.',
      'Du kannst die Klasse B als Schaltung, als reine Automatik oder mit der Schlüsselzahl B197 machen.',
    ],
    simulatorSupported: true,
    calculatorSupported: true,
    related: ['bf17', 'b197', 'automatik', 'be', 'b96'],
    seoTitle: 'Führerschein Klasse B in Fulda und Bad Hersfeld',
    seoDescription:
      'Autoführerschein Klasse B bei der Fahrschule Krebs in Fulda und Bad Hersfeld: Theorie, Simulatortraining, Sonderfahrten und transparente Preise. Jetzt Kosten berechnen.',
  },
  {
    slug: 'bf17',
    code: 'BF17',
    name: 'Begleitetes Fahren ab 17',
    category: 'pkw',
    order: 11,
    tagline: 'Ein Jahr Vorsprung',
    summary:
      'Beim begleiteten Fahren machst du die komplette Ausbildung und die Prüfungen der Klasse B bereits mit 17 und fährst danach bis zum 18. Geburtstag mit einer eingetragenen Begleitperson. Das Jahr Fahrpraxis senkt das Unfallrisiko nachweislich.',
    minAge: age('17 Jahre', 'Ausbildungsbeginn ist in der Regel sechs Monate vorher möglich.'),
    theory: th({ grundstoff: 12, zusatzstoff: 2, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_B),
    allows: [
      'Alles, was die Klasse B erlaubt — bis zum 18. Geburtstag nur mit eingetragener Begleitperson',
    ],
    prerequisites: [
      'Einverständnis der Erziehungsberechtigten',
      'Mindestens eine Begleitperson, die die Voraussetzungen erfüllt',
      'Sehtest, Erste-Hilfe-Kurs, biometrisches Passbild',
    ],
    goodToKnow: [
      'Begleitpersonen müssen mindestens 30 Jahre alt sein, seit mindestens fünf Jahren die Klasse B besitzen und dürfen höchstens einen Punkt im Fahreignungsregister haben.',
      'Mehrere Begleitpersonen sind möglich und werden alle in der Prüfungsbescheinigung eingetragen.',
    ],
    simulatorSupported: true,
    calculatorSupported: true,
    related: ['klasse-b', 'b197', 'automatik'],
    seoTitle: 'Begleitetes Fahren ab 17 (BF17) in Fulda und Bad Hersfeld',
    seoDescription:
      'BF17 bei der Fahrschule Krebs: mit 17 den Führerschein machen und ein Jahr begleitet fahren. Voraussetzungen, Ablauf und Kosten transparent erklärt.',
  },
  {
    slug: 'b197',
    code: 'B197',
    name: 'Klasse B mit Schlüsselzahl 197',
    category: 'pkw',
    order: 12,
    tagline: 'Automatik lernen, Schaltung fahren',
    summary:
      'Mit B197 machst du den größten Teil der Ausbildung und die Prüfung auf einem Automatikfahrzeug, absolvierst aber zusätzlich Schaltstunden und eine Testfahrt. Im Führerschein steht am Ende keine Automatikbeschränkung — du darfst beides fahren.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 2, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_B),
    allows: ['Alles, was die Klasse B erlaubt — Schaltwagen und Automatik ohne Einschränkung'],
    prerequisites: [
      'Mindestens zehn Fahrstunden à 45 Minuten auf einem Schaltfahrzeug',
      'Eine abschließende Testfahrt mit Schaltgetriebe, die deine Fahrlehrerin oder dein Fahrlehrer bescheinigt',
    ],
    goodToKnow: [
      'Der Vorteil: Du lernst zuerst ohne Kupplung und kannst dich auf Verkehr, Blick und Entscheidungen konzentrieren.',
      'Die Schaltkompetenz wird von der Fahrschule bescheinigt, nicht separat von der Prüfstelle abgenommen.',
    ],
    simulatorSupported: true,
    calculatorSupported: true,
    related: ['klasse-b', 'automatik', 'bf17'],
    seoTitle: 'B197 — Automatik lernen, Schaltung fahren | Fulda und Bad Hersfeld',
    seoDescription:
      'B197 bei der Fahrschule Krebs: Ausbildung auf Automatik, Schaltstunden inklusive, Führerschein ohne Automatikbeschränkung. Ablauf und Kosten im Überblick.',
  },
  {
    slug: 'automatik',
    code: 'B (78)',
    name: 'Klasse B Automatik',
    category: 'pkw',
    order: 13,
    tagline: 'Ohne Kupplung zum Führerschein',
    summary:
      'Die reine Automatikausbildung führt zur Klasse B mit der Schlüsselzahl 78. Du fährst damit ausschließlich Fahrzeuge ohne Kupplungspedal — für viele der ruhigere und schnellere Weg, gerade in der Stadt.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 2, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_B),
    allows: ['Fahrzeuge der Klasse B ohne Schaltgetriebe (Schlüsselzahl 78)'],
    prerequisites: ['Sehtest', 'Erste-Hilfe-Kurs', 'Biometrisches Passbild'],
    goodToKnow: [
      'Wenn du dir später doch Schaltfahrzeuge offenhalten willst, ist B197 der passendere Weg.',
      'Immer mehr Neuwagen und alle Elektroautos fahren ohnehin ohne Kupplung.',
    ],
    simulatorSupported: true,
    calculatorSupported: true,
    related: ['b197', 'klasse-b'],
    seoTitle: 'Automatik-Führerschein Klasse B in Fulda und Bad Hersfeld',
    seoDescription:
      'Automatikausbildung Klasse B bei der Fahrschule Krebs in Fulda und Bad Hersfeld. Was die Schlüsselzahl 78 bedeutet und wann B197 die bessere Wahl ist.',
  },
  {
    slug: 'be',
    code: 'BE',
    name: 'Klasse BE',
    category: 'pkw',
    order: 14,
    tagline: 'Der Anhängerführerschein',
    summary:
      'Mit BE ziehst du schwere Anhänger — Pferdeanhänger, Bootstrailer, Baumaschinen. Es gibt keine zusätzliche Theorieprüfung: Du absolvierst Sonderfahrten und die praktische Prüfung. Das Rangieren übst du bei uns auch im Simulator.',
    minAge: age('18 Jahre'),
    theory: null,
    sonderfahrten: sf(SF_BE),
    allows: [
      'Kombination aus einem Fahrzeug der Klasse B und einem Anhänger über 750 kg',
      'Anhänger bis 3.500 kg zulässige Gesamtmasse',
    ],
    prerequisites: ['Vorhandene Fahrerlaubnis der Klasse B'],
    goodToKnow: [
      'Für BE ist keine Theorieprüfung nötig — nur die praktische Prüfung.',
      'Wenn dir 4.250 kg Gesamtmasse reichen, ist die Schlüsselzahl B96 deutlich günstiger und ohne Prüfung zu haben.',
    ],
    simulatorSupported: true,
    calculatorSupported: false,
    related: ['b96', 'klasse-b', 'c1e'],
    seoTitle: 'Anhängerführerschein Klasse BE in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse BE bei der Fahrschule Krebs: schwere Anhänger ziehen, Sonderfahrten, praktische Prüfung und Simulatortraining fürs Rangieren.',
  },
  {
    slug: 'b96',
    code: 'B96',
    name: 'Schlüsselzahl B96',
    category: 'pkw',
    order: 15,
    tagline: 'Der kleine Anhängerschein',
    summary:
      'B96 ist keine eigene Klasse, sondern eine Schlüsselzahl in deinem Führerschein. In einer eintägigen Schulung ohne Prüfung erweiterst du die zulässige Gesamtmasse deiner Kombination von 3.500 auf 4.250 kg — ideal für Wohnwagen und mittlere Anhänger.',
    minAge: age('18 Jahre'),
    theory: null,
    sonderfahrten: null,
    allows: ['Kombination aus Klasse B und Anhänger mit bis zu 4.250 kg Gesamtmasse'],
    prerequisites: ['Vorhandene Fahrerlaubnis der Klasse B'],
    goodToKnow: [
      'Die Schulung umfasst Theorie, Fahrübungen auf dem Übungsplatz und eine Fahrt im öffentlichen Straßenverkehr.',
      'Es gibt keine Prüfung — am Ende wird die Teilnahme bescheinigt und eingetragen.',
      'Reicht die Gesamtmasse nicht aus, brauchst du die Klasse BE.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['be', 'klasse-b'],
    seoTitle: 'B96 Schulung in Fulda und Bad Hersfeld — Anhänger bis 4.250 kg',
    seoDescription:
      'B96 bei der Fahrschule Krebs: Anhängerschulung ohne Prüfung, Gesamtmasse bis 4.250 kg. Ablauf, Voraussetzungen und Abgrenzung zur Klasse BE.',
  },

  // ─── ZWEIRAD ─────────────────────────────────────────────────────────────
  {
    slug: 'mofa',
    code: 'Mofa',
    name: 'Mofa-Prüfbescheinigung',
    category: 'zweirad',
    order: 20,
    tagline: 'Der erste eigene Motor',
    summary:
      'Die Mofa-Prüfbescheinigung ist für viele der erste Schritt in den Straßenverkehr. Theorieunterricht, eine praktische Unterweisung und eine theoretische Prüfung — mehr braucht es nicht.',
    minAge: age('15 Jahre'),
    theory: null,
    sonderfahrten: null,
    allows: ['Einsitzige Fahrräder mit Hilfsmotor bis 25 km/h Höchstgeschwindigkeit'],
    prerequisites: ['Sehtest ist nicht vorgeschrieben, wird aber empfohlen'],
    goodToKnow: [
      'Wer bereits eine andere Fahrerlaubnis besitzt, braucht keine Mofa-Prüfbescheinigung.',
      'Für schnellere Roller bis 45 km/h brauchst du die Klasse AM.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['am', 'a1'],
    seoTitle: 'Mofa-Prüfbescheinigung in Fulda und Bad Hersfeld',
    seoDescription:
      'Mofa-Prüfbescheinigung bei der Fahrschule Krebs in Fulda und Bad Hersfeld: Ablauf, Mindestalter und was danach möglich ist.',
  },
  {
    slug: 'am',
    code: 'AM',
    name: 'Klasse AM',
    category: 'zweirad',
    order: 21,
    tagline: 'Roller bis 45 km/h',
    summary:
      'Mit der Klasse AM fährst du Roller und Kleinkrafträder bis 45 km/h. Der Einstieg in echte Mobilität — und die Grundlage, auf der du später auf A1 aufbauen kannst.',
    minAge: fact(
      '15 Jahre',
      'FeV § 10 — bundesweit einheitlich seit dem 28.07.2021',
      REVIEWED,
      'confirmed',
      'Wer mit 15 erwirbt, bekommt die Schlüsselzahl 195 eingetragen: Bis zum 16. Geburtstag gilt die Fahrerlaubnis nur in Deutschland.',
    ),
    theory: th({ grundstoff: 12, zusatzstoff: 4, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: null,
    allows: [
      'Zweirädrige Kleinkrafträder bis 45 km/h und höchstens 50 cm³',
      'Dreirädrige Kleinkrafträder und leichte vierrädrige Fahrzeuge nach den geltenden Grenzwerten',
    ],
    prerequisites: ['Sehtest', 'Erste-Hilfe-Kurs', 'Biometrisches Passbild'],
    goodToKnow: [
      'Die Klasse AM ist in den Klassen A1, A2, A und B automatisch enthalten.',
      'Für AM gibt es keine praktische Prüfung, aber eine praktische Ausbildung.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['a1', 'mofa', 'a2'],
    seoTitle: 'Rollerführerschein Klasse AM in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse AM bei der Fahrschule Krebs: Roller bis 45 km/h fahren. Mindestalter, Ausbildung und der Weg zu A1 und A2.',
  },
  {
    slug: 'a1',
    code: 'A1',
    name: 'Klasse A1',
    category: 'zweirad',
    order: 22,
    tagline: 'Leichtkraftrad ab 16',
    summary:
      'Die Klasse A1 erlaubt Motorräder bis 125 cm³ und 11 kW. Du lernst Kurventechnik, Blickführung und Gefahrenwahrnehmung von Grund auf — die Basis für jede spätere Aufstiegsklasse.',
    minAge: age('16 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 4, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_A),
    allows: [
      'Krafträder bis 125 cm³ und maximal 11 kW',
      'Leistungsgewicht höchstens 0,1 kW je Kilogramm',
    ],
    prerequisites: ['Sehtest', 'Erste-Hilfe-Kurs', 'Biometrisches Passbild', 'Einverständnis der Erziehungsberechtigten'],
    goodToKnow: [
      'Wer die Klasse B seit mindestens fünf Jahren besitzt, kann über die Schlüsselzahl B196 125er fahren — dafür ist keine Prüfung nötig.',
      'Mit zwei Jahren A1 steigst du auf A2 auf, ohne die Theorieprüfung erneut abzulegen.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['a2', 'a', 'am'],
    seoTitle: 'Motorradführerschein Klasse A1 in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse A1 bei der Fahrschule Krebs: 125er fahren ab 16. Ausbildung, Sonderfahrten und der Aufstieg zu A2 und A.',
  },
  {
    slug: 'a2',
    code: 'A2',
    name: 'Klasse A2',
    category: 'zweirad',
    order: 23,
    tagline: 'Mittlere Leistungsklasse',
    summary:
      'A2 ist die Klasse für Motorräder bis 35 kW. Für viele der eigentliche Einstieg ins Motorradfahren — mit genügend Leistung für die Landstraße und einem klaren Weg zur offenen Klasse A.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 4, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_A),
    allows: [
      'Krafträder bis 35 kW',
      'Leistungsgewicht höchstens 0,2 kW je Kilogramm',
      'Keine Ableitung aus einem Fahrzeug mit mehr als doppelter Leistung',
    ],
    prerequisites: ['Sehtest', 'Erste-Hilfe-Kurs', 'Biometrisches Passbild'],
    goodToKnow: [
      'Nach zwei Jahren Besitz der Klasse A2 steigst du mit einer praktischen Prüfung auf die Klasse A auf.',
      'Wer A1 bereits besitzt, verkürzt die Ausbildung deutlich.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['a', 'a1'],
    seoTitle: 'Motorradführerschein Klasse A2 in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse A2 bei der Fahrschule Krebs: Motorräder bis 35 kW. Ausbildung, Voraussetzungen und Aufstieg zur offenen Klasse A.',
  },
  {
    slug: 'a',
    code: 'A',
    name: 'Klasse A',
    category: 'zweirad',
    order: 24,
    tagline: 'Die offene Klasse',
    summary:
      'Die Klasse A ist unbeschränkt — jedes Motorrad, jede Leistung. Du erreichst sie im Direkteinstieg oder als Aufstieg nach zwei Jahren Klasse A2.',
    minAge: fact(
      '24 Jahre im Direkteinstieg, 20 Jahre beim Aufstieg nach zwei Jahren Klasse A2',
      FEV,
      REVIEWED,
      'confirmed',
    ),
    theory: th({ grundstoff: 12, zusatzstoff: 4, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_A),
    allows: ['Krafträder ohne Leistungsbeschränkung', 'Dreirädrige Kraftfahrzeuge über 15 kW'],
    prerequisites: ['Sehtest', 'Erste-Hilfe-Kurs', 'Biometrisches Passbild'],
    goodToKnow: [
      'Beim Aufstieg von A2 auf A nach zwei Jahren entfällt die Theorieprüfung; es bleibt die praktische Prüfung.',
      'Im Direkteinstieg ab 24 durchläufst du die vollständige Ausbildung.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['a2', 'a1'],
    seoTitle: 'Motorradführerschein Klasse A in Fulda und Bad Hersfeld',
    seoDescription:
      'Offene Motorradklasse A bei der Fahrschule Krebs: Direkteinstieg ab 24 oder Aufstieg von A2. Ausbildung und Voraussetzungen im Überblick.',
  },

  // ─── LKW ─────────────────────────────────────────────────────────────────
  {
    slug: 'c1',
    code: 'C1',
    name: 'Klasse C1',
    category: 'lkw',
    order: 30,
    tagline: 'Bis 7,5 Tonnen',
    summary:
      'C1 erlaubt Fahrzeuge zwischen 3,5 und 7,5 Tonnen — der klassische Einstieg für Handwerk, Feuerwehr, Rettungsdienst und Wohnmobile jenseits der 3,5-Tonnen-Grenze.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 6, zusatzstoff: 6 }),
    sonderfahrten: sf(SF_C1),
    allows: [
      'Kraftfahrzeuge von 3.500 kg bis 7.500 kg zulässiger Gesamtmasse',
      'Höchstens acht Sitzplätze außer dem Fahrersitz',
      'Anhänger bis 750 kg',
    ],
    prerequisites: [
      'Vorhandene Fahrerlaubnis der Klasse B',
      'Ärztliche Untersuchung',
      'Sehtest beim Augenarzt oder Betriebsmediziner',
    ],
    goodToKnow: [
      'Für die Klassen C1 und C sind eine ärztliche Untersuchung und ein erweiterter Sehtest vorgeschrieben.',
      'Die Klasse C1 ist befristet und muss regelmäßig verlängert werden.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['c1e', 'c', 'ce'],
    seoTitle: 'LKW-Führerschein Klasse C1 in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse C1 bei der Fahrschule Krebs: Fahrzeuge bis 7,5 Tonnen. Voraussetzungen, ärztliche Untersuchung, Ausbildung und Prüfung.',
  },
  {
    slug: 'c1e',
    code: 'C1E',
    name: 'Klasse C1E',
    category: 'lkw',
    order: 31,
    tagline: 'C1 mit schwerem Anhänger',
    summary:
      'C1E kombiniert ein Fahrzeug der Klasse C1 mit einem Anhänger über 750 kg. Für Betriebe, die Material und Maschinen zusammen transportieren.',
    minAge: age('18 Jahre'),
    theory: th({ grundstoff: 12, zusatzstoff: 6, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_C1),
    allows: [
      'Kombination aus Klasse C1 und Anhänger über 750 kg',
      'Gesamtmasse der Kombination bis 12.000 kg',
    ],
    prerequisites: ['Vorhandene Fahrerlaubnis der Klasse C1', 'Ärztliche Untersuchung und Sehtest'],
    goodToKnow: [
      'Die Kombination darf 12 Tonnen Gesamtmasse nicht überschreiten — darüber brauchst du CE.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['c1', 'ce', 'be'],
    seoTitle: 'Klasse C1E in Fulda und Bad Hersfeld — LKW mit Anhänger',
    seoDescription:
      'Klasse C1E bei der Fahrschule Krebs: LKW bis 7,5 Tonnen mit schwerem Anhänger. Voraussetzungen, Ausbildung und Prüfung.',
  },
  {
    slug: 'c',
    code: 'C',
    name: 'Klasse C',
    category: 'lkw',
    order: 32,
    tagline: 'Der große LKW',
    summary:
      'Die Klasse C ist der LKW-Führerschein ohne Gewichtsgrenze nach oben. Wir bilden auf eigenen LKW aus — von der ersten Rangierübung bis zur Prüfungsfahrt.',
    minAge: fact(
      '21 Jahre — mit vollständiger Grundqualifikation nach dem Berufskraftfahrerqualifikationsgesetz oder im Rahmen einer entsprechenden Berufsausbildung ab 18 Jahren',
      `${FEV}; § 10 Abs. 1 FeV in Verbindung mit § 4 BKrFQG`,
      REVIEWED,
      'confirmed',
      'Wichtig: Die beschleunigte Grundqualifikation senkt das Mindestalter für C und CE nicht — dort bleibt es bei 21 Jahren.',
    ),
    theory: th({ grundstoff: 12, zusatzstoff: 10, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_C),
    allows: [
      'Kraftfahrzeuge über 3.500 kg zulässiger Gesamtmasse',
      'Höchstens acht Sitzplätze außer dem Fahrersitz',
      'Anhänger bis 750 kg',
    ],
    prerequisites: [
      'Vorhandene Fahrerlaubnis der Klasse B',
      'Ärztliche Untersuchung',
      'Untersuchung des Sehvermögens',
    ],
    goodToKnow: [
      'Wer den LKW beruflich fährt, braucht zusätzlich die Grundqualifikation oder beschleunigte Grundqualifikation nach dem Berufskraftfahrerqualifikationsgesetz.',
      'Die Fahrerlaubnis der Klasse C ist befristet und wird regelmäßig verlängert.',
    ],
    simulatorSupported: true,
    calculatorSupported: false,
    related: ['ce', 'c1', 'berufskraftfahrer'],
    seoTitle: 'LKW-Führerschein Klasse C in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse C bei der Fahrschule Krebs: LKW über 3,5 Tonnen. Ausbildung auf eigenen Fahrzeugen, Simulatortraining und Weg zur Berufskraftfahrer-Qualifikation.',
  },
  {
    slug: 'ce',
    code: 'CE',
    name: 'Klasse CE',
    category: 'lkw',
    order: 33,
    tagline: 'Sattelzug und Hängerzug',
    summary:
      'CE ist die höchste LKW-Klasse: Sattelzüge und Lastzüge ohne Gewichtsbeschränkung. Der Standard für den Güterverkehr — und die Klasse, die im Fernverkehr gefragt ist.',
    minAge: fact(
      '21 Jahre — mit vollständiger Grundqualifikation nach dem Berufskraftfahrerqualifikationsgesetz oder im Rahmen einer entsprechenden Berufsausbildung ab 18 Jahren',
      `${FEV}; § 10 Abs. 1 FeV in Verbindung mit § 4 BKrFQG`,
      REVIEWED,
      'confirmed',
      'Wichtig: Die beschleunigte Grundqualifikation senkt das Mindestalter für C und CE nicht — dort bleibt es bei 21 Jahren.',
    ),
    theory: th({ grundstoff: 12, zusatzstoff: 10, grundstoffMitVorbesitz: 6 }),
    sonderfahrten: sf(SF_C),
    allows: [
      'Kombination aus Klasse C und Anhänger oder Auflieger über 750 kg',
      'Keine Begrenzung der Gesamtmasse nach oben',
    ],
    prerequisites: ['Vorhandene oder gleichzeitig erworbene Fahrerlaubnis der Klasse C', 'Ärztliche Untersuchung und Sehtest'],
    goodToKnow: [
      'Viele Fahrschülerinnen und Fahrschüler machen C und CE direkt hintereinander — das spart Zeit und Kosten.',
      'Das Rangieren mit Auflieger lässt sich im Simulator beliebig oft wiederholen, bevor es auf den Platz geht.',
    ],
    simulatorSupported: true,
    calculatorSupported: false,
    related: ['c', 'berufskraftfahrer', 'c1e'],
    seoTitle: 'Klasse CE in Fulda und Bad Hersfeld — Sattelzug fahren',
    seoDescription:
      'Klasse CE bei der Fahrschule Krebs: Lastzüge und Sattelzüge. Ausbildung auf eigenen Fahrzeugen mit Simulatortraining fürs Rangieren.',
  },

  // ─── BUS ─────────────────────────────────────────────────────────────────
  {
    slug: 'd',
    code: 'D',
    name: 'Klasse D',
    category: 'bus',
    order: 40,
    tagline: 'Verantwortung für Fahrgäste',
    summary:
      'Die Klasse D ist der Busführerschein. Wir bilden auf einem eigenen Bus aus — im Linienverkehr, im Reiseverkehr und überall dort, wo Menschen sicher ankommen müssen.',
    minAge: fact(
      '24 Jahre — abgestuft niedriger mit Berufskraftfahrer-Qualifikation: 23 Jahre nach beschleunigter Grundqualifikation, 21 Jahre nach vollständiger Grundqualifikation oder im Linienverkehr bis 50 km',
      `${FEV}; § 10 Abs. 1 FeV in Verbindung mit § 4 BKrFQG`,
      REVIEWED,
      'likely',
      'Weitere Absenkungen sind im Rahmen einer anerkannten Berufsausbildung möglich. Der konkrete Einzelfall gehört ins Beratungsgespräch.',
    ),
    theory: th({ grundstoff: 6, zusatzstoff: 18 }),
    sonderfahrten: BUS_SF_WITHHELD,
    allows: [
      'Kraftfahrzeuge zur Personenbeförderung mit mehr als acht Sitzplätzen außer dem Fahrersitz',
      'Anhänger bis 750 kg',
    ],
    prerequisites: [
      'Vorhandene Fahrerlaubnis der Klasse B',
      'Ärztliche und betriebs- oder verkehrsmedizinische Untersuchung',
      'Untersuchung des Sehvermögens',
    ],
    goodToKnow: [
      'Für die gewerbliche Personenbeförderung ist zusätzlich die Grundqualifikation nach dem Berufskraftfahrerqualifikationsgesetz erforderlich.',
      'Die Klasse D ist befristet und muss regelmäßig verlängert werden.',
    ],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['de', 'berufskraftfahrer', 'c'],
    seoTitle: 'Busführerschein Klasse D in Fulda und Bad Hersfeld',
    seoDescription:
      'Klasse D bei der Fahrschule Krebs: Busführerschein mit Ausbildung auf eigenem Fahrzeug. Voraussetzungen, Untersuchungen und Berufskraftfahrer-Qualifikation.',
  },
  {
    slug: 'de',
    code: 'DE',
    name: 'Klasse DE',
    category: 'bus',
    order: 41,
    tagline: 'Bus mit Anhänger',
    summary:
      'DE erweitert die Klasse D um Anhänger über 750 kg — etwa für Gepäckanhänger im Reiseverkehr.',
    minAge: fact(
      'Entspricht dem Mindestalter der Klasse D',
      `${FEV}; § 10 Abs. 1 FeV`,
      REVIEWED,
      'likely',
    ),
    theory: th({ grundstoff: 6, zusatzstoff: 18 }),
    sonderfahrten: BUS_SF_WITHHELD,
    allows: ['Kombination aus Klasse D und Anhänger über 750 kg'],
    prerequisites: ['Vorhandene oder gleichzeitig erworbene Fahrerlaubnis der Klasse D'],
    goodToKnow: ['DE wird in der Regel direkt im Anschluss an die Klasse D erworben.'],
    simulatorSupported: false,
    calculatorSupported: false,
    related: ['d', 'berufskraftfahrer'],
    seoTitle: 'Klasse DE in Fulda und Bad Hersfeld — Bus mit Anhänger',
    seoDescription:
      'Klasse DE bei der Fahrschule Krebs: Busführerschein mit Anhänger. Voraussetzungen und Ablauf der Ausbildung.',
  },
]

export const categories: Record<ClassCategory, { label: string; short: string; blurb: string }> = {
  pkw: {
    label: 'PKW & Anhänger',
    short: 'PKW',
    blurb: 'Vom Autoführerschein bis zum schweren Anhänger — der meistgewählte Weg.',
  },
  zweirad: {
    label: 'Zweirad',
    short: 'Zweirad',
    blurb: 'Vom Mofa bis zur offenen Klasse A. Jede Stufe baut auf der vorherigen auf.',
  },
  lkw: {
    label: 'LKW',
    short: 'LKW',
    blurb: 'Ausbildung auf eigenen Fahrzeugen — bis zum Sattelzug.',
  },
  bus: {
    label: 'Bus',
    short: 'Bus',
    blurb: 'Personenbeförderung mit allem, was rechtlich und praktisch dazugehört.',
  },
  spezial: {
    label: 'Beruf & Spezial',
    short: 'Spezial',
    blurb: 'Qualifikationen, Seminare und Ausbildungen jenseits der Fahrerlaubnisklassen.',
  },
}

export function classBySlug(slug: string): LicenceClass | undefined {
  return licenceClasses.find((c) => c.slug === slug)
}

export function classesByCategory(category: ClassCategory): LicenceClass[] {
  return licenceClasses.filter((c) => c.category === category).sort((a, b) => a.order - b.order)
}

export const classCategoryOrder: readonly ClassCategory[] = ['pkw', 'zweirad', 'lkw', 'bus']

/** Total compulsory Sonderfahrten (45-minute units) for a class. */
export function sonderfahrtenTotal(s: Sonderfahrten): number {
  return s.ueberland + s.autobahn + s.nacht
}
