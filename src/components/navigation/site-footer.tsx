import Link from 'next/link'
import { business, locations, yearsInBusiness } from '@/content/business'
import { footerLinks, legalLinks } from '@/content/navigation'
import { publicValue } from '@/content/truth'
import { KrebsWordmark } from '@/components/brand/marks'

/**
 * The footer closes the route: it is the only place where every location's
 * verified contact data appears in full, and it repeats the primary action
 * once more for anyone who read to the end.
 */
export function SiteFooter() {
  const founded = publicValue(business.founded)
  const years = yearsInBusiness()

  return (
    <footer className="relative z-10 border-t border-chalk/8 bg-ink-900">
      {/* The finish line: the route's signal reaching its end. */}
      <div aria-hidden className="relative h-px w-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-signal-500 via-signal-500/40 to-transparent" />
      </div>

      <div className="shell py-14 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div>
            <Link href="/" className="text-xl text-chalk">
              <KrebsWordmark />
            </Link>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-chalk-dim">
              {founded
                ? `Familienbetrieb seit ${founded} — inzwischen ${years} Jahre Fahrausbildung in Fulda und Bad Hersfeld, in zweiter Generation.`
                : 'Fahrausbildung in Fulda und Bad Hersfeld.'}
            </p>
            <Link
              href="/kontakt?von=/"
              className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-signal-500 px-5 text-sm font-semibold text-chalk transition-colors hover:bg-signal-600"
            >
              Beratung starten
            </Link>
          </div>

          <nav aria-label="Footer" className="footer-grid grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {footerLinks.map((column) => (
              <div key={column.title} className="footer-col">
                <p className="type-eyebrow mb-3 text-chalk-faint">{column.title}</p>
                <ul className="space-y-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-chalk-soft transition-colors hover:text-chalk">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 grid gap-8 border-t border-chalk/8 pt-10 sm:grid-cols-2">
          {locations.map((location) => {
            const street = publicValue(location.street)
            const postal = publicValue(location.postalCode)
            const phone = publicValue(location.phone)
            const phoneHref = publicValue(location.phoneHref)
            const email = publicValue(location.email)
            const hours = publicValue(location.officeHours)

            return (
              <div key={location.slug}>
                <p className="font-display text-lg font-bold text-chalk">{location.name}</p>
                <address className="mt-2 space-y-1 text-sm not-italic text-chalk-dim">
                  {street && postal && (
                    <p>
                      {street}
                      <br />
                      {postal} {location.city}
                    </p>
                  )}
                  {phone && phoneHref && (
                    <p>
                      <a href={`tel:${phoneHref}`} className="transition-colors hover:text-chalk">
                        {phone}
                      </a>
                    </p>
                  )}
                  {email && (
                    <p>
                      <a href={`mailto:${email}`} className="transition-colors hover:text-chalk">
                        {email}
                      </a>
                    </p>
                  )}
                </address>

                {hours && hours.length > 0 && (
                  <dl className="mt-3 space-y-0.5 text-sm text-chalk-faint">
                    {hours.map((h) => (
                      <div key={h.days} className="flex flex-wrap gap-x-2">
                        <dt>{h.days}</dt>
                        <dd className="tabular">{h.hours}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <Link
                  href={`/standorte/${location.slug}`}
                  className="mt-3 inline-block text-sm font-semibold text-signal-400 transition-colors hover:text-signal-500"
                >
                  Standort {location.name} ansehen
                </Link>
              </div>
            )
          })}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-chalk/8 pt-8 text-xs text-chalk-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {business.legalName}
          </p>
          <ul className="flex flex-wrap gap-5">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="transition-colors hover:text-chalk-soft">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  )
}
