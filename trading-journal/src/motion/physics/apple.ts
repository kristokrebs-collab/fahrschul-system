import type { Transition } from "motion/react";
import { physics } from "@/motion/physics/constants";

/**
 * Apple spring model (WWDC23 10158 "Animate with springs"): a spring is described by its perceptual `duration`
 * (= response, the period of the undamped oscillation) and `bounce` ∈ [−1, 1].
 *   mass = 1 · stiffness = (2π / duration)² · damping = 4π(1 − bounce) / duration          (bounce ≥ 0)
 *                                              damping = 4π / (duration · (1 + bounce))      (bounce < 0, "flattened")
 * Check: Apple `.smooth` = (0.5 s, 0) → k 157.91, c 25.13 = our `spring.smooth` {158, 25}.
 *
 * Motion 13 caveat (motion-dom spring.mjs): time-defined springs (`{bounce, duration}` / `visualDuration`) DROP the
 * initial velocity. Every spring that must carry a finger's velocity is therefore physics-defined
 * (stiffness/damping/mass) — everything returned here that carries `velocity` is.
 */

/** A physics-defined Motion spring (keeps an initial `velocity`). */
export interface PhysicsSpring {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

/** A physics spring with the initial velocity (units/s of the animated value, same sign as its change). */
export interface VelocitySpring extends PhysicsSpring {
  velocity: number;
}

/** Apple's two spring parameters. `duration` in seconds. */
export interface AppleParams {
  duration: number;
  bounce: number;
}

type SpringLike = {
  type?: unknown;
  stiffness?: number;
  damping?: number;
  mass?: number;
  bounce?: number;
  duration?: number;
  visualDuration?: number;
};

const TAU = 2 * Math.PI;

/** WWDC23 conversion: Apple (duration, bounce) → Motion physics spring (mass 1). */
export function appleSpring(duration: number, bounce = 0): PhysicsSpring {
  const d = Math.max(1e-3, duration);
  const b = Math.min(1, Math.max(-0.99, bounce));
  const stiffness = (TAU / d) ** 2;
  const damping = b >= 0 ? (2 * TAU * (1 - b)) / d : (2 * TAU) / (d * (1 + b));
  return { type: "spring", stiffness, damping, mass: 1 };
}

/**
 * Inverse of `appleSpring` for any physics spring: ω₀ = √(k/m), duration = 2π/ω₀, ζ = c / (2√(km)),
 * bounce = 1 − ζ (ζ ≤ 1) or 1/ζ − 1 (ζ > 1). `spring.smooth` → { duration ≈ 0.4999, bounce ≈ 0.006 }.
 */
export function appleParams({ stiffness, damping, mass = 1 }: { stiffness: number; damping: number; mass?: number }): AppleParams {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return { duration: TAU / w0, bounce: zeta <= 1 ? 1 - zeta : 1 / zeta - 1 };
}

/** Damping ratio ζ of a physics spring (1 = critically damped, < 1 overshoots). */
export function dampingRatio({ stiffness, damping, mass = 1 }: { stiffness: number; damping: number; mass?: number }): number {
  return damping / (2 * Math.sqrt(stiffness * mass));
}

// ── Motion's own resolution of spring transitions (motion-dom 13.4.6 `getSpringOptions` / `findSpring`) ─────────

const MOTION_DEFAULTS = { stiffness: 100, damping: 10, mass: 1, duration: 0.8, bounce: 0.3 } as const;
const validPhysics = (v: unknown, canBeZero = false): v is number =>
  typeof v === "number" && (canBeZero ? v >= 0 : v > 0) && v < Infinity;

/** True when Motion resolves this spring from time (`bounce`/`duration`/`visualDuration`) — it then drops velocity. */
export function isTimeDefined(t: Transition): boolean {
  const s = t as SpringLike;
  const hasPhysics = validPhysics(s.stiffness) || validPhysics(s.damping, true) || validPhysics(s.mass);
  return !hasPhysics && (s.duration !== undefined || s.bounce !== undefined);
}

/** True for transitions Motion runs as a spring (as opposed to tweens / inertia). */
export function isSpring(t: Transition | undefined | null): boolean {
  if (!t || typeof t !== "object") return false;
  const s = t as SpringLike;
  if (s.type !== undefined) return s.type === "spring";
  return s.stiffness !== undefined || s.damping !== undefined || s.mass !== undefined || s.bounce !== undefined || s.visualDuration !== undefined;
}

/** Port of Motion's `findSpring` (duration in SECONDS here): the physics a `{bounce, duration}` spring resolves to. */
export function motionTimeSpring({ duration = MOTION_DEFAULTS.duration, bounce = MOTION_DEFAULTS.bounce }: { duration?: number; bounce?: number }): PhysicsSpring {
  const safeMin = 0.001;
  const zeta = Math.min(1, Math.max(0.05, 1 - bounce));
  const T = Math.min(10, Math.max(0.01, duration));
  const angular = (w0: number, z: number) => w0 * Math.sqrt(1 - z * z);
  let envelope: (w0: number) => number;
  let derivative: (w0: number) => number;
  if (zeta < 1) {
    envelope = (w0) => {
      const decay = w0 * zeta;
      return safeMin - (decay / angular(w0, zeta)) * Math.exp(-decay * T);
    };
    derivative = (w0) => {
      const decay = w0 * zeta;
      const e = zeta * zeta * w0 * w0 * T;
      const f = Math.exp(-decay * T);
      const g = angular(w0 * w0, zeta);
      const factor = -envelope(w0) + safeMin > 0 ? -1 : 1;
      return (factor * -e * f) / g;
    };
  } else {
    envelope = (w0) => -safeMin + Math.exp(-w0 * T) * (w0 * T + 1);
    derivative = (w0) => Math.exp(-w0 * T) * (-w0 * T * T);
  }
  let w0 = 5 / T;
  for (let i = 1; i < 12; i++) w0 -= envelope(w0) / derivative(w0);
  const stiffness = w0 * w0;
  const damping = zeta * 2 * Math.sqrt(stiffness);
  if (!validPhysics(stiffness) || !validPhysics(damping, true)) return { type: "spring", stiffness: MOTION_DEFAULTS.stiffness, damping: MOTION_DEFAULTS.damping, mass: 1 };
  return { type: "spring", stiffness, damping, mass: 1 };
}

/**
 * The exact physics Motion runs for a spring transition (time-defined ones resolved like `getSpringOptions`), or
 * `null` for non-springs (tweens, inertia). Use it to hand a velocity to a token that is time-defined
 * (`spring.segment` → ≈ {k 387.9, c 32.30} = Apple (0.319 s, 0.18); `spring.detail` → ≈ {k 351.4, c 34.49} = (0.335 s, 0.08)).
 */
export function physicsOf(t: Transition): PhysicsSpring | null {
  if (!isSpring(t)) return null;
  const s = t as SpringLike;
  if (!isTimeDefined(t)) {
    return {
      type: "spring",
      stiffness: validPhysics(s.stiffness) ? s.stiffness : MOTION_DEFAULTS.stiffness,
      damping: validPhysics(s.damping, true) ? s.damping : MOTION_DEFAULTS.damping,
      mass: validPhysics(s.mass) ? s.mass : MOTION_DEFAULTS.mass,
    };
  }
  if (s.visualDuration) {
    const root = TAU / (s.visualDuration * 1.2);
    const stiffness = root * root;
    return { type: "spring", stiffness, damping: 2 * Math.min(1, Math.max(0.05, 1 - (s.bounce || 0))) * Math.sqrt(stiffness), mass: 1 };
  }
  return motionTimeSpring({ duration: s.duration, bounce: s.bounce });
}

/** Apple (duration, bounce) of any spring token, time-defined ones included (via `physicsOf`). */
export function appleParamsOf(t: Transition): AppleParams | null {
  const p = physicsOf(t);
  return p ? appleParams(p) : null;
}

// ── tempo ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hermite smoothstep of x between a and b (0 … 1, flat at both ends). */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Input tempo 0 … 1 from a speed in px/s: 0 at ≤ `physics.slowSpeed` (400, slow / deliberate), 1 at
 * ≥ `physics.fastSpeed` (1800, fast / thrown), smooth in between. Sign is ignored.
 */
export function tempoOf(speed: number): number {
  if (!Number.isFinite(speed)) return speed === Infinity || speed === -Infinity ? 1 : 0;
  return smoothstep(physics.slowSpeed, physics.fastSpeed, Math.abs(speed));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Release spring for a value let go with momentum (WWDC18: "if the gesture that's driving the motion itself has
 * momentum, reward that momentum with a little bit of overshoot").
 * - |speed| ≤ 400 px/s → Apple(0.5, 0) = `spring.smooth`: gentle, critically damped, no overshoot of its own;
 * - |speed| ≥ 1800 px/s → Apple(0.36, 0.3): short and direct, up to 0.3 bounce;
 * - in between: duration and bounce interpolated on `tempoOf`.
 * `velocity` (units/s, same sign as the value's change) rides along, so the finger's speed carries into the spring.
 * `speed` defaults to |velocity|; pass the 2-D speed (hypot) for xy gestures. Always physics-defined (keeps velocity).
 */
export function releaseSpring(velocity: number, speed: number = Math.abs(velocity)): VelocitySpring {
  const t = tempoOf(speed);
  const { releaseSlow: s, releaseFast: f } = physics;
  const v = Number.isFinite(velocity) ? Math.max(-physics.maxVelocity, Math.min(physics.maxVelocity, velocity)) : 0;
  return { ...appleSpring(lerp(s.duration, f.duration, t), lerp(s.bounce, f.bounce, t)), velocity: v };
}

/** A committed exit (flung sheet / toast / card): leaves in `direction` at ≥ `minVelocity` px/s, never overshoots back. */
export interface FlingSpring extends VelocitySpring {
  restDelta: number;
  restSpeed: number;
}

/**
 * Exit spring for a dismissal: critically damped, carries the release velocity (at least `physics.flingMinVelocity`
 * in `direction`), 0.5 s when slow → 0.36 s when thrown. Rest thresholds are coarse (10 px / 200 px·s⁻¹) because the
 * target lies off-screen: the exit completes as soon as it is visually gone, not when a sub-pixel tail settles.
 */
export function flingSpring(direction: 1 | -1, velocity: number, minVelocity: number = physics.flingMinVelocity): FlingSpring {
  const along = Number.isFinite(velocity) ? velocity * direction : 0;
  const speed = Math.min(physics.maxVelocity, Math.max(minVelocity, along));
  const t = tempoOf(speed);
  return { ...appleSpring(lerp(physics.releaseSlow.duration, physics.releaseFast.duration, t), 0), velocity: direction * speed, restDelta: 10, restSpeed: 200 };
}

/**
 * Context spring for LAYOUT-driven targets that cannot take a velocity (hover pills, row highlight, segmented thumb,
 * dock bg/dot, morphs — Motion starts layout animations at velocity 0). `tempo` 0 … 1 (see `tempoOf`).
 * - tempo ≤ 0 (or NaN) → returns `base` ITSELF (same object): taps, keyboard, focus and programmatic changes keep the
 *   tuned token exactly (the additive guarantee);
 * - tempo 1 → Apple duration × 0.8 and bounce + 0.15, capped at 0.4 (never less bouncy or slower than the token).
 * The result is the equivalent mass-1 PHYSICS spring (time-defined tokens are resolved exactly like Motion does first,
 * so `spring.segment` (0.319 s, 0.18) → (0.255 s, 0.33) — Motion's own `duration` is a settle time, scaling it would
 * shorten the response by ≈ 30 %). Extra fields of the token (restDelta, restSpeed, …) are kept. Non-spring
 * transitions (tweens) are returned unchanged.
 */
export function contextSpringAt<T extends Transition>(base: T, tempo: number): T {
  if (!(tempo > 0)) return base;
  const resolved = physicsOf(base);
  if (!resolved) return base;
  const t = Math.min(1, tempo);
  const p = appleParams(resolved);
  const bounce = Math.max(p.bounce, Math.min(physics.maxBounce, p.bounce + physics.contextBounce * t));
  const { bounce: _b, duration: _d, visualDuration: _v, ...rest } = base as SpringLike & Record<string, unknown>;
  return { ...rest, ...appleSpring(p.duration * (1 - physics.contextResponse * t), bounce) } as T;
}

/**
 * Blend of two spring tokens in Apple space (duration and bounce interpolated): returns `a` ITSELF at t ≤ 0 and `b`
 * ITSELF at t ≥ 1 (identity at both ends), a mass-1 physics spring in between. Dock hop: `mixSpring(spring.pop,
 * spring.smooth, pressTempo(lastPressMs()))`; WidgetGrid drop: `mixSpring(springLayout, appleSpring(.33, .26), t)`.
 */
export function mixSpring<A extends Transition, B extends Transition>(a: A, b: B, t: number): A | B | PhysicsSpring {
  if (!(t > 0)) return a;
  if (t >= 1) return b;
  const pa = appleParamsOf(a);
  const pb = appleParamsOf(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  return appleSpring(lerp(pa.duration, pb.duration, t), lerp(pa.bounce, pb.bounce, t));
}

/**
 * Press tempo from a press duration (ms): 0 for a quick tap (≤ 150 ms) … 1 for a deliberate press (≥ 400 ms),
 * smooth between. NaN (no press yet / keyboard) → 0, i.e. the tuned tap behaviour.
 */
export function pressTempo(pressMs: number): number {
  return Number.isFinite(pressMs) ? smoothstep(physics.tapMs, physics.holdMs, pressMs) : 0;
}

/**
 * UIKit-normalised velocity (`initialSpringVelocity`, progress units/s) for the 0 → 1 progress springs of the pulse
 * engine (`engine.springAt`, `springStep.stepSpring`): `v_px / distance`. 0 when the distance is 0.
 */
export function progressVelocity(velocity: number, distance: number): number {
  return distance && Number.isFinite(velocity) ? velocity / distance : 0;
}

/**
 * `contextSpringAt(base, tempoOf(speed))` — `speed` = the input speed in px/s sampled IN THE EVENT HANDLER (e.g.
 * `pointerSpeed()` from the tempo probe), never during render. ≤ 400 px/s returns `base` itself.
 */
export function contextSpring<T extends Transition>(base: T, speed: number): T {
  return contextSpringAt(base, tempoOf(speed));
}
