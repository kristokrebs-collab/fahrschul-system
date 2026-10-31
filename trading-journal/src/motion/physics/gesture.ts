import { physics } from "@/motion/physics/constants";

/**
 * Pure gesture math (WWDC18 803 "Designing Fluid Interfaces"): projection, iOS rubber band, commit rules, snapping.
 * Units: px, ms, px/s. Everything here is deterministic and allocation-light — safe to call per pointer move.
 */

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

/**
 * Where a value thrown at `velocity` px/s comes to rest under UIScrollView deceleration (`rate` per ms):
 * `project(v) = (v / 1000) · rate / (1 − rate)` — 0.998 (normal): 1000 px/s → 499 px; 0.99 (fast): → 99 px.
 */
export function project(velocity: number, rate: number = physics.decelNormal): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** 2-D `project`: the resting point of a throw from `p` at `v`. */
export function projectPoint(p: { x: number; y: number }, v: { x: number; y: number }, rate: number = physics.decelNormal): { x: number; y: number } {
  return { x: p.x + project(v.x, rate), y: p.y + project(v.y, rate) };
}

/**
 * Motion `inertia` transition identical to UIScrollView deceleration: initial slope = v, end = v·τ, τ = −1/ln(rate)
 * (499.5 ms normal, 99.5 ms fast). Motion's drag default (`power .8`, `τ 750`) throws ≈ 60 % farther than iOS.
 */
export function decayInertia(rate: number = physics.decelNormal): { type: "inertia"; timeConstant: number; power: number } {
  const tau = -1 / Math.log(rate);
  return { type: "inertia", timeConstant: tau, power: tau / 1000 };
}

/**
 * iOS rubber band: `b(x) = (1 − 1 / (|x|·c / d + 1)) · d · sign(x)` with c = 0.55. Slope c (55 %) at the edge, tends
 * to `d` and never reaches it. d = 60: 50 → 18.9, 100 → 28.7, 200 → 38.8 px. d = 300: 100 → 46.5 px.
 */
export function rubberBand(x: number, d: number, c: number = physics.rubber): number {
  if (x === 0 || !(d > 0) || !Number.isFinite(x)) return x === Infinity ? d : x === -Infinity ? -d : 0;
  return Math.sign(x) * (1 - 1 / ((Math.abs(x) * c) / d + 1)) * d;
}

/** Inverse of `rubberBand` (the finger offset that produced a banded offset `b`, |b| < d). */
export function rubberBandInverse(b: number, d: number, c: number = physics.rubber): number {
  if (b === 0 || !(d > 0)) return 0;
  const r = Math.min(Math.abs(b) / d, 0.999999);
  return b / (c * (1 - r));
}

/** Free between `min` and `max`, rubber-banded beyond (d = dimension of the band, e.g. the element size). */
export function rubberClamp(v: number, min: number, max: number, d: number, c: number = physics.rubber): number {
  if (v < min) return min - rubberBand(min - v, d, c);
  if (v > max) return max + rubberBand(v - max, d, c);
  return v;
}

/** Projected-offset threshold for overlay dismissal: clamp(0.33 · size, 140, 260) px (phone ≈ 260, tablet editor ≈ 231). */
export function dismissThreshold(size: number): number {
  return clamp(physics.dismissFraction * size, physics.dismissMin, physics.dismissMax);
}

export interface SwipeDecisionInput {
  /** px travelled TOWARD the dismissal (direction-normalised: > 0 = toward dismiss). */
  offset: number;
  /** px/s, direction-normalised like `offset`. */
  velocity: number;
  /** projected px needed (see `dismissThreshold`). */
  threshold: number;
  rate?: number;
  minOffset?: number;
  flickBack?: number;
}

/**
 * One-directional commit rule (iOS sheet / PiP family): decide on the PROJECTED position, not raw offset or speed.
 * - thrown back faster than `flickBack` (300 px/s) → cancel, even past the threshold;
 * - travelled less than `minOffset` (16 px) → cancel (no accidental flicks);
 * - otherwise commit when `offset + project(velocity) > threshold`.
 * Examples (threshold 231): (40 px, 500 px/s) → true · (150, 0) → false · (120, −400) → false · (10, 2000) → false.
 */
export function swipeDecision({ offset, velocity, threshold, rate, minOffset = physics.dismissMinOffset, flickBack = physics.flickBack }: SwipeDecisionInput): boolean {
  if (velocity < -flickBack) return false;
  if (offset < minOffset) return false;
  return offset + project(velocity, rate) > threshold;
}

/**
 * Two-directional commit rule (toast x, cards that leave either way): −1 / +1 = commit in that direction, 0 = return.
 * Direction = sign of the projected position; it commits when |offset + project(v)| > threshold, |offset| ≥
 * `minOffset`, and the release velocity does not point back against that direction faster than `flickBack`.
 * Toast (threshold 80, minOffset 12): (30, 600) → +1 · (60, 0) → 0 · (90, −700) → −1.
 */
export function flickDecision({ offset, velocity, threshold, rate, minOffset = physics.dismissMinOffset, flickBack = physics.flickBack }: SwipeDecisionInput): -1 | 0 | 1 {
  const projected = offset + project(velocity, rate);
  if (Math.abs(projected) <= threshold) return 0;
  const dir = projected > 0 ? 1 : -1;
  if (Math.abs(offset) < minOffset) return 0;
  if (velocity * dir < -flickBack) return 0;
  return dir;
}

/** Index of the point nearest to `v` (ties → the lower index). Empty list → −1. */
export function nearestIndex(points: readonly number[], v: number): number {
  if (!points.length) return -1;
  let best = 0;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i]! - v) < Math.abs(points[best]! - v)) best = i;
  return best;
}

/**
 * Snap target of a throw along one axis: the point nearest to `position + project(velocity, rate)` when the release
 * is at least `minSpeed` (default 400 px/s), else the point nearest to `position` (a slow release lands where it is).
 * Segmented flick: `snapIndex(centres, x, vx, { rate: physics.decelFast })` (1200 px/s → +119 px ≈ 1–2 segments).
 */
export function snapIndex(points: readonly number[], position: number, velocity: number, opts: { rate?: number; minSpeed?: number } = {}): number {
  const { rate = physics.decelFast, minSpeed = physics.throwMinSpeed } = opts;
  const target = Math.abs(velocity) >= minSpeed ? position + project(velocity, rate) : position;
  return nearestIndex(points, target);
}

export interface FlickStepInput {
  /** px travelled along the axis (signed). */
  offset: number;
  /** px/s at release (signed). */
  velocity: number;
  /** ms from pointerdown to release. */
  durationMs: number;
  minSpeed?: number;
  minTravel?: number;
  maxMs?: number;
}

/**
 * One step per quick flick (dock flick-to-switch, calendar month, iOS home-indicator swipe): ±1 when the release is
 * fast (≥ 600 px/s), travelled ≥ 24 px in the same direction, and the press lasted ≤ 250 ms; otherwise 0.
 */
export function flickStep({ offset, velocity, durationMs, minSpeed = physics.flickMinSpeed, minTravel = physics.flickMinTravel, maxMs = physics.flickMaxMs }: FlickStepInput): -1 | 0 | 1 {
  if (durationMs > maxMs || Math.abs(velocity) < minSpeed || Math.abs(offset) < minTravel) return 0;
  if (Math.sign(offset) !== Math.sign(velocity)) return 0;
  return velocity > 0 ? 1 : -1;
}

export type AxisLock = "pending" | "engage" | "reject";

/**
 * Hysteresis + angle lock (WWDC18: "usually 10 points"). Before engagement: "pending" while the pointer is within
 * `hysteresis` px of its start; then "engage" if the primary axis wins (|primary| > axisRatio · |cross|), else
 * "reject" (the browser keeps the scroll). `axis` "xy" engages on distance alone.
 */
export function axisLock(dx: number, dy: number, axis: "x" | "y" | "xy", hysteresis: number = physics.hysteresis, axisRatio: number = physics.axisRatio): AxisLock {
  if (Math.hypot(dx, dy) < hysteresis) return "pending";
  if (axis === "xy") return "engage";
  const primary = Math.abs(axis === "x" ? dx : dy);
  const cross = Math.abs(axis === "x" ? dy : dx);
  return primary > axisRatio * cross ? "engage" : "reject";
}
