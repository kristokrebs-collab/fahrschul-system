import { fact } from './truth'

/**
 * The training guide — what a licence actually requires, and in what order.
 * Legal details verified against the FeV, FahrschAusbO and StVG in July 2026;
 * region-dependent items say so rather than pretending to a single answer.
 */

const REVIEWED = '2026-07-27'

export interface GuideStage {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly items?: readonly string[]
  readonly who: 'fahrschule' | 'du' | 'behoerde' | 'pruefstelle'
}

export const guideStages: readonly GuideStage[] = [
  {
    id: 'beratung',
    title: 'Beratung und Klasse festlegen',
    who: 'fahrschule',
    body: 'Wir klären, welche Klasse zu deinem Ziel passt, ob Automatik, Schaltung oder B197 sinnvoll ist und wann du frühestens starten kannst.',
  },
  {
    id: 'anmeldung',
    title: 'Anmeldung',
    who: 'du',
    body: 'Mit der Anmeldung beginnt die Ausbildung offiziell. Minderjährige brauchen die Unterschrift der Erziehungsberechtigten.',
  },
  {
    id: 'unterlagen',
    title: 'Unterlagen zusammenstellen',
    who: 'du',
    body: 'Diese Nachweise brauchst du für den Antrag. Sie lassen sich alle parallel zum Theorieunterricht erledigen.',
    items: [
      'Sehtest — bei der Antragstellung höchstens zwei Jahre alt',
      'Erste-Hilfe-Kurs — mindestens neun Unterrichtseinheiten, danach unbefristet gültig',
      'Biometrisches Passbild',
      'Gültiges Ausweisdokument',
      'Bei Minderjährigen: Einverständnis der Erziehungsberechtigten',
    ],
  },
  {
    id: 'antrag',
    title: 'Antrag bei der Führerscheinstelle',
    who: 'behoerde',
    body: 'Der Antrag geht an die Fahrerlaubnisbehörde deines Wohnorts. Die Bearbeitung dauert je nach Landkreis unterschiedlich lange — deshalb lohnt es sich, früh damit anzufangen.',
  },
  {
    id: 'theorie',
    title: 'Theorieunterricht',
    who: 'fahrschule',
    body: 'Grundstoff plus klassenspezifischer Zusatzstoff. Wer bereits eine andere Klasse besitzt, braucht statt zwölf nur sechs Doppelstunden Grundstoff. Pro Tag sind höchstens zwei Unterrichtseinheiten möglich.',
  },
  {
    id: 'theoriepruefung',
    title: 'Theoretische Prüfung',
    who: 'pruefstelle',
    body: 'Die Prüfung findet bei einer amtlich anerkannten Prüforganisation statt. Sie ist frühestens drei Monate vor Erreichen des Mindestalters möglich.',
  },
  {
    id: 'simulator',
    title: 'Simulatortraining',
    who: 'fahrschule',
    body: 'Bedienung und Abläufe in wiederholbaren Situationen, bevor es in den echten Verkehr geht. Ergänzt die praktische Ausbildung.',
  },
  {
    id: 'uebungsfahrten',
    title: 'Übungsfahrten',
    who: 'fahrschule',
    body: 'Die Zahl der Übungsfahrstunden ist gesetzlich nicht vorgeschrieben. Sie richtet sich danach, wie sicher du unterwegs bist — und ist der Posten, der die Gesamtkosten am stärksten beeinflusst.',
  },
  {
    id: 'sonderfahrten',
    title: 'Sonderfahrten',
    who: 'fahrschule',
    body: 'Überland-, Autobahn- und Nachtfahrten sind gesetzlich vorgeschrieben und lassen sich nicht reduzieren. Sie beginnen erst, wenn die Grundausbildung abgeschlossen ist.',
  },
  {
    id: 'freigabe',
    title: 'Freigabe zur Prüfung',
    who: 'fahrschule',
    body: 'Die Fahrschule meldet dich zur praktischen Prüfung an, wenn die Pflichtfahrten vollständig sind und du bereit bist. Diese Entscheidung trifft ein Mensch, kein Automatismus.',
  },
  {
    id: 'praxispruefung',
    title: 'Praktische Prüfung',
    who: 'pruefstelle',
    body: 'Die praktische Prüfung wird von einer amtlich anerkannten Prüforganisation abgenommen — mit deiner Fahrlehrerin oder deinem Fahrlehrer im Fahrzeug.',
  },
  {
    id: 'fuehrerschein',
    title: 'Führerschein',
    who: 'behoerde',
    body: 'Nach bestandener Prüfung wird der Führerschein bei der Fahrerlaubnisbehörde ausgehändigt. Bei BF17 bekommst du zunächst eine Prüfungsbescheinigung mit den eingetragenen Begleitpersonen.',
  },
]

export const whoLabels: Record<GuideStage['who'], string> = {
  fahrschule: 'Fahrschule',
  du: 'Du',
  behoerde: 'Behörde',
  pruefstelle: 'Prüforganisation',
}

/** Cost categories, kept apart so nobody mistakes an authority fee for our price. */
export const costCategories = [
  {
    id: 'fahrschule',
    label: 'Leistungen der Fahrschule',
    body: 'Grundbetrag, Lehrmaterial, Fahrstunden, Sonderfahrten und die Vorstellung zu den Prüfungen.',
  },
  {
    id: 'behoerde',
    label: 'Gebühren der Behörde',
    body: 'Der Antrag bei der Führerscheinstelle. Die Höhe unterscheidet sich je nach Landkreis und Klasse.',
  },
  {
    id: 'pruefung',
    label: 'Gebühren der Prüforganisation',
    body: 'Theoretische und praktische Prüfung bei TÜV oder DEKRA. Bei jedem Antritt erneut fällig.',
  },
  {
    id: 'extern',
    label: 'Externe Nachweise',
    body: 'Sehtest, Erste-Hilfe-Kurs und Passbild — Preise je nach Anbieter unterschiedlich.',
  },
] as const

export const guideSources = fact(
  'Fahrerlaubnis-Verordnung (FeV), Fahrschüler-Ausbildungsordnung (FahrschAusbO) und Straßenverkehrsgesetz (StVG)',
  'Abgleich mit den Veröffentlichungen von TÜV, DEKRA und ADAC',
  REVIEWED,
  'confirmed',
)
