import Link from 'next/link'
import { publishableElements } from '@/content/digital-package'
import { ChapterHeading } from '@/components/brand/section'
import { MarkDigital, MarkRoute, MarkSimulator } from '@/components/brand/marks'

const ELEMENT_MARK: Record<string, (props: { className?: string }) => React.ReactElement> = {
  theorie: MarkRoute,
  simulator: MarkSimulator,
  ferienfahrschule: MarkRoute,
  anmeldung: MarkDigital,
  cockpit: MarkDigital,
}

/**
 * Chapter 4 — how the parts connect.
 *
 * Presented as one system rather than a grid of feature cards: the elements sit
 * on a shared line in the order a student meets them. Anything still in
 * development is visibly marked as a preview rather than quietly implied to
 * exist — see src/content/digital-package.ts for why that distinction is
 * enforced in data rather than left to copywriting.
 */
export function DigitalSystem() {
  return (
    <section className="chapter relative" aria-labelledby="digitalsystem">
      <div className="atmos-lanes" />
      <div className="shell relative">
        <ChapterHeading
          marker="Kapitel 04 — Das System"
          id="digitalsystem"
          title={
            <>
              Nicht nur Fahrstunden.
              <br />
              Ein Ablauf, der zusammenpasst.
            </>
          }
          lead="Theorie, Simulator und Praxis sind bei uns keine getrennten Baustellen. Sie greifen ineinander — und du siehst an jedem Punkt, wo du stehst."
        />

        <ol className="relative mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {publishableElements.map((element, index) => {
            const Mark = ELEMENT_MARK[element.id] ?? MarkDigital
            const preview = element.status === 'vorschau'

            return (
              <li
                key={element.id}
                className={`relative flex flex-col rounded-2xl border p-6 ${
                  preview ? 'border-chalk/10 bg-ink-900/50' : 'border-chalk/10 bg-ink-850/60'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <Mark className={`h-6 w-6 ${preview ? 'text-chalk-faint' : 'text-signal-400'}`} />
                  <span className="tabular text-[0.6875rem] font-semibold tracking-widest text-chalk-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold text-chalk">{element.name}</h3>
                  {preview && (
                    <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-amber-400">
                      In Entwicklung
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm font-semibold text-chalk-soft">{element.headline}</p>
                <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{element.body}</p>

                <ul className="mt-5 space-y-1.5 border-t border-chalk/8 pt-4">
                  {element.detail.map((line) => (
                    <li key={line} className="flex gap-2.5 text-xs leading-relaxed text-chalk-dim">
                      <span aria-hidden className="mt-1.5 h-1 w-2.5 shrink-0 rounded-sm bg-signal-500/60" />
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/digitalpaket"
            className="inline-flex min-h-12 items-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-chalk/35"
          >
            Digitalpaket im Detail
          </Link>
          <Link
            href="/schueler-cockpit"
            className="inline-flex min-h-12 items-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-chalk/35"
          >
            Cockpit entdecken
          </Link>
        </div>
      </div>
    </section>
  )
}
