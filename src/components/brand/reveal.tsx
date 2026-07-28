'use client'

import { Children, Fragment, cloneElement, isValidElement, useEffect, useRef, type ReactNode } from 'react'

/**
 * Kinetic type: headings rise word by word out of a mask as their chapter
 * scrolls into view.
 *
 * Progressive enhancement, strictly. The server renders the words as plain
 * visible text; only once JavaScript runs (and the visitor accepts motion)
 * does the component arm the mask and play the reveal — by mutating a data
 * attribute, never by re-rendering. No JS, no motion preference, no
 * IntersectionObserver → the text simply stands there, which is exactly
 * right.
 */

/** Split string children into per-word mask spans; keep elements (e.g. <br/>) intact. */
function splitWords(node: ReactNode, index: { i: number }): ReactNode {
  if (typeof node === 'string') {
    const parts = node.split(/(\s+)/)
    return parts.map((part, k) => {
      if (part.trim() === '') return part
      const i = index.i++
      return (
        <span key={`w${i}-${k}`} className="reveal-word">
          <span style={{ ['--reveal-i' as string]: i }}>{part}</span>
        </span>
      )
    })
  }
  if (isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: ReactNode; className?: string }>
    // An element that styles its own text (the hero's red line) stays whole:
    // one mask around it, so its own background-clip effects keep working.
    if (typeof el.type === 'string' && el.props.className) {
      const i = index.i++
      return (
        <span key={`a${i}`} className="reveal-word">
          <span style={{ ['--reveal-i' as string]: i }}>{el}</span>
        </span>
      )
    }
    if (el.type === Fragment || typeof el.type === 'string') {
      const kids = el.props.children
      if (kids == null) return node
      return cloneElement(el, undefined, splitWords(kids, index))
    }
    return node
  }
  if (Array.isArray(node)) {
    return Children.map(node, (child) => splitWords(child, index))
  }
  return node
}

/** Arm (hide) and release (animate) an element via its data attribute. */
function useReveal<T extends HTMLElement>(threshold: number) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Arming and releasing happen in one place, so the text is never left
    // hidden for anyone the observer cannot reach.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          node.dataset.reveal = 'go'
          io.disconnect()
        }
      },
      { threshold },
    )
    node.dataset.reveal = 'armed'
    io.observe(node)
    return () => {
      io.disconnect()
      node.dataset.reveal = 'idle'
    }
  }, [threshold])

  return ref
}

export function RevealWords({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLSpanElement>(0.35)
  const content = splitWords(children, { i: 0 })
  return (
    <span ref={ref} data-reveal="idle" className={className}>
      {content}
    </span>
  )
}

/** Soft rise-and-fade for anything that is not a headline (leads, panels). */
export function RevealBlock({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useReveal<HTMLDivElement>(0.2)
  return (
    <div ref={ref} data-reveal="idle" className={`reveal-block ${className}`} style={{ ['--reveal-delay' as string]: `${delay}ms` }}>
      {children}
    </div>
  )
}
