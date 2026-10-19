/**
 * Pure curve helpers shared by `@/motion/fx` and the newer pulse ports (GlyphZoom, OrbitSpread, LaunchGrid, CardSpread):
 * every choreography there is a pure function of elapsed time or progress, so these stay side-effect free and
 * frame-rate independent (no per-frame increments, only time → value).
 */

export type CurveKeys = readonly (readonly [number, number])[];

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson) through `[[x, y], …]` (x ascending): no overshoot between
 * keys, so a measured progress curve stays monotone. Outside the keys it clamps to the first / last y.
 */
export function monotoneCurve(keys: CurveKeys): (x: number) => number {
  const n = keys.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => keys[0]![1];
  const X = keys.map((k) => k[0]);
  const Y = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = (Y[i + 1]! - Y[i]!) / Math.max(1e-9, X[i + 1]! - X[i]!);
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1]!;
    const b = d[i]!;
    m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  return (x: number) => {
    if (!(x > X[0]!)) return Y[0]!;
    if (x >= X[n - 1]!) return Y[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > X[i + 1]!) i++;
    const h = X[i + 1]! - X[i]!;
    const t = (x - X[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * Y[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

/** Exponential approach of a step that started at `t0`: `to · (1 − e^(−k·(t − t0)))`, 0 before `t0`. */
export function expApproach(t: number, t0: number, k: number, to: number): number {
  return t <= t0 ? 0 : to * (1 - Math.exp(-k * (t - t0)));
}

/** Hermite smoothstep of `x` between `a` and `b` (0 below, 1 above). */
export function smoothstep(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Linear progress of `x` through `[a, b]`, clamped to 0..1. */
export function progressIn(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  return Math.min(1, Math.max(0, (x - a) / (b - a)));
}

/** `cubic-bezier(.76, 0, .24, 1)`-style ease-in-out quart (closed form, used by the wipes and the "Step inside"). */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
