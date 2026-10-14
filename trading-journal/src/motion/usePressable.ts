import type { TargetAndTransition, Transition } from "motion/react";
import { spring } from "@/motion/tokens";
import { useCanHover } from "@/motion/useMediaQuery";

export interface PressableOptions {
  /** No press feedback while disabled (Bundle `Re`). */
  disabled?: boolean;
  /** Tap scale, default .96 (Bundle Button). */
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
export function usePressable({ disabled, scale = 0.96, hover, transition = spring.press }: PressableOptions = {}): PressableProps {
  const canHover = useCanHover();
  return {
    whileTap: disabled ? undefined : { scale },
    whileHover: !disabled && canHover && hover ? hover : undefined,
    transition,
  };
}
