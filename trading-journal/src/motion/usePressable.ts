import type { TargetAndTransition, Transition } from "motion/react";
import { pressScale, spring } from "@/motion/tokens";
import { useCanHover } from "@/motion/useMediaQuery";

export interface PressableOptions {
  /** No press feedback while disabled (Bundle `Re`). */
  disabled?: boolean;
  /** Tap scale, default `pressScale.control` (.96, Bundle Button); pick the token of the target size (`pressScale` in tokens). */
  scale?: number;
  /** Optional hover target, only applied on `(hover: hover)` devices. */
  hover?: TargetAndTransition;
  transition?: Transition;
}

export interface PressableProps {
  whileTap?: TargetAndTransition;
  whileHover?: TargetAndTransition;
  transition: Transition;
}

/**
 * Press feedback for any `motion.*` element: `whileTap {scale:.96}` with `spring.press`.
 * Hover targets are attached only when the device can hover.
 */
export function usePressable({ disabled, scale = pressScale.control, hover, transition = spring.press }: PressableOptions = {}): PressableProps {
  const canHover = useCanHover();
  return {
    whileTap: disabled ? undefined : { scale },
    whileHover: !disabled && canHover && hover ? hover : undefined,
    transition,
  };
}
