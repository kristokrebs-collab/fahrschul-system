import { motion } from "motion/react";
import type { ReactNode } from "react";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface RingGaugeProps {
  /** 0..1, `null` → empty ring. */
  value: number | null;
  /** 0..1 marker (backtest win rate) drawn as a needle. */
  marker?: number | null;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  "aria-label"?: string;
}

const C = 2 * Math.PI * 45;

/**
 * Bundle `l2`: SVG 100×100, r 45, round caps, `strokeDashoffset` on `tween.gauge` (`initial:false`),
 * needle `h-[16px] w-[2px] rounded-full bg-fg/80` rotated `marker·360deg`. Track `#222` (Plan 2.2).
 */
export function RingGauge({ value, marker, size = 148, stroke = 9, color = "#f2f2f2", track = "#222", children, "aria-label": ariaLabel }: RingGaugeProps) {
  const reduced = useReducedFx();
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const deg = marker != null ? marker * 360 : null;
  return (
    <div className="relative" style={{ width: size, height: size }} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="45" fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: C * (1 - v) }}
          transition={reduced ? { duration: 0 } : tween.gauge}
        />
      </svg>
      {deg != null && (
        <span className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${deg}deg)` }} aria-hidden="true">
          <span className="absolute left-1/2 top-0 h-[16px] w-[2px] -translate-x-1/2 rounded-full bg-fg/80" />
        </span>
      )}
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
