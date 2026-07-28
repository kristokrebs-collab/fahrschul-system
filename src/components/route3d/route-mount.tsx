'use client'

import { useEffect, useRef, useState, type ComponentType, type RefObject } from 'react'
import type { RouteDriver } from './route-canvas'

type CanvasComponent = ComponentType<{ driver: RefObject<RouteDriver>; fractions: number[] }>

/**
 * Gate and driver for the 3D route scene.
 *
 * The scene only exists where it can be excellent: desktop viewports, WebGL2,
 * and no reduced-motion preference. Everyone else keeps the (already complete)
 * 2D atmosphere — the scene is an addition, never a requirement.
 *
 * The canvas module is imported by hand inside an effect rather than through
 * next/dynamic: a rejected import then costs only this component, not the
 * page's hydration, and nothing three.js-sized enters the bundle for visitors
 * whose device never qualifies.
 *
 * Scroll progress and pointer position are written into a mutable driver
 * object outside React, read per-frame inside the canvas. No re-renders on
 * scroll, ever.
 */
export function RouteMount() {
  const [active, setActive] = useState(false)
  const [Canvas, setCanvas] = useState<CanvasComponent | null>(null)
  const [fractions, setFractions] = useState<number[] | null>(null)
  // A mutable channel between scroll handlers and the render loop; only
  // event handlers and frame callbacks ever touch .current.
  const driver = useRef<RouteDriver>({ p: 0, mx: 0, my: 0 })

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const webgl = (() => {
      try {
        return Boolean(document.createElement('canvas').getContext('webgl2'))
      } catch {
        return false
      }
    })()

    const decide = () => setActive(webgl && wide.matches && !reduced.matches)
    decide()
    wide.addEventListener('change', decide)
    reduced.addEventListener('change', decide)
    return () => {
      wide.removeEventListener('change', decide)
      reduced.removeEventListener('change', decide)
    }
  }, [])

  useEffect(() => {
    if (!active || Canvas) return
    let cancelled = false
    import('./route-canvas')
      .then((m) => {
        if (!cancelled) setCanvas(() => m.default)
      })
      .catch(() => {
        // WebGL said yes but the module failed (network, driver quirks).
        // The 2D atmosphere is still on stage; nothing else may break.
      })
    return () => {
      cancelled = true
    }
  }, [active, Canvas])

  useEffect(() => {
    if (!active) {
      delete document.documentElement.dataset.route3d
      return
    }
    document.documentElement.dataset.route3d = 'on'

    const measure = () => {
      const sections = document.querySelectorAll<HTMLElement>('[data-atmo]')
      const doc = document.documentElement
      const range = doc.scrollHeight - window.innerHeight
      if (range <= 0 || sections.length === 0) return
      const f: number[] = []
      sections.forEach((el) => {
        const rect = el.getBoundingClientRect()
        const centre = rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2
        f.push(Math.min(1, Math.max(0, centre / range)))
      })
      setFractions(f)
    }

    const onScroll = () => {
      const doc = document.documentElement
      const range = doc.scrollHeight - window.innerHeight
      driver.current.p = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0
    }
    const onPointer = (e: PointerEvent) => {
      driver.current.mx = (e.clientX / window.innerWidth) * 2 - 1
      driver.current.my = (e.clientY / window.innerHeight) * 2 - 1
    }

    measure()
    onScroll()
    // Page height settles as media loads; re-measure when the body resizes.
    const ro = new ResizeObserver(() => {
      measure()
      onScroll()
    })
    ro.observe(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointermove', onPointer, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onPointer)
      delete document.documentElement.dataset.route3d
    }
  }, [active])

  if (!active || !Canvas || !fractions) return null

  return (
    <div aria-hidden className="route3d-stage pointer-events-none fixed inset-0 -z-10">
      <Canvas driver={driver} fractions={fractions} />
    </div>
  )
}
