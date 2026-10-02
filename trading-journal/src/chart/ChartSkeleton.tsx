/**
 * Dot-grid placeholder with axis stubs, a transform-only shimmer band and a Nothing dot-matrix loader in the middle
 * (Plan 3.3 "Skeleton"). Fixed height (set by the parent) → no CLS. Static under reduced motion.
 */
import { motion, useReducedMotion } from "motion/react";
import { Skeleton } from "@/ui/skeleton";
import { DotMatrix } from "@/motion/DotMatrix";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";

export interface ChartSkeletonProps {
  className?: string;
  /** number of price-axis stubs */
  rows?: number;
  /** number of time-axis stubs */
  cols?: number;
  label?: string;
  /** dot-matrix loader in the centre (default true) */
  loader?: boolean;
}

export function ChartSkeleton({ className, rows = 5, cols = 6, label = "Chart wird geladen", loader = true }: ChartSkeletonProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="img"
      aria-label={label}
      aria-busy="true"
      className={cn("absolute inset-0 overflow-hidden rounded-2xl", className)}
      initial={false}
      exit={{ opacity: 0 }}
      transition={tween.fade}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, #ffffff0e 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div aria-hidden className="absolute inset-y-3 right-2 flex w-12 flex-col justify-between">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-2 w-10 rounded-sm bg-white/[0.06]" />
        ))}
      </div>
      <div aria-hidden className="absolute inset-x-4 bottom-2 flex justify-between pr-14">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-2 w-9 rounded-sm bg-white/[0.06]" />
        ))}
      </div>
      {loader ? (
        <div aria-hidden className="absolute inset-0 grid place-items-center pr-14">
          <DotMatrix preset="loader" tone="mute" size={4} gap={3} />
        </div>
      ) : null}
      {reduce ? (
        <div aria-hidden className="absolute inset-0 bg-white/[0.04]" />
      ) : (
        <div aria-hidden className="absolute inset-0 animate-fx-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
      )}
    </motion.div>
  );
}
