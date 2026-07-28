'use client'

import { useEffect, useRef } from 'react'

/**
 * Velocity type between chapters: two opposing strips of outlined display
 * text drifting like lane markings, shearing slightly with the reader's own
 * scroll momentum. Pure decoration — aria-hidden, with the actual words
 * available to everyone in the chapters themselves.
 *
 * The drift is a CSS keyframe loop; JavaScript only writes the velocity
 * shear, and not at all under reduced motion (where the strip stands still).
 */

const LINE = 'Fahrschule Krebs — Die Krebs Route — Fulda · Bad Hersfeld — Seit 1964 — '

export function RouteMarquee() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let lastY = window.scrollY
    let lastT = performance.now()
    let skew = 0
    let raf = 0

    const paint = () => {
      raf = 0
      skew *= 0.9
      node.style.setProperty('--marquee-skew', `${skew.toFixed(3)}deg`)
      if (Math.abs(skew) > 0.02) raf = requestAnimationFrame(paint)
    }

    const onScroll = () => {
      const now = performance.now()
      const dt = Math.max(8, now - lastT)
      const v = ((window.scrollY - lastY) / dt) * 1000
      lastY = window.scrollY
      lastT = now
      skew = Math.max(-4, Math.min(4, v / 900))
      if (!raf) raf = requestAnimationFrame(paint)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={ref} aria-hidden className="marquee-band pointer-events-none relative -my-4 overflow-hidden py-6">
      <div className="marquee-row marquee-left">
        {[0, 1].map((k) => (
          <span key={k} className="marquee-text">
            {LINE}
            <span className="marquee-solid">Ein Weg.</span>
            {' — '}
          </span>
        ))}
      </div>
      <div className="marquee-row marquee-right mt-2">
        {[0, 1].map((k) => (
          <span key={k} className="marquee-text marquee-dim">
            {LINE}
            <span className="marquee-solid">Alle Klassen.</span>
            {' — '}
          </span>
        ))}
      </div>
    </div>
  )
}
