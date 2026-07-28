import Link from 'next/link'
import { business, locations, yearsInBusiness } from '@/content/business'
import { licenceClasses } from '@/content/classes'
import { publicValue } from '@/content/truth'
import { Roadway } from '@/components/brand/roadway'
import { HeroParallax } from './hero-parallax'
import { SceneVideo } from '@/components/media/scene-video'
import { sceneClips } from '@/content/media'
import { RevealWords } from '@/components/brand/reveal'

/**
 * Chapter 1 — Dein Weg beginnt hier.
 *
 * Everything a visitor needs to act is inside the first frame: who this is,
 * what is on offer, where, and two clear next steps. The cinematic layer sits
 * behind the text and never delays it — the roadway is inline SVG that ships
 * with the HTML, so there is no image request between paint and comprehension.
 */
export function Hero() {
  const founded = publicValue(business.founded)
  const years = yearsInBusiness()
  const cities = locations.map((l) => l.name).join(' und ')

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden pt-[var(--header-h)]" data-atmo="72/22">
      <HeroParallax>
        {/* Cinematic layer, in order of capability: devices without the WebGL
            route get the filament footage; reduced motion gets its poster;
            the SVG roadway underlies both. Everything retires the moment the
            3D scene takes the stage. */}
        <div className="route3d-retire absolute inset-0">
          <Roadway className="absolute inset-x-0 bottom-0 h-[78%] w-full" />
          <SceneVideo
            name={sceneClips.heroFilament.name}
            hd={sceneClips.heroFilament.hd}
            className="media-weld-y opacity-55"
            videoClassName="object-bottom"
          />
        </div>
      </HeroParallax>

      <div className="atmos-falloff" />

      <div className="shell relative z-10 pb-16 pt-24 md:pb-24">
        <p className="kapitel-label">
          Fahrschule in {cities}
          {founded && <span className="text-chalk-faint">· seit {founded}</span>}
        </p>

        <h1 className="type-hero mt-6 max-w-[16ch] text-gradient-chalk">
          <RevealWords>
            Alle Klassen.
            <br />
            Zwei Standorte.
            <br />
            <span className="text-signal-500 shine-sweep">Ein Weg.</span>
          </RevealWords>
        </h1>

        <p className="type-lead mt-7 max-w-[52ch]">
          Vom Roller bis zum Bus bilden wir in jeder Führerscheinklasse aus — mit Simulatortraining,
          mehreren Theorieterminen pro Tag und einem Ablauf, der von Anfang an nachvollziehbar ist.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href="/fuehrerschein#finder"
            className="inline-flex min-h-13 items-center justify-center rounded-xl bg-signal-500 px-7 py-3.5 text-base font-semibold text-chalk shadow-[0_16px_48px_-16px_color-mix(in_oklab,var(--color-signal-500)_75%,transparent)] transition-colors hover:bg-signal-600"
          >
            Führerschein finden
          </Link>
          <Link
            href="/kontakt"
            className="inline-flex min-h-13 items-center justify-center rounded-xl border border-chalk/18 bg-chalk/[0.04] px-7 py-3.5 text-base font-semibold text-chalk transition-colors hover:border-chalk/35 hover:bg-chalk/[0.08]"
          >
            Beratung starten
          </Link>
          <Link
            href="/ausbildungsablauf"
            className="inline-flex min-h-13 items-center justify-center px-1 py-3.5 text-base font-semibold text-chalk-soft underline-offset-4 transition-colors hover:text-chalk hover:underline"
          >
            So läuft die Ausbildung ab
          </Link>
        </div>

        <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-6 border-t border-chalk/10 pt-8 sm:grid-cols-4">
          {/* Counted from the catalogue, never typed by hand — adding a class
              updates the headline figure automatically. */}
          <Stat value={String(licenceClasses.length)} label="Führerscheinklassen" />
          <Stat value={String(locations.length)} label={`Standorte in ${cities}`} />
          {founded && <Stat value={String(years)} label="Jahre Fahrausbildung" />}
          <Stat value="2." label="Generation im Familienbetrieb" />
        </dl>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tabular block font-display text-3xl font-extrabold leading-none text-chalk md:text-4xl">
          {value}
        </span>
        <span className="mt-2 block text-xs leading-snug text-chalk-dim">{label}</span>
      </dd>
    </div>
  )
}
