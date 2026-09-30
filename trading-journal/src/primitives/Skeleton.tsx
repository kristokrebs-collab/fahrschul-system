import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Fixed height in px (CLS): cards pass the height of the content they stand in for. */
  height?: number;
}

/**
 * Placeholder (Plan 3.3 "Skeleton"): `rounded-xl bg-white/[0.04] relative overflow-hidden` + a transform-only
 * shimmer layer (`@keyframes shimmer-x` in shiny-cta.css). Under reduced motion the layer is hidden → static tint.
 */
export function Skeleton({ className, style, height }: SkeletonProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-white/[0.04]", className)} style={{ height, ...style }} aria-hidden="true">
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer-x_1.6s_linear_infinite] motion-reduce:hidden" />
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
