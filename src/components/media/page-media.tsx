import Image from 'next/image'
import { pageMedia, sceneClips, type SceneClipKey } from '@/content/media'
import { SceneVideo } from './scene-video'

/** A captioned cinematic clip panel — the standard way footage appears in a page flow. */
export function ScenePanel({
  clip,
  caption,
  className = '',
}: {
  clip: SceneClipKey
  caption: string
  className?: string
}) {
  return (
    <figure className={`relative overflow-hidden rounded-2xl border border-chalk/10 ${className}`}>
      <SceneVideo
        name={sceneClips[clip].name}
        hd={sceneClips[clip].hd}
        variant="panel"
        className="aspect-video w-full"
      />
      <figcaption className="pointer-events-none absolute bottom-3 right-4 text-xs text-chalk-faint drop-shadow">
        {caption}
      </figcaption>
    </figure>
  )
}

/**
 * The staged visual for a detail page, looked up by route key
 * ("fuehrerschein/klasse-b", "leistungen/adr", …). Renders nothing when no
 * truthful asset exists for the page — a missing image is honest, a wrong
 * one is not. Every figure carries its "Studio-Inszenierung" caption so
 * nobody mistakes a render for the real fleet.
 */
export function PageMedia({ routeKey, className = '' }: { routeKey: string; className?: string }) {
  const entry = pageMedia[routeKey]
  if (!entry) return null

  const aspect = entry.aspect ?? 'aspect-video'

  return (
    <figure className={`relative overflow-hidden rounded-2xl border border-chalk/10 ${className}`}>
      {entry.kind === 'video' ? (
        <SceneVideo
          name={sceneClips[entry.ref as SceneClipKey].name}
          hd={sceneClips[entry.ref as SceneClipKey].hd}
          variant="panel"
          className={`${aspect} w-full`}
        />
      ) : (
        <Image
          src={`/stills/${entry.ref}-1600.avif`}
          alt={entry.alt}
          width={1600}
          height={aspect === 'aspect-video' ? 900 : 2133}
          sizes="(min-width: 1024px) 20rem, 100vw"
          className={`${aspect} w-full object-cover`}
        />
      )}
      <figcaption className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.6875rem] text-chalk-faint drop-shadow">
        {entry.caption}
      </figcaption>
    </figure>
  )
}
