/**
 * Dot-grid placeholder with axis stubs and a transform-only shimmer (Plan 3.3 "Skeleton").
 * Fixed height (set by the parent) → no CLS. Static under reduced motion.
 */
import { motion, useReducedMotion } from "motion/react";
import { Skeleton } from "@/ui/skeleton";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";

export interface ChartSkeletonProps {
  className?: string;
  /** number of price-axis stubs */
  rows?: number;
  /** number of time-axis stubs */
  cols?: number;
  label?: string;
}

export function ChartSkeleton({ className, rows = 5, cols = 6, label = "Chart wird geladen" }: ChartSkeletonProps) {
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
      {reduce ? (
        <div aria-hidden className="absolute inset-0 bg-white/[0.04]" />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
          style={{ animation: "chart-shimmer-x 1.6s linear infinite" }}
        />
      )}
      <style>{"@keyframes chart-shimmer-x { to { transform: translateX(200%) } }"}</style>
    </motion.div>
  );
}
