'use client'

import { useEffect } from 'react'

/**
 * The background develops with the story.
 *
 * One fixed gradient layer sits behind the whole page; as chapters scroll
 * through the viewport, its red intensity and vertical position glide to that
 * chapter's values via a slow CSS transition. No animation loop — the layer
 * only changes when the active chapter changes, and the compositor does the
 * rest.
 *
 * Chapters opt in with `data-atmo="<intensity>/<y>"` — intensity 0..100 (how
 * much signal red bleeds into the dark), y 0..100 (where the light source
 * sits vertically). Sections without the attribute keep the last value, so
 * the light travels smoothly down the journey.
 */
export function ChapterAtmosphere() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const root = document.documentElement
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-atmo]'))
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // The chapter closest to mid-viewport wins.
        let best: { el: HTMLElement; d: number } | null = null
        const mid = window.innerHeight / 2
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const rect = entry.boundingClientRect
          const d = Math.abs(rect.top + rect.height / 2 - mid)
          if (!best || d < best.d) best = { el: entry.target as HTMLElement, d }
        }
        if (!best) return
        const [intensity = '0', y = '30'] = (best.el.dataset.atmo ?? '').split('/')
        root.style.setProperty('--atmo-intensity', String(Number(intensity) / 100))
        root.style.setProperty('--atmo-y', `${y}%`)
      },
      { rootMargin: '-25% 0px -25% 0px', threshold: [0, 0.4, 1] },
    )

    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])

  return <div aria-hidden className="atmos-chapter" />
}
