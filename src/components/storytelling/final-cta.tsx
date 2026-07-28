import Image from 'next/image'
import Link from 'next/link'
import { locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { Magnetic } from '@/components/brand/magnetic'

/**
 * Chapter 11 — the finish line.
 *
 * The route's signal arrives. Three unambiguous next steps, ordered by how
 * committed the visitor has to be: find the class, get advice, or simply pick
 * up the phone.
 */
export function FinalCta() {
  return (
    <section
      className="chapter-day relative isolate overflow-hidden py-28 md:py-36"
      data-atmo="80/75"
    >
      {/* The crab from the real logo, printed into the daylight like a
          watermark on paper */}
      <Image
        src="/brand/krebs-crab.png"
        alt=""
        aria-hidden
        width={700}
        height={254}
        className="pointer-events-none absolute left-1/2 top-8 -z-10 w-[34rem] max-w-[90vw] -translate-x-1/2 opacity-[0.07] mix-blend-multiply"
      />

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
          <Magnetic className="w-full sm:w-auto">
            <Link
              href="/fuehrerschein#finder"
              className="cta-shine inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-signal-500 px-8 text-base font-semibold text-chalk shadow-[0_18px_50px_-18px_color-mix(in_oklab,var(--color-signal-500)_80%,transparent)] transition-colors hover:bg-signal-600 sm:w-auto"
            >
              Führerschein finden
            </Link>
          </Magnetic>
          <Link
            href="/kontakt?von=/"
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
