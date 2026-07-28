/**
 * The atmosphere layer.
 *
 * One fixed, non-interactive element for the whole document. It supplies the
 * asphalt grain that keeps large dark areas from looking dead, without adding
 * a per-section cost, an animation loop, or a single byte of downloaded image.
 *
 * The grain is an inline SVG turbulence, rasterised once by the browser.
 * It is removed entirely under prefers-reduced-motion (see globals.css).
 */

const GRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="180" height="180" filter="url(#g)" opacity="0.32"/></svg>`

export function Atmosphere() {
  return (
    <div
      className="atmos-grain"
      aria-hidden
      style={{ ['--grain-url' as string]: `url("data:image/svg+xml,${encodeURIComponent(GRAIN)}")` }}
    />
  )
}
