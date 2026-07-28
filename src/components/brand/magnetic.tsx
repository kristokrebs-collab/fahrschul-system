'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Magnetic pull for the one or two buttons that deserve it.
 *
 * The shell drifts toward the pointer (clamped hard), the label inside
 * drifts a little further, and everything springs back through a CSS
 * transition on leave. Direct style writes in a rAF handler — no React
 * involvement after mount, no effect at all for touch or reduced motion.
 */
export function Magnetic({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const shell = ref.current
    if (!shell) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const inner = shell.firstElementChild as HTMLElement | null
    if (!inner) return

    const MAX = 18
    let frame = 0
    let tx = 0
    let ty = 0

    const paint = () => {
      frame = 0
      shell.style.transform = `translate(${tx}px, ${ty}px)`
      inner.style.transform = `translate(${tx * 0.55}px, ${ty * 0.55}px)`
    }

    const onMove = (e: PointerEvent) => {
      const r = shell.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      tx = Math.max(-MAX, Math.min(MAX, dx * 0.28))
      ty = Math.max(-MAX, Math.min(MAX, dy * 0.28))
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onLeave = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      shell.style.transform = ''
      inner.style.transform = ''
    }

    shell.addEventListener('pointermove', onMove)
    shell.addEventListener('pointerleave', onLeave)
    return () => {
      shell.removeEventListener('pointermove', onMove)
      shell.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={ref} className={`magnetic ${className}`}>
      {children}
    </div>
  )
}
