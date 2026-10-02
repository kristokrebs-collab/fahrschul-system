import { motion, type HTMLMotionProps, type Transition, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { springSettleTime, type SpringConfig } from "@/motion/pulse/engine";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Variant labels used by the overlay bodies (`MorphDialogProvider`, `Sheet`) and `StaggerItem`. */
export const STAGGER_HIDDEN = "hidden";
export const STAGGER_SHOWN = "shown";

/**
 * `delayChildren` for a stagger parent: `base + min(i, stagger.max) · stagger.sections` – sections cascade
 * 40 ms apart and a long list never waits more than 12 steps.
 */
export function sectionDelay(base = 0): (i: number) => number {
  return (i) => base + Math.min(i, stagger.max) * stagger.sections;
}

/** Share of an overlay morph after which its body starts to reveal (the panel already covers most of its box). */
export const BODY_REVEAL_AT = 0.65;

/**
 * Seconds into a morph on spring `cfg` at which the overlay body starts revealing: `BODY_REVEAL_AT` of the spring's
 * settle time (0.5 % band). A blank panel never lands; the body never fades in over a panel that is still small.
 */
export function bodyRevealDelay(cfg: SpringConfig, at = BODY_REVEAL_AT): number {
  return Math.round(springSettleTime(cfg, 0.005) * at * 1000) / 1000;
}

/** Parent transition helper: `{ ...t, delayChildren: sectionDelay(base) }`. */
export function withSectionStagger(t: Transition, base = 0): Transition {
  return { ...t, delayChildren: sectionDelay(base) };
}

const ITEM: Variants = {
  [STAGGER_HIDDEN]: { opacity: 0, y: 8, filter: "blur(4px)" },
  [STAGGER_SHOWN]: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { default: tween.reveal, y: spring.enter },
    // ends at `filter: none` / `transform: none` – no containing block for fixed descendants afterwards
    transitionEnd: { filter: "none" },
  },
};
const STATIC: Variants = { [STAGGER_HIDDEN]: {}, [STAGGER_SHOWN]: {} };

type StaggerTag = "div" | "section" | "li";

export interface StaggerItemProps extends Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "children"> {
  as?: StaggerTag;
  children?: ReactNode;
}

/**
 * One section of a staggered overlay body: fades up from `{opacity 0, y 8, blur 4px}` (`tween.reveal`, y on
 * `spring.enter`) when its stagger parent switches to `shown`. Wrap the top-level blocks of a Sheet / MorphDialog
 * body in it; they cascade `stagger.sections` apart in DOM order. Outside a stagger parent it renders statically.
 * Reduced motion → static (no opacity / filter animation).
 */
export function StaggerItem({ as = "div", children, ...rest }: StaggerItemProps) {
  const reduced = useReducedFx();
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag variants={reduced ? STATIC : ITEM} {...rest}>
      {children}
    </Tag>
  );
}
