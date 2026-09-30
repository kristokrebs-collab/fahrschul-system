import { AnimatePresence, motion, type Variants } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";

const variants: Variants = {
  enter: (dir: number) => ({ x: dir * 16, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: -dir * 12, opacity: 0, transition: { x: spring.smooth, opacity: tween.exit } }),
};

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
 * initial={false}`, enter `{x: dir·16, opacity: 0}`, exit `{x: −dir·12, opacity: 0}`; `x` on
 * `spring.smooth`, opacity on `tween.page` in / `tween.exit` out. The container is a `layout`
 * element with `position: relative` and the page is `layout="position"` so the footer does not jump.
 */
export function PageSwitch({ index, pageKey, children, onTransitioning, rememberScroll = true, className }: PageSwitchProps) {
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
    <motion.div layout className={cn("relative", className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir} onExitComplete={settle}>
        <motion.div
          key={pageKey ?? index}
          layout="position"
          custom={dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ x: spring.smooth, opacity: tween.page }}
          onAnimationComplete={(def) => {
            if (def === "center") settle();
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
