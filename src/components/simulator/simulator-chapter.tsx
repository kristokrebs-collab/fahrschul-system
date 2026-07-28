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
    <section className="chapter relative overflow-hidden" aria-labelledby="simulator">
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
 * The driver's view: the same carriageway language as the hero, but framed by
 * a windscreen rather than seen from above. Pure SVG, no photography needed.
 */
function DriverView() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-chalk/12 bg-ink-900">
        <svg viewBox="0 0 400 300" className="block w-full" aria-hidden focusable="false">
          <defs>
            <linearGradient id="sim-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink-800)" />
              <stop offset="100%" stopColor="var(--color-ink-900)" />
            </linearGradient>
            <linearGradient id="sim-road" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink-750)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--color-ink-700)" stopOpacity="0.6" />
            </linearGradient>
            <radialGradient id="sim-glow" cx="50%" cy="42%" r="30%">
              <stop offset="0%" stopColor="var(--color-signal-500)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--color-signal-500)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="400" height="300" fill="url(#sim-sky)" />
          <rect width="400" height="300" fill="url(#sim-glow)" />

          {/* Carriageway */}
          <path d="M120 300 L190 126 L210 126 L280 300 Z" fill="url(#sim-road)" />
          <path d="M120 300 L190 126" stroke="var(--color-chalk)" strokeOpacity="0.28" strokeWidth="2" />
          <path d="M280 300 L210 126" stroke="var(--color-chalk)" strokeOpacity="0.28" strokeWidth="2" />

          {/* Centre markings, compressing toward the horizon */}
          {[
            [300, 268, 6],
            [252, 232, 4.6],
            [216, 202, 3.4],
            [188, 178, 2.5],
            [166, 158, 1.8],
            [149, 143, 1.3],
          ].map(([y1, y2, w], i) => (
            <path
              key={i}
              d={`M${200 - (w as number) / 2} ${y1} L${200 + (w as number) / 2} ${y1} L${200 + (w as number) / 2.6} ${y2} L${200 - (w as number) / 2.6} ${y2} Z`}
              fill="var(--color-signal-500)"
              opacity={0.9 - i * 0.13}
            />
          ))}

          <line x1="0" y1="126" x2="400" y2="126" stroke="var(--color-chalk)" strokeOpacity="0.08" />

          {/* Windscreen frame and wheel rim — suggestion, not a fake HUD */}
          <path d="M0 0 H400 V22 Q200 44 0 22 Z" fill="var(--color-ink-950)" opacity="0.85" />
          <path
            d="M60 300 Q200 214 340 300"
            fill="none"
            stroke="var(--color-ink-700)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M60 300 Q200 214 340 300"
            fill="none"
            stroke="var(--color-chalk)"
            strokeOpacity="0.08"
            strokeWidth="1.5"
          />
        </svg>
      </div>
      <p className="mt-3 text-center text-xs text-chalk-faint">
        Schematische Darstellung der Fahrerperspektive
      </p>
    </div>
  )
}
