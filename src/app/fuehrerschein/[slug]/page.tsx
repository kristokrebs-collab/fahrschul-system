import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { classBySlug, licenceClasses, sonderfahrtenTotal } from '@/content/classes'
import { locations } from '@/content/business'
import { publicValue } from '@/content/truth'
import { breadcrumbJsonLd, courseJsonLd } from '@/lib/structured-data'
import { ActionLink, Disclosure } from '@/components/brand/section'
import { Roadway } from '@/components/brand/roadway'
import { PageMedia } from '@/components/media/page-media'

export function generateStaticParams() {
  return licenceClasses.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const licenceClass = classBySlug(slug)
  if (!licenceClass) return {}

  return {
    title: licenceClass.seoTitle,
    description: licenceClass.seoDescription,
    alternates: { canonical: `/fuehrerschein/${licenceClass.slug}` },
    openGraph: {
      title: licenceClass.seoTitle,
      description: licenceClass.seoDescription,
      url: `/fuehrerschein/${licenceClass.slug}`,
    },
  }
}

export default async function ClassPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const licenceClass = classBySlug(slug)
  if (!licenceClass) notFound()

  const minAge = publicValue(licenceClass.minAge)
  const theory = publicValue(licenceClass.theory)
  const sf = publicValue(licenceClass.sonderfahrten)
  const related = licenceClass.related.map(classBySlug).filter((c) => c !== undefined)
  const cities = locations.map((l) => l.name).join(' und ')

  const trail = [
    { name: 'Start', href: '/' },
    { name: 'Führerschein', href: '/fuehrerschein' },
    { name: licenceClass.name, href: `/fuehrerschein/${licenceClass.slug}` },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseJsonLd(licenceClass)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />

      <header className="relative isolate overflow-hidden pt-[calc(var(--header-h)+3.5rem)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-35">
          <Roadway className="absolute inset-x-0 bottom-0 h-full w-full" />
        </div>
        <div className="atmos-falloff" />

        <div className="shell relative pb-14">
          <nav aria-label="Brotkrumen" className="mb-8">
            <ol className="flex flex-wrap items-center gap-2 text-xs text-chalk-faint">
              {trail.map((crumb, index) => (
                <li key={crumb.href} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden>/</span>}
                  {index === trail.length - 1 ? (
                    <span aria-current="page" className="text-chalk-dim">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link href={crumb.href} className="transition-colors hover:text-chalk-soft">
                      {crumb.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <p className="kapitel-label">{licenceClass.tagline}</p>
          <h1 className="type-hero mt-5 max-w-[14ch] text-gradient-chalk">{licenceClass.name}</h1>
          <p className="type-lead mt-6 max-w-[54ch]">{licenceClass.summary}</p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ActionLink href="/kontakt">Beratung zu {licenceClass.code} starten</ActionLink>
            {licenceClass.calculatorSupported && (
              <ActionLink href="/preise" variant="secondary">
                Kosten vergleichen
              </ActionLink>
            )}
          </div>

          <dl className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-chalk/10 bg-chalk/8 sm:grid-cols-3">
            <Facet label="Mindestalter" value={minAge ?? 'Auf Anfrage'} />
            <Facet
              label="Theorieunterricht"
              value={theory ? `${theory.grundstoff + theory.zusatzstoff} Doppelstunden` : 'Keine Theorieprüfung nötig'}
              hint={theory?.grundstoffMitVorbesitz ? `Mit Vorbesitz: ${theory.grundstoffMitVorbesitz + theory.zusatzstoff}` : undefined}
            />
            <Facet
              label="Sonderfahrten"
              value={sf ? `${sonderfahrtenTotal(sf)} à 45 Minuten` : 'Individuell'}
              hint={sf ? `${sf.ueberland} Überland · ${sf.autobahn} Autobahn · ${sf.nacht} Nacht` : undefined}
            />
          </dl>
        </div>
      </header>

      <div className="shell grid gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-16">
        <div className="space-y-12">
          <Block title="Was du damit fahren darfst" items={licenceClass.allows} />
          {licenceClass.prerequisites.length > 0 && (
            <Block title="Was du dafür brauchst" items={licenceClass.prerequisites} />
          )}
          {licenceClass.goodToKnow.length > 0 && <Block title="Gut zu wissen" items={licenceClass.goodToKnow} />}

          {!sf && licenceClass.category === 'bus' && (
            <Disclosure>
              Der Pflichtumfang der praktischen Ausbildung hängt bei den Busklassen davon ab, welche Klassen du bereits
              besitzt und wie lange. Deshalb nennen wir hier bewusst keine pauschale Zahl — wir rechnen das im
              Beratungsgespräch für deinen Fall durch.
            </Disclosure>
          )}

          <Disclosure>
            Rechtsstand Juli 2026. Fahrerlaubnisrecht ändert sich — was konkret für dich gilt, klären wir persönlich.
          </Disclosure>
        </div>

        <aside className="space-y-6">
          <PageMedia routeKey={`fuehrerschein/${licenceClass.slug}`} />
          <div className="surface p-6">
            <h2 className="font-display text-base font-bold text-chalk">Wo du ausgebildet wirst</h2>
            <ul className="mt-3 space-y-2">
              {locations.map((location) => (
                <li key={location.slug}>
                  <Link
                    href={`/standorte/${location.slug}`}
                    className="text-sm text-chalk-dim transition-colors hover:text-chalk"
                  >
                    {location.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-chalk-faint">
              Ausbildung in {cities} — beide Standorte liegen direkt am Bahnhof.
            </p>
          </div>

          {licenceClass.simulatorSupported && (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Mit Simulatortraining</h2>
              <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
                Abläufe und Bedienung in wiederholbaren Situationen üben, bevor es in den echten Verkehr geht.
              </p>
              <Link href="/simulator" className="mt-3 inline-block text-sm font-semibold text-signal-400 hover:text-signal-500">
                Simulator kennenlernen
              </Link>
            </div>
          )}

          {related.length > 0 && (
            <div className="surface p-6">
              <h2 className="font-display text-base font-bold text-chalk">Passt auch dazu</h2>
              <ul className="mt-3 space-y-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/fuehrerschein/${r.slug}`}
                      className="text-sm text-chalk-dim transition-colors hover:text-chalk"
                    >
                      {r.name} — <span className="text-chalk-faint">{r.tagline}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}

function Facet({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-ink-900 p-6">
      <dt className="type-eyebrow text-chalk-faint">{label}</dt>
      <dd className="mt-2 font-display text-lg font-bold leading-tight text-chalk">{value}</dd>
      {hint && <p className="mt-1.5 text-xs text-chalk-dim">{hint}</p>}
    </div>
  )
}

function Block({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section>
      <h2 className="font-display text-2xl font-bold text-chalk">{title}</h2>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed text-chalk-soft">
            <span aria-hidden className="mt-2.5 h-1 w-3 shrink-0 rounded-sm bg-signal-500" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
