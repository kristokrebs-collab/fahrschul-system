'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A background/panel video that behaves like a responsible adult.
 *
 * - Plays only while on screen (IntersectionObserver), muted and inline.
 * - Never loads video data for visitors with reduced motion or Save-Data:
 *   they get the poster frame, which every clip is designed to survive.
 * - preload="none" until the section approaches, so a video five chapters
 *   down costs nothing at page load.
 * - Fades from poster to moving image once playback actually starts —
 *   no decoded-frame pop.
 *
 * All clips live in /media/video with a 720p tier (and 1080p for the few
 * hero-grade ones), posters in /media/poster. Sources are the approved
 * Higgsfield archive, transcoded on CI.
 */

type SceneVideoProps = {
  /** Clip name from the media manifest, e.g. "hero-filament". */
  name: string
  /** Whether a 1080p tier exists for this clip. */
  hd?: boolean
  /** Cover the parent (backdrop) or behave as a block element (panel). */
  variant?: 'backdrop' | 'panel'
  className?: string
  /** Extra class on the <video> itself (object-position tweaks etc). */
  videoClassName?: string
}

export function SceneVideo({ name, hd = false, variant = 'backdrop', className = '', videoClassName = '' }: SceneVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mode, setMode] = useState<'unknown' | 'poster' | 'video'>('unknown')
  const [playing, setPlaying] = useState(false)

  const poster = `/media/poster/${name}.jpg`

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    type SaveDataConnection = { saveData?: boolean }
    const connection = (navigator as Navigator & { connection?: SaveDataConnection }).connection
    const decide = () => setMode(reduced.matches || connection?.saveData ? 'poster' : 'video')
    decide()
    reduced.addEventListener('change', decide)
    return () => reduced.removeEventListener('change', decide)
  }, [])

  useEffect(() => {
    if (mode !== 'video') return
    const wrap = wrapRef.current
    const video = videoRef.current
    if (!wrap || !video) return

    let loaded = false
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting && !loaded) {
          loaded = true
          // Choose codec and tier once, at the moment data is first needed.
          // Chromium builds without proprietary codecs cannot decode H.264;
          // they get the VP9 track instead.
          const h264 = video.canPlayType('video/mp4; codecs="avc1.640028"') !== ''
          const wantHd = hd && window.innerWidth * devicePixelRatio >= 1700
          video.src = h264
            ? `/media/video/${name}-${wantHd ? '1080' : '720'}.mp4`
            : `/media/video/${name}-720.webm`
          video.load()
        }
        if (entry.isIntersecting) {
          void video.play().catch(() => setMode('poster'))
        } else {
          video.pause()
        }
      },
      // Start loading one viewport early; pause as soon as it fully leaves.
      { rootMargin: '100% 0px 100% 0px' },
    )
    near.observe(wrap)
    return () => near.disconnect()
  }, [mode, name, hd])

  const shellClass =
    variant === 'backdrop'
      ? `pointer-events-none absolute inset-0 overflow-hidden ${className}`
      : `relative overflow-hidden ${className}`

  return (
    <div ref={wrapRef} className={shellClass} aria-hidden={variant === 'backdrop' || undefined}>
      {/* Poster paints immediately and stays as the reduced-motion truth */}
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative
          poster underneath a video; next/image adds nothing but wrappers here */}
      <img
        src={poster}
        alt=""
        aria-hidden
        className={`absolute inset-0 h-full w-full object-cover ${videoClassName}`}
        loading="lazy"
        decoding="async"
      />
      {mode === 'video' && (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="none"
          poster={poster}
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? 'opacity-100' : 'opacity-0'} ${videoClassName}`}
          tabIndex={-1}
        />
      )}
    </div>
  )
}
