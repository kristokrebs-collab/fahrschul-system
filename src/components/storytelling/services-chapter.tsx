import Link from 'next/link'
import { serviceGroupOrder, serviceGroups, servicesByGroup } from '@/content/services'
import { publicValue } from '@/content/truth'
import { ChapterHeading } from '@/components/brand/section'
import { MarkProfessional, MarkSeminar, MarkSpecial, MarkPricing } from '@/components/brand/marks'
import type { ServiceGroup } from '@/content/services'

const GROUP_MARK: Record<ServiceGroup, (props: { className?: string }) => React.ReactElement> = {
  beruf: MarkProfessional,
  logistik: MarkPricing,
  seminare: MarkSeminar,
  spezial: MarkSpecial,
}

/**
 * Chapter 9 — more than a driving licence.
 *
 * These are real revenue lines for the business and are given the same visual
 * weight as the licence classes rather than being dumped into a footer list.
 * Grouping is by who the customer is, not by internal category.
 */
export function ServicesChapter() {
  return (
    <section className="chapter relative" aria-labelledby="leistungen" data-atmo="42/40">
      <div className="shell relative">
        <ChapterHeading
          marker="Kapitel 09 — Beruf & Spezial"
          id="leistungen"
          title="Mehr als ein Führerschein"
          lead="Ein großer Teil unserer Arbeit beginnt erst, wenn der Führerschein längst da ist: Qualifikationen für den Beruf, Schulungen für Betriebe, Seminare nach Auffälligkeiten — und eine Ausbildung, die sich nach dem Menschen richtet."
        />

        <div className="mt-14 space-y-12">
          {serviceGroupOrder.map((group) => {
            const Mark = GROUP_MARK[group]
            const items = servicesByGroup(group)

            return (
              <div key={group}>
                <div className="flex items-center gap-3 border-b border-chalk/8 pb-4">
                  <Mark className="h-5 w-5 text-signal-400" />
                  <h3 className="font-display text-xl font-bold text-chalk">{serviceGroups[group].label}</h3>
                  <p className="ml-auto hidden max-w-md text-right text-xs text-chalk-faint sm:block">
                    {serviceGroups[group].blurb}
                  </p>
                </div>

                <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((service) => {
                    const format = publicValue(service.format)
                    return (
                      <li key={service.slug}>
                        <Link
                          href={`/leistungen/${service.slug}`}
                          className="group flex h-full flex-col rounded-2xl border border-chalk/10 bg-ink-850/50 p-6 transition-colors hover:border-signal-500/40 hover:bg-ink-800/60"
                        >
                          <h4 className="font-display text-base font-bold text-chalk">{service.name}</h4>
                          <p className="mt-1.5 text-sm font-semibold text-signal-400">{service.tagline}</p>
                          <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{service.forWhom}</p>

                          {format && (
                            <p className="mt-4 border-t border-chalk/8 pt-3 text-xs leading-relaxed text-chalk-faint">
                              {format}
                            </p>
                          )}

                          <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-chalk transition-colors group-hover:text-signal-400">
                            {service.name} ansehen
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
