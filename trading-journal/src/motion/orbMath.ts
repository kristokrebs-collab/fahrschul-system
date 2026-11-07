/**
 * Thinking orbs (R11, package A5 "Interaktionen"): the PURE part – where every dot is at time `t`. No DOM, no canvas, no
 * random: a frame is a function of `(variant, t)`, so the static symbol of a reduced-motion user is the very same picture
 * as one frame of the animation, and the whole thing is testable.
 *
 * Three small pictures for three honest waiting states (they say what KIND of waiting it is, never how long it takes):
 * - `search` – a ball of dots turning about its axis (looking for something: sync, connection check),
 * - `calc`   – a loose cloud of dots that drifts, gathers and spreads again (computing: simulation, text recognition),
 * - `plan`   – one small ring of dots with a leading dot that walks around it (waiting for a third party: payment).
 *
 * Coordinates are in the unit square [-1, 1]²; `r` is the dot radius as a share of the half-size, `a` the opacity.
 */

export type OrbVariant = "search" | "calc" | "plan";

export interface OrbDot {
  x: number;
  y: number;
  /** Dot radius as a fraction of the half-size of the box. */
  r: number;
  /** Opacity 0…1. */
  a: number;
}

/** Number of dots per variant (the loop draws at most this many arcs per frame). */
export const ORB_DOTS: Readonly<Record<OrbVariant, number>> = { search: 84, calc: 56, plan: 14 };

/** Seconds of one full turn / breath / lap. */
export const ORB_PERIOD: Readonly<Record<OrbVariant, number>> = { search: 9, calc: 7, plan: 2.2 };

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** The still frame of the static symbol (a reduced-motion user, the Suspense fallback): a pleasant moment of each motion. */
export const ORB_STILL_T: Readonly<Record<OrbVariant, number>> = { search: 1.1, calc: 2.3, plan: 0.55 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Deterministic 0…1 hash of an integer (no `Math.random`: the same dot is always at the same place). */
export function hash01(i: number, salt = 0): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** `n` points evenly spread on the unit sphere (Fibonacci spiral): `[x, y, z]`. */
export function fibonacciSphere(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GOLDEN * i;
    out.push([Math.cos(th) * rad, y, Math.sin(th) * rad]);
  }
  return out;
}

const SPHERE = fibonacciSphere(ORB_DOTS.search);
const TILT = 0.38;

/** Ball of dots: turns about a tilted axis; the near side is bigger and brighter, the far side small and faint. */
function searchFrame(t: number): OrbDot[] {
  const turn = (t / ORB_PERIOD.search) * TAU;
  const cy = Math.cos(turn);
  const sy = Math.sin(turn);
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  // a soft scanning band that walks over the ball once per turn (latitude)
  const band = Math.sin((t / ORB_PERIOD.search) * TAU * 1.5);
  return SPHERE.map(([px, py, pz]) => {
    const x1 = px * cy + pz * sy;
    const z1 = -px * sy + pz * cy;
    const y2 = py * ct - z1 * st;
    const z2 = py * st + z1 * ct;
    const depth = (z2 + 1) / 2; // 0 far … 1 near
    const lit = Math.exp(-Math.pow((py - band) * 3.2, 2));
    return { x: x1 * 0.86, y: y2 * 0.86, r: 0.045 + depth * 0.05 + lit * 0.025, a: clamp01(0.16 + depth * 0.6 + lit * 0.3) };
  });
}

/** Loose cloud: every dot drifts on its own slow ellipse; the whole cloud gathers and spreads (one breath per period). */
function calcFrame(t: number): OrbDot[] {
  const n = ORB_DOTS.calc;
  const breath = 0.5 + 0.5 * Math.sin((t / ORB_PERIOD.calc) * TAU - Math.PI / 2); // 0 gathered … 1 spread
  const out: OrbDot[] = [];
  for (let i = 0; i < n; i++) {
    const home = Math.sqrt(hash01(i, 1)) * 0.82; // radius of the dot's own orbit centre
    const ang0 = hash01(i, 2) * TAU;
    const speed = (0.35 + hash01(i, 3) * 0.9) * (hash01(i, 4) > 0.5 ? 1 : -1);
    const ang = ang0 + (t / ORB_PERIOD.calc) * TAU * speed;
    const wob = 0.1 + hash01(i, 5) * 0.14;
    const spread = 0.55 + breath * 0.45;
    const x = Math.cos(ang0) * home * spread + Math.cos(ang) * wob;
    const y = Math.sin(ang0) * home * spread + Math.sin(ang * 1.3 + i) * wob;
    const tw = 0.5 + 0.5 * Math.sin((t / ORB_PERIOD.calc) * TAU * (1 + hash01(i, 6) * 2) + hash01(i, 7) * TAU);
    out.push({ x: x * 0.95, y: y * 0.95, r: 0.04 + hash01(i, 8) * 0.045 + tw * 0.012, a: clamp01(0.22 + tw * 0.55) });
  }
  return out;
}

/** Small ring: dots on a circle, a bright head walks around it and drags a fading tail. */
function planFrame(t: number): OrbDot[] {
  const n = ORB_DOTS.plan;
  const head = ((t / ORB_PERIOD.plan) % 1) * n;
  const out: OrbDot[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU - Math.PI / 2;
    // how far behind the head this dot is, in dots (0 = the head itself)
    const behind = (((head - i) % n) + n) % n;
    const tail = Math.exp(-behind / 3.4);
    out.push({ x: Math.cos(ang) * 0.78, y: Math.sin(ang) * 0.78, r: 0.07 + tail * 0.1, a: clamp01(0.14 + tail * 0.86) });
  }
  return out;
}

/** The dots of `variant` at `t` seconds. Pure: the same input gives the same dots. */
export function orbFrame(variant: OrbVariant, t: number): OrbDot[] {
  return variant === "search" ? searchFrame(t) : variant === "calc" ? calcFrame(t) : planFrame(t);
}

/** The static symbol of `variant` (reduced motion, loading fallback). */
export function orbStill(variant: OrbVariant): OrbDot[] {
  return orbFrame(variant, ORB_STILL_T[variant]);
}

/** Opacity buckets the canvas batches its arcs into (4 fills per frame instead of one per dot). */
export const ORB_BUCKETS = 4;

/** Index `0…ORB_BUCKETS-1` of the opacity bucket of a dot. */
export function bucketOf(a: number): number {
  return Math.min(ORB_BUCKETS - 1, Math.max(0, Math.floor(a * ORB_BUCKETS)));
}

/** The opacity a bucket is drawn with (the middle of its range). */
export function bucketAlpha(b: number): number {
  return (b + 0.5) / ORB_BUCKETS;
}
