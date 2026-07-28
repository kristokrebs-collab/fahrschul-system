import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { SimulatorChapter } from '@/components/simulator/simulator-chapter'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Fahrsimulator in der Ausbildung',
  description:
    'Simulatortraining bei der Fahrschule Krebs in Fulda: Abläufe und Bedienung in wiederholbaren Situationen üben, bevor es in den echten Verkehr geht.',
  alternates: { canonical: '/simulator' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Simulator', href: '/simulator' },
]

export default function SimulatorPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Simulator"
        title="Die ersten Meter ohne Verkehr"
        lead="Am Anfang ist alles gleichzeitig neu: Kupplung, Spiegel, Schilder, Blick, andere Autos. Im Simulator nimmst du einen Teil davon vorweg — in deinem Tempo."
        trail={trail}
        actions={<ActionLink href="/kontakt">Nach Simulatorterminen fragen</ActionLink>}
      />
      <SimulatorChapter />
    </>
  )
}
