'use client'

import { useEffect } from 'react'

/**
 * The clock behind the daylight arc.
 *
 * Writes one value — `--daylight`, 0 at the top of the page, 1 at the bottom —
 * onto the document element, from a rAF-throttled scroll handler. Everything
 * that has to agree on the time of day reads it from there: the fixed sky in
 * CSS, and the WebGL route's fog and ground.
 *
 * The curve is deliberately not linear. Night holds while the visitor is still
 * deciding, the light comes up through the middle chapters, and the last third
 * is unmistakably day — the payoff has to be felt, not measured.
 */
export function Daylight() {
  useEffect(() => {
    const root = document.documentElement

    let frame = 0
    const paint = () => {
      frame = 0
      const range = root.scrollHeight - window.innerHeight
      const p = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0
      // Hold the night, then open up: slow start, quick middle, settled end.
      const eased = p < 0.18 ? p * 0.28 : 0.05 + Math.pow((p - 0.18) / 0.82, 0.78) * 0.95
      root.style.setProperty('--daylight', eased.toFixed(4))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    paint()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
      root.style.removeProperty('--daylight')
    }
  }, [])

  return <div aria-hidden className="daylight-sky" />
}
