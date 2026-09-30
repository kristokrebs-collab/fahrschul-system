import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";

export interface BarProps {
  /** 0..1 */
  value: number | null | undefined;
  className?: string;
  /** Track classes (default `bg-white/[0.06]`). */
  track?: string;
  /** Fill classes (default `bg-win`). */
  fill?: string;
}

/**
 * Single-segment progress bar (Plan 3.3 "Balken"): only `scaleX` with `transformOrigin: left` on `tween.bar`,
 * `initial: false` (no replay on re-mount inside a page). Used by the RSI check, ranking rows, patterns, checklist.
 */
export function Bar({ value, className, track = "bg-white/[0.06]", fill = "bg-win" }: BarProps) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full", track, className)} aria-hidden="true">
      <motion.span className={cn("block h-full rounded-full", fill)} style={{ originX: 0 }} initial={false} animate={{ scaleX: v }} transition={tween.bar} />
    </span>
  );
}
