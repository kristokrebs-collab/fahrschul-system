'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { categories, classCategoryOrder, classesByCategory, sonderfahrtenTotal, type ClassCategory } from '@/content/classes'
import { publicValue } from '@/content/truth'
import { MarkBus, MarkClasses, MarkProfessional, MarkTwoWheel } from '@/components/brand/marks'

const CATEGORY_MARK: Record<ClassCategory, (props: { className?: string }) => React.ReactElement> = {
  pkw: MarkClasses,
  zweirad: MarkTwoWheel,
  lkw: MarkProfessional,
  bus: MarkBus,
  spezial: MarkClasses,
}

/**
 * Studio visuals from the approved Higgsfield archive — each category's
 * vehicle staged on the red-ring turntable, matching the site's material
 * language. They are staged product illustrations, not photographs of the
 * training fleet, and are captioned accordingly.
 */
const CATEGORY_IMAGE: Record<ClassCategory, { src: string; alt: string } | null> = {
  pkw: { src: '/vehicles/pkw-1600.avif', alt: 'Schwarzer Kombi im dunklen Studio auf rot beleuchteter Drehscheibe' },
  zweirad: { src: '/vehicles/motorrad-1600.avif', alt: 'Sportmotorrad im dunklen Studio auf rot beleuchteter Drehscheibe' },
  lkw: { src: '/vehicles/lkw-1600.avif', alt: 'Rote Sattelzugmaschine im dunklen Studio auf rot beleuchteter Drehscheibe' },
  bus: { src: '/vehicles/bus-1600.avif', alt: 'Stadtbus im dunklen Studio auf rot beleuchteter Drehscheibe' },
  spezial: null,
}

/**
 * Chapter 3 — the licence universe as a lane system.
 *
 * Rather than twenty identical cards, the classes are organised as
 * carriageways: you pick a lane, and the classes in it are laid out in the
 * order you would actually progress through them. The active lane is the only
 * thing carrying brand red, so the eye always knows where it is.
 *
 * Tabs are real buttons in a tablist with arrow-key support; the panels stay in
 * the DOM order the headings imply, so keyboard and screen-reader users get the
 * same structure the visual gives everyone else.
 */
export function LicenceRoute() {
  const [active, setActive] = useState<ClassCategory>('pkw')

  function onKeyDown(event: React.KeyboardEvent) {
    const index = classCategoryOrder.indexOf(active)
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = classCategoryOrder[(index + delta + classCategoryOrder.length) % classCategoryOrder.length]
      if (next) {
        setActive(next)
        document.getElementById(`lane-tab-${next}`)?.focus()
      }
    }
  }

  const classes = classesByCategory(active)

  return (
    <div>
      <div
        role="tablist"
        aria-label="Fahrzeugarten"
        onKeyDown={onKeyDown}
        className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {classCategoryOrder.map((category) => {
          const selected = category === active
          const Mark = CATEGORY_MARK[category]
          return (
            <button
              key={category}
              id={`lane-tab-${category}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`lane-panel-${category}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(category)}
              className={`flex min-h-12 shrink-0 items-center gap-2.5 rounded-xl border px-4 text-sm font-semibold transition-colors ${
                selected
                  ? 'border-signal-500/50 bg-signal-500/10 text-chalk'
                  : 'border-chalk/10 text-chalk-dim hover:border-chalk/25 hover:text-chalk'
              }`}
            >
              <Mark className={`h-4.5 w-4.5 ${selected ? 'text-signal-400' : 'text-chalk-faint'}`} />
              {categories[category].label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`lane-panel-${active}`}
        aria-labelledby={`lane-tab-${active}`}
        tabIndex={0}
        className="mt-7 focus:outline-none"
      >
        {CATEGORY_IMAGE[active] && (
          <figure className="relative mb-8 overflow-hidden rounded-2xl border border-chalk/10">
            <Image
              key={active}
              src={CATEGORY_IMAGE[active].src}
              alt={CATEGORY_IMAGE[active].alt}
              width={1600}
              height={900}
              sizes="(min-width: 1280px) 1152px, 100vw"
              className="lane-stage-in h-52 w-full object-cover object-center sm:h-64 md:h-80"
              priority={false}
            />
            {/* Blend the studio floor into the page surface */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/40" />
            <figcaption className="absolute bottom-3 left-4 flex items-baseline gap-3">
              <span className="font-display text-xl font-extrabold text-chalk drop-shadow">{categories[active].label}</span>
              <span className="text-[0.65rem] uppercase tracking-widest text-chalk-dim">Studio-Darstellung</span>
            </figcaption>
          </figure>
        )}
        <p className="max-w-2xl text-[0.9375rem] text-chalk-dim">{categories[active].blurb}</p>

        {/* The lane: classes strung along one continuous line. */}
        <ol className="relative mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 hidden h-px bg-gradient-to-r from-signal-500/60 via-chalk/12 to-transparent xl:block"
          />
          {classes.map((licenceClass, index) => {
            const sf = publicValue(licenceClass.sonderfahrten)
            const theory = publicValue(licenceClass.theory)
            const minAge = publicValue(licenceClass.minAge)

            return (
              <li key={licenceClass.slug}>
                <Link
                  href={`/fuehrerschein/${licenceClass.slug}`}
                  className="group relative flex h-full flex-col rounded-2xl border border-chalk/10 bg-ink-850/60 p-6 transition-all duration-300 hover:border-signal-500/45 hover:bg-ink-800/70"
                >
                  <span
                    aria-hidden
                    className="absolute left-6 top-0 h-0.5 w-10 -translate-y-px bg-signal-500/0 transition-colors duration-300 group-hover:bg-signal-500"
                  />

                  <div className="flex items-start justify-between gap-3">
                    <span className="tabular font-display text-2xl font-extrabold leading-none text-chalk">
                      {licenceClass.code}
                    </span>
                    <span className="tabular mt-1 text-[0.6875rem] font-semibold tracking-widest text-chalk-faint">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold text-signal-400">{licenceClass.tagline}</p>
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-chalk-dim">{licenceClass.summary}</p>

                  <dl className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-chalk/8 pt-4 text-xs">
                    {minAge && (
                      <div>
                        <dt className="text-chalk-faint">Ab</dt>
                        <dd className="tabular mt-0.5 font-semibold text-chalk-soft">{minAge}</dd>
                      </div>
                    )}
                    {theory && (
                      <div>
                        <dt className="text-chalk-faint">Theorie</dt>
                        <dd className="tabular mt-0.5 font-semibold text-chalk-soft">
                          {theory.grundstoff + theory.zusatzstoff} Doppelstunden
                        </dd>
                      </div>
                    )}
                    {sf && (
                      <div>
                        <dt className="text-chalk-faint">Sonderfahrten</dt>
                        <dd className="tabular mt-0.5 font-semibold text-chalk-soft">{sonderfahrtenTotal(sf)}</dd>
                      </div>
                    )}
                  </dl>

                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-chalk transition-colors group-hover:text-signal-400">
                    {licenceClass.name} ansehen
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
