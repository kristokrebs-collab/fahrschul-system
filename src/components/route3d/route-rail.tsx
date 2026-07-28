'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The route odometer — a tachometer-style rail on the right edge of the
 * homepage. Fifty tick bars trace the page; the ticks nearest the current
 * position magnify and warm toward signal red, and chapter stations are
 * clickable dots that scroll to their section.
 *
 * Reads the same [data-atmo] chapter sections the 3D scene uses, so both
 * layers always agree on where the journey's stations are. All per-frame
 * work is direct style writes; React renders only on mount and resize.
 */

const TICKS = 50

export function RouteRail() {
  const railRef = useRef<HTMLDivElement>(null)
  const [stations, setStations] = useState<{ f: number; label: string; id: string }[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const measure = () => {
      const sections = document.querySelectorAll<HTMLElement>('[data-atmo]')
      const range = document.documentElement.scrollHeight - window.innerHeight
      if (range <= 0 || sections.length === 0) return
      const s: { f: number; label: string; id: string }[] = []
      sections.forEach((el, i) => {
        const rect = el.getBoundingClientRect()
        const centre = rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2
        const heading = el.querySelector('h1, h2')
        s.push({
          f: Math.min(1, Math.max(0, centre / range)),
          label: heading?.textContent?.trim().replace(/\s+/g, ' ') ?? `Kapitel ${i + 1}`,
          id: el.id || heading?.id || '',
        })
      })
      setStations(s)
      setReady(true)
    }

    let current = 0
    let target = 0
    let raf = 0

    const paint = () => {
      const rail = railRef.current
      if (!rail) return
      // Spring toward the target so fast flicks read as momentum, not jumps.
      current += (target - current) * (reduced ? 1 : 0.16)
      const ticks = rail.querySelectorAll<HTMLElement>('[data-tick]')
      ticks.forEach((tick, i) => {
        const f = i / (TICKS - 1)
        const d = Math.abs(f - current)
        const near = Math.max(0, 1 - d * 9)
        tick.style.transform = `scaleX(${1 + near * 1.1})`
        tick.style.opacity = String(0.18 + near * 0.82)
        tick.style.background = near > 0.55 ? 'var(--color-signal-500)' : ''
      })
      if (!reduced && Math.abs(target - current) > 0.0005) {
        raf = requestAnimationFrame(paint)
      } else {
        raf = 0
      }
    }

    const onScroll = () => {
      const range = document.documentElement.scrollHeight - window.innerHeight
      target = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0
      if (!raf) raf = requestAnimationFrame(paint)
    }

    measure()
    onScroll()
    const ro = new ResizeObserver(() => {
      measure()
      onScroll()
    })
    ro.observe(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (!ready) return null

  return (
    <div
      ref={railRef}
      className="route-rail fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
      aria-hidden
    >
      <div className="relative flex h-[46vh] flex-col justify-between">
        {Array.from({ length: TICKS }, (_, i) => (
          <span key={i} data-tick className="route-tick block h-px w-4 origin-right transition-none" />
        ))}
        {stations.map((st) => (
          <button
            key={st.f}
            type="button"
            tabIndex={-1}
            title={st.label}
            onClick={() => {
              const range = document.documentElement.scrollHeight - window.innerHeight
              window.scrollTo({ top: st.f * range, behavior: 'smooth' })
            }}
            className="route-station absolute -right-1.5 h-2 w-2 -translate-y-1/2 cursor-pointer rounded-full transition-colors hover:!border-signal-400 hover:!bg-signal-500"
            style={{ top: `${st.f * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}
