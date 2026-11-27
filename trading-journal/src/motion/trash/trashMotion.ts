import type { TargetAndTransition } from "motion/react";
import { tween } from "@/motion/tokens";

/**
 * Exit of a thing that goes into the Papierkorb: it shrinks to a small speck, tips a little and falls a few pixels (the way
 * paper is dropped into a bin), transform + opacity only, `tween.collapse` long (0.32 s). The siblings that stay close up
 * through their own `layout="position"` spring. Reduced motion: it is simply gone (no travel).
 */
export function trashExit(reduced: boolean): TargetAndTransition {
  if (reduced) return { opacity: 0, transition: { duration: 0 } };
  return {
    opacity: 0,
    scale: 0.16,
    y: 14,
    rotate: -7,
    transition: { scale: tween.collapse, y: tween.collapse, rotate: tween.collapse, opacity: { duration: 0.26, ease: "easeIn" } },
  };
}
