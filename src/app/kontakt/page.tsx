import type { Metadata } from 'next'
import Image from 'next/image'
import { PageHeader } from '@/components/brand/page-header'
import { ContactForm } from '@/components/contact/contact-form'
import { locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { breadcrumbJsonLd } from '@/lib/structured-data'
import { resolveRequestContext } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Kontakt und Beratung',
  description:
    'Beratung, Voranmeldung und Anfragen an die Fahrschule Krebs in Fulda und Bad Hersfeld. Wir antworten in der Regel innerhalb eines Werktags.',
  alternates: { canonical: '/kontakt' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Kontakt', href: '/kontakt' },
]

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const context = resolveRequestContext(await searchParams)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Kontakt"
        title="Frag uns einfach"
        lead="Du musst dich nicht festlegen, um mit uns zu sprechen. Schreib uns, was du wissen willst — oder ruf an, das geht meistens schneller."
        trail={trail}
      />

      <div className="shell grid gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-16">
        <ContactForm context={context} />

        <aside className="space-y-6">
          <figure className="relative overflow-hidden rounded-2xl border border-chalk/10">
            <Image
              src="/stills/anmeldung-buero-1600.avif"
              alt="Dunkler, ruhiger Empfangstresen mit einer Leuchte — Symbolbild für die Anmeldung"
              width={1600}
              height={2133}
              sizes="(min-width: 1024px) 20rem, 100vw"
              className="aspect-[3/4] w-full object-cover"
            />
            <figcaption className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.6875rem] text-chalk-faint drop-shadow">
              Studio-Inszenierung
            </figcaption>
          </figure>
          {locations.map((location) => {
            const street = publicValue(location.street)
            const postal = publicValue(location.postalCode)
            const phone = publicValue(location.phone)
            const phoneHref = publicValue(location.phoneHref)
            const email = publicValue(location.email)
            const hours = publicValue(location.officeHours)

            return (
              <div key={location.slug} className="surface p-6">
                <h2 className="font-display text-base font-bold text-chalk">{location.name}</h2>
                <address className="mt-3 space-y-1.5 text-sm not-italic text-chalk-dim">
                  {street && postal && <p>{street}, {postal} {location.city}</p>}
                  {phone && phoneHref && (
                    <p><a href={`tel:${phoneHref}`} className="font-semibold hover:text-chalk">{phone}</a></p>
                  )}
                  {email && <p><a href={`mailto:${email}`} className="hover:text-chalk">{email}</a></p>}
                </address>
                {hours && hours.length > 0 && (
                  <dl className="mt-4 space-y-1 border-t border-chalk/8 pt-3 text-xs">
                    {hours.map((h) => (
                      <div key={h.days} className="flex flex-wrap justify-between gap-x-3">
                        <dt className="text-chalk-faint">{h.days}</dt>
                        <dd className="tabular text-chalk-dim">{h.hours}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )
          })}
        </aside>
      </div>
    </>
  )
}
