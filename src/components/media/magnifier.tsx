'use client'

import { useRef, useState } from 'react'

/**
 * A loupe over the staged vehicle photography.
 *
 * These stills are engineering studies — a brake disc, a hinge, a linkage —
 * and the detail is the point. Hovering lifts a circle of the image at 2.2×
 * so the surface can actually be read, the way you would lean in to a print.
 *
 * The magnified layer is the same file scaled up with background-position, so
 * no second request is made. Touch devices and reduced-motion users get the
 * plain figure, which was already complete.
 */
export function Magnifier({
  src,
  alt,
  width,
  height,
  caption,
  className = '',
  imgClassName = '',
}: {
  src: string
  alt: string
  width: number
  height: number
  caption?: string
  className?: string
  imgClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lensRef = useRef<HTMLSpanElement>(null)
  const [on, setOn] = useState(false)

  const move = (e: React.PointerEvent) => {
    const box = ref.current
    const lens = lensRef.current
    if (!box || !lens) return
    const r = box.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    lens.style.transform = `translate3d(${x}px, ${y}px, 0)`
    lens.style.backgroundPosition = `${(x / r.width) * 100}% ${(y / r.height) * 100}%`
    lens.style.backgroundSize = `${r.width * 2.2}px ${r.height * 2.2}px`
  }

  const enable = () => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setOn(true)
  }

  return (
    <figure
      ref={ref}
      onPointerEnter={enable}
      onPointerLeave={() => setOn(false)}
      onPointerMove={move}
      className={`magnifier relative overflow-hidden rounded-2xl border border-chalk/10 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the loupe needs
          the exact same resource as its own background layer; next/image's
          generated srcset would fetch a different file for the lens */}
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className={imgClassName} />
      <span
        ref={lensRef}
        aria-hidden
        className="magnifier-lens"
        style={{ backgroundImage: `url(${src})`, opacity: on ? 1 : 0 }}
      />
      {caption && (
        <figcaption className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.6875rem] text-chalk-faint drop-shadow">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
