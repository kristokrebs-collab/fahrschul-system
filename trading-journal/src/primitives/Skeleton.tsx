import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Fixed height in px (CLS): cards pass the height of the content they stand in for. */
  height?: number;
}

/**
 * Placeholder (Plan 3.3 "Skeleton"): `rounded-xl bg-white/[0.04] relative overflow-hidden` + a PRE-RENDERED gradient
 * band that only moves by `transform` (`animate-fx-shimmer` = `@keyframes fx-shimmer-x`, 1.6 s linear = `tween.skeleton`).
 * It rests parked off-screen, so under reduced motion the placeholder is a static tint.
 */
export function Skeleton({ className, style, height }: SkeletonProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-white/[0.04]", className)} style={{ height, ...style }} aria-hidden="true">
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_25%,rgb(255_255_255/0.055)_50%,transparent_75%)] [transform:translateX(-100%)] will-change-transform animate-fx-shimmer motion-reduce:hidden" />
    </div>
  );
}

/** Chart skeleton: dot-grid placeholder + axis stubs, fixed height (CLS-free, sits `absolute inset-0` over the chart). */
export function ChartSkeleton({ height = 268, className }: { height?: number; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl", className)} style={{ height }} aria-hidden="true">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.06) 1px, transparent 0) 0 0 / 18px 18px" }} />
      <div className="absolute inset-x-3 bottom-6 grid gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-px bg-white/[0.05]" />
        ))}
      </div>
      <div className="absolute bottom-2 left-3 right-3 flex justify-between">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-2 w-8 rounded" />
        ))}
      </div>
    </div>
  );
}

export interface SkeletonSwapProps {
  /** `false` shows `skeleton`, `true` the children. */
  ready: boolean;
  /** Placeholder holding the exact final box (e.g. `<Skeleton height={40} />`). */
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Zero-shift crossfade (21st.dev "Skeleton Swap"): placeholder and content share one grid cell, so the swap never
 * moves the layout. The skeleton fades out (`tween.exit`), the content fades + de-blurs in (`tween.fade`) and ends at
 * `filter: none` (no containing block for fixed descendants). Content already ready on mount appears without animation;
 * reduced motion: the content appears at once while the skeleton fades away.
 */
export function SkeletonSwap({ ready, skeleton, children, className }: SkeletonSwapProps) {
  const reduced = useReducedFx();
  return (
    <div className={cn("grid", className)}>
      <AnimatePresence initial={false}>
        {ready ? (
          <motion.div
            key="content"
            className="[grid-area:1/1] min-w-0"
            initial={reduced ? false : { opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
            transition={tween.fade}
          >
            {children}
          </motion.div>
        ) : (
          <motion.div key="skeleton" className="[grid-area:1/1] min-w-0" initial={false} exit={{ opacity: 0, transition: tween.exit }}>
            {skeleton}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
