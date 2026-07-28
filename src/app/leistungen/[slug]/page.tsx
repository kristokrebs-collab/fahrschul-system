import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { serviceBySlug, serviceGroups, services } from '@/content/services'
import { publicValue } from '@/content/truth'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink, Disclosure } from '@/components/brand/section'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const service = serviceBySlug(slug)
  if (!service) return {}
  return {
    title: service.seoTitle,
    description: service.seoDescription,
    alternates: { canonical: `/leistungen/${service.slug}` },
    openGraph: { title: service.seoTitle, description: service.seoDescription, url: `/leistungen/${service.slug}` },
  }
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const service = serviceBySlug(slug)
  if (!service) notFound()

  const format = publicValue(service.format)
  const modules = publicValue(service.modules)

  const trail = [
    { name: 'Start', href: '/' },
    { name: 'Beruf & Seminare', href: '/leistungen' },
    { name: service.name, href: `/leistungen/${service.slug}` },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow={serviceGroups[service.group].label}
        title={service.name}
        lead={service.summary}
        trail={trail}
        actions={<ActionLink href="/kontakt">{service.nextStep}</ActionLink>}
      />

      <div className="shell grid gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-16">
        <div className="space-y-12">
          <section>
            <h2 className="font-display text-2xl font-bold text-chalk">Für wen das gedacht ist</h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-chalk-soft">{service.forWhom}</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-chalk">Was dazugehört</h2>
            <ul className="mt-5 space-y-3">
              {service.includes.map((item) => (
                <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-chalk-soft">
                  <span aria-hidden className="mt-2.5 h-1 w-3 shrink-0 rounded-sm bg-signal-500" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {modules && modules.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-bold text-chalk">Die Module</h2>
              <ol className="mt-5 grid gap-3 sm:grid-cols-2">
                {modules.map((module) => (
                  <li key={module.title} className="surface p-5">
                    <p className="font-display text-sm font-bold text-chalk">{module.title}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-chalk-dim">{module.detail}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {service.requirements.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-bold text-chalk">Voraussetzungen</h2>
              <ul className="mt-5 space-y-3">
                {service.requirements.map((item) => (
                  <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-chalk-soft">
                    <span aria-hidden className="mt-2.5 h-1 w-3 shrink-0 rounded-sm bg-signal-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Disclosure>
            Termine, Verfügbarkeiten und Preise für diese Leistung bekommst du auf Anfrage — wir melden uns in der Regel
            innerhalb eines Werktags.
          </Disclosure>
        </div>

        <aside className="space-y-6">
          {format && (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Umfang und Ablauf</h2>
              <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{format}</p>
            </div>
          )}
          <div className="surface edge-signal p-6">
            <h2 className="font-display text-base font-bold text-chalk">Nächster Schritt</h2>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">{service.nextStep}.</p>
            <ActionLink href="/kontakt" className="mt-4 w-full">Anfrage senden</ActionLink>
          </div>
        </aside>
      </div>
    </>
  )
}
