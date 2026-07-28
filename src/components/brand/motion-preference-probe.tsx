'use client'

import { useEffect } from 'react'

/**
 * Marks the document when the user has asked for reduced motion, so that CSS
 * rules which cannot express the query (and JS animation set-up) can branch on
 * a single attribute. Kept tiny and effect-only: it renders nothing and never
 * blocks paint.
 */
export function MotionPreferenceProbe() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      document.documentElement.toggleAttribute('data-reduced', mq.matches)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return null
}
