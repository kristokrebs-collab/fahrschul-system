import Link from 'next/link'
import { locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { Roadway } from '@/components/brand/roadway'

/**
 * Chapter 11 — the finish line.
 *
 * The route's signal arrives. Three unambiguous next steps, ordered by how
 * committed the visitor has to be: find the class, get advice, or simply pick
 * up the phone.
 */
export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-chalk/8 py-24 md:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-45">
        <Roadway className="absolute inset-x-0 bottom-0 h-full w-full" />
      </div>
      <div className="atmos-falloff" />

      <div className="shell relative text-center">
        <p className="kapitel-label justify-center">Letztes Kapitel — Ankommen</p>
        <h2 className="type-chapter mx-auto mt-6 max-w-[18ch] text-gradient-chalk">
          Der erste Schritt ist der kleinste.
        </h2>
        <p className="type-lead mx-auto mt-6 max-w-[46ch]">
          Du musst dich heute noch nicht festlegen. Finde heraus, welche Klasse passt — oder frag uns einfach, was du
          wissen willst.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/fuehrerschein#finder"
            className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-signal-500 px-8 text-base font-semibold text-chalk shadow-[0_18px_50px_-18px_color-mix(in_oklab,var(--color-signal-500)_80%,transparent)] transition-colors hover:bg-signal-600 sm:w-auto"
          >
            Führerschein finden
          </Link>
          <Link
            href="/kontakt"
            className="inline-flex min-h-13 w-full items-center justify-center rounded-xl border border-chalk/18 bg-chalk/[0.04] px-8 text-base font-semibold text-chalk transition-colors hover:border-chalk/35 sm:w-auto"
          >
            Beratung starten
          </Link>
        </div>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {locations.map((location) => {
            const phone = publicValue(location.phone)
            const phoneHref = publicValue(location.phoneHref)
            if (!phone || !phoneHref) return null
            return (
              <li key={location.slug} className="text-sm text-chalk-dim">
                <span className="text-chalk-faint">{location.name}</span>{' '}
                <a href={`tel:${phoneHref}`} className="tabular font-semibold text-chalk hover:text-signal-400">
                  {phone}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
