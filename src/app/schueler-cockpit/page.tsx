import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { CockpitShowcase } from '@/components/cockpit/cockpit-showcase'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Schüler-Cockpit — dein Ausbildungsstand auf einen Blick',
  description:
    'Das digitale Schüler-Cockpit der Fahrschule Krebs: Ausbildungsfortschritt, Termine, Unterlagen und Rückmeldungen aus den Fahrstunden an einem Ort. Vorschau mit Beispieldaten.',
  alternates: { canonical: '/schueler-cockpit' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Schüler-Cockpit', href: '/schueler-cockpit' },
]

export default function CockpitPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="In Entwicklung"
        title="Schluss mit „Wie weit bin ich eigentlich?“"
        lead="Wir bauen gerade ein digitales Cockpit für unsere Fahrschülerinnen und Fahrschüler. Die folgenden Ansichten zeigen mit Beispieldaten, wie es aussehen wird."
        trail={trail}
        actions={<ActionLink href="/kontakt" variant="secondary">Sag uns, was dir fehlen würde</ActionLink>}
      />
      <section className="chapter pt-0">
        <div className="shell">
          <CockpitShowcase />
        </div>
      </section>
    </>
  )
}
