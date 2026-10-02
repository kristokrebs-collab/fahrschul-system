import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/** One blur band of a progressive edge blur: box from `from` to `to` (fractions of the edge, 0 = inner side). */
export interface BlurBand {
  blur: number;
  from: number;
  to: number;
}

/**
 * Bands of the bottom edge (behind the dock). OFF for perf (`[]` → the plain gradient only): the strip is fixed and
 * full-width, the dock sits on top of it, so any frame that damages the strip (scrolling, the FAB's ping, a dock
 * hover) re-ran the stacked backdrop blur and kept the display compositor at its ceiling (perf review perf-01).
 * A non-empty list (`{ blur, from, to }`, fractions of the strip, blur growing toward the screen edge) turns
 * `EdgeBlur` back on – only together with a strip that nothing animates over.
 */
export const BOTTOM_BANDS: readonly BlurBand[] = [];

/** Pure: the mask of a band – fades in over its first third, out over its last third (the outermost band stays solid). */
export function bandMask(band: BlurBand, toward: "top" | "bottom"): string {
  return band.to >= 1
    ? `linear-gradient(to ${toward}, transparent 0%, #000 33%)`
    : `linear-gradient(to ${toward}, transparent 0%, #000 33%, #000 66%, transparent 100%)`;
}

/** Pure: the band's box inside the edge strip (CSS `top` / `height` in %, measured from the inner side). */
export function bandBox(band: BlurBand, toward: "top" | "bottom"): CSSProperties {
  const start = `${band.from * 100}%`;
  const height = `${(band.to - band.from) * 100}%`;
  return toward === "bottom" ? { top: start, height } : { bottom: start, height };
}

export interface EdgeBlurProps {
  bands: readonly BlurBand[];
  /** Which way the blur grows (`bottom`: the bottom screen edge, `top`: toward the header). */
  toward: "top" | "bottom";
  className?: string;
}

/**
 * Progressive edge blur (21st.dev "Edge / Progressive Blur"): stacked `backdrop-filter` bands, each masked so the blur
 * ramps up toward the edge and content scrolling under the dock or the header smears softly instead of being cut.
 * Decorative (`aria-hidden`, no pointer events). `prefers-reduced-transparency` → no blur (the caller's tint remains).
 */
export function EdgeBlur({ bands, toward, className }: EdgeBlurProps) {
  if (bands.length === 0) return null;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none [@media(prefers-reduced-transparency:reduce)]:hidden", className)}>
      {bands.map((b) => {
        const mask = bandMask(b, toward);
        const filter = `blur(${b.blur}px)`;
        return (
          <div
            key={`${b.blur}-${b.from}`}
            className="absolute inset-x-0"
            style={{ ...bandBox(b, toward), backdropFilter: filter, WebkitBackdropFilter: filter, maskImage: mask, WebkitMaskImage: mask }}
          />
        );
      })}
    </div>
  );
}

/**
 * Bundle `U$`: fixed fade behind the dock (`z-[45] h-28`) – the `from-transparent via-ink-900/70 to-ink-900` tint
 * (the progressive blur bands under it are off, see `BOTTOM_BANDS`).
 */
export function BottomFade() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] h-28">
      <EdgeBlur bands={BOTTOM_BANDS} toward="bottom" className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink-900/70 to-ink-900" />
    </div>
  );
}
