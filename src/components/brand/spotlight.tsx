'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * One headlight sweeping a group of dark surfaces.
 *
 * A single rAF-throttled pointer listener on the group writes local
 * coordinates into CSS custom properties on every registered card, and a
 * proximity value that lets nearby cards pre-glow before the pointer even
 * arrives. All drawing happens in CSS (see .spot-card in globals) — React
 * renders exactly once.
 *
 * Fine pointers only; on touch the cards keep their resting state, which is
 * already complete.
 */
export function SpotlightGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const group = ref.current
    if (!group) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let px = 0
    let py = 0

    const paint = () => {
      frame = 0
      const cards = group.querySelectorAll<HTMLElement>('.spot-card')
      cards.forEach((card) => {
        const r = card.getBoundingClientRect()
        const x = px - r.left
        const y = py - r.top
        // Distance from the card's nearest edge, for the pre-glow falloff.
        const dx = Math.max(r.left - px, 0, px - r.right)
        const dy = Math.max(r.top - py, 0, py - r.bottom)
        const dist = Math.hypot(dx, dy)
        card.style.setProperty('--mx', `${x}px`)
        card.style.setProperty('--my', `${y}px`)
        card.style.setProperty('--spot', String(Math.max(0, 1 - dist / 260)))
      })
    }

    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onLeave = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      group.querySelectorAll<HTMLElement>('.spot-card').forEach((card) => {
        card.style.setProperty('--spot', '0')
      })
    }

    group.addEventListener('pointermove', onMove)
    group.addEventListener('pointerleave', onLeave)
    return () => {
      group.removeEventListener('pointermove', onMove)
      group.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
