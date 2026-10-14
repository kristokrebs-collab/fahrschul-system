import { motion, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { playWaapi, FX_TONE } from "@/motion/fx/shared";
import { usePlayTrigger } from "@/motion/pulse/textKit";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * GlowBreak – a DOM glow pinned to a chart point (RSI break, level break, a new high): a soft halo that breathes 3×
 * (`tween.glow`), a lit core and FINITE sonar rings (each pings 3× = `tween.pingFew`, staggered), then everything
 * rests at the halo's resting glow. Place it in a `relative` (or absolutely positioned overlay) parent; `x` / `y` are
 * the point in that parent's px – numbers or MotionValues (a chart overlay can glide it without React renders).
 * Pre-rendered radial gradients only (no blur filter), transform / opacity animations (WAAPI), aria-hidden.
 * Reduced motion: the resting glow, no breathing, no rings. Light mode: the halo at half strength (ring, not cloud).
 */
export type GlowBreakTone = "win" | "loss" | "soft";

const TONE: Record<GlowBreakTone, string> = { win: FX_TONE.win, loss: FX_TONE.loss, soft: FX_TONE.fg };

export const GLOW_BREAK = {
  size: 28,
  rings: 2,
  /** ring start scale → end scale (of the core-sized ring) */
  ringFrom: 0.5,
  ringTo: 3.4,
  /** resting halo opacity after the breathing (and under reduced motion) */
  rest: 0.55,
} as const;

export interface GlowBreakProps {
  x?: number | MotionValue<number>;
  y?: number | MotionValue<number>;
  tone?: GlowBreakTone;
  /** Halo diameter in px (default 28). */
  size?: number;
  /** Sonar rings per play, 0–3 (default 2). */
  rings?: number;
  /** Replay key: every new number (or false → true) breathes and pings again. */
  play?: number | boolean;
  /** Play once on mount (default true). */
  playOnMount?: boolean;
  className?: string;
}

export function GlowBreak({ x = 0, y = 0, tone = "win", size = GLOW_BREAK.size, rings = GLOW_BREAK.rings, play, playOnMount = true, className }: GlowBreakProps) {
  const reduced = useReducedFx();
  const haloRef = useRef<HTMLSpanElement>(null);
  const ringRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const running = useRef<Animation[]>([]);
  const ringCount = reduced ? 0 : Math.max(0, Math.min(3, Math.round(rings)));
  const color = TONE[tone];

  const stop = () => {
    for (const a of running.current) a.cancel();
    running.current = [];
  };

  usePlayTrigger(play, playOnMount, () => {
    if (reduced) return;
    stop();
    const list: Animation[] = [];
    const halo = playWaapi(
      haloRef.current,
      [
        { opacity: GLOW_BREAK.rest, transform: "scale(0.9)" },
        { opacity: 1, transform: "scale(1.18)" },
        { opacity: GLOW_BREAK.rest, transform: "scale(1)" },
      ],
      { duration: tween.glow.duration, ease: "easeInOut", iterations: tween.glow.repeat + 1 },
    );
    if (halo) list.push(halo);
    ringRefs.current.slice(0, ringCount).forEach((el, i) => {
      const a = playWaapi(
        el,
        [
          { opacity: 0.9, transform: `scale(${GLOW_BREAK.ringFrom})` },
          { opacity: 0, transform: `scale(${GLOW_BREAK.ringTo})` },
        ],
        { duration: tween.pingFew.duration, ease: ease.out, iterations: tween.pingFew.repeat + 1, delay: (i * tween.pingFew.duration) / Math.max(1, ringCount) },
      );
      if (a) list.push(a);
    });
    running.current = list;
  });

  useEffect(() => () => stop(), []);

  return (
    <motion.span aria-hidden="true" data-fx="glow-break" data-tone={tone} className={cn("pointer-events-none absolute left-0 top-0 z-[1]", className)} style={{ x, y }}>
      <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ width: size, height: size }}>
        {/* on paper (light mode) the halo at half strength: a full green cloud reads as a smudge there, a ring of light
            does not (the wrapper scales the breathing opacity of the halo, the WAAPI keyframes stay the same) */}
        <span className="absolute inset-0 [:root[data-theme=light]_&]:opacity-50">
          <span
            ref={haloRef}
            className="absolute inset-[-40%] rounded-full"
            style={{ opacity: GLOW_BREAK.rest, background: `radial-gradient(circle, color-mix(in srgb, ${color} 55%, transparent) 0%, color-mix(in srgb, ${color} 18%, transparent) 38%, transparent 68%)` }}
          />
        </span>
        {Array.from({ length: ringCount }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              ringRefs.current[i] = el;
            }}
            className="absolute inset-[22%] rounded-full opacity-0"
            style={{ boxShadow: `0 0 0 1.5px ${color}` }}
          />
        ))}
        <span className="absolute left-1/2 top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 30%, transparent)` }} />
        <span className="absolute left-1/2 top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
      </span>
    </motion.span>
  );
}
