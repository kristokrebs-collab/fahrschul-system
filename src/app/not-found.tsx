import Link from 'next/link'
import { Roadway } from '@/components/brand/roadway'

/**
 * 404. Uses the route metaphor rather than an apology: a wrong turn, with the
 * useful exits offered immediately.
 */
export default function NotFound() {
  return (
    <section className="relative isolate flex min-h-[80svh] items-center overflow-hidden pt-[var(--header-h)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-40">
        <Roadway className="absolute inset-x-0 bottom-0 h-full w-full" />
      </div>
      <div className="atmos-falloff" />

      <div className="shell relative py-20">
        <p className="kapitel-label">Fehler 404</p>
        <h1 className="type-hero mt-5 max-w-[14ch] text-gradient-chalk">Falsch abgebogen.</h1>
        <p className="type-lead mt-6 max-w-[46ch]">
          Diese Seite gibt es nicht — oder nicht mehr. Hier sind die Ausfahrten, die weiterhelfen.
        </p>

        <ul className="mt-10 flex flex-wrap gap-3">
          {[
            { href: '/', label: 'Zur Startseite' },
            { href: '/fuehrerschein', label: 'Führerscheinklassen' },
            { href: '/preise', label: 'Preise' },
            { href: '/kontakt', label: 'Kontakt' },
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-12 items-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-signal-500/50 hover:text-signal-400"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
