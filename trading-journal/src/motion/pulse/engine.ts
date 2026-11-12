/**
 * 120 Hz engine shared by the pulse-motion ports (see pulse-motion/references/principles-120hz.md):
 * time-based (never per-frame increments), exact spring solution, frame-rate independent smoothing,
 * one pointer read per frame, and a loop that sleeps whenever nothing animates.
 */

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
}

/** Exact damped spring progress 0→1 at time t (seconds). Same parameters as motion's { type: "spring" }. */
export function springAt(t: number, { stiffness = 300, damping = 24, mass = 1, velocity = 0 }: SpringConfig = {}): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 - velocity) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + (w0 - velocity) * t);
  const wd = w0 * Math.sqrt(z * z - 1);
  const r1 = -z * w0 + wd;
  const r2 = -z * w0 - wd;
  const c2 = (r1 + velocity) / (r1 - r2);
  const c1 = 1 - c2;
  return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}

/** Seconds until a spring stays within `epsilon` of its target (for scheduling the end of a loop). */
export function springSettleTime(cfg: SpringConfig = {}, epsilon = 0.001, maxSeconds = 4): number {
  const step = 1 / 240;
  let lastOutside = 0;
  for (let t = 0; t <= maxSeconds; t += step) if (Math.abs(1 - springAt(t, cfg)) > epsilon) lastOutside = t;
  return Math.min(maxSeconds, lastOutside + step);
}

/** Frame-rate independent smoothing factor: x += (target - x) * smoothing(k, dt). */
export function smoothing(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** cubic-bezier(x1,y1,x2,y2) as a function of linear progress (CSS timing-function semantics). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sy(t);
  };
}

/**
 * Timestamp caveat: in a browser the rAF timestamp and `performance.now()` share one origin, so absolute times set in
 * event handlers (`performance.now()`) can be compared with `now`. jsdom's rAF timestamps use a different origin –
 * code that compares absolute times reads `performance.now()` inside the frame instead of trusting `now` there.
 *
 * rAF loop that only runs while `update` returns true. `update(dt, now)` gets dt in seconds (clamped to 50 ms so
 * tab switches never jump) and the rAF timestamp. Call `wake()` whenever something should animate again.
 */
export function createFrameLoop(update: (dt: number, now: number) => boolean): { wake: () => void; stop: () => void; running: () => boolean } {
  let raf = 0;
  let last = 0;
  const hasRaf = typeof requestAnimationFrame === "function";
  const frame = (t: number) => {
    const dt = Math.min(Math.max(t - last, 0), 50) / 1000;
    last = t;
    raf = update(dt, t) ? requestAnimationFrame(frame) : 0;
  };
  return {
    wake() {
      if (raf || !hasRaf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    running: () => raf !== 0,
  };
}

/** Latest pointer position, read once per frame (handles 240–1000 Hz input via coalesced events). */
export function latestPointer(e: PointerEvent): { x: number; y: number } {
  const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  const last = list[list.length - 1] ?? e;
  return { x: last.clientX, y: last.clientY };
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Deterministic PRNG (mulberry32) so glyph scrambles are stable in tests and never use Math.random per frame. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
