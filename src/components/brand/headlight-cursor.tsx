'use client'

import { useEffect } from 'react'

/**
 * A headlight that follows the pointer across the dark chapters.
 *
 * Not a replacement cursor — the real one stays, because taking it away costs
 * usability and buys nothing. This is a soft pool of warm light that trails
 * slightly behind the pointer and dims as the page moves into daylight, where
 * a headlight would make no sense.
 *
 * Fine pointers only, motion-safe only, one rAF loop, no React re-renders.
 */
export function HeadlightCursor() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const light = document.createElement('div')
    light.className = 'headlight'
    light.setAttribute('aria-hidden', 'true')
    document.body.appendChild(light)

    let tx = window.innerWidth / 2
    let ty = window.innerHeight / 2
    let x = tx
    let y = ty
    let raf = 0
    let alive = true

    const loop = () => {
      if (!alive) return
      // Trail, don't stick: the light arrives a moment after the pointer.
      x += (tx - x) * 0.14
      y += (ty - y) * 0.14
      light.style.transform = `translate3d(${x}px, ${y}px, 0)`
      raf = requestAnimationFrame(loop)
    }
    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      light.style.opacity = '1'
    }
    const onLeave = () => {
      light.style.opacity = '0'
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    raf = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      light.remove()
    }
  }, [])

  return null
}
