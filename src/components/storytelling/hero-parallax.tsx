'use client'

import { useEffect, useRef } from 'react'

/**
 * Moves the roadway a little slower than the page as the hero leaves.
 *
 * Deliberately small in scope: one transform on one element, written directly
 * to style inside a rAF callback so React never re-renders on scroll. It does
 * nothing at all when the user prefers reduced motion, and it stops listening
 * once the hero is off screen.
 */
export function HeroParallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let visible = true

    const update = () => {
      frame = 0
      if (!visible) return
      const progress = Math.min(1, Math.max(0, window.scrollY / window.innerHeight))
      // Recede toward the horizon rather than simply sliding away.
      node.style.transform = `translate3d(0, ${progress * 8}%, 0) scale(${1 + progress * 0.06})`
      node.style.opacity = String(1 - progress * 0.55)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false
        if (visible) onScroll()
      },
      { threshold: 0 },
    )
    observer.observe(node)

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 -z-10 will-change-transform" aria-hidden>
      {children}
    </div>
  )
}
