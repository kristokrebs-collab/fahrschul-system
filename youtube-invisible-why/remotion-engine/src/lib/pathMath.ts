export interface PathPoint {
  x: number;
  y: number;
  angle: number;
}

// Measuring an SVG path's geometry (getTotalLength / getPointAtLength) does
// not require the element to be attached to the document — it's pure path
// data math, not layout. That lets us compute hand-tip positions and
// stroke-reveal lengths synchronously during render, which matches
// Remotion's model of "every frame is a pure render," with no ref/effect
// timing to worry about.
const cache = new Map<string, SVGPathElement>();

function getPathElement(d: string): SVGPathElement | null {
  if (typeof document === "undefined") return null;
  let el = cache.get(d);
  if (!el) {
    el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    cache.set(d, el);
  }
  return el;
}

export function getPathLength(d: string): number {
  const el = getPathElement(d);
  if (!el) return 0;
  try {
    return el.getTotalLength();
  } catch {
    return 0;
  }
}

export function getPointAtProgress(d: string, progress: number): PathPoint {
  const el = getPathElement(d);
  if (!el) return { x: 0, y: 0, angle: 0 };
  const len = getPathLength(d);
  if (len === 0) return { x: 0, y: 0, angle: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const dist = clamped * len;
  try {
    const p = el.getPointAtLength(dist);
    const p2 = el.getPointAtLength(Math.min(len, dist + 0.5));
    const angle = Math.atan2(p2.y - p.y, p2.x - p.x) * (180 / Math.PI);
    return { x: p.x, y: p.y, angle };
  } catch {
    return { x: 0, y: 0, angle: 0 };
  }
}
