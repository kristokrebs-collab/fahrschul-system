import type { Metadata } from 'next'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink } from '@/components/brand/section'
import { ServicesChapter } from '@/components/storytelling/services-chapter'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Beruf, Seminare und Spezialausbildung',
  description:
    'Berufskraftfahrer-Qualifikation, BKF-Weiterbildung, ADR, Staplerschein, ASF und FES sowie Handicap-Ausbildung bei der Fahrschule Krebs in Fulda und Bad Hersfeld.',
  alternates: { canonical: '/leistungen' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Beruf & Seminare', href: '/leistungen' },
]

export default function ServicesPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Beruf & Spezial"
        title="Mehr als ein Führerschein"
        lead="Ein großer Teil unserer Arbeit beginnt erst, wenn der Führerschein längst da ist — Qualifikationen für den Beruf, Schulungen für Betriebe und Seminare, wenn es einmal eng wird."
        trail={trail}
        actions={<ActionLink href="/kontakt?thema=seminar&von=/leistungen">Anfrage für Unternehmen</ActionLink>}
      />
      <ServicesChapter />
    </>
  )
}
