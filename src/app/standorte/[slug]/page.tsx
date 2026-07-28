import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { locationBySlug, locations, practiceGround } from '@/content/business'
import { publicValue } from '@/content/truth'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink, Disclosure } from '@/components/brand/section'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export function generateStaticParams() {
  return locations.map((l) => ({ slug: l.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const location = locationBySlug(slug)
  if (!location) return {}
  return {
    title: `Fahrschule in ${location.name}`,
    description: `Fahrschule Krebs in ${location.name}: Adresse, Kontakt, Theorieunterricht und Ausbildungsangebot. Direkt am Bahnhof.`,
    alternates: { canonical: `/standorte/${location.slug}` },
  }
}

export default async function LocationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const location = locationBySlug(slug)
  if (!location) notFound()

  const street = publicValue(location.street)
  const postal = publicValue(location.postalCode)
  const phone = publicValue(location.phone)
  const phoneHref = publicValue(location.phoneHref)
  const email = publicValue(location.email)
  const hours = publicValue(location.officeHours)
  const theory = publicValue(location.theorySchedule)
  const focus = publicValue(location.focus)
  const other = locations.find((l) => l.slug !== location.slug)

  const trail = [
    { name: 'Start', href: '/' },
    { name: 'Standorte', href: `/standorte/${location.slug}` },
    { name: location.name, href: `/standorte/${location.slug}` },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow={`Standort ${location.name}`}
        title={`Fahrschule in ${location.name}`}
        lead={location.intro}
        trail={trail}
        actions={
          <>
            <ActionLink href="/kontakt">Beratung starten</ActionLink>
            {phone && phoneHref && (
              <a
                href={`tel:${phoneHref}`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-chalk/18 px-6 text-sm font-semibold text-chalk transition-colors hover:border-chalk/35"
              >
                {phone} anrufen
              </a>
            )}
          </>
        }
      />

      <div className="shell grid gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
        <div className="space-y-12">
          {theory && theory.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-bold text-chalk">Theorieunterricht</h2>
              <p className="mt-3 text-sm text-chalk-dim">{location.theoryNote}</p>
              <dl className="mt-6 space-y-px overflow-hidden rounded-2xl border border-chalk/10 bg-chalk/8">
                {theory.map((slot) => (
                  <div key={slot.label} className="bg-ink-900 p-5">
                    <dt className="font-display text-sm font-bold text-chalk">{slot.label}</dt>
                    <dd className="mt-1 text-sm text-chalk-dim">{slot.detail}</dd>
                  </div>
                ))}
              </dl>
              <Disclosure>
                Die genauen Uhrzeiten des Grundstoffunterrichts stimmen wir bei der Anmeldung mit dir ab — ruf uns an
                oder frag im Kontaktformular danach.
              </Disclosure>
            </section>
          )}

          <section>
            <h2 className="font-display text-2xl font-bold text-chalk">Anfahrt</h2>
            <ul className="mt-5 space-y-3">
              {location.gettingHere.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-chalk-soft">
                  <span aria-hidden className="mt-2.5 h-1 w-3 shrink-0 rounded-sm bg-signal-500" />
                  {item}
                </li>
              ))}
            </ul>
            {location.slug === 'fulda' && publicValue(practiceGround.address) && (
              <p className="mt-5 text-sm text-chalk-dim">
                {practiceGround.name}: {publicValue(practiceGround.address)} — {practiceGround.purpose}
              </p>
            )}
          </section>

          {focus && (
            <section>
              <h2 className="font-display text-2xl font-bold text-chalk">Was hier ausgebildet wird</h2>
              <p className="mt-4 text-[0.9375rem] leading-relaxed text-chalk-soft">{focus}</p>
              <Link href="/fuehrerschein" className="mt-4 inline-block text-sm font-semibold text-signal-400 hover:text-signal-500">
                Alle Klassen ansehen
              </Link>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <div className="surface p-6">
            <h2 className="font-display text-base font-bold text-chalk">Kontakt</h2>
            <address className="mt-3 space-y-1.5 text-sm not-italic text-chalk-dim">
              {street && postal && (
                <p>
                  {street}
                  <br />
                  {postal} {location.city}
                </p>
              )}
              {phone && phoneHref && (
                <p>
                  <a href={`tel:${phoneHref}`} className="hover:text-chalk">{phone}</a>
                </p>
              )}
              {email && (
                <p>
                  <a href={`mailto:${email}`} className="hover:text-chalk">{email}</a>
                </p>
              )}
            </address>
          </div>

          {hours && hours.length > 0 ? (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Bürozeiten</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                {hours.map((h) => (
                  <div key={h.days} className="flex flex-wrap justify-between gap-x-3">
                    <dt className="text-chalk-dim">{h.days}</dt>
                    <dd className="tabular text-chalk-soft">{h.hours}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Bürozeiten</h2>
              <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
                Das Büro ist an diesem Standort nur zu bestimmten Zeiten besetzt. Ruf am besten kurz an — dann sagen wir
                dir sofort, wann du vorbeikommen kannst.
              </p>
            </div>
          )}

          {other && (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Anderer Standort</h2>
              <Link href={`/standorte/${other.slug}`} className="mt-2 inline-block text-sm font-semibold text-signal-400 hover:text-signal-500">
                {other.name} ansehen
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
