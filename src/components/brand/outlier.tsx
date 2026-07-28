'use client'

import { useEffect, useRef } from 'react'

/**
 * The one typographic outlier on the entire site.
 *
 * Every reference that reads as expensive has exactly one line that is allowed
 * to perform; everything else stays still. Here that line is the hero's third
 * line — the promise the whole site is built on. Each glyph arrives on its own
 * spring, and a single band of light passes across once, afterwards. Nothing
 * else on the site is allowed this treatment.
 *
 * Rendered as plain text on the server and for reduced motion; the springs are
 * a decoration on top of something that already reads.
 */
export function Outlier({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Fonts settle first — springing an unstyled glyph and then reflowing it
    // is worse than not springing at all.
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) node.dataset.outlier = 'go'
    })
    node.dataset.outlier = 'armed'
    return () => {
      cancelled = true
    }
  }, [])

  const glyphs = [...text]
  return (
    <span ref={ref} data-outlier="idle" className={`outlier ${className}`} aria-label={text}>
      {glyphs.map((glyph, i) => (
        <span key={i} aria-hidden className="outlier-glyph" style={{ ['--g' as string]: i }}>
          {glyph === ' ' ? ' ' : glyph}
        </span>
      ))}
    </span>
  )
}
