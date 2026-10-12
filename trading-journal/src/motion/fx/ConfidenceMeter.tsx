import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { DotMatrix, type DotTone, type Frame } from "@/motion/DotMatrix";
import { useFirstInView } from "@/motion/inView";
import { RollingDigits } from "@/motion/RollingDigits";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * ConfidenceMeter – how sure a finding / edge is, as a dot-matrix ramp (columns grow taller to the right, like a signal
 * strength meter) plus the percentage in odometer digits (`RollingDigits`, `spring.digit`). On first view the ramp is
 * uncovered left → right by a clip-path wipe (`tween.reveal`, ends at `clip-path: none`); later value changes
 * cross-fade cell by cell through the DotMatrix phosphor (zero React renders inside the matrix) while the digits roll.
 * `role="meter"` with the value; the matrix and digits are decorative copies. Reduced motion: static.
 *
 * `tone="auto"`: ≥ 70 win, ≥ 40 fg, below mute – a weak edge stays quiet ("trade the best, fuck the rest").
 */
export const CONFIDENCE_METER = {
  rows: 5,
  cols: 18,
  strong: 70,
  medium: 40,
} as const;

/** Pattern of the ramp for `value` 0..100 (lit columns bottom-up, brightness rising to the right). */
export function confidenceFrame(value: number, rows: number = CONFIDENCE_METER.rows, cols: number = CONFIDENCE_METER.cols): Frame {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const lit = Math.round((v / 100) * cols);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      if (c >= lit) return 0;
      const height = Math.max(1, Math.ceil(rows * (0.3 + (0.7 * (c + 1)) / cols)));
      return rows - r <= height ? 0.55 + (0.45 * (c + 1)) / cols : 0;
    }),
  );
}

export function confidenceTone(value: number): DotTone {
  return value >= CONFIDENCE_METER.strong ? "win" : value >= CONFIDENCE_METER.medium ? "fg" : "mute";
}

export interface ConfidenceMeterProps {
  /** 0..100 */
  value: number;
  /** Accessible name / visible caption (default "Konfidenz"). */
  label?: string;
  /** Hide the caption visually (still the accessible name). */
  hideLabel?: boolean;
  tone?: "auto" | DotTone;
  rows?: number;
  cols?: number;
  /** Dot size / gap in px (DotMatrix). */
  size?: number;
  gap?: number;
  showValue?: boolean;
  className?: string;
}

export function ConfidenceMeter({ value, label = "Konfidenz", hideLabel = false, tone = "auto", rows = CONFIDENCE_METER.rows, cols = CONFIDENCE_METER.cols, size = 4, gap = 2, showValue = true, className }: ConfidenceMeterProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  const t = tone === "auto" ? confidenceTone(v) : tone;
  const pattern = useMemo(() => confidenceFrame(v, rows, cols), [v, rows, cols]);
  const textTone = t === "win" ? "text-win" : t === "mute" ? "text-mute" : t === "loss" ? "text-loss" : t === "signal" ? "text-signal" : t === "warn" ? "text-warn" : "text-fg";

  return (
    <div
      ref={ref}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={`${v} %`}
      data-fx="confidence-meter"
      data-tone={t}
      className={cn("inline-flex items-center gap-3", className)}
    >
      <motion.span
        aria-hidden="true"
        className="inline-flex"
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={seen ? { clipPath: "inset(0 0% 0 0)", transitionEnd: { clipPath: "none" } } : undefined}
        transition={tween.reveal}
      >
        <DotMatrix pattern={pattern} rows={rows} cols={cols} tone={t} size={size} gap={gap} />
      </motion.span>
      {showValue ? (
        <span aria-hidden="true" className={cn("dot-num inline-flex items-baseline text-[20px] leading-none", textTone)}>
          <RollingDigits value={v} />
          <span className="ml-0.5 text-[0.7em] text-mute">%</span>
        </span>
      ) : null}
      {hideLabel ? null : (
        <span aria-hidden="true" className="label">
          {label}
        </span>
      )}
    </div>
  );
}
