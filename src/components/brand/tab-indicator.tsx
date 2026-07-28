'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A single lit block that slides between tabs instead of each tab lighting up
 * on its own. One light moving along a row reads as a vehicle changing lane;
 * separate lights switching on and off read as a form control.
 *
 * The indicator is a real element measured from the selected tab, so it works
 * with any tab widths and any font. Under reduced motion it jumps instead of
 * gliding, which is the correct behaviour rather than a degraded one.
 */
export function TabIndicator({
  children,
  selectedId,
  className = '',
  ...rest
}: {
  children: ReactNode
  /** DOM id of the currently selected tab button. */
  selectedId: string
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = ref.current
    if (!wrap) return
    const bar = wrap.querySelector<HTMLElement>('[data-indicator]')
    const tab = document.getElementById(selectedId)
    if (!bar || !tab) return

    const place = () => {
      const w = wrap.getBoundingClientRect()
      const t = tab.getBoundingClientRect()
      bar.style.width = `${t.width}px`
      bar.style.height = `${t.height}px`
      bar.style.transform = `translate3d(${t.left - w.left + wrap.scrollLeft}px, ${t.top - w.top}px, 0)`
      bar.style.opacity = '1'
    }

    place()
    const ro = new ResizeObserver(place)
    ro.observe(wrap)
    wrap.addEventListener('scroll', place, { passive: true })
    return () => {
      ro.disconnect()
      wrap.removeEventListener('scroll', place)
    }
  }, [selectedId])

  return (
    <div ref={ref} className={`tab-rail relative ${className}`} {...rest}>
      <span aria-hidden data-indicator className="tab-indicator" />
      {children}
    </div>
  )
}
