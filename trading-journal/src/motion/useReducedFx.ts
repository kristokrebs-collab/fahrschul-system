import { useReducedMotion } from "motion/react";
import { motionReduced, useMotionPref } from "@/motion/profile";

/**
 * `true` when motion is reduced: the device asks for it (`prefers-reduced-motion`) and the reader left the setting on „Wie das Gerät“,
 * or the reader chose „Reduziert“; „Volles Profil“ is never reduced (`src/motion/profile.ts`). Gate every `useSpring`/MotionValue effect
 * (spotlight, magnetic, tilt, digits, counters, beams) with this – `MotionConfig reducedMotion` (set from the same setting in
 * `MotionRoot`) only covers transform/layout animations on `motion` elements, not hand-rolled MotionValue effects.
 */
export function useReducedFx(): boolean {
  const device = useReducedMotion() ?? false;
  return motionReduced(useMotionPref((s) => s.mode), device);
}
