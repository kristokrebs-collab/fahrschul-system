/**
 * The roadway.
 *
 * The recurring visual spine of the site: a carriageway in true perspective
 * with the Krebs signal running along the active lane. Everything is computed
 * geometry rendered as SVG — no image is downloaded, it is razor sharp at any
 * density, and it costs a few hundred bytes after compression.
 *
 * The perspective is real rather than eyeballed. For a flat road, a point at
 * ground distance d projects to screen height y = horizon + k/d. Markings are
 * therefore placed at equal *distances* and their screen spacing compresses
 * toward the horizon on its own — which is what makes it read as a road
 * instead of a stack of shrinking rectangles.
 */

const VIEW_W = 1600
const VIEW_H = 900
const HORIZON = 312
/** Half-width of the carriageway at the bottom edge of the frame. */
const HALF_W = 980
const DEPTH = VIEW_H - HORIZON

/** Screen y for a ground distance d (d = 1 is the bottom edge of the frame). */
function projectY(d: number): number {
  return HORIZON + DEPTH / d
}

/** Horizontal offset from the centre line at ground distance d. */
function projectX(lateral: number, d: number): number {
  return VIEW_W / 2 + (lateral * HALF_W) / d
}

interface Dash {
  d: string
  depth: number
}

/**
 * Builds the trapezoidal dashes of one lane marking. Each dash is a quad
 * because its near edge is wider than its far edge.
 */
function buildDashes(lateral: number, width: number, count: number, gap: number, length: number): Dash[] {
  const dashes: Dash[] = []

  for (let i = 0; i < count; i++) {
    const near = 1 + i * (length + gap)
    const far = near + length

    const yNear = projectY(near)
    const yFar = projectY(far)
    // Stop once a dash collapses into the horizon — sub-pixel dashes are noise.
    if (yNear - yFar < 0.6) break

    const halfNear = (width / 2) / near
    const halfFar = (width / 2) / far

    const xNearL = projectX(lateral - halfNear * 2, near)
    const xNearR = projectX(lateral + halfNear * 2, near)
    const xFarL = projectX(lateral - halfFar * 2, far)
    const xFarR = projectX(lateral + halfFar * 2, far)

    dashes.push({
      d: `M${xNearL.toFixed(1)} ${yNear.toFixed(1)}L${xNearR.toFixed(1)} ${yNear.toFixed(1)}L${xFarR.toFixed(1)} ${yFar.toFixed(1)}L${xFarL.toFixed(1)} ${yFar.toFixed(1)}Z`,
      depth: near,
    })
  }

  return dashes
}

/** A continuous edge line from the bottom of the frame to the horizon. */
function edgeLine(lateral: number, width: number): string {
  const near = 1
  const far = 260
  const halfNear = width / 2
  const halfFar = (width / 2) / far

  return [
    `M${projectX(lateral - halfNear, near).toFixed(1)} ${projectY(near).toFixed(1)}`,
    `L${projectX(lateral + halfNear, near).toFixed(1)} ${projectY(near).toFixed(1)}`,
    `L${projectX(lateral + halfFar, far).toFixed(1)} ${projectY(far).toFixed(1)}`,
    `L${projectX(lateral - halfFar, far).toFixed(1)} ${projectY(far).toFixed(1)}`,
    'Z',
  ].join('')
}

/** The tarmac between the two edge lines, used to clip the surface shading. */
function carriageway(): string {
  const near = 1
  const far = 260
  return [
    `M${projectX(-1, near).toFixed(1)} ${projectY(near).toFixed(1)}`,
    `L${projectX(1, near).toFixed(1)} ${projectY(near).toFixed(1)}`,
    `L${projectX(1 / far, far).toFixed(1)} ${projectY(far).toFixed(1)}`,
    `L${projectX(-1 / far, far).toFixed(1)} ${projectY(far).toFixed(1)}`,
    'Z',
  ].join('')
}

// Computed once at module scope: this is static geometry, not per-render work.
const LANE_LEFT = buildDashes(-0.34, 0.022, 26, 0.62, 0.34)
const LANE_RIGHT = buildDashes(0.34, 0.022, 26, 0.62, 0.34)
const ROUTE = buildDashes(0, 0.05, 30, 0.34, 0.5)
const EDGE_LEFT = edgeLine(-0.98, 0.03)
const EDGE_RIGHT = edgeLine(0.98, 0.03)
const CARRIAGEWAY = carriageway()

export interface RoadwayProps {
  className?: string
  /** 0 = the signal only glows near the horizon, 1 = it has arrived in front. */
  intensity?: number
}

export function Roadway({ className, intensity = 1 }: RoadwayProps) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        {/* Marking paint fades out before the horizon so the road dissolves
            into atmosphere instead of ending at a hard line. */}
        <linearGradient id="rw-depth" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="45%" stopColor="white" stopOpacity="0.45" />
          <stop offset="78%" stopColor="white" stopOpacity="0.1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        <linearGradient id="rw-signal" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="var(--color-signal-400)" stopOpacity="1" />
          <stop offset="40%" stopColor="var(--color-signal-500)" stopOpacity="0.85" />
          <stop offset="75%" stopColor="var(--color-signal-500)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--color-signal-500)" stopOpacity="0" />
        </linearGradient>

        {/* Signal light pooling on the horizon. Kept as a tight ellipse so it
            reads as a distant source rather than a band across the frame. */}
        <radialGradient id="rw-haze" cx="50%" cy={`${(HORIZON / VIEW_H) * 100}%`} r="38%">
          <stop offset="0%" stopColor="var(--color-signal-500)" stopOpacity="0.28" />
          <stop offset="35%" stopColor="var(--color-signal-600)" stopOpacity="0.12" />
          <stop offset="70%" stopColor="var(--color-signal-700)" stopOpacity="0.03" />
          <stop offset="100%" stopColor="var(--color-signal-700)" stopOpacity="0" />
        </radialGradient>

        {/* Wet asphalt: the surface catching a little of that light. */}
        <linearGradient id="rw-surface" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ink-700)" stopOpacity="0.55" />
          <stop offset="30%" stopColor="var(--color-ink-800)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--color-ink-950)" stopOpacity="0" />
        </linearGradient>

        <mask id="rw-fade">
          <rect x="0" y={HORIZON - 40} width={VIEW_W} height={VIEW_H} fill="url(#rw-depth)" />
        </mask>

        <clipPath id="rw-carriageway">
          <path d={CARRIAGEWAY} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#rw-haze)" />

      {/* The road surface itself, so the markings sit on something */}
      <g clipPath="url(#rw-carriageway)">
        <rect x="0" y={HORIZON} width={VIEW_W} height={VIEW_H - HORIZON} fill="url(#rw-surface)" />
      </g>

      <g mask="url(#rw-fade)">
        {/* Carriageway edges */}
        <path d={EDGE_LEFT} fill="var(--color-chalk)" opacity="0.3" />
        <path d={EDGE_RIGHT} fill="var(--color-chalk)" opacity="0.3" />

        {/* Lane dividers */}
        {LANE_LEFT.map((dash, i) => (
          <path key={`l${i}`} d={dash.d} fill="var(--color-chalk)" opacity="0.34" />
        ))}
        {LANE_RIGHT.map((dash, i) => (
          <path key={`r${i}`} d={dash.d} fill="var(--color-chalk)" opacity="0.34" />
        ))}
      </g>

      {/* The active route — the one element that is brand red */}
      <g mask="url(#rw-fade)" opacity={intensity}>
        {ROUTE.map((dash, i) => (
          <path key={`s${i}`} d={dash.d} fill="url(#rw-signal)" />
        ))}
      </g>
    </svg>
  )
}
