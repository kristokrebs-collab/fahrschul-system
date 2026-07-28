import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { SimulatorChapter } from '@/components/simulator/simulator-chapter'
import { SceneVideo } from '@/components/media/scene-video'
import { sceneClips } from '@/content/media'
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
        actions={<ActionLink href="/kontakt?thema=fuehrerschein&von=/simulator">Nach Simulatorterminen fragen</ActionLink>}
      />

      {/* The whole idea of simulator training in one shot: the rendered road
          becomes the real one, without a cut. */}
      <section className="shell pb-4">
        <figure className="relative overflow-hidden rounded-2xl border border-chalk/10">
          <SceneVideo
            name={sceneClips.simToReal.name}
            hd={sceneClips.simToReal.hd}
            variant="panel"
            className="aspect-video w-full"
          />
          <figcaption className="pointer-events-none absolute bottom-3 right-4 text-xs text-chalk-faint drop-shadow">
            Studio-Inszenierung — aus dem Simulator auf die echte Straße
          </figcaption>
        </figure>
      </section>

      <SimulatorChapter />
    </>
  )
}
