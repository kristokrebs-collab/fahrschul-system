import Image from 'next/image'
import Link from 'next/link'
import { business, locations, practiceGround } from '@/content/business'
import { publicValue } from '@/content/truth'
import { ChapterHeading } from '@/components/brand/section'

/**
 * Chapter 10 — people and places.
 *
 * No invented biographies, no stock portraits, no fabricated testimonials: the
 * research turned up no photography we are entitled to use and no verified
 * review figure worth printing. So this chapter trades on what *is* verified —
 * a 1964 family business, its own fleet, its own practice ground, two stations
 * — and leaves a clearly marked space for real photography and real instructor
 * profiles once the owner supplies them.
 */
export function LocationsChapter() {
  const founded = publicValue(business.founded)
  const founder = publicValue(business.founder)
  const succession = publicValue(business.successionYear)
  const branch = publicValue(business.branchOpened)
  const team = publicValue(business.instructorTeam)
  const scope = publicValue(business.instructorScope)
  const fleetNote = publicValue(business.fleetNote)
  const groundSize = publicValue(practiceGround.size)
  const groundAddress = publicValue(practiceGround.address)

  return (
    <section className="chapter relative" aria-labelledby="standorte" data-atmo="46/35">
      <div className="atmos-lanes" />
      <div className="shell relative">
        <ChapterHeading
          marker="Kapitel 10 — Menschen & Orte"
          id="standorte"
          title="Zwei Bahnhöfe, ein Betrieb"
          lead="Beide Standorte liegen direkt am Bahnhof — das ist kein Zufall, sondern der Grund, warum du ohne Auto zur Fahrschule kommst."
        />

        {/* The history, told with verified dates only */}
        {founded && founder && (
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-chalk/10 bg-chalk/8 sm:grid-cols-3">
            <Milestone year={String(founded)} title="Gegründet" body={`${founder} startet in Fulda als Ein-Mann-Betrieb.`} />
            {succession && (
              <Milestone year={String(succession)} title="Zweite Generation" body="Michael Krebs steigt in den Familienbetrieb ein." />
            )}
            {branch && <Milestone year={String(branch)} title="Filiale" body="Bad Hersfeld kommt als zweiter Standort dazu." />}
          </ol>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {locations.map((location) => {
            const street = publicValue(location.street)
            const postal = publicValue(location.postalCode)
            const phone = publicValue(location.phone)
            const phoneHref = publicValue(location.phoneHref)
            const theory = publicValue(location.theorySchedule)

            return (
              <div key={location.slug} className="flex flex-col rounded-2xl border border-chalk/10 bg-ink-850/50 p-7">
                <h3 className="font-display text-2xl font-extrabold text-chalk">{location.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{location.intro}</p>

                {street && postal && (
                  <address className="mt-5 text-sm not-italic text-chalk-soft">
                    {street}, {postal} {location.city}
                    {phone && phoneHref && (
                      <>
                        {' · '}
                        <a href={`tel:${phoneHref}`} className="font-semibold hover:text-chalk">
                          {phone}
                        </a>
                      </>
                    )}
                  </address>
                )}

                {theory && theory.length > 0 && (
                  <dl className="mt-5 space-y-2 border-t border-chalk/8 pt-4">
                    {theory.map((slot) => (
                      <div key={slot.label}>
                        <dt className="text-xs font-semibold text-chalk-soft">{slot.label}</dt>
                        <dd className="text-xs text-chalk-dim">{slot.detail}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <ul className="mt-5 flex flex-wrap gap-2">
                  {location.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="rounded-lg border border-chalk/10 px-2.5 py-1 text-xs text-chalk-dim"
                    >
                      {highlight}
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/standorte/${location.slug}`}
                  className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-signal-400 hover:text-signal-500"
                >
                  Standort {location.name} ansehen
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
            )
          })}
        </div>

        {/* The real K-Team — the photograph the whole chapter was waiting for */}
        {team && (
          <figure className="relative mt-6 overflow-hidden rounded-2xl border border-chalk/10">
            <Image
              src="/team/k-team-strip.avif"
              alt="Das Team der Fahrschule Krebs — rund zwanzig Fahrlehrerinnen, Fahrlehrer und Büromitarbeitende in schwarzen Krebs-Jacken"
              width={1640}
              height={254}
              sizes="(min-width: 1280px) 1152px, 100vw"
              className="w-full object-cover"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/70 via-transparent to-transparent" />
            <figcaption className="absolute bottom-3 left-4 right-4 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-display text-lg font-extrabold text-chalk drop-shadow">Das K-Team</span>
              <Link href="/team" className="text-sm font-semibold text-signal-400 hover:text-signal-500">
                Team und Fahrzeuge ansehen
              </Link>
            </figcaption>
          </figure>
        )}

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {team && (
            <div className="rounded-2xl border border-chalk/10 bg-ink-850/50 p-7">
              <h3 className="font-display text-lg font-bold text-chalk">Das Team</h3>
              <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
                {team}
                {scope ? ` unterrichten in den Klassen ${scope}.` : '.'} {fleetNote}
              </p>
            </div>
          )}

          {groundAddress && (
            <div className="rounded-2xl border border-chalk/10 bg-ink-850/50 p-7">
              <h3 className="font-display text-lg font-bold text-chalk">{practiceGround.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
                {practiceGround.purpose}
                {groundSize && ` Rund ${groundSize.replace('rund ', '')} Fläche.`}
              </p>
              <p className="mt-3 text-xs text-chalk-faint">{groundAddress}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Milestone({ year, title, body }: { year: string; title: string; body: string }) {
  return (
    <li className="bg-ink-900 p-6">
      <p className="tabular font-display text-3xl font-extrabold leading-none text-signal-500">{year}</p>
      <p className="mt-3 font-display text-sm font-bold text-chalk">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-chalk-dim">{body}</p>
    </li>
  )
}
