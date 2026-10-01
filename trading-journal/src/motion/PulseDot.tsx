import { animate, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type PulseTone = "live" | "warn" | "error" | "muted" | "win" | "loss" | "fg" | "signal";

const TONE_BG: Record<PulseTone, string> = {
  live: "bg-win",
  warn: "bg-warn",
  error: "bg-loss",
  muted: "bg-faint",
  win: "bg-win",
  loss: "bg-loss",
  fg: "bg-fg",
  signal: "bg-signal",
};

/** Per-trade pings are capped at 4 Hz – faster prints keep the current ping running. */
export const PING_MIN_INTERVAL_MS = 250;

/** Pure: whether a ping may fire at `now` after the last one at `last`. */
export function pingAllowed(last: number, now: number, minIntervalMs = PING_MIN_INTERVAL_MS): boolean {
  return now - last >= minIntervalMs;
}

export interface PulseDotProps {
  tone?: PulseTone;
  /** Dot diameter in px (default 6). */
  size?: number;
  /** Ripple rings: 1 (default), 2 = radar (half a period apart), 0 = none. They ping `tween.pingFew` (3×) when they
   * start or come back on screen, then rest – no endless loop at idle (perf review perf-05). */
  rings?: 0 | 1 | 2;
  /** Run the rings (e.g. `false` while the feed is stale – the dot stays, the breathing stops). */
  active?: boolean;
  /** Every change of this MotionValue fires one brighter ping (≤ 4 Hz), e.g. `tradeCountMv` or `priceMv`. */
  ping?: MotionValue<number>;
  /** Static accessible label → `role="img"`; without it the dot is decorative (`aria-hidden`). */
  label?: string;
  className?: string;
}

/**
 * Live status dot (21st.dev "Pinging live dot" / "Status Dot"): a solid core with ripple rings that scale 1 → 2.4
 * and fade .6 → 0 on `tween.pingFew` (three 1.6 s beats, then rest; replayed when it scrolls back into view), plus an optional per-trade ping (`tween.ripple`) and a white core
 * flash (`tween.flash`), so market activity is visible at a glance. Rings and pings are native WAAPI
 * transform/opacity animations (compositor), paused while off-screen. Reduced motion: a static dot.
 */
export function PulseDot({ tone = "live", size = 6, rings = 1, active = true, ping, label, className }: PulseDotProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLSpanElement>(null);
  const ringA = useRef<HTMLSpanElement>(null);
  const ringB = useRef<HTMLSpanElement>(null);
  const pingRef = useRef<HTMLSpanElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const els = [ringA.current, ringB.current].slice(0, rings).filter((el): el is HTMLSpanElement => el !== null);
    if (reduced || !active || !root || els.length === 0) return;
    const period = tween.pingFew.duration;
    const controls: AnimationPlaybackControls[] = els.map((el, i) =>
      animate(el, { transform: ["scale(1)", "scale(2.4)"], opacity: [0.6, 0] }, { ...tween.pingFew, delay: (i * period) / els.length }),
    );
    const unobserve = observeInView(root, (inView) => {
      for (const c of controls) {
        if (inView) c.play();
        else c.pause();
      }
    });
    return () => {
      unobserve();
      for (const c of controls) c.stop();
      for (const el of els) el.style.opacity = "0";
    };
  }, [reduced, active, rings]);

  useEffect(() => {
    if (!ping || reduced) return;
    let last = -Infinity;
    return ping.on("change", () => {
      const now = performance.now();
      if (!pingAllowed(last, now)) return;
      last = now;
      if (pingRef.current) animate(pingRef.current, { transform: ["scale(1)", "scale(2.2)"], opacity: [0.9, 0] }, tween.ripple);
      if (flashRef.current) animate(flashRef.current, { opacity: [0.85, 0] }, tween.flash);
    });
  }, [ping, reduced]);

  const bg = TONE_BG[tone];
  return (
    <span
      ref={rootRef}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      data-tone={tone}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {!reduced && rings > 0 && <span ref={ringA} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-full opacity-0", bg)} />}
      {!reduced && rings > 1 && <span ref={ringB} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-full opacity-0", bg)} />}
      {!reduced && ping && <span ref={pingRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-full opacity-0", bg)} />}
      <span aria-hidden="true" className={cn("relative size-full rounded-full", bg)} />
      {!reduced && ping && <span ref={flashRef} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-white opacity-0" />}
    </span>
  );
}
