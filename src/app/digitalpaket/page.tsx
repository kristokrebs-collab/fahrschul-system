import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { DigitalSystem } from '@/components/storytelling/digital-system'
import { ScenePanel } from '@/components/media/page-media'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Digitalpaket — wie Theorie, Simulator und Praxis zusammenspielen',
  description:
    'Theorie mit mehreren Terminen pro Tag, Simulatortraining, Ferienfahrschule und Online-Anmeldung: So greift die Ausbildung bei der Fahrschule Krebs ineinander.',
  alternates: { canonical: '/digitalpaket' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Digitalpaket', href: '/digitalpaket' },
]

export default function DigitalPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Das System"
        title="Nicht nur Fahrstunden"
        lead="Theorie, Simulator und Praxis sind keine getrennten Baustellen. Sie greifen ineinander — und du siehst an jedem Punkt, wo du stehst."
        trail={trail}
        actions={<ActionLink href="/kontakt?thema=fuehrerschein&von=/digitalpaket">Beratung starten</ActionLink>}
      />
      <section className="shell pb-4">
        <ScenePanel
          clip="phoneScroll"
          caption="Studio-Inszenierung — das Cockpit-Interface in Bewegung"
        />
      </section>

      <DigitalSystem />
    </>
  )
}
