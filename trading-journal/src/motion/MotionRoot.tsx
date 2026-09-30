import { LayoutGroup, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/motion/tokens";

/**
 * App-level motion root (Plan 3.1): `reducedMotion="user"`, `spring.smooth` as the default transition
 * for every `motion` element without its own, and ONE id-less `LayoutGroup` so siblings outside an
 * `AnimatePresence` are notified of layout changes. `layoutId`s are NOT prefixed – collisions are
 * avoided by naming and conditions (see README "layoutId contracts").
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring.smooth}>
      <LayoutGroup>{children}</LayoutGroup>
    </MotionConfig>
  );
}
