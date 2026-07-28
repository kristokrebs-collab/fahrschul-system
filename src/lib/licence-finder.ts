/**
 * Licence finder logic.
 *
 * Pure and testable: given the visitor's answers it scores every class in the
 * catalogue and returns a ranked recommendation with the reasons that produced
 * it. Nothing here is a legally binding assessment — it is guidance, and the UI
 * says so.
 */

import { licenceClasses, type LicenceClass } from '@/content/classes'

export type VehicleAnswer = 'auto' | 'motorrad' | 'roller' | 'anhaenger' | 'lkw' | 'bus'
export type AgeAnswer = 'unter16' | '16-17' | 'ab18' | 'ab21' | 'ab24'
export type LicenceAnswer = 'keine' | 'b' | 'b-automatik' | 'a1-a2' | 'c'
export type GearAnswer = 'schaltung' | 'automatik' | 'egal'
export type PurposeAnswer = 'privat' | 'beruflich' | 'spezial'

export interface FinderAnswers {
  vehicle?: VehicleAnswer
  age?: AgeAnswer
  licence?: LicenceAnswer
  gear?: GearAnswer
  purpose?: PurposeAnswer
  location?: 'fulda' | 'bad-hersfeld' | 'egal'
}

export interface Recommendation {
  readonly licenceClass: LicenceClass
  readonly score: number
  readonly reasons: readonly string[]
  /** Things the visitor cannot satisfy yet, e.g. an age they have not reached. */
  readonly blockers: readonly string[]
}

/** Rough numeric age floor implied by each answer, for comparing against classes. */
const AGE_FLOOR: Record<AgeAnswer, number> = {
  unter16: 15,
  '16-17': 16,
  ab18: 18,
  ab21: 21,
  ab24: 24,
}

/** The minimum age each class needs, as a number we can compare. */
const CLASS_MIN_AGE: Record<string, number> = {
  mofa: 15,
  am: 15,
  a1: 16,
  a2: 18,
  a: 24,
  'klasse-b': 18,
  bf17: 17,
  b197: 18,
  automatik: 18,
  be: 18,
  b96: 18,
  c1: 18,
  c1e: 18,
  c: 21,
  ce: 21,
  d: 24,
  de: 24,
}

const VEHICLE_CLASSES: Record<VehicleAnswer, readonly string[]> = {
  auto: ['klasse-b', 'bf17', 'b197', 'automatik'],
  motorrad: ['a1', 'a2', 'a'],
  roller: ['am', 'mofa'],
  anhaenger: ['b96', 'be'],
  lkw: ['c1', 'c1e', 'c', 'ce'],
  bus: ['d', 'de'],
}

export function recommend(answers: FinderAnswers): Recommendation[] {
  const { vehicle, age, licence, gear, purpose } = answers
  if (!vehicle) return []

  const candidates = VEHICLE_CLASSES[vehicle]
  const results: Recommendation[] = []

  for (const slug of candidates) {
    const licenceClass = licenceClasses.find((c) => c.slug === slug)
    if (!licenceClass) continue

    let score = 100
    const reasons: string[] = []
    const blockers: string[] = []

    // --- Age -------------------------------------------------------------
    const needed = CLASS_MIN_AGE[slug]
    if (needed !== undefined && age) {
      const have = AGE_FLOOR[age]
      if (have < needed) {
        // Not a hard exclusion — people plan ahead — but it sinks the ranking.
        score -= 45
        blockers.push(`Mindestalter ${needed} Jahre — das ist noch nicht erreicht.`)
      } else if (needed >= 21 && have >= needed) {
        reasons.push('Das Mindestalter ist erfüllt.')
      }
    }

    // BF17 is the better answer for anyone who is 16 or 17 and wants a car.
    if (slug === 'bf17') {
      if (age === '16-17') {
        score += 55
        reasons.push('Mit 17 kannst du schon starten und ein Jahr begleitet fahren.')
      } else if (age && AGE_FLOOR[age] >= 18) {
        score -= 60
      }
    }
    if (slug === 'klasse-b' && age === '16-17') {
      score -= 25
    }

    // --- Existing licence -------------------------------------------------
    if (licence) {
      const holdsB = licence === 'b' || licence === 'b-automatik'

      if ((slug === 'be' || slug === 'b96') && !holdsB) {
        score -= 40
        blockers.push('Dafür brauchst du zuerst die Klasse B.')
      }
      if ((slug === 'be' || slug === 'b96') && holdsB) {
        score += 25
        reasons.push('Du hast die Klasse B — das ist die Voraussetzung.')
      }
      if ((slug === 'c' || slug === 'ce' || slug === 'c1' || slug === 'c1e' || slug === 'd' || slug === 'de') && !holdsB && licence !== 'c') {
        score -= 30
        blockers.push('Voraussetzung ist eine bestehende Fahrerlaubnis der Klasse B.')
      }
      if (slug === 'ce' && licence === 'c') {
        score += 30
        reasons.push('Mit der Klasse C ist CE der direkte nächste Schritt.')
      }
      if (slug === 'a' && licence === 'a1-a2') {
        score += 25
        reasons.push('Mit Vorbesitz A2 ist der Aufstieg ab 20 Jahren möglich.')
      }
      // Someone already holding a licence needs less theory — worth saying.
      if (licence !== 'keine' && licenceClass.theory?.value.grundstoffMitVorbesitz) {
        reasons.push('Durch deinen Vorbesitz reduziert sich der Grundstoff auf sechs Doppelstunden.')
      }
      // Escaping an automatic restriction is exactly what B197 is for.
      if (slug === 'b197' && licence === 'b-automatik') {
        score += 40
        reasons.push('Damit lässt sich die Automatikbeschränkung ohne neue Prüfung auflösen.')
      }
    }

    // --- Gearbox preference ----------------------------------------------
    if (gear && vehicle === 'auto') {
      if (gear === 'automatik' && slug === 'automatik') {
        score += 35
        reasons.push('Reine Automatikausbildung — genau das hast du ausgewählt.')
      }
      if (gear === 'automatik' && slug === 'b197') {
        score += 25
        reasons.push('Du lernst auf Automatik und darfst trotzdem Schaltwagen fahren.')
      }
      if (gear === 'schaltung' && slug === 'automatik') {
        score -= 50
      }
      if (gear === 'schaltung' && slug === 'klasse-b') {
        score += 20
        reasons.push('Klassische Schaltausbildung.')
      }
      if (gear === 'egal' && slug === 'b197') {
        score += 15
        reasons.push('Hält dir beide Möglichkeiten offen.')
      }
    }

    // --- Purpose ----------------------------------------------------------
    if (purpose === 'beruflich') {
      if (['c', 'ce', 'c1', 'c1e', 'd', 'de'].includes(slug)) {
        score += 20
        reasons.push('Für den gewerblichen Einsatz kommt die Berufskraftfahrer-Qualifikation dazu.')
      }
    }
    if (purpose === 'spezial' && slug === 'klasse-b') {
      reasons.push('Für die Ausbildung mit Handicap beraten wir dich vorab persönlich.')
    }

    results.push({ licenceClass, score, reasons, blockers })
  }

  return results.sort((a, b) => b.score - a.score)
}

export interface FinderQuestion {
  readonly id: keyof FinderAnswers
  readonly question: string
  readonly hint?: string
  readonly options: readonly { value: string; label: string; description?: string }[]
}

export const finderQuestions: readonly FinderQuestion[] = [
  {
    id: 'vehicle',
    question: 'Was möchtest du fahren?',
    options: [
      { value: 'auto', label: 'Auto', description: 'PKW bis 3,5 Tonnen' },
      { value: 'motorrad', label: 'Motorrad', description: 'Von 125er bis offen' },
      { value: 'roller', label: 'Roller oder Mofa', description: 'Bis 45 km/h' },
      { value: 'anhaenger', label: 'Anhänger', description: 'Wohnwagen, Pferde, Boot' },
      { value: 'lkw', label: 'LKW', description: 'Ab 3,5 Tonnen' },
      { value: 'bus', label: 'Bus', description: 'Personenbeförderung' },
    ],
  },
  {
    id: 'age',
    question: 'Wie alt bist du?',
    hint: 'Das Mindestalter entscheidet, welche Klasse jetzt schon möglich ist.',
    options: [
      { value: 'unter16', label: 'Unter 16' },
      { value: '16-17', label: '16 oder 17' },
      { value: 'ab18', label: '18 bis 20' },
      { value: 'ab21', label: '21 bis 23' },
      { value: 'ab24', label: '24 oder älter' },
    ],
  },
  {
    id: 'licence',
    question: 'Hast du bereits eine Fahrerlaubnis?',
    hint: 'Vorbesitz verkürzt in vielen Fällen den Theorieunterricht.',
    options: [
      { value: 'keine', label: 'Noch keine' },
      { value: 'b', label: 'Klasse B' },
      { value: 'b-automatik', label: 'Klasse B, nur Automatik' },
      { value: 'a1-a2', label: 'Motorrad A1 oder A2' },
      { value: 'c', label: 'LKW-Klasse C' },
    ],
  },
  {
    id: 'gear',
    question: 'Schaltung oder Automatik?',
    hint: 'Nur für Autoklassen relevant.',
    options: [
      { value: 'schaltung', label: 'Schaltung' },
      { value: 'automatik', label: 'Automatik' },
      { value: 'egal', label: 'Noch unentschieden' },
    ],
  },
  {
    id: 'purpose',
    question: 'Wofür brauchst du den Führerschein?',
    options: [
      { value: 'privat', label: 'Privat' },
      { value: 'beruflich', label: 'Beruflich' },
      { value: 'spezial', label: 'Ich habe besondere Anforderungen' },
    ],
  },
  {
    id: 'location',
    question: 'Wo möchtest du ausgebildet werden?',
    options: [
      { value: 'fulda', label: 'Fulda' },
      { value: 'bad-hersfeld', label: 'Bad Hersfeld' },
      { value: 'egal', label: 'Ist mir egal' },
    ],
  },
]
