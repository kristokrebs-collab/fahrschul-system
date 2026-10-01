import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { canRevealOnView, useRevealValue } from "@/primitives/revealValue";

export interface RingGaugeProps {
  /** 0..1, `null` → empty ring. */
  value: number | null;
  /** 0..1 marker (backtest win rate) drawn as a needle. */
  marker?: number | null;
  size?: number;
  stroke?: number;
  /** Arc colour (below the marker when `passColor` is set). */
  color?: string;
  /**
   * Arc colour once the drawn arc reaches `marker`: both arcs are pre-rendered and crossfade the moment the tip
   * passes the needle (also while drawing in); an upward crossing flashes a halo in this colour.
   */
  passColor?: string;
  track?: string;
  /** Centre content; a function receives the drawn progress (0..1) so a counter runs frame-synced with the arc. */
  children?: ReactNode | ((progress: MotionValue<number>) => ReactNode);
  "aria-label"?: string;
}

const C = 2 * Math.PI * 45;
/** Below this the arc (and its tip) count as empty – a zero-length dash would still paint a round cap. */
const EMPTY = 0.004;

/** Pure: did the drawn progress move across `marker` between two frames (`1` upwards, `-1` downwards, `0` no)? */
export function crossing(prev: number, next: number, marker: number | null | undefined): -1 | 0 | 1 {
  if (marker == null || !Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  if (prev < marker && next >= marker) return 1;
  if (prev >= marker && next < marker) return -1;
  return 0;
}

/**
 * Bundle `l2` as an activity ring (21st.dev "Activity Ring with riding tip"): SVG 100×100, r 45, round caps,
 * track `#222`.
 * - Draws from 0 the first time it scrolls into view (`tween.gauge`); later changes animate from the current arc.
 *   One MotionValue drives the arc, the riding tip dot and the optional centre counter – no React render per frame.
 * - The backtest needle pops in on `spring.pop` as the draw starts. With `passColor` the arc turns that colour the
 *   moment its tip passes the needle and an upward crossing flashes a halo (`tween.flash`, opacity only).
 * Reduced motion / no `IntersectionObserver`: the final state, static.
 */
export function RingGauge({ value, marker, size = 148, stroke = 9, color = "#f2f2f2", passColor, track = "#222", children, "aria-label": ariaLabel }: RingGaugeProps) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const m = marker != null ? Math.max(0, Math.min(1, marker)) : null;
  const [armed] = useState(() => canRevealOnView(reduced));

  const needle = useMotionValue(armed ? 0 : 1);
  const progress = useRevealValue(root, v, { transition: tween.gauge, onReveal: () => animate(needle, 1, spring.pop) });
  const pass = useMotionValue(!armed && m != null && v >= m ? 1 : 0);

  const offset = useTransform(progress, (p) => C * (1 - p));
  const drawn = useTransform(progress, (p) => (p > EMPTY ? 1 : 0));
  const passOpacity = useTransform(() => pass.get() * drawn.get());
  const tipRotate = useTransform(progress, (p) => p * 360);

  useEffect(() => {
    if (reduced) needle.jump(1);
  }, [reduced, needle]);

  useEffect(() => {
    if (!passColor || m == null) return;
    let prev = progress.get();
    pass.jump(prev >= m ? 1 : 0);
    return progress.on("change", (p) => {
      const dir = crossing(prev, p, m);
      prev = p;
      if (dir === 0) return;
      if (reduced) {
        pass.jump(dir > 0 ? 1 : 0);
        return;
      }
      animate(pass, dir > 0 ? 1 : 0, tween.crossfade);
      if (dir > 0 && halo.current) animate(halo.current, { opacity: [0.9, 0] }, tween.flash);
    });
  }, [passColor, m, progress, pass, reduced]);

  const deg = m != null ? m * 360 : null;
  return (
    <div ref={root} className="relative" style={{ width: size, height: size }} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      {passColor && (
        <span
          ref={halo}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-0.5 rounded-full opacity-0"
          style={{ boxShadow: `0 0 26px 2px color-mix(in srgb, ${passColor} 45%, transparent), inset 0 0 18px color-mix(in srgb, ${passColor} 35%, transparent)` }}
        />
      )}
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="45" fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx="50" cy="50" r="45" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} style={{ opacity: drawn }} />
        {passColor && (
          <motion.circle cx="50" cy="50" r="45" fill="none" stroke={passColor} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} style={{ opacity: passOpacity }} />
        )}
      </svg>
      {deg != null && (
        <span className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${deg}deg)` }} aria-hidden="true">
          <motion.span className="absolute left-1/2 top-0 -ml-px h-[16px] w-[2px] rounded-full bg-fg/80" style={{ scale: needle }} />
        </span>
      )}
      {value != null && (
        <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ rotate: tipRotate, opacity: drawn }}>
          {/* the arc's centre line runs 5 % in from the edge (r 45 of 50) */}
          <span
            className="absolute left-1/2 top-[5%] size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 7px 1px color-mix(in srgb, ${passColor ?? color} 70%, transparent)` }}
          />
        </motion.span>
      )}
      <div className="absolute inset-0 grid place-items-center text-center">{typeof children === "function" ? children(progress) : children}</div>
    </div>
  );
}
