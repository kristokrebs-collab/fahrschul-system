import { fact, type Fact } from './truth'

/**
 * The digital training system.
 *
 * IMPORTANT — honesty rule for this file.
 * The original brief listed a number of digital features (a theory audio book,
 * an e-book on exam anxiety, "more than 80 learning videos", a fixed number of
 * simulators, a live student app). Independent research could not find a public
 * source for any of them. They are therefore NOT presented as existing
 * products. Each element carries an explicit `status`:
 *
 *   'verfuegbar' — publicly evidenced today, shown normally.
 *   'vorschau'   — shown, but visibly labelled as a preview of something that
 *                  is being built. Never phrased as if a visitor can use it now.
 *   'geprueft'   — withheld from the page entirely until confirmed.
 *
 * Flipping an element to 'verfuegbar' is a one-line change once the owner
 * confirms it. See docs/business-confirmations-needed.md.
 */

const REVIEWED = '2026-07-27'

export type ElementStatus = 'verfuegbar' | 'vorschau' | 'geprueft'

export interface DigitalElement {
  readonly id: string
  readonly name: string
  readonly status: ElementStatus
  readonly headline: string
  readonly body: string
  readonly detail: readonly string[]
  readonly evidence: Fact<string>
}

export const digitalElements: readonly DigitalElement[] = [
  {
    id: 'theorie',
    name: 'Theorie mit System',
    status: 'verfuegbar',
    headline: 'Mehrere Themen pro Tag statt einer Chance pro Woche',
    body:
      'In Fulda laufen von Montag bis Donnerstag drei verschiedene Theoriethemen pro Tag, dazu eigene Termine für LKW und Motorrad. In Bad Hersfeld gibt es sechs Termine pro Woche. Wer schnell durch will, kommt schnell durch — wer nebenbei arbeitet, findet trotzdem einen Termin.',
    detail: [
      'Drei parallele Themen pro Tag in Fulda, Montag bis Donnerstag',
      'Eigene LKW-Theorie montags und donnerstags',
      'Motorrad-Theorie mittwochs im Zwei-Wochen-Rhythmus',
      'Anmeldung online, höchstens zwei Unterrichtseinheiten pro Tag',
    ],
    evidence: fact('Eigene Website, Theorie-Seite', 'fulda.fahrschule-krebs.de/theorie/', REVIEWED, 'likely'),
  },
  {
    id: 'simulator',
    name: 'Simulatortraining',
    status: 'verfuegbar',
    headline: 'Erst üben, dann in den Verkehr',
    body:
      'Im Fahrsimulator lernst du Bedienung, Blickführung und Abläufe, bevor du sie zum ersten Mal im echten Verkehr brauchst. Situationen lassen sich beliebig oft wiederholen — ohne Zeitdruck, ohne Publikum und ohne dass hinter dir jemand hupt.',
    detail: [
      'Grundfahraufgaben, Abbiegen und Vorfahrt in wiederholbaren Situationen',
      'Ruhiger Einstieg in Bedienung und Abläufe',
      'Ergänzt die praktische Ausbildung, ersetzt sie nicht',
    ],
    evidence: fact(
      'Simulator-Ausbildung als beworbene Leistung, eigenes Video „VOGEL Simulator der Fahrschule Krebs GmbH"',
      'Eigene Facebook- und YouTube-Kanäle; fahrschule-123; clickclickdrive',
      REVIEWED,
      'confirmed',
      'Bestätigt ist, DASS mit Simulator ausgebildet wird. Anzahl der Simulatoren und abgedeckte Klassen sind nicht belegt und werden deshalb nicht genannt.',
    ),
  },
  {
    id: 'ferienfahrschule',
    name: 'Ferienfahrschule',
    status: 'verfuegbar',
    headline: 'Der Führerschein am Stück',
    body:
      'Ein strukturierter Intensivkurs in Theorie und Praxis — und weil er nicht an Schulferien gebunden ist, geht er grundsätzlich das ganze Jahr. Theorie und Praxis laufen parallel oder versetzt, je nachdem, was zu deinem Zeitplan passt.',
    detail: [
      'Theorie in kurzer Zeit vollständig absolvieren',
      'Praxis parallel oder versetzt nach Absprache',
      'Ganzjährig möglich, nicht nur in den Ferien',
    ],
    evidence: fact('Eigene Website, Seite Ferienfahrschule', 'fulda.fahrschule-krebs.de/ferienfahrschule/', REVIEWED, 'confirmed'),
  },
  {
    id: 'anmeldung',
    name: 'Online anmelden',
    status: 'verfuegbar',
    headline: 'Der Papierkram beginnt digital',
    body:
      'Voranmeldung und die Anmeldung zum Theorieunterricht laufen online. Du musst dafür nicht ins Büro kommen und dich nicht in eine Warteschlange stellen.',
    detail: ['Online-Voranmeldung für die Ausbildung', 'Online-Buchung der Theorietermine'],
    evidence: fact('Eigene Website, Seiten Voranmeldung und Theorie', 'fulda.fahrschule-krebs.de/voranmeldung/', REVIEWED, 'confirmed'),
  },
  {
    id: 'cockpit',
    name: 'Schüler-Cockpit',
    status: 'vorschau',
    headline: 'Dein Ausbildungsstand, jederzeit einsehbar',
    body:
      'Wir bauen gerade ein digitales Cockpit, in dem alles zusammenläuft: Ausbildungsstand, Termine, Unterlagen, Rückmeldungen aus den Fahrstunden und der Blick darauf, was als Nächstes ansteht. Die folgende Ansicht zeigt mit Beispieldaten, wie das aussehen wird.',
    detail: [
      'Ausbildungsfortschritt über alle Stationen',
      'Termine, Unterlagen und offene Aufgaben an einem Ort',
      'Rückmeldung nach jeder Fahrstunde',
      'Nachvollziehbarer Stand statt Nachfragen im Büro',
    ],
    evidence: fact(
      'Interne Entwicklung — öffentlich noch nicht verfügbar',
      'Kein öffentlicher Beleg für eine bereits nutzbare Schüler-App gefunden',
      REVIEWED,
      'unverified',
      'Als Vorschau gekennzeichnet. Vor einer Umstellung auf „verfügbar" muss der Start bestätigt sein.',
    ),
  },
]

/**
 * Elements that were claimed in the original brief but have no public source.
 * They are listed here so nothing is silently dropped — and so the moment a
 * source exists, adding them back is obvious.
 */
export const unconfirmedElements: readonly { name: string; reason: string }[] = [
  { name: 'Hörbuch zur Theorie', reason: 'Kein öffentlicher Beleg gefunden.' },
  { name: 'E-Book gegen Prüfungsangst', reason: 'Kein öffentlicher Beleg gefunden.' },
  { name: 'Über 80 Lernvideos aus Fulda', reason: 'Belegt ist nur eine dokumentarische Videoreihe von 2016/17, keine Lernvideo-Bibliothek.' },
  { name: 'Anzahl der Simulatoren', reason: 'Belegt ist die Ausbildung am Simulator, nicht deren Anzahl oder die abgedeckten Klassen.' },
  { name: 'Intensivtheorie in neun Werktagen', reason: 'Keine veröffentlichte Zusage gefunden.' },
]

export function elementsByStatus(status: ElementStatus): DigitalElement[] {
  return digitalElements.filter((e) => e.status === status)
}

/** Elements that may appear on the page at all. */
export const publishableElements = digitalElements.filter((e) => e.status !== 'geprueft')
