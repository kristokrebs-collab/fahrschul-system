import Image from 'next/image'
import Link from 'next/link'
import { serviceBySlug, services } from '@/content/services'
import { ChapterHeading, ActionLink } from '@/components/brand/section'

/**
 * Chapter 9 — more than a driving licence.
 *
 * These are real revenue lines, so they belong on the homepage. Nine equally
 * weighted cards, however, is a list pretending to be a design: nothing is
 * recommended, so nothing is chosen. Three are given a face — one per kind of
 * customer, professional, logistics, personal — and the remaining six stay
 * discoverable as a typographic index that reads in a glance. The detail lives
 * on the service pages, where a decision actually gets made.
 */

const FEATURED = [
  { slug: 'berufskraftfahrer', still: 'laderampe', alt: 'Hecktüren eines schwarzen Aufliegers an der Laderampe im Morgengrauen' },
  { slug: 'adr', still: 'adr-latch', alt: 'Schwerer Metallverschluss an einer dunklen Tankwagen-Blende' },
  { slug: 'handicap', still: 'handbedienung', alt: 'Makroaufnahme einer präzise gefertigten Handbedienung an der Lenksäule' },
] as const

export function ServicesChapter() {
  const featured = FEATURED.map((f) => ({ ...f, service: serviceBySlug(f.slug) })).filter(
    (f): f is typeof f & { service: NonNullable<typeof f.service> } => Boolean(f.service),
  )
  const featuredSlugs = new Set(FEATURED.map((f) => f.slug))
  const rest = services.filter((s) => !featuredSlugs.has(s.slug as (typeof FEATURED)[number]['slug']))

  return (
    <section className="chapter relative" aria-labelledby="leistungen" data-atmo="42/40">
      <div className="shell relative">
        <ChapterHeading
          marker="Kapitel 09 — Beruf & Spezial"
          id="leistungen"
          title="Mehr als ein Führerschein"
          lead="Ein großer Teil unserer Arbeit beginnt erst, wenn der Führerschein längst da ist: Qualifikationen für den Beruf, Schulungen für Betriebe, Seminare nach Auffälligkeiten — und eine Ausbildung, die sich nach dem Menschen richtet."
        />

        <ul className="mt-14 grid gap-5 md:grid-cols-3">
          {featured.map(({ slug, still, alt, service }) => (
            <li key={slug}>
              <Link
                href={`/leistungen/${slug}`}
                className="orbit-card group flex h-full flex-col overflow-hidden rounded-2xl border border-chalk/10 bg-ink-850/50 transition-colors hover:border-signal-500/40 hover:bg-ink-800/60"
              >
                <div className="relative overflow-hidden">
                  <Image
                    src={`/stills/${still}-1600.avif`}
                    alt={alt}
                    width={1600}
                    height={2133}
                    sizes="(min-width: 768px) 22rem, 100vw"
                    className="aspect-[16/10] w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                  <span className="pointer-events-none absolute bottom-2 right-3 text-[0.625rem] text-chalk-faint drop-shadow">
                    Studio-Inszenierung
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="font-display text-lg font-bold text-chalk">{service.name}</h3>
                  <p className="mt-1.5 text-sm font-semibold text-signal-400">{service.tagline}</p>
                  <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{service.forWhom}</p>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-chalk transition-colors group-hover:text-signal-400">
                    Ansehen
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {/* The rest as an index, not as cards: same information, a tenth of
            the visual noise, and it stays scannable. */}
        <div className="mt-12 border-t border-chalk/10 pt-8">
          <h3 className="type-eyebrow text-chalk-faint">Außerdem im Programm</h3>
          <ul className="mt-5 grid gap-x-10 gap-y-1 sm:grid-cols-2">
            {rest.map((service) => (
              <li key={service.slug}>
                <Link
                  href={`/leistungen/${service.slug}`}
                  className="group flex items-baseline gap-3 border-b border-chalk/8 py-3 transition-colors hover:border-signal-500/40"
                >
                  <span className="font-display text-base font-bold text-chalk transition-colors group-hover:text-signal-400">
                    {service.name}
                  </span>
                  <span className="text-sm text-chalk-dim">{service.tagline}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="ml-auto shrink-0 self-center text-chalk-faint opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-signal-400 group-hover:opacity-100"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>

          <ActionLink href="/leistungen" variant="secondary" className="mt-8">
            Alle {services.length} Leistungen im Überblick
          </ActionLink>
        </div>
      </div>
    </section>
  )
}
