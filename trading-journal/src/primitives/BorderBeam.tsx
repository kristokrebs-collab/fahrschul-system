import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface BorderBeamProps {
  /** Beam length (px-ish; mapped to the arc's angular span). */
  size?: number;
  /** Loop duration in seconds (Bundle default 9 = `tween.beam`, market card 6). */
  duration?: number;
  /** Phase offset in seconds. */
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
  /**
   * One-shot mode: instead of looping, the beam runs a single lap (`tween.burst`, ~1.2 s) and fades out – again on
   * every new truthy value (`fire={saveCount}`). `false`/`0` renders nothing.
   */
  fire?: boolean | number | string;
  className?: string;
}

/** Arc span in degrees for a beam of `size` px (80 → 36°, clamped to a readable 20–120°). */
export function beamSpan(size: number): number {
  return Math.min(120, Math.max(20, size * 0.45));
}

/**
 * Bundle `a2` look, compositor-only: a PRE-RENDERED conic beam (transparent → `colorTo` → `colorFrom` head) rotates by
 * `transform` under a static ring mask (`fx-ring`, ring = `borderWidth`), so neither the border nor the beam repaints.
 * Loop: CSS `fx-spin` (runs on the compositor, no per-frame JS). Mount it only while it should run (`status === "live"`
 * AND hover, Plan 3.2 rule 8) or use `fire` for a single lap. Renders nothing under reduced motion.
 */
export function BorderBeam({ size = 80, duration = 9, delay = 0, colorFrom = "#e5202e", colorTo = "#ffffff", borderWidth = 1, fire, className }: BorderBeamProps) {
  const reduced = useReducedFx();
  if (reduced || fire === false || fire === 0 || fire === "") return null;
  const span = beamSpan(size);
  const beam = `conic-gradient(from ${-span}deg, transparent 0deg, ${colorTo} ${span * 0.6}deg, ${colorFrom} ${span}deg, transparent ${span}deg)`;
  const disc = "absolute left-1/2 top-1/2 aspect-square w-[calc(100cqw+100cqh)] -translate-x-1/2 -translate-y-1/2";
  return (
    <div
      aria-hidden="true"
      className="fx-ring pointer-events-none absolute inset-0 rounded-[inherit] [container-type:size]"
      style={{ padding: borderWidth }}
    >
      {fire === undefined ? (
        <span
          className={cn(disc, "will-change-transform animate-fx-spin", className)}
          style={{ background: beam, animationDuration: `${duration}s`, animationDelay: `${-delay}s` } as CSSProperties}
        />
      ) : (
        <motion.span
          key={String(fire)}
          className={cn(disc, "will-change-transform", className)}
          style={{ background: beam }}
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: 360, opacity: [0, 1, 1, 0] }}
          transition={tween.burst}
        />
      )}
    </div>
  );
}
