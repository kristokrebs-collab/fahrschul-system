import { AnimatePresence, motion, type Transition, type Variants } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

// x/scale on the critically damped `spring.enter` (settles ≈ 0.42 s): the switch – and with it `transitioning`,
// which locks the trade detail – is over well inside the 600 ms budget
const ENTER_TRANSITION: Transition = { x: spring.enter, scale: spring.enter, opacity: tween.page, filter: tween.page };

/**
 * `depth`: the entering page also comes up from scale .985 + blur 4px (a "focus pull"); off under reduced motion,
 * where `MotionConfig reducedMotion="user"` already turns x/scale into instant changes and only the opacity
 * crossfade remains. The page always ends at `transform: none` / `filter: none` (no containing block for the
 * chart's fixed marker ghost or the table ghost).
 */
function pageVariants(depth: boolean): Variants {
  return {
    enter: (dir: number) => ({ x: dir * 16, opacity: 0, scale: 0.985, ...(depth ? { filter: "blur(4px)" } : {}) }),
    center: { x: 0, opacity: 1, scale: 1, ...(depth ? { filter: "blur(0px)", transitionEnd: { filter: "none" } } : {}) },
    // the leaving page only has to get out of the way: one short linear tween for every value
    exit: (dir: number) => ({ x: -dir * 12, opacity: 0, transition: tween.exit }),
  };
}
const DEPTH = pageVariants(true);
const FLAT = pageVariants(false);

export interface PageSwitchProps {
  /** Index of the active page (tab order) – the sign of the difference decides the slide direction. */
  index: number;
  /** Stable key for the active page; defaults to `index`. */
  pageKey?: string | number;
  children: ReactNode;
  /** `true` from the moment the page changes until enter and exit have both finished. */
  onTransitioning?: (transitioning: boolean) => void;
  /** Remember/restore `window.scrollY` per page index (default true). */
  rememberScroll?: boolean;
  className?: string;
}

/**
 * Direction-aware page transition (Plan 3.3 "Seitenwechsel"): `AnimatePresence mode="popLayout"
 * initial={false}`; enter `{x: dir·16, opacity 0, scale .985, blur 4px}` (x/scale on `spring.enter`,
 * opacity/blur on `tween.page`), exit `{x: −dir·12, opacity 0}` on `tween.exit` (≈ 120 ms). The whole switch
 * settles in ≈ 0.45 s. No `layout` here: the container is a plain `relative` box (popLayout pins the leaving page
 * absolutely inside it), so a page switch never runs a full-page layout projection.
 */
export function PageSwitch({ index, pageKey, children, onTransitioning, rememberScroll = true, className }: PageSwitchProps) {
  const reduced = useReducedFx();
  // direction derived from the previous index (state-from-props pattern, no refs during render)
  const [nav, setNav] = useState({ index, dir: 1 });
  if (nav.index !== index) setNav({ index, dir: index > nav.index ? 1 : -1 });
  const dir = nav.index === index ? nav.dir : index > nav.index ? 1 : -1;

  const last = useRef(index);
  const scroll = useRef(new Map<number, number>());
  const pending = useRef(0);
  const notify = useRef(onTransitioning);
  useLayoutEffect(() => {
    notify.current = onTransitioning;
  });

  useLayoutEffect(() => {
    if (last.current === index) return;
    const from = last.current;
    last.current = index;
    // exit + enter both have to settle before the flag clears
    pending.current = 2;
    notify.current?.(true);
    if (!rememberScroll || typeof window === "undefined") return;
    try {
      scroll.current.set(from, window.scrollY);
      window.scrollTo({ top: scroll.current.get(index) ?? 0, behavior: "instant" as ScrollBehavior });
    } catch {
      /* jsdom / older engines: scroll restore is a convenience only */
    }
  }, [index, rememberScroll]);

  const settle = () => {
    if (pending.current === 0) return;
    pending.current -= 1;
    if (pending.current === 0) notify.current?.(false);
  };

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir} onExitComplete={settle}>
        <motion.div
          key={pageKey ?? index}
          custom={dir}
          variants={reduced ? FLAT : DEPTH}
          initial="enter"
          animate="center"
          exit="exit"
          transition={ENTER_TRANSITION}
          onAnimationComplete={(def) => {
            if (def === "center") settle();
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
