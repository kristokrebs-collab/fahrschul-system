import { motion, useTransform, type MotionValue } from "motion/react";
import { useRef, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { MotionNumber } from "@/motion/MotionNumber";
import { revealDelay } from "@/motion/Reveal";
import { stagger, tween } from "@/motion/tokens";
import { useRevealValue } from "@/primitives/revealValue";

/**
 * Delay of the first fill of the `index`-th bar in a list (capped stagger). Bars start filling one beat
 * (`stagger.lead`) after their card begins to fade in, so the fill reads instead of hiding in the blur.
 */
export function barDelay(index = 0): number {
  return revealDelay(index, stagger.lead);
}

/**
 * The fill of a bar whose readout must count in step with it (win-rate tiles): pass the result to `<Bar source>`
 * and derive the number with `useTransform(fill, (f) => f * 100)`. `ref` is the tile holding both.
 */
export function useBarFill(ref: RefObject<Element | null>, value: number | null | undefined, index = 0): MotionValue<number> {
  return useRevealValue(ref, Math.max(0, Math.min(1, value ?? 0)), { transition: tween.bar, delay: barDelay(index) });
}

export interface BarProps {
  /** 0..1 */
  value?: number | null;
  /** Externally driven fill (0..1), e.g. shared with a counter; `value` is ignored then. */
  source?: MotionValue<number>;
  /** Position in its list → staggered first fill (`stagger.reveal`, capped). */
  index?: number;
  className?: string;
  /** Track classes (default `bg-white/[0.06]`). */
  track?: string;
  /** Fill classes (default `bg-win`). */
  fill?: string;
}

/**
 * Single-segment progress bar (Plan 3.3 "Balken"): only `scaleX` with `transformOrigin: left`. Fills from 0 on
 * `tween.bar` the first time it scrolls into view, staggered by `index`; later changes animate from the current
 * fill, re-mounts inside a page do not replay. Reduced motion / no `IntersectionObserver`: the value, static.
 * Used by the RSI check, ranking rows, patterns, checklist.
 */
export function Bar({ value, source, index = 0, className, track = "bg-white/[0.06]", fill = "bg-win" }: BarProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const v = Math.max(0, Math.min(1, value ?? 0));
  const own = useRevealValue(ref, v, { transition: tween.bar, delay: barDelay(index), enabled: !source });
  return (
    <span ref={ref} className={cn("block h-1.5 overflow-hidden rounded-full", track, className)} aria-hidden="true">
      <motion.span className={cn("block h-full rounded-full", fill)} style={{ originX: 0, scaleX: source ?? own }} />
    </span>
  );
}

/** Percent readout of a `useBarFill` value (`62 %`), frame-synced with its bar; `label` is the final value. */
export function BarPercent({ fill, label, className }: { fill: MotionValue<number>; label: string; className?: string }) {
  const pct = useTransform(fill, (f) => f * 100);
  return <MotionNumber source={pct} decimals={0} suffix=" %" aria-label={label} className={className} />;
}
