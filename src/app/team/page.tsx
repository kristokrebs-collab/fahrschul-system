import type { Metadata } from 'next'
import Image from 'next/image'
import { business, locations, practiceGround, yearsInBusiness } from '@/content/business'
import { publicValue } from '@/content/truth'
import { PageHeader } from '@/components/brand/page-header'
import { ActionLink, Disclosure } from '@/components/brand/section'
import { ScenePanel } from '@/components/media/page-media'
import { breadcrumbJsonLd } from '@/lib/structured-data'

export const metadata: Metadata = {
  title: 'Team, Fahrzeuge und Geschichte',
  description:
    'Die Fahrschule Krebs ist ein Familienbetrieb aus Fulda — seit 1964, heute in zweiter Generation, mit eigenem Fuhrpark, eigenen LKW und einem eigenen Bus.',
  alternates: { canonical: '/team' },
}

const trail = [
  { name: 'Start', href: '/' },
  { name: 'Team', href: '/team' },
]

export default function TeamPage() {
  const founded = publicValue(business.founded)
  const founder = publicValue(business.founder)
  const succession = publicValue(business.successionYear)
  const branch = publicValue(business.branchOpened)
  const team = publicValue(business.instructorTeam)
  const scope = publicValue(business.instructorScope)
  const fleet = publicValue(business.fleet)
  const fleetNote = publicValue(business.fleetNote)
  const director = publicValue(business.managingDirector)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }} />
      <PageHeader
        eyebrow="Die Fahrschule"
        title="Ein Familienbetrieb, kein Franchise"
        lead={founded ? `Seit ${founded} bilden wir in Fulda aus — inzwischen ${yearsInBusiness()} Jahre, in zweiter Generation.` : undefined}
        trail={trail}
        actions={<ActionLink href="/kontakt">Lern uns kennen</ActionLink>}
      />

      <div className="shell space-y-16 pb-24">
        {founded && founder && (
          <section aria-labelledby="geschichte">
            <h2 id="geschichte" className="font-display text-2xl font-bold text-chalk">Wie es dazu kam</h2>
            <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-chalk/10 bg-chalk/8 sm:grid-cols-3">
              <li className="bg-ink-900 p-6">
                <p className="tabular font-display text-3xl font-extrabold text-signal-500">{founded}</p>
                <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
                  {founder} gründet die Fahrschule in Fulda — zunächst als Ein-Mann-Betrieb mit PKW und Motorrad.
                </p>
              </li>
              {succession && (
                <li className="bg-ink-900 p-6">
                  <p className="tabular font-display text-3xl font-extrabold text-signal-500">{succession}</p>
                  <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
                    {director ?? 'Michael Krebs'} steigt in zweiter Generation in den Familienbetrieb ein.
                  </p>
                </li>
              )}
              {branch && (
                <li className="bg-ink-900 p-6">
                  <p className="tabular font-display text-3xl font-extrabold text-signal-500">{branch}</p>
                  <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
                    Die Filiale in Bad Hersfeld eröffnet — bis heute der zweite und einzige Standort.
                  </p>
                </li>
              )}
            </ol>
          </section>
        )}

        {team && (
          <section aria-labelledby="team-heading">
            <h2 id="team-heading" className="font-display text-2xl font-bold text-chalk">Das K-Team</h2>
            <p className="mt-4 max-w-3xl text-[0.9375rem] leading-relaxed text-chalk-soft">
              Bei uns unterrichten {team}
              {scope ? ` in den Klassen ${scope}` : ''}. Wer bei welcher Klasse dein Ansprechpartner ist, klären wir bei
              der Anmeldung — es kommt darauf an, was du vorhast und wann du kannst.
            </p>
            <figure className="mt-6 overflow-hidden rounded-2xl border border-chalk/10">
              <Image
                src="/team/k-team-banner.avif"
                alt="Das K-Team der Fahrschule Krebs — das gesamte Team in schwarzen Krebs-Jacken vor dunklem Hintergrund"
                width={1640}
                height={624}
                sizes="(min-width: 1280px) 1152px, 100vw"
                className="w-full"
              />
            </figure>
            {/* The same photograph, hung in a dark gallery and swept by light */}
            <ScenePanel
              clip="teamGallery"
              caption="Studio-Inszenierung — das K-Team-Foto als Galerieabzug"
              className="mt-6"
            />
            <Disclosure>
              Einzelporträts mit Klassen und Schwerpunkten folgen, sobald sie freigegeben sind — erfundene Profile
              zeigen wir nicht.
            </Disclosure>
          </section>
        )}

        <section aria-labelledby="fahrzeuge">
          <h2 id="fahrzeuge" className="font-display text-2xl font-bold text-chalk">Fahrzeuge</h2>
          {fleetNote && <p className="mt-4 max-w-3xl text-[0.9375rem] leading-relaxed text-chalk-soft">{fleetNote}</p>}
          {fleet && fleet.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2">
              {fleet.map((brand) => (
                <li key={brand} className="rounded-lg border border-chalk/12 px-3.5 py-2 text-sm text-chalk-dim">
                  {brand}
                </li>
              ))}
            </ul>
          )}
          {publicValue(practiceGround.address) && (
            <p className="mt-6 text-sm text-chalk-dim">
              Dazu kommt der {practiceGround.name} in der Bellingerstraße: {practiceGround.purpose}
            </p>
          )}
        </section>

        <section aria-labelledby="standorte-heading">
          <h2 id="standorte-heading" className="font-display text-2xl font-bold text-chalk">Wo wir sind</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {locations.map((location) => (
              <li key={location.slug} className="surface p-6">
                <p className="font-display text-lg font-bold text-chalk">{location.name}</p>
                <p className="mt-2 text-sm leading-relaxed text-chalk-dim">{location.intro}</p>
                <a href={`/standorte/${location.slug}`} className="mt-3 inline-block text-sm font-semibold text-signal-400 hover:text-signal-500">
                  Standort ansehen
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
