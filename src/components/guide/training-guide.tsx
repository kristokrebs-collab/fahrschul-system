import { costCategories, guideSources, guideStages, whoLabels } from '@/content/guide'
import { publicValue } from '@/content/truth'
import { ChapterHeading } from '@/components/brand/section'
import { SceneVideo } from '@/components/media/scene-video'
import { sceneClips } from '@/content/media'
import { GuideBeam } from './guide-beam'

/**
 * Chapter 8 — the route to the licence.
 *
 * Presented as a milestone route rather than a bureaucratic checklist: each
 * stage says plainly *who* has to act, which is the thing people actually get
 * lost in. The four cost categories are separated for the same reason — so an
 * authority fee is never mistaken for something the driving school charges.
 */
export function TrainingGuide() {
  const sources = publicValue(guideSources)

  return (
    <section className="chapter chapter-day relative overflow-hidden" aria-labelledby="ausbildungsweg" data-atmo="34/50">
      {/* Paperwork aligning into a road — exactly what this chapter explains */}
      <SceneVideo
        name={sceneClips.documentsRoad.name}
        hd={sceneClips.documentsRoad.hd}
        className="media-weld-y opacity-30"
      />
      <div className="shell relative">
        <ChapterHeading
          marker="Kapitel 08 — Dein Weg"
          id="ausbildungsweg"
          title="Was du brauchst, und wann"
          lead="Der Führerschein ist kein Behördenlabyrinth, wenn man die Reihenfolge kennt. Hier ist sie — mit dem Hinweis, wer jeweils am Zug ist."
        />

        <GuideBeam className="relative mt-14 space-y-2">
          {/* The route line the milestones sit on… */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-6 left-[7px] top-6 w-px bg-gradient-to-b from-signal-500/40 via-chalk/12 to-transparent"
          />
          {/* …and the beam the reader draws along it by scrolling */}
          <span aria-hidden className="guide-beam-fill" />

          {guideStages.map((stage, index) => (
            <li key={stage.id} className="relative pl-9">
              <span
                aria-hidden
                className="guide-dot absolute left-0 top-[1.375rem] h-3.5 w-3.5 rounded-full border-2 border-signal-500/60 bg-ink-950"
              />
              <div className="rounded-xl border border-chalk/8 bg-ink-900/40 p-5 transition-colors hover:border-chalk/16">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tabular text-[0.6875rem] font-bold tracking-widest text-chalk-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-display text-lg font-bold text-chalk">{stage.title}</h3>
                  <span className="ml-auto rounded-md border border-chalk/12 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-chalk-dim">
                    {whoLabels[stage.who]}
                  </span>
                </div>

                <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-chalk-dim">{stage.body}</p>

                {stage.items && (
                  <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                    {stage.items.map((item) => (
                      <li key={item} className="flex gap-2.5 text-xs leading-relaxed text-chalk-soft">
                        <span aria-hidden className="mt-1.5 h-1 w-2.5 shrink-0 rounded-sm bg-signal-500/60" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </GuideBeam>

        <div className="mt-14">
          <h3 className="font-display text-xl font-bold text-chalk">Wer bekommt eigentlich welches Geld?</h3>
          <p className="mt-2 max-w-2xl text-sm text-chalk-dim">
            Ein Teil der Kosten geht gar nicht an die Fahrschule. Diese vier Töpfe sauber zu trennen ist der
            wichtigste Schritt, um Angebote fair zu vergleichen.
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {costCategories.map((category) => (
              <div key={category.id} className="rounded-xl border border-chalk/10 bg-ink-850/50 p-5">
                <dt className="font-display text-sm font-bold text-chalk">{category.label}</dt>
                <dd className="mt-2 text-xs leading-relaxed text-chalk-dim">{category.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        {sources && (
          <p className="mt-8 text-xs text-chalk-faint">
            Rechtliche Grundlage: {sources}. Stand: Juli 2026. Rechtsvorschriften ändern sich — was in deinem Fall
            gilt, klären wir im Beratungsgespräch.
          </p>
        )}
      </div>
    </section>
  )
}
