import { fact, type Fact } from './truth'

/**
 * Professional qualifications, seminars and specialist training —
 * everything beyond the plain licence classes.
 */

const REVIEWED = '2026-07-27'
const OWN = 'Eigene Website (fulda.fahrschule-krebs.de)'

export type ServiceGroup = 'beruf' | 'logistik' | 'seminare' | 'spezial'

export interface ServiceModule {
  readonly title: string
  readonly detail: string
}

export interface Service {
  readonly slug: string
  readonly name: string
  readonly group: ServiceGroup
  readonly order: number
  readonly tagline: string
  readonly forWhom: string
  readonly summary: string
  readonly includes: readonly string[]
  readonly modules?: Fact<readonly ServiceModule[]>
  readonly format: Fact<string> | null
  readonly requirements: readonly string[]
  readonly nextStep: string
  readonly seoTitle: string
  readonly seoDescription: string
}

export const serviceGroups: Record<ServiceGroup, { label: string; blurb: string }> = {
  beruf: {
    label: 'Beruf & Logistik',
    blurb: 'Qualifikationen, mit denen aus einem Führerschein ein Beruf wird.',
  },
  logistik: {
    label: 'Ladung & Gefahrgut',
    blurb: 'Schulungen für alles, was transportiert, gesichert und bewegt wird.',
  },
  seminare: {
    label: 'Seminare',
    blurb: 'Wenn es nach dem Führerschein noch einmal um die Fahrerlaubnis geht.',
  },
  spezial: {
    label: 'Spezialausbildung',
    blurb: 'Ausbildung, die sich nach dem Menschen richtet — nicht umgekehrt.',
  },
}

export const services: readonly Service[] = [
  {
    slug: 'berufskraftfahrer',
    name: 'Berufskraftfahrer-Ausbildung',
    group: 'beruf',
    order: 10,
    tagline: 'Vom Führerschein zum Beruf',
    forWhom: 'Für alle, die LKW oder Bus beruflich fahren wollen — und für Unternehmen, die ausbilden.',
    summary:
      'Wer gewerblich Güter oder Personen befördert, braucht neben der Fahrerlaubnis eine Qualifikation nach dem Berufskraftfahrerqualifikationsgesetz. Wir bilden beides aus: die Fahrerlaubnis auf eigenen Fahrzeugen und die beschleunigte Grundqualifikation.',
    includes: [
      'Beschleunigte Grundqualifikation für LKW und Bus',
      'Fahrerlaubnis der Klassen C und CE beziehungsweise D und DE',
      'Gefahrgutschulung ADR — Stückgut und Tank',
      'Ladungssicherung',
    ],
    format: fact(
      '140 Unterrichtsstunden à 60 Minuten in einer anerkannten Ausbildungsstätte, abgeschlossen mit einer 90-minütigen theoretischen Prüfung bei der IHK.',
      `${OWN}, Seite Berufskraftfahrerausbildung`,
      REVIEWED,
      'confirmed',
    ),
    requirements: [
      'Fahrerlaubnis der Klasse B',
      'Ärztliche Untersuchung und Untersuchung des Sehvermögens für die Klassen C und D',
    ],
    nextStep: 'Beratung für Berufskraftfahrer starten',
    seoTitle: 'Berufskraftfahrer-Ausbildung in Fulda — beschleunigte Grundqualifikation',
    seoDescription:
      'Berufskraftfahrer-Ausbildung bei der Fahrschule Krebs in Fulda: beschleunigte Grundqualifikation mit 140 Stunden und IHK-Prüfung, Klassen C/CE und D/DE, ADR und Ladungssicherung.',
  },
  {
    slug: 'bkf-weiterbildung',
    name: 'BKF-Weiterbildung',
    group: 'beruf',
    order: 11,
    tagline: 'Fünf Module, eine Woche',
    forWhom: 'Für Berufskraftfahrerinnen und Berufskraftfahrer, deren Weiterbildung ansteht — und für ihre Arbeitgeber.',
    summary:
      'Die gesetzlich vorgeschriebene Weiterbildung läuft bei uns als geschlossene Woche: Montag bis Freitag, ein Modul pro Tag. Wer alle fünf Module absolviert hat, ist wieder für fünf Jahre qualifiziert.',
    includes: [
      'Alle fünf Kenntnisbereiche der Weiterbildung',
      'Durchführung als kompakte Wochenschulung',
      'Auch einzeln buchbar, wenn nur einzelne Module fehlen',
    ],
    modules: fact(
      [
        { title: 'Modul 1 — Eco-Training', detail: 'Wirtschaftliche und vorausschauende Fahrweise.' },
        { title: 'Modul 2 — Sozialvorschriften', detail: 'Sozialvorschriften im Güterverkehr, Lenk- und Ruhezeiten.' },
        { title: 'Modul 3 — Sicherheitstechnik', detail: 'Sicherheitstechnik und Fahrsicherheit.' },
        { title: 'Modul 4 — Fahrer als Dienstleister', detail: 'Der Fahrer als Dienstleister und Imageträger des Unternehmens.' },
        { title: 'Modul 5 — Ladungssicherung', detail: 'Ladungssicherung in Theorie und Praxis.' },
      ],
      `${OWN}, Seite Berufskraftfahrerausbildung`,
      REVIEWED,
      'confirmed',
    ),
    format: fact(
      'Montag bis Freitag, ein Modul pro Tag von 08:00 bis 16:00 Uhr — sieben Unterrichtseinheiten à 60 Minuten pro Tag, insgesamt 35 Unterrichtseinheiten.',
      `${OWN}, Seite Berufskraftfahrerausbildung`,
      REVIEWED,
      'confirmed',
    ),
    requirements: ['Bestehende Fahrerlaubnis der Klassen C/CE oder D/DE'],
    nextStep: 'Termine für die Weiterbildung anfragen',
    seoTitle: 'BKF-Weiterbildung in Fulda — alle fünf Module in einer Woche',
    seoDescription:
      'Berufskraftfahrer-Weiterbildung bei der Fahrschule Krebs: fünf Module von Montag bis Freitag, 08:00 bis 16:00 Uhr. Eco-Training, Sozialvorschriften, Sicherheitstechnik, Dienstleistung und Ladungssicherung.',
  },
  {
    slug: 'adr',
    name: 'Gefahrgutschulung ADR',
    group: 'logistik',
    order: 20,
    tagline: 'Gefahrgut sicher bewegen',
    forWhom: 'Für Fahrerinnen und Fahrer, die gefährliche Güter transportieren.',
    summary:
      'Der ADR-Basiskurs vermittelt Vorschriften, Gefahreneigenschaften und Dokumentation und schließt mit einer IHK-Prüfung ab. Darauf bauen die Aufbaukurse auf — etwa für Tankfahrzeuge.',
    includes: [
      'Basiskurs mit Vorschriften, Gefahreneigenschaften und Dokumentation',
      'Abschluss mit IHK-Prüfung',
      'Aufbaukurs Tank',
      'Regelmäßige Auffrischungskurse',
    ],
    format: null,
    requirements: ['Gültige Fahrerlaubnis'],
    nextStep: 'ADR-Termine anfragen',
    seoTitle: 'Gefahrgutschulung ADR in Fulda — Basiskurs und Aufbaukurse',
    seoDescription:
      'ADR-Schulung bei der Fahrschule Krebs in Fulda: Basiskurs mit IHK-Prüfung, Aufbaukurs Tank und Auffrischung. Für alle, die Gefahrgut transportieren.',
  },
  {
    slug: 'staplerschein',
    name: 'Gabelstaplerschein',
    group: 'logistik',
    order: 21,
    tagline: 'Sicher heben, sicher stapeln',
    forWhom: 'Für Beschäftigte in Lager, Produktion und Handwerk — und für Betriebe, die ihre Leute qualifizieren.',
    summary:
      'Die Staplerausbildung vermittelt den sicheren Umgang mit Flurförderzeugen: Standsicherheit, Lastaufnahme, Verkehrswege und die Verantwortung, die mit dem Gerät kommt.',
    includes: ['Theoretische Unterweisung', 'Praktische Ausbildung am Gerät', 'Abschluss mit Bescheinigung'],
    format: null,
    requirements: ['Mindestalter 18 Jahre', 'Körperliche und geistige Eignung'],
    nextStep: 'Staplerschein anfragen',
    seoTitle: 'Gabelstaplerschein in Fulda — Ausbildung für Flurförderzeuge',
    seoDescription:
      'Staplerschein bei der Fahrschule Krebs in Fulda: Theorie und Praxis für den sicheren Umgang mit Gabelstaplern. Für Betriebe und Einzelpersonen.',
  },
  {
    slug: 'ladungssicherung',
    name: 'Ladungssicherung',
    group: 'logistik',
    order: 22,
    tagline: 'Was nicht rutscht, kommt an',
    forWhom: 'Für Fahrpersonal, Verlader und Disponenten.',
    summary:
      'Ladungssicherung ist der Bereich, in dem im Alltag am meisten schiefgeht — und der am klarsten geregelt ist. Wir schulen Grundlagen, Hilfsmittel und die Verantwortung entlang der Transportkette.',
    includes: ['Physikalische Grundlagen', 'Sicherungsmittel und ihre Grenzen', 'Verantwortlichkeiten entlang der Kette'],
    format: null,
    requirements: [],
    nextStep: 'Schulung zur Ladungssicherung anfragen',
    seoTitle: 'Ladungssicherung — Schulung in Fulda',
    seoDescription:
      'Schulung zur Ladungssicherung bei der Fahrschule Krebs in Fulda. Grundlagen, Sicherungsmittel und Verantwortlichkeiten — auch als Modul der BKF-Weiterbildung.',
  },
  {
    slug: 'asf',
    name: 'ASF — Aufbauseminar für Fahranfänger',
    group: 'seminare',
    order: 30,
    tagline: 'Probezeit retten',
    forWhom: 'Für Fahranfängerinnen und Fahranfänger, die in der Probezeit auffällig geworden sind.',
    summary:
      'Wer in der Probezeit einen schwerwiegenden Verstoß begeht, wird zum Aufbauseminar verpflichtet. Es geht nicht um Belehrung, sondern darum, die eigene Fahrweise ehrlich anzuschauen — in einer kleinen Gruppe und mit einer begleiteten Fahrprobe.',
    includes: [
      'Mehrere Sitzungen in fester Gruppe',
      'Eine begleitete Fahrprobe zwischen den Sitzungen',
      'Beratung zum weiteren Ablauf und zur Probezeit',
    ],
    format: null,
    requirements: ['Anordnung der Fahrerlaubnisbehörde'],
    nextStep: 'ASF-Termin anfragen',
    seoTitle: 'ASF-Seminar in Fulda und Bad Hersfeld — Aufbauseminar für Fahranfänger',
    seoDescription:
      'Aufbauseminar für Fahranfänger (ASF) bei der Fahrschule Krebs. Ablauf, Fahrprobe und was für die Probezeit gilt — mit persönlicher Beratung.',
  },
  {
    slug: 'fes',
    name: 'FES — Fahreignungsseminar',
    group: 'seminare',
    order: 31,
    tagline: 'Punkte abbauen',
    forWhom: 'Für Fahrerinnen und Fahrer mit Punkten im Fahreignungsregister.',
    summary:
      'Das Fahreignungsseminar verbindet einen verkehrspädagogischen und einen verkehrspsychologischen Teil. Unter bestimmten Voraussetzungen lässt sich damit ein Punkt abbauen.',
    includes: ['Verkehrspädagogischer Teil', 'Verkehrspsychologischer Teil', 'Beratung zum Punktestand'],
    format: null,
    requirements: ['Beratung im Einzelfall — ob ein Punktabbau möglich ist, hängt vom aktuellen Punktestand ab'],
    nextStep: 'Zum Fahreignungsseminar beraten lassen',
    seoTitle: 'Fahreignungsseminar (FES) in Fulda — Punkte abbauen',
    seoDescription:
      'Fahreignungsseminar bei der Fahrschule Krebs in Fulda: verkehrspädagogischer und verkehrspsychologischer Teil. Beratung zum Punktestand inklusive.',
  },
  {
    slug: 'handicap',
    name: 'Handicap-Ausbildung',
    group: 'spezial',
    order: 40,
    tagline: 'Ausbildung, die sich anpasst',
    forWhom: 'Für Menschen mit Behinderung, die eine Fahrerlaubnis der Klasse B erwerben möchten.',
    summary:
      'Wir sind auf die Ausbildung von Menschen mit Behinderung spezialisiert. Am Anfang steht kein Standardablauf, sondern ein Gespräch: Was ist nötig, was ist möglich, welche Auflagen kommen dazu und wie sieht der Weg zur Fahrerlaubnis konkret aus.',
    includes: [
      'Persönliche Beratung vor der Anmeldung',
      'Begleitung durch das Verfahren bei Gutachten und Auflagen',
      'Abstimmung auf den individuellen Bedarf',
    ],
    format: null,
    requirements: ['Individuelle Klärung — die Voraussetzungen hängen vom Einzelfall ab'],
    nextStep: 'Persönliches Beratungsgespräch vereinbaren',
    seoTitle: 'Handicap-Ausbildung in Fulda — Führerschein mit Behinderung',
    seoDescription:
      'Fahrausbildung für Menschen mit Behinderung bei der Fahrschule Krebs in Fulda. Persönliche Beratung, Begleitung durch das Verfahren, Ausbildung nach individuellem Bedarf.',
  },
  {
    slug: 'ferienfahrschule',
    name: 'Ferienfahrschule',
    group: 'spezial',
    order: 41,
    tagline: 'Theorie am Stück',
    forWhom: 'Für alle, die den Führerschein in einem zusammenhängenden Zeitraum machen wollen.',
    summary:
      'Die Ferienfahrschule ist ein strukturierter Intensivkurs in Theorie und Praxis. Weil in Fulda mehrere Themen pro Tag laufen, lässt sich der Theorieteil in kurzer Zeit vollständig absolvieren — Praxis läuft parallel oder versetzt, je nach Absprache.',
    includes: [
      'Strukturierte Intensivkurse in Theorie und Praxis',
      'Theorie und Praxis parallel oder versetzt nach Absprache',
      'Nicht an Schulferien gebunden — grundsätzlich jederzeit möglich',
    ],
    format: null,
    requirements: ['Anmeldung und Absprache des Zeitraums'],
    nextStep: 'Zeitraum für die Ferienfahrschule absprechen',
    seoTitle: 'Ferienfahrschule in Fulda — Intensivkurs für den Führerschein',
    seoDescription:
      'Ferienfahrschule der Fahrschule Krebs in Fulda: strukturierter Intensivkurs in Theorie und Praxis, ganzjährig möglich. Theorie am Stück statt über Monate verteilt.',
  },
]

export function serviceBySlug(slug: string): Service | undefined {
  return services.find((s) => s.slug === slug)
}

export function servicesByGroup(group: ServiceGroup): Service[] {
  return services.filter((s) => s.group === group).sort((a, b) => a.order - b.order)
}

export const serviceGroupOrder: readonly ServiceGroup[] = ['beruf', 'logistik', 'seminare', 'spezial']
