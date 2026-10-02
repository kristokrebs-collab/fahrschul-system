/**
 * Measured curves of the pulse-motion pack, as pure functions (unit-tested): monotone cubic Hermite interpolation
 * (Fritsch–Carlson, exactly as the pack's reference implementations) through measured key points.
 */

export type Keys = readonly (readonly [number, number])[];

/** f(x) through `pts` (x ascending), monotone between keys, clamped to the end values outside. */
export function monotoneCubic(pts: Keys): (x: number) => number {
  const n = pts.length;
  const h: number[] = [];
  const d: number[] = [];
  const m: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1]![0] - pts[i]![0];
    d[i] = (pts[i + 1]![1] - pts[i]![1]) / h[i]!;
  }
  m[0] = d[0] ?? 0;
  m[n - 1] = d[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= pts[0]![0]) return pts[0]![1];
    if (x >= pts[n - 1]![0]) return pts[n - 1]![1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]![0] <= x) lo = mid;
      else hi = mid;
    }
    const hh = h[lo]!;
    const u = (x - pts[lo]![0]) / hh;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * pts[lo]![1] + (u3 - 2 * u2 + u) * hh * m[lo]! + (-2 * u3 + 3 * u2) * pts[lo + 1]![1] + (u3 - u2) * hh * m[lo + 1]!;
  };
}

/** glyph-portal: normalised zoom curve g(u) – slow start (~u³), plunge around u .7, soft end. */
export const ZOOM_KEYS: Keys = [
  [0, 0], [0.142, 0.006], [0.237, 0.025], [0.313, 0.053], [0.38, 0.09], [0.4235, 0.121], [0.493, 0.186], [0.569, 0.281],
  [0.645, 0.404], [0.72, 0.562], [0.778, 0.688], [0.835, 0.799], [0.89, 0.891], [0.949, 0.968], [0.978, 0.992], [1, 1],
];
/** glyph-portal: roll curve h(u) – turns early, saturates from u .8. */
export const ROLL_KEYS: Keys = [
  [0, 0], [0.129, 0.018], [0.209, 0.09], [0.274, 0.166], [0.326, 0.262], [0.379, 0.348], [0.4235, 0.44], [0.507, 0.53],
  [0.585, 0.62], [0.641, 0.7], [0.693, 0.8], [0.765, 0.94], [0.835, 1], [1, 1],
];
/** cinematic-orbit-hero: opening progress p(t), t in ms after the start (2.8 s; slow start, peak ~1.4 s, long settle). */
export const ORBIT_KEYS: Keys = [
  [0, 0], [300, 0.004], [500, 0.015], [700, 0.04], [900, 0.075], [1050, 0.15], [1200, 0.28], [1300, 0.39], [1400, 0.52],
  [1500, 0.625], [1600, 0.7], [1700, 0.76], [1850, 0.82], [2000, 0.88], [2150, 0.93], [2300, 0.962], [2500, 0.988], [2800, 1],
];
export const ORBIT_MS = 2800;

export const zoomCurve = monotoneCubic(ZOOM_KEYS);
export const rollCurve = monotoneCubic(ROLL_KEYS);
export const orbitCurve = monotoneCubic(ORBIT_KEYS);
