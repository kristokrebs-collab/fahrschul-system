import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { TrainingGuide } from '@/components/guide/training-guide'
import { ScenePanel } from '@/components/media/page-media'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Ausbildungsablauf — so läuft der Führerschein ab',
  description:
    'Von der Beratung bis zur praktischen Prüfung: alle Stationen der Führerscheinausbildung, welche Unterlagen du brauchst und wer jeweils am Zug ist.',
  alternates: { canonical: '/ausbildungsablauf' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Ausbildungsablauf', href: '/ausbildungsablauf' },
]

export default function GuidePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Ablauf"
        title="Kein Behördenlabyrinth"
        lead="Der Führerschein wirkt kompliziert, weil niemand die Reihenfolge erklärt. Hier ist sie — mit dem Hinweis, wer bei jedem Schritt handeln muss."
        trail={trail}
        actions={<ActionLink href="/kontakt?thema=fuehrerschein&von=/ausbildungsablauf">Beratung starten</ActionLink>}
      />
      <section className="shell pb-4">
        <ScenePanel
          clip="documentsRoad"
          caption="Studio-Inszenierung — aus Unterlagen wird eine Straße"
        />
      </section>

      <TrainingGuide />
    </>
  )
}
