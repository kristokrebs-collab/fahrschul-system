'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The red beam drawn along the training route by the reader's own scrolling.
 *
 * The static gradient line stays as the no-JS baseline; this layer adds a
 * bright fill that grows with scroll position and ignites each milestone dot
 * as it passes. Progress is written as one custom property and one class per
 * dot — every visual is CSS, every frame is a single style write.
 */
export function GuideBeam({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const list = ref.current
    if (!list) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // The journey is shown complete rather than animated.
      list.style.setProperty('--beam', '1')
      list.querySelectorAll('.guide-dot').forEach((dot) => dot.classList.add('lit'))
      return
    }

    let frame = 0
    const paint = () => {
      frame = 0
      const rect = list.getBoundingClientRect()
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100) return
      const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.78 - rect.top) / rect.height))
      list.style.setProperty('--beam', progress.toFixed(4))
      list.querySelectorAll<HTMLElement>('.guide-dot').forEach((dot) => {
        const dotY = dot.getBoundingClientRect().top - rect.top
        dot.classList.toggle('lit', progress * rect.height >= dotY)
      })
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
    }
  }, [])

  return (
    <ol ref={ref} className={className}>
      {children}
    </ol>
  )
}
