'use client'

import { useEffect, useRef, useState } from 'react'
import { cockpitScenes, routeMilestones } from '@/content/cockpit-demo'
import { CockpitScreen, type CockpitSection } from './cockpit-screen'

/**
 * The Cockpit chapter — a scroll-driven product presentation.
 *
 * Desktop mechanics: the section provides ~450vh of ordinary scroll runway; a
 * sticky full-height stage rides inside it. As the page scrolls, one progress
 * value (0..1) drives everything in lockstep:
 *
 *   · the device settles in from a slight tilt (entry),
 *   · the app content *inside* the phone scrolls to the section that the
 *     narrative is talking about — the phone visibly progresses, it is never
 *     a static screenshot with captions,
 *   · counters, bars and the Prüfungsreife ring fill as they scroll into
 *     relevance,
 *   · the active milestone of the training route advances,
 *   · and at the end the route line draws out of the device toward the next
 *     chapter, handing the story over.
 *
 * There is no scroll hijacking: the wheel is never intercepted, the scrollbar
 * keeps its meaning, and the runway is the only cost. Progress is measured in
 * a rAF-throttled scroll handler; React re-renders are quantised to 1 % steps
 * so the subtree updates at most ~100 times across the whole sequence.
 *
 * Mobile and reduced motion get a stacked narrative instead: full-width app
 * panels in document order — no pinning, no phone-in-a-phone, no runway.
 */

const SCENE_COUNT = cockpitScenes.length
/** Scroll runway per scene, in viewport heights. */
const RUNWAY_VH = 85

/** Which app block each scene should bring into view. */
const SCENE_ANCHOR: Record<string, CockpitSection | null> = {
  entry: null,
  fortschritt: 'fortschritt',
  fahrstil: 'fahrstil',
  protokoll: 'protokoll',
  finale: 'protokoll',
}

export function CockpitShowcase() {
  const [mode, setMode] = useState<'pending' | 'scroll' | 'stacked'>('pending')

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const decide = () => setMode(wide.matches && !reduced.matches ? 'scroll' : 'stacked')
    decide()
    wide.addEventListener('change', decide)
    reduced.addEventListener('change', decide)
    return () => {
      wide.removeEventListener('change', decide)
      reduced.removeEventListener('change', decide)
    }
  }, [])

  // Server-render the stacked variant: it is complete, ordered and needs no JS.
  if (mode !== 'scroll') return <StackedShowcase />
  return <ScrollShowcase />
}

/* ────────────────────────────────────────────────────────────────────────────
   Desktop: sticky stage + progress-driven device
   ─────────────────────────────────────────────────────────────────────────── */

function ScrollShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const deviceRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<SVGPathElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    let frame = 0
    let lastQuantised = -1

    const update = () => {
      frame = 0
      const rect = section.getBoundingClientRect()
      const runway = rect.height - window.innerHeight
      const p = runway > 0 ? Math.min(1, Math.max(0, -rect.top / runway)) : 0

      // Continuous transforms are written directly — no React involved.
      applyContinuous(p)

      // Discrete/derived state re-renders at most once per percent.
      const quantised = Math.round(p * 100)
      if (quantised !== lastQuantised) {
        lastQuantised = quantised
        setProgress(quantised / 100)
      }
    }

    const applyContinuous = (p: number) => {
      const device = deviceRef.current
      const screen = screenRef.current
      const line = lineRef.current

      if (device) {
        // Entry: settle from a slight product-shot tilt; finale: recede a touch.
        const settle = Math.min(1, p / 0.08)
        const recede = Math.max(0, (p - 0.85) / 0.15)
        device.style.transform =
          `perspective(1200px) rotateX(${(1 - settle) * 10}deg) translateY(${(1 - settle) * 36}px) scale(${1 - recede * 0.05})`
      }

      if (screen) {
        // Scroll the app to the block the narrative is discussing.
        const stage = screen.parentElement!
        const anchors = collectAnchors(screen, stage.clientHeight)
        const target = anchorOffsetForProgress(p, anchors)
        screen.style.transform = `translateY(${-target}px)`
      }

      if (line) {
        // The route line draws out of the device during the finale.
        const draw = Math.max(0, (p - 0.86) / 0.14)
        const length = line.getTotalLength()
        line.style.strokeDasharray = String(length)
        line.style.strokeDashoffset = String(length * (1 - draw))
      }
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const sceneIndex = Math.min(SCENE_COUNT - 1, Math.floor(progress * SCENE_COUNT))
  const scene = cockpitScenes[sceneIndex]!
  // Milestones advance with the story: two per scene, capped to the demo state.
  const activeMilestone = Math.min(routeMilestones.length - 1, 1 + sceneIndex * 2)

  return (
    <div ref={sectionRef} style={{ height: `${SCENE_COUNT * RUNWAY_VH + 100}vh` }} className="relative">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="shell grid w-full grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-center gap-16">
          {/* ── Narrative column ── */}
          <div className="max-w-xl">
            <p className="kapitel-label" aria-live="polite">
              <span className="tabular">{String(sceneIndex + 1).padStart(2, '0')}</span>
              <span className="text-chalk-faint">{scene.eyebrow}</span>
            </p>
            <h3 key={scene.id} className="mt-4 font-display text-3xl font-extrabold leading-tight text-chalk cockpit-scene-in xl:text-4xl">
              {scene.title}
            </h3>
            <p className="mt-4 text-[0.9575rem] leading-relaxed text-chalk-soft">{scene.body}</p>
            <ul className="mt-5 space-y-2">
              {scene.bullets.map((bullet) => (
                <li key={bullet} className="flex items-center gap-2.5 text-sm text-chalk-dim">
                  <span aria-hidden className="h-1 w-3 rounded-sm bg-signal-500/80" />
                  {bullet}
                </li>
              ))}
            </ul>

            {/* Training-route rail: the active milestone advances with the story */}
            <ol className="mt-8 flex flex-wrap gap-x-1 gap-y-2" aria-label="Ausbildungsweg in der App">
              {routeMilestones.map((milestone, i) => (
                <li key={milestone.label} className="flex items-center">
                  <span
                    className={`rounded-md px-2 py-1 text-[0.62rem] font-bold uppercase tracking-wide transition-colors duration-300 ${
                      i < activeMilestone
                        ? 'text-state-done'
                        : i === activeMilestone
                          ? 'bg-signal-500/15 text-signal-400'
                          : 'text-chalk-faint'
                    }`}
                  >
                    {milestone.label}
                  </span>
                  {i < routeMilestones.length - 1 && <span aria-hidden className="mx-0.5 h-px w-2 bg-chalk/15" />}
                </li>
              ))}
            </ol>

            <p className="mt-6 text-xs text-chalk-faint">
              Demo mit Beispieldaten — nachgebaut aus der echten Cockpit-App.
            </p>
          </div>

          {/* ── Device column ── */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-10 -z-10 opacity-80"
              style={{
                background:
                  'radial-gradient(55% 45% at 50% 8%, color-mix(in oklab, var(--color-signal-500) 20%, transparent), transparent 70%)',
              }}
            />
            <div ref={deviceRef} className="will-change-transform">
              <div className="mx-auto w-full max-w-[21rem] rounded-[2.4rem] border border-chalk/15 bg-gradient-to-b from-ink-700 to-ink-850 p-[3px] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.95)]">
                <div className="relative h-[36rem] overflow-hidden rounded-[2.25rem] bg-[#0b0a10]">
                  <div aria-hidden className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
                  <div ref={screenRef} className="will-change-transform">
                    <CockpitScreen progress={progress} />
                  </div>
                  {/* glass sheen */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[2.25rem] bg-gradient-to-br from-white/[0.05] via-transparent to-transparent" />
                </div>
              </div>
            </div>

            {/* Finale: the route line leaves the device toward the next chapter */}
            <svg
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full h-40 w-24 -translate-x-1/2"
              viewBox="0 0 96 160"
              fill="none"
            >
              <path
                ref={lineRef}
                d="M48 0 C48 60 48 60 48 160"
                stroke="var(--color-signal-500)"
                strokeWidth="4"
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 8px color-mix(in oklab, var(--color-signal-500) 70%, transparent))' }}
              />
            </svg>
          </div>
        </div>

        {/* Scene progress dots */}
        <ol className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden>
          {cockpitScenes.map((s, i) => (
            <li key={s.id}>
              <span
                className={`block h-1 rounded-full transition-all duration-500 ${
                  i === sceneIndex ? 'w-8 bg-signal-500' : 'w-4 bg-chalk/15'
                }`}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/** Reads the in-app anchor offsets, cached per layout via a WeakMap. */
const anchorCache = new WeakMap<HTMLElement, { offsets: Record<string, number>; max: number; height: number }>()

function collectAnchors(screen: HTMLElement, viewport: number) {
  const cached = anchorCache.get(screen)
  if (cached && cached.height === screen.scrollHeight) return cached

  const offsets: Record<string, number> = {}
  for (const el of screen.querySelectorAll<HTMLElement>('[data-scene]')) {
    offsets[el.dataset.scene!] = el.offsetTop
  }
  const result = {
    offsets,
    max: Math.max(0, screen.scrollHeight - viewport),
    height: screen.scrollHeight,
  }
  anchorCache.set(screen, result)
  return result
}

/** Maps global progress to an in-app scroll offset, interpolating between scene anchors. */
function anchorOffsetForProgress(
  p: number,
  anchors: { offsets: Record<string, number>; max: number },
): number {
  const segment = 1 / SCENE_COUNT
  const index = Math.min(SCENE_COUNT - 1, Math.floor(p / segment))
  const within = (p - index * segment) / segment

  const target = (i: number) => {
    const scene = cockpitScenes[Math.min(SCENE_COUNT - 1, i)]!
    const anchor = SCENE_ANCHOR[scene.id]
    // Lead with a small offset so the section label sits near the top.
    return anchor ? Math.min(anchors.max, Math.max(0, (anchors.offsets[anchor] ?? 0) - 24)) : 0
  }

  const from = target(index)
  const to = target(index + 1)
  // Hold for the first 60 % of a scene, then glide to the next anchor.
  const glide = within < 0.6 ? 0 : (within - 0.6) / 0.4
  return from + (to - from) * easeInOut(glide)
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/* ────────────────────────────────────────────────────────────────────────────
   Mobile / reduced motion: stacked, full-width, no pinning
   ─────────────────────────────────────────────────────────────────────────── */

const STACKED_SECTIONS: Record<string, readonly CockpitSection[] | null> = {
  entry: ['intro'],
  fortschritt: ['fortschritt'],
  fahrstil: ['fahrstil'],
  protokoll: ['protokoll'],
  finale: null,
}

function StackedShowcase() {
  return (
    <div className="space-y-12">
      {cockpitScenes.map((scene, index) => {
        const sections = STACKED_SECTIONS[scene.id]
        return (
          <section key={scene.id} aria-labelledby={`cockpit-${scene.id}`}>
            <p className="kapitel-label">
              <span className="tabular">{String(index + 1).padStart(2, '0')}</span>
              <span className="text-chalk-faint">{scene.eyebrow}</span>
            </p>
            <h3 id={`cockpit-${scene.id}`} className="mt-3 font-display text-2xl font-extrabold leading-tight text-chalk">
              {scene.title}
            </h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-chalk-soft">{scene.body}</p>

            {sections && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-chalk/10">
                <CockpitScreen sections={sections} />
              </div>
            )}

            {scene.id === 'finale' && (
              <ul className="mt-4 space-y-2">
                {scene.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-center gap-2.5 text-sm text-chalk-dim">
                    <span aria-hidden className="h-1 w-3 rounded-sm bg-signal-500/80" />
                    {bullet}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      <p className="text-xs text-chalk-faint">Demo mit Beispieldaten — nachgebaut aus der echten Cockpit-App.</p>
    </div>
  )
}
