import Link from 'next/link'
import type { Metadata } from 'next'
import { Hero } from '@/components/storytelling/hero'
import { DigitalSystem } from '@/components/storytelling/digital-system'
import { ServicesChapter } from '@/components/storytelling/services-chapter'
import { LocationsChapter } from '@/components/storytelling/locations-chapter'
import { FinalCta } from '@/components/storytelling/final-cta'
import { SimulatorChapter } from '@/components/simulator/simulator-chapter'
import { TrainingGuide } from '@/components/guide/training-guide'
import { LicenceFinder } from '@/components/classes/licence-finder'
import { LicenceRoute } from '@/components/classes/licence-route'
import { CockpitShowcase } from '@/components/cockpit/cockpit-showcase'
import { PriceCalculator } from '@/components/pricing/price-calculator'
import { ChapterHeading } from '@/components/brand/section'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

/**
 * The homepage is one continuous route in eleven chapters. Each chapter is a
 * landmark section with its own heading, so the page is navigable by heading
 * for screen-reader users exactly as it is by scrolling for everyone else.
 */
export default function HomePage() {
  return (
    <>
      <Hero />

      {/* Chapter 2 — the junction */}
      <section className="chapter relative" aria-labelledby="finder-heading" id="finder" data-atmo="30/18">
        <div className="shell">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
            <ChapterHeading
              marker="Kapitel 02 — Entscheiden"
              id="finder-heading"
              title="Welche Klasse passt zu dir?"
              lead="Sechs kurze Fragen. Danach weißt du, welche Klasse infrage kommt, was du dafür brauchst und was der nächste Schritt ist."
            />
            <LicenceFinder />
          </div>
        </div>
      </section>

      {/* Chapter 3 — the lane system */}
      <section className="chapter relative" aria-labelledby="klassen-heading" data-atmo="45/45">
        <div className="atmos-lanes" />
        <div className="shell relative">
          <ChapterHeading
            marker="Kapitel 03 — Klassen"
            id="klassen-heading"
            title="Vom Roller bis zum Sattelzug"
            lead="Wir bilden in jeder Fahrerlaubnisklasse aus — auf eigenen Fahrzeugen, mit eigenen LKW und einem eigenen Bus. Wähle die Spur, die dich interessiert."
          />
          <div className="mt-12">
            <LicenceRoute />
          </div>
        </div>
      </section>

      <DigitalSystem />

      {/* Chapter 5 — the cockpit */}
      <section className="chapter relative" aria-labelledby="cockpit-heading" data-atmo="55/55">
        <div className="shell">
          <ChapterHeading
            marker="Kapitel 05 — Cockpit"
            id="cockpit-heading"
            title="Dein Ausbildungsstand, jederzeit einsehbar"
            lead="Wir bauen gerade ein digitales Cockpit für unsere Fahrschülerinnen und Fahrschüler. So wird es aussehen — die Ansicht zeigt Beispieldaten."
          />
          <div className="mt-14">
            <CockpitShowcase />
          </div>
        </div>
      </section>

      <SimulatorChapter />

      {/* Chapter 7 — costs */}
      <section className="chapter relative" aria-labelledby="preise-heading" data-atmo="28/30">
        <div className="shell">
          <ChapterHeading
            marker="Kapitel 07 — Kosten"
            id="preise-heading"
            title="Angebote ehrlich vergleichen"
            lead="Zwei Fahrschulen mit unterschiedlichen Fahrstundenzahlen zu vergleichen führt fast immer in die Irre. Dieser Rechner legt beide Angebote auf dieselben Mengen um."
          />
          <div className="mt-12">
            <PriceCalculator />
          </div>
          <p className="mt-6 text-sm text-chalk-dim">
            Du willst einfach wissen, was deine Ausbildung kostet?{' '}
            <Link href="/kontakt" className="font-semibold text-signal-400 underline-offset-4 hover:underline">
              Frag uns nach einem konkreten Angebot
            </Link>
            .
          </p>
        </div>
      </section>

      <TrainingGuide />
      <ServicesChapter />
      <LocationsChapter />
      <FinalCta />
    </>
  )
}
