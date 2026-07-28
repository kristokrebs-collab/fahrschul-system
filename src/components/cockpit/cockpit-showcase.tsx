'use client'

import { useEffect, useRef, useState } from 'react'
import {
  cockpitStates,
  demoStudent,
  documents,
  readinessChecks,
  sonderfahrtenProgress,
  trainingSteps,
  type CockpitState,
} from '@/content/cockpit-demo'
import { CockpitScreen } from './cockpit-screen'

/**
 * Chapter 5 — the Schüler-Cockpit.
 *
 * Desktop: the device is sticky while the narrative scrolls past it, and the
 * screen content changes as each passage comes into view. Crucially the page
 * keeps scrolling normally the whole time — nothing is pinned by hijacking the
 * wheel, so there is no nested-scroll trap and no fighting the scrollbar.
 * Section visibility drives the state via IntersectionObserver, which costs
 * nothing per frame.
 *
 * Mobile: no sticky device, no phone-inside-a-phone. Each state becomes a
 * full-width panel in normal document flow.
 *
 * Reduced motion / no JS: every state is rendered as ordinary, ordered content
 * — the observer only ever *adds* the synchronised behaviour on top.
 */
export function CockpitShowcase() {
  const [activeIndex, setActiveIndex] = useState(0)
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const nodes = sectionRefs.current.filter((n): n is HTMLDivElement => n !== null)
    if (nodes.length === 0) return

    // Only the desktop layout syncs a single device to many passages.
    const desktop = window.matchMedia('(min-width: 1024px)')
    if (!desktop.matches) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Choose the passage closest to the middle of the viewport rather than
        // the first intersecting one, so fast scrolling cannot leave the device
        // showing a state the reader has already passed.
        let best: { index: number; distance: number } | null = null
        const middle = window.innerHeight / 2

        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = nodes.indexOf(entry.target as HTMLDivElement)
          if (index === -1) continue
          const rect = entry.boundingClientRect
          const distance = Math.abs(rect.top + rect.height / 2 - middle)
          if (!best || distance < best.distance) best = { index, distance }
        }

        if (best) setActiveIndex(best.index)
      },
      { rootMargin: '-30% 0px -30% 0px', threshold: [0, 0.5, 1] },
    )

    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
        {/* Narrative column */}
        <div className="order-2 lg:order-1">
          {cockpitStates.map((state, index) => (
            <div
              key={state.id}
              ref={(node) => {
                sectionRefs.current[index] = node
              }}
              // The tall passage is what gives the sticky device room to change
              // state. With reduced motion there is no state change to pace, so
              // the extra height would just be dead space — it collapses.
              className="lg:flex lg:min-h-[70vh] lg:flex-col lg:justify-center motion-reduce:lg:min-h-0"
            >
              <StatePassage state={state} index={index} active={index === activeIndex} />

              {/* Mobile: the screen belongs with its own passage. */}
              <div className="mt-6 lg:hidden">
                <MobilePanel state={state} />
              </div>
            </div>
          ))}
        </div>

        {/* Device column — sticky on desktop only */}
        <div className="order-1 hidden lg:order-2 lg:block">
          <div className="sticky top-[calc(var(--header-h)+3rem)]">
            <DeviceFrame>
              <CockpitScreen
                stateId={cockpitStates[activeIndex]?.id ?? 'heute'}
                student={demoStudent}
                steps={trainingSteps}
                sonderfahrten={sonderfahrtenProgress}
                documents={documents}
                readiness={readinessChecks}
              />
            </DeviceFrame>

            <ol className="mt-6 flex flex-wrap justify-center gap-1.5" aria-hidden>
              {cockpitStates.map((state, index) => (
                <li key={state.id}>
                  <span
                    className={`block h-1 rounded-full transition-all duration-500 ${
                      index === activeIndex ? 'w-8 bg-signal-500' : 'w-4 bg-chalk/15'
                    }`}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatePassage({ state, index, active }: { state: CockpitState; index: number; active: boolean }) {
  return (
    // Inactive passages are de-emphasised, not hidden. The floor is 60% rather
    // than something more dramatic because below roughly that the body text
    // stops clearing 4.5:1 against the background — a passage the reader has
    // not reached yet still has to be readable. Removed entirely for users who
    // asked for reduced motion.
    <div
      className={`transition-opacity duration-500 motion-reduce:!opacity-100 lg:py-8 ${
        active ? 'lg:opacity-100' : 'lg:opacity-60'
      }`}
    >
      <p className="kapitel-label">
        <span className="tabular">{String(index + 1).padStart(2, '0')}</span>
        <span className="text-chalk-faint">{state.tab}</span>
      </p>
      <h3 className="mt-4 font-display text-2xl font-extrabold leading-tight text-chalk sm:text-3xl">{state.title}</h3>
      <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-chalk-soft">{state.narrative}</p>
      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
        {state.bullets.map((bullet) => (
          <li key={bullet} className="flex items-center gap-2 text-sm text-chalk-dim">
            <span aria-hidden className="h-1 w-3 rounded-sm bg-signal-500/70" />
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** On phones the interface is shown at full width — never inside a phone. */
function MobilePanel({ state }: { state: CockpitState }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-chalk/10 bg-ink-900">
      <CockpitScreen
        stateId={state.id}
        student={demoStudent}
        steps={trainingSteps}
        sonderfahrten={sonderfahrtenProgress}
        documents={documents}
        readiness={readinessChecks}
      />
    </div>
  )
}

/**
 * The device. A restrained aluminium-and-glass suggestion rather than a
 * photorealistic mock-up: enough to read as a phone, not so much that the
 * bezel competes with the interface inside it.
 */
function DeviceFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[21rem]">
      <div
        aria-hidden
        className="absolute -inset-8 -z-10 rounded-[3rem] opacity-70"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--color-signal-500) 18%, transparent), transparent 70%)',
        }}
      />
      <div className="rounded-[2.25rem] border border-chalk/14 bg-gradient-to-b from-ink-700 to-ink-850 p-[3px] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-ink-950">
          <div aria-hidden className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-ink-950" />
          {children}
        </div>
      </div>
    </div>
  )
}
