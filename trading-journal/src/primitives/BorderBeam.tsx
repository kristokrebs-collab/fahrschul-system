import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface BorderBeamProps {
  size?: number;
  /** Loop duration in seconds (Bundle default 9, market card 6). */
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
  className?: string;
}

/**
 * Bundle `a2`: a gradient blob travelling along `offset-path: rect(...)` inside a masked border.
 * Mount it only while it should run (`status === "live"` AND hover, Plan 3.2 rule 8); it renders
 * nothing under reduced motion.
 */
export function BorderBeam({ size = 80, duration = 9, delay = 0, colorFrom = "#e5202e", colorTo = "#ffffff", borderWidth = 1, className }: BorderBeamProps) {
  const reduced = useReducedFx();
  if (reduced) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
      style={{ borderWidth, borderStyle: "solid" }}
    >
      <motion.div
        className={cn("absolute aspect-square", className)}
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)`, background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)` }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: ["0%", "100%"] }}
        transition={{ ...tween.beam, duration, delay: -delay }}
      />
    </div>
  );
}
