import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { PriceCalculator } from '@/components/pricing/price-calculator'
import { costCategories } from '@/content/guide'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Preise und Kostenrechner',
  description:
    'Was kostet der Führerschein? Mit dem Kostenrechner der Fahrschule Krebs vergleichst du zwei Angebote fair — bei gleichen Mengen, Position für Position.',
  alternates: { canonical: '/preise' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Preise', href: '/preise' },
]

export default function PricesPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Kosten"
        title="Was der Führerschein wirklich kostet"
        lead="Der ehrlichste Satz zuerst: Niemand kann dir vorher den Endpreis nennen. Er hängt davon ab, wie viele Übungsfahrstunden du brauchst — und das weiß am Anfang niemand. Was wir tun können, ist die Rechnung transparent machen."
        trail={trail}
        actions={<ActionLink href="/kontakt?von=/preise">Konkretes Angebot anfragen</ActionLink>}
      />

      <section className="chapter pt-0" aria-labelledby="rechner">
        <div className="shell">
          <h2 id="rechner" className="type-chapter text-gradient-chalk">Angebote vergleichen</h2>
          <p className="type-lead mt-5 max-w-[56ch]">
            Trag die Positionen aus zwei Angeboten ein. Der Rechner legt beide auf dieselben Mengen um — nur so ist der
            Vergleich aussagekräftig.
          </p>
          <div className="mt-10">
            <PriceCalculator />
          </div>
        </div>
      </section>

      <section className="chapter pt-0" aria-labelledby="toepfe">
        <div className="shell">
          <h2 id="toepfe" className="font-display text-2xl font-bold text-chalk">Wer bekommt welches Geld?</h2>
          <p className="mt-3 max-w-2xl text-sm text-chalk-dim">
            Ein erheblicher Teil der Gesamtkosten geht gar nicht an die Fahrschule. Diese vier Töpfe zu trennen ist der
            wichtigste Schritt beim Vergleichen.
          </p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {costCategories.map((category) => (
              <div key={category.id} className="surface p-6">
                <dt className="font-display text-sm font-bold text-chalk">{category.label}</dt>
                <dd className="mt-2 text-xs leading-relaxed text-chalk-dim">{category.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-chalk-dim">
            Unsere aktuellen Preise bekommst du auf Anfrage und im Beratungsgespräch — schriftlich, aufgeschlüsselt und
            ohne Kleingedrucktes.{' '}
            <Link href="/kontakt?von=/preise" className="font-semibold text-signal-400 underline-offset-4 hover:underline">
              Preisliste anfordern
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  )
}
