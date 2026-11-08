/**
 * Voice ring (Runde 12): the PURE part of the glowing, softly deformed ring – where the strands of the ring are at time `t` and what each
 * mood looks like. No DOM, no canvas, no random: a frame is a function of `(look, t, strand)`, so the still symbol of a reduced-motion
 * user is the very same picture as one frame of the animation, and the whole thing is testable.
 *
 * Idea: the "Voice Ring" reference (libraries.dev, Chrome recording of the user) – a luminous ring whose outline breathes like a soft
 * membrane, with three states (Listening / Speaking, Processing, Mono). Built here in the Nothing language: no rainbow, the colour is the
 * text colour with ONE restrained accent (the signal red) running round it, the mono state is a single quiet line.
 *
 * The three moods say what KIND of waiting it is – never how long it takes (no fake progress):
 * - `active` – the work is going on and moves visibly (an answer is being formed, scenarios are being computed): three strands, a deeper
 *   deformation, a soft halo, the accent turns slowly round the ring;
 * - `think`  – a short wait for something that is not ours (a lookup, a reply): two strands, a shallow deformation that moves faster, the
 *   accent runs round quicker;
 * - `quiet`  – the mono state: one thin strand in the text colour, almost round; it moves for a moment and then rests (no loop at idle).
 *
 * Coordinates are in the unit square [-1, 1]²; the ring stays inside ±0.78 so the halo fits the box.
 */

export type RingMood = "active" | "think" | "quiet";

export interface RingLook {
  /** deformation depth as a share of the radius */
  amp: number;
  /** speed of the deformation (1 = the reference pace) */
  speed: number;
  /** number of strands (1–3) */
  layers: number;
  /** line width of the core strand as a share of the half-size */
  core: number;
  /** opacity of the halo behind the strands, 0 = none (mono) */
  glow: number;
  /** turns per second of the accent that runs round the ring, 0 = none (mono) */
  spin: number;
}

export const RING_LOOK: Readonly<Record<RingMood, RingLook>> = {
  active: { amp: 0.17, speed: 1, layers: 3, core: 0.05, glow: 0.3, spin: 0.12 },
  think: { amp: 0.07, speed: 1.7, layers: 2, core: 0.055, glow: 0.18, spin: 0.55 },
  quiet: { amp: 0.045, speed: 0.4, layers: 1, core: 0.045, glow: 0, spin: 0 },
};

/** Points of one strand (the canvas draws a closed path of this many segments). */
export const RING_POINTS = 72;
/** Radius of the undeformed ring in the unit square. */
export const RING_RADIUS = 0.62;
/** A quiet ring moves this long after it became quiet (ms), then it rests: no frame is requested at idle. */
export const RING_SETTLE_MS = 1600;
/** Time constant (s) with which the look eases from one mood to the next. */
export const RING_EASE_S = 0.35;
/** The moment of the animation the still symbol shows (reduced motion, loading fallback, a finished ring). */
export const RING_STILL_T: Readonly<Record<RingMood, number>> = { active: 1.3, think: 0.9, quiet: 2.1 };

const TAU = Math.PI * 2;
/** The three harmonics of the deformation: (lobes, angular speed in rad/s, weight). Integer lobes keep the outline closed. */
const HARMONICS: readonly (readonly [number, number, number])[] = [
  [2, 0.9, 1],
  [3, -1.3, 0.62],
  [4, 1.9, 0.38],
];
const WEIGHT = HARMONICS.reduce((s, h) => s + h[2], 0);

export interface RingPoint {
  x: number;
  y: number;
}

/** The outline of strand `strand` (0 = the core, 1 and 2 follow it a little apart) at `t` seconds. Closed: the last point is not the first. */
export function ringPoints(look: RingLook, t: number, strand = 0, n = RING_POINTS): RingPoint[] {
  const out: RingPoint[] = [];
  const offset = 1 - 0.022 * strand;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let wave = 0;
    for (const [lobes, w, weight] of HARMONICS) wave += weight * Math.sin(lobes * a + w * t * look.speed + strand * 1.1 + lobes * 0.9);
    const r = RING_RADIUS * offset * (1 + look.amp * (wave / WEIGHT));
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** Linear mix of two looks (`k` 0 = `a`, 1 = `b`); the strands are whole numbers. */
export function mixLook(a: RingLook, b: RingLook, k: number): RingLook {
  const m = (x: number, y: number): number => x + (y - x) * k;
  return { amp: m(a.amp, b.amp), speed: m(a.speed, b.speed), layers: Math.round(m(a.layers, b.layers)), core: m(a.core, b.core), glow: m(a.glow, b.glow), spin: m(a.spin, b.spin) };
}

/** Pure: how far the look has come towards `to` after `dt` seconds of easing (exponential, frame-rate independent). */
export function easeLook(from: RingLook, to: RingLook, dt: number): RingLook {
  const k = 1 - Math.exp(-Math.max(0, dt) / RING_EASE_S);
  return mixLook(from, to, k);
}

/** Angle (radians) the accent has turned to at `t`. */
export function ringSpin(look: RingLook, t: number): number {
  return t * look.spin * TAU;
}

/** SVG path data (`M … L … Z`) of a strand – the still symbol is drawn with it. */
export function ringPath(points: readonly RingPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join("") + "Z";
}

/** Largest distance from the centre over all points (the box a frame needs). */
export function ringExtent(points: readonly RingPoint[]): number {
  return points.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y)), 0);
}
