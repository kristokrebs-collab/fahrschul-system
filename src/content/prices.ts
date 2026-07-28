import { fact, type Fact } from './truth'

/**
 * Price model.
 *
 * CRITICAL FINDING — read before adding numbers here.
 * The Fahrschule Krebs GmbH in Fulda/Bad Hersfeld publishes no price list.
 * A price list that circulated during this project (Grundbetrag 399 €,
 * Fahrstunde 64 €, Sonderfahrt 76 €, …) traces back to a DIFFERENT and
 * unrelated company of the same name in Freigericht/Gelnhausen. Publishing
 * those figures would put a competitor's prices on this website.
 *
 * Therefore no Krebs rate is published. Every entry below is `unverified`,
 * which means `publicValue()` returns undefined and the calculator renders
 * "auf Anfrage" instead of a number.
 *
 * The calculator itself is fully functional: it computes from whatever rates
 * are supplied, and its comparison mode works entirely on figures the visitor
 * enters from real offers. As soon as the owner supplies the real list, change
 * the value and the confidence here — nothing else needs to change.
 */

const REVIEWED = '2026-07-27'

const NO_SOURCE =
  'Für die Fahrschule Krebs GmbH (Fulda/Bad Hersfeld) ist keine Preisliste veröffentlicht. Werte aus fremden Quellen wurden bewusst nicht übernommen.'

export type CostKind = 'fahrschule' | 'extern'

export interface PriceItem {
  readonly id: string
  readonly label: string
  /** What one unit is, e.g. "je 45 Minuten". */
  readonly unit: string
  readonly kind: CostKind
  readonly explanation: string
  /** Quantity cannot be changed by the visitor because the law fixes it. */
  readonly fixedQuantity?: boolean
  readonly rate: Fact<number>
}

/**
 * Driving-school line items. `rate` is in euro.
 * All currently withheld — see the note at the top of this file.
 */
export const priceItems: readonly PriceItem[] = [
  {
    id: 'grundbetrag',
    label: 'Grundbetrag',
    unit: 'einmalig',
    kind: 'fahrschule',
    explanation:
      'Deckt Anmeldung, Verwaltung, den gesamten Theorieunterricht und die Betreuung während der Ausbildung ab.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'lehrmaterial',
    label: 'Lehrmaterial',
    unit: 'einmalig',
    kind: 'fahrschule',
    explanation: 'Lernsystem und Unterlagen für die Theorieprüfung.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'fahrstunde',
    label: 'Übungsfahrstunde',
    unit: 'je 45 Minuten',
    kind: 'fahrschule',
    explanation:
      'Die Anzahl ist gesetzlich nicht vorgeschrieben. Wie viele du brauchst, hängt von Vorerfahrung, Übungsmöglichkeiten und Lerntempo ab — deshalb ist das hier eine Schätzung, keine Zusage.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'sonderfahrt',
    label: 'Sonderfahrt',
    unit: 'je 45 Minuten',
    kind: 'fahrschule',
    explanation:
      'Überland-, Autobahn- und Nachtfahrten. Die Anzahl schreibt die Fahrschüler-Ausbildungsordnung vor und ist deshalb fest.',
    fixedQuantity: true,
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'simulator',
    label: 'Simulatoreinheit',
    unit: 'je Einheit',
    kind: 'fahrschule',
    explanation: 'Training am Fahrsimulator vor den ersten Fahrten im echten Verkehr.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'vorstellung-theorie',
    label: 'Vorstellung zur Theorieprüfung',
    unit: 'je Antritt',
    kind: 'fahrschule',
    explanation: 'Gebühr der Fahrschule für die Anmeldung und Vorstellung zur theoretischen Prüfung.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
  {
    id: 'vorstellung-praxis',
    label: 'Vorstellung zur praktischen Prüfung',
    unit: 'je Antritt',
    kind: 'fahrschule',
    explanation:
      'Gebühr der Fahrschule für die Vorstellung zur praktischen Prüfung — enthält das Fahrzeug und die Begleitung.',
    rate: fact(0, NO_SOURCE, REVIEWED, 'unverified'),
  },
]

/**
 * Costs that are not paid to the driving school. They are shown separately so
 * that a comparison between two driving schools is not distorted by fees that
 * are identical no matter where you train.
 */
export interface ExternalCost {
  readonly id: string
  readonly label: string
  readonly explanation: string
  readonly amount: Fact<{ from: number; to: number }>
}

export const externalCosts: readonly ExternalCost[] = [
  {
    id: 'antrag',
    label: 'Antrag bei der Führerscheinstelle',
    explanation: 'Gebühr der Fahrerlaubnisbehörde. Sie unterscheidet sich je nach Landkreis und Klasse.',
    amount: fact({ from: 0, to: 0 }, 'Regional unterschiedlich — noch nicht mit einer amtlichen Quelle belegt', REVIEWED, 'unverified'),
  },
  {
    id: 'sehtest',
    label: 'Sehtest',
    explanation: 'Bei Optikerinnen, Optikern oder Augenärztinnen und Augenärzten.',
    amount: fact({ from: 0, to: 0 }, 'Anbieterabhängig — noch nicht belegt', REVIEWED, 'unverified'),
  },
  {
    id: 'erste-hilfe',
    label: 'Erste-Hilfe-Kurs',
    explanation: 'Neun Unterrichtseinheiten bei einer anerkannten Stelle.',
    amount: fact({ from: 0, to: 0 }, 'Anbieterabhängig — noch nicht belegt', REVIEWED, 'unverified'),
  },
  {
    id: 'pruefung-theorie',
    label: 'Theoretische Prüfung',
    explanation: 'Gebühr der amtlich anerkannten Prüforganisation (TÜV oder DEKRA).',
    amount: fact({ from: 0, to: 0 }, 'Noch nicht mit einer aktuellen Gebührenordnung belegt', REVIEWED, 'unverified'),
  },
  {
    id: 'pruefung-praxis',
    label: 'Praktische Prüfung',
    explanation: 'Gebühr der amtlich anerkannten Prüforganisation (TÜV oder DEKRA).',
    amount: fact({ from: 0, to: 0 }, 'Noch nicht mit einer aktuellen Gebührenordnung belegt', REVIEWED, 'unverified'),
  },
]

/**
 * Default quantities for an estimate. Sonderfahrten are fixed by law; the
 * number of practice lessons is genuinely unknowable in advance, so the
 * calculator presents it as an adjustable assumption and says so.
 */
export interface Assumption {
  readonly itemId: string
  readonly quantity: number
  readonly min: number
  readonly max: number
  readonly note?: string
}

export const defaultAssumptions: Record<'klasse-b' | 'bf17', readonly Assumption[]> = {
  'klasse-b': [
    { itemId: 'grundbetrag', quantity: 1, min: 1, max: 1 },
    { itemId: 'lehrmaterial', quantity: 1, min: 0, max: 1 },
    { itemId: 'simulator', quantity: 0, min: 0, max: 10, note: 'Falls Simulatoreinheiten Teil deiner Ausbildung sind.' },
    {
      itemId: 'fahrstunde',
      quantity: 20,
      min: 0,
      max: 80,
      note: 'Reine Annahme. Der bundesweite Durchschnitt liegt höher, als die meisten erwarten — plane lieber großzügig.',
    },
    { itemId: 'sonderfahrt', quantity: 12, min: 12, max: 12, note: 'Gesetzlich vorgeschrieben: 5 Überland-, 4 Autobahn- und 3 Nachtfahrten.' },
    { itemId: 'vorstellung-theorie', quantity: 1, min: 1, max: 5 },
    { itemId: 'vorstellung-praxis', quantity: 1, min: 1, max: 5 },
  ],
  bf17: [
    { itemId: 'grundbetrag', quantity: 1, min: 1, max: 1 },
    { itemId: 'lehrmaterial', quantity: 1, min: 0, max: 1 },
    { itemId: 'simulator', quantity: 0, min: 0, max: 10 },
    { itemId: 'fahrstunde', quantity: 20, min: 0, max: 80, note: 'Reine Annahme — die tatsächliche Zahl hängt von dir ab.' },
    { itemId: 'sonderfahrt', quantity: 12, min: 12, max: 12, note: 'Gesetzlich vorgeschrieben: 5 Überland-, 4 Autobahn- und 3 Nachtfahrten.' },
    { itemId: 'vorstellung-theorie', quantity: 1, min: 1, max: 5 },
    { itemId: 'vorstellung-praxis', quantity: 1, min: 1, max: 5 },
  ],
}

export function priceItemById(id: string): PriceItem | undefined {
  return priceItems.find((p) => p.id === id)
}

/** True when at least one Krebs rate has been confirmed and may be displayed. */
export function hasPublishedRates(): boolean {
  return priceItems.some((p) => p.rate.confidence === 'confirmed' || p.rate.confidence === 'likely')
}
