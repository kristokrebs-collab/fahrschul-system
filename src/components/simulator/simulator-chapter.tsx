import Link from 'next/link'
import { ChapterHeading, Disclosure } from '@/components/brand/section'
import { SceneVideo } from '@/components/media/scene-video'
import { sceneClips } from '@/content/media'

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
 * The simulator station, staged like the rest of the fleet: a camera orbit
 * around a triple-screen training rig on a dark stage. Reduced-motion and
 * Save-Data visitors get the poster frame — same rig, same light.
 */
function DriverView() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <figure className="overflow-hidden rounded-2xl border border-chalk/12 bg-ink-900">
        <SceneVideo
          name={sceneClips.simOrbit.name}
          hd={sceneClips.simOrbit.hd}
          variant="panel"
          className="aspect-video w-full"
        />
      </figure>
      <p className="mt-3 text-center text-xs text-chalk-faint">
        Studio-Inszenierung eines Simulatorplatzes mit drei Bildschirmen
      </p>
    </div>
  )
}
