import { useReducedMotion } from "motion/react";

/**
 * `true` when the OS asks for reduced motion. Gate every `useSpring`/MotionValue effect
 * (spotlight, magnetic, tilt, digits, counters, beams) with this – `MotionConfig reducedMotion="user"`
 * only covers transform/layout animations on `motion` elements, not hand-rolled MotionValue effects.
 */
export function useReducedFx(): boolean {
  return useReducedMotion() ?? false;
}
