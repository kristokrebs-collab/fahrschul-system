import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink, ChapterHeading } from '@/components/brand/section'
import { LicenceFinder } from '@/components/classes/licence-finder'
import { LicenceRoute } from '@/components/classes/licence-route'
import { licenceClasses } from '@/content/classes'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Führerscheinklassen in Fulda und Bad Hersfeld',
  description:
    'Alle Führerscheinklassen bei der Fahrschule Krebs: PKW, Anhänger, Motorrad, LKW und Bus. Mit Führerschein-Finder, Voraussetzungen und Ablauf je Klasse.',
  alternates: { canonical: '/fuehrerschein' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Führerschein', href: '/fuehrerschein' },
]

export default function LicenceIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Führerschein"
        title="Jede Klasse, die es gibt"
        lead={`Wir bilden in ${licenceClasses.length} Fahrerlaubnisklassen aus — vom Mofa bis zum Sattelzug, auf eigenen Fahrzeugen. Wenn du nicht weißt, welche du brauchst, beantworte kurz sechs Fragen.`}
        trail={trail}
        actions={<ActionLink href="#finder">Führerschein finden</ActionLink>}
      />

      <section className="chapter pt-0" aria-labelledby="finder-heading" id="finder">
        <div className="shell">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
            <ChapterHeading
              marker="Entscheiden"
              id="finder-heading"
              title="Welche Klasse passt zu dir?"
              lead="Sechs kurze Fragen — danach weißt du, welche Klasse infrage kommt und was der nächste Schritt ist."
            />
            <LicenceFinder />
          </div>
        </div>
      </section>

      <section className="chapter pt-0" aria-labelledby="alle-klassen">
        <div className="atmos-lanes" />
        <div className="shell relative">
          <ChapterHeading marker="Übersicht" id="alle-klassen" title="Alle Klassen im Überblick" />
          <div className="mt-12">
            <LicenceRoute />
          </div>
        </div>
      </section>
    </>
  )
}
