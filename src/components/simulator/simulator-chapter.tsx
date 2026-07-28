import Link from 'next/link'
import { ChapterHeading, Disclosure } from '@/components/brand/section'

/**
 * Chapter 6 — the simulator.
 *
 * Honesty constraint that shaped this section: research confirmed the school
 * trains with a driving simulator, but found no source for how many there are
 * or which licence classes they cover. So the chapter argues the *purpose* of
 * simulator training — which is verifiable and genuinely persuasive — and makes
 * no claim about hardware count or class coverage. It also states plainly that
 * the simulator supplements rather than replaces the legally required lessons.
 *
 * No gaming aesthetic, no fake dashboard: the visual is the same lane geometry
 * used everywhere else, seen from the driver's position.
 */

const SITUATIONS = [
  {
    title: 'Bedienung ohne Verkehr',
    body: 'Anfahren, Schalten, Lenken und Blickführung zuerst in Ruhe — ohne dass hinter dir jemand wartet.',
  },
  {
    title: 'Situationen wiederholen',
    body: 'Eine Kreuzung, die nicht sitzt, lässt sich zehnmal fahren. Im echten Verkehr kommt sie einmal.',
  },
  {
    title: 'Fehler ohne Folgen',
    body: 'Was schiefgeht, kostet hier nichts außer einem Neustart. Genau das nimmt den Druck raus.',
  },
  {
    title: 'Sicherer in die erste Fahrstunde',
    body: 'Wer die Abläufe schon kennt, kann sich vom ersten Meter an auf den Verkehr konzentrieren.',
  },
]

export function SimulatorChapter() {
  return (
    <section className="chapter relative overflow-hidden" aria-labelledby="simulator" data-atmo="60/45">
      <div className="shell relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16">
          <div>
            <ChapterHeading
              marker="Kapitel 06 — Simulator"
              id="simulator"
              title={
                <>
                  Erst üben.
                  <br />
                  Dann in den Verkehr.
                </>
              }
              lead="Die ersten Fahrstunden sind die teuersten Minuten der Ausbildung — weil so viel gleichzeitig neu ist. Im Simulator nimmst du einen Teil davon vorweg, in deinem Tempo und ohne Zuschauer."
            />

            <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {SITUATIONS.map((situation) => (
                <div key={situation.title} className="border-l-2 border-signal-500/40 pl-4">
                  <dt className="font-display text-base font-bold text-chalk">{situation.title}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-chalk-dim">{situation.body}</dd>
                </div>
              ))}
            </dl>

            <Disclosure>
              Das Simulatortraining ergänzt die praktische Ausbildung — es ersetzt keine der gesetzlich
              vorgeschriebenen Fahrstunden. Welche Einheiten für deine Klasse sinnvoll sind, besprechen wir bei der
              Anmeldung.
            </Disclosure>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/simulator"
                className="inline-flex min-h-12 items-center rounded-xl bg-signal-500 px-6 text-sm font-semibold text-chalk transition-colors hover:bg-signal-600"
              >
                Simulator kennenlernen
              </Link>
              <Link
                href="/kontakt"
                className="inline-flex min-h-12 items-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-chalk/35"
              >
                Nach Simulatorterminen fragen
              </Link>
            </div>
          </div>

          <DriverView />
        </div>
      </div>
    </section>
  )
}

/**
 * The simulator station: a triple-screen training rig with seat and console,
 * drawn as geometry rather than photographed. The road scene on the centre
 * screen is the same carriageway language used everywhere on the site; the
 * side screens continue it at an angle, which is what visually separates a
 * professional training rig from a gaming setup.
 */
function DriverView() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-chalk/12 bg-ink-900">
        <svg viewBox="0 0 440 330" className="block w-full" aria-hidden focusable="false">
          <defs>
            <linearGradient id="sim-screen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink-800)" />
              <stop offset="100%" stopColor="var(--color-ink-950)" />
            </linearGradient>
            <radialGradient id="sim-glow2" cx="50%" cy="30%" r="45%">
              <stop offset="0%" stopColor="var(--color-signal-500)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-signal-500)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="440" height="330" fill="var(--color-ink-900)" />
          <rect width="440" height="330" fill="url(#sim-glow2)" />

          {/* ── Side screens, angled toward the seat ── */}
          <g>
            <path d="M28 52 L128 66 L128 176 L28 196 Z" fill="url(#sim-screen)" stroke="var(--color-ink-600)" strokeWidth="2" />
            <path d="M412 52 L312 66 L312 176 L412 196 Z" fill="url(#sim-screen)" stroke="var(--color-ink-600)" strokeWidth="2" />
            {/* side-screen road edges continuing the centre scene */}
            <path d="M52 178 L116 118" stroke="var(--color-chalk)" strokeOpacity="0.18" strokeWidth="3" />
            <path d="M388 178 L324 118" stroke="var(--color-chalk)" strokeOpacity="0.18" strokeWidth="3" />
          </g>

          {/* ── Centre screen with the carriageway ── */}
          <g>
            <rect x="132" y="58" width="176" height="122" rx="4" fill="url(#sim-screen)" stroke="var(--color-ink-600)" strokeWidth="2.5" />
            <path d="M164 176 L212 92 L228 92 L276 176 Z" fill="var(--color-ink-750)" opacity="0.7" />
            <path d="M164 176 L212 92" stroke="var(--color-chalk)" strokeOpacity="0.3" strokeWidth="1.5" />
            <path d="M276 176 L228 92" stroke="var(--color-chalk)" strokeOpacity="0.3" strokeWidth="1.5" />
            {[[172, 6], [152, 4.4], [136, 3.2], [124, 2.2], [115, 1.5]].map(([y, w], i) => (
              <rect key={i} x={220 - (w as number) / 2} y={y} width={w as number} height={(w as number) * 1.4} fill="var(--color-signal-500)" opacity={0.9 - i * 0.16} />
            ))}
            <line x1="140" y1="92" x2="300" y2="92" stroke="var(--color-chalk)" strokeOpacity="0.1" />
          </g>

          {/* ── Instructor side monitor ── */}
          <rect x="366" y="210" width="52" height="34" rx="3" fill="var(--color-ink-850)" stroke="var(--color-ink-600)" strokeWidth="2" />
          <line x1="392" y1="244" x2="392" y2="270" stroke="var(--color-ink-600)" strokeWidth="4" />

          {/* ── Console: wheel and dash ── */}
          <path d="M150 208 H290 L282 232 H158 Z" fill="var(--color-ink-800)" stroke="var(--color-ink-600)" strokeWidth="2" />
          <circle cx="220" cy="216" r="26" fill="none" stroke="var(--color-ink-500)" strokeWidth="7" />
          <circle cx="220" cy="216" r="26" fill="none" stroke="var(--color-chalk)" strokeOpacity="0.1" strokeWidth="1.5" />

          {/* ── Seat in profile ── */}
          <g>
            <path d="M96 176 q-10 -4 -12 8 l-6 66 q-1 12 10 12 h34 q10 0 12 -10 l4 -22 q2 -10 12 -10 h28 v-14 h-34 q-14 0 -18 12 l-3 10" fill="var(--color-ink-750)" stroke="var(--color-ink-600)" strokeWidth="2" />
            <rect x="78" y="262" width="180" height="10" rx="4" fill="var(--color-ink-800)" />
          </g>

          {/* ── Base plate ── */}
          <rect x="48" y="286" width="344" height="10" rx="5" fill="var(--color-ink-800)" />
          <rect x="48" y="286" width="344" height="10" rx="5" fill="none" stroke="var(--color-signal-500)" strokeOpacity="0.35" strokeWidth="1" />

          {/* pedal block */}
          <path d="M126 262 l18 -18 h22 l-14 18 Z" fill="var(--color-ink-700)" />
        </svg>
      </div>
      <p className="mt-3 text-center text-xs text-chalk-faint">
        Schematische Darstellung eines Simulatorplatzes mit drei Bildschirmen
      </p>
    </div>
  )
}
