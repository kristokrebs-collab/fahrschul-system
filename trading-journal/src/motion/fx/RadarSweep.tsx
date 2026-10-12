import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { FX_TONE, type FxTone } from "@/motion/fx/shared";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * RadarSweep – scanner feedback that runs ONLY while a scan runs (`active`).
 *
 * Declared motion exception `radar-sweep` (README): the turn / pass repeats (`tween.scan`, 2.4 s linear) for as long
 * as `active` is true – a loop by design, but never at idle: it is a CSS animation on a pre-rendered layer
 * (transform only, compositor), switched on by `[data-scanning]` and paused while the scanner is off screen
 * (`[data-offscreen]`, shared observer). When `active` turns false the layer fades out (`tween.exit`).
 *
 * - `variant="radar"`: a round scope (rings, cross-hair, rotating wedge, blips that light when the wedge passes).
 * - `variant="band"`: a scan line crossing its `relative` parent (fills it), e.g. a chart while a backtest runs.
 *
 * Decorative (aria-hidden) unless `label` is given (`role="img"`); never `aria-live` – announce results elsewhere.
 * Reduced motion: no turn / pass; the radar shows a still wedge while active, the band a static tint.
 */
export const RADAR_SWEEP = {
  size: 44,
  /** wedge angle in degrees (bright leading edge, fading tail) */
  wedge: 72,
  /** blip angles (deg, clockwise from 12 o'clock) and radii (share of the scope) */
  blips: [
    [52, 0.62],
    [148, 0.38],
    [231, 0.74],
    [317, 0.5],
  ] as const,
} as const;

export interface RadarSweepProps {
  active: boolean;
  variant?: "radar" | "band";
  tone?: Extract<FxTone, "fg" | "signal" | "win">;
  /** Radar diameter in px (default 44). */
  size?: number;
  /** Accessible name (radar → `role="img"`), e.g. "Scan läuft". */
  label?: string;
  className?: string;
}

export function RadarSweep({ active, variant = "radar", tone = "signal", size = RADAR_SWEEP.size, label, className }: RadarSweepProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLSpanElement>(null);
  const scanning = active && !reduced;
  const color = FX_TONE[tone];
  const period = tween.scan.duration;

  // pause the loop while off screen (attribute write only, no React state)
  useEffect(() => {
    const el = ref.current;
    if (!el || !scanning) return;
    const stop = observeInView(el, (inView) => {
      if (inView) el.removeAttribute("data-offscreen");
      else el.setAttribute("data-offscreen", "");
    });
    return () => {
      stop();
      el.removeAttribute("data-offscreen");
    };
  }, [scanning]);

  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  const fade = { transition: `opacity ${(active ? tween.fade : tween.exit).duration}s linear` };

  if (variant === "band") {
    return (
      <span
        ref={ref}
        {...a11y}
        data-fx="radar-sweep"
        data-variant="band"
        data-scanning={scanning ? "" : undefined}
        data-active={active ? "" : undefined}
        className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}
      >
        <span className="absolute inset-0" style={{ ...fade, opacity: active ? 1 : 0, background: `linear-gradient(180deg, transparent, color-mix(in srgb, ${color} 5%, transparent))` }} />
        {!reduced && (
          <span className="fx-scan__band absolute inset-0" style={{ ...fade, opacity: active ? 1 : 0 }}>
            <span className="absolute inset-y-0 right-0 w-[38%]" style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 16%, transparent))` }} />
            <span className="absolute inset-y-0 right-0 w-[1.5px]" style={{ background: color, boxShadow: `0 0 10px 1px color-mix(in srgb, ${color} 70%, transparent)` }} />
          </span>
        )}
      </span>
    );
  }

  const w = RADAR_SWEEP.wedge;
  return (
    <span
      ref={ref}
      {...a11y}
      data-fx="radar-sweep"
      data-variant="radar"
      data-scanning={scanning ? "" : undefined}
      data-active={active ? "" : undefined}
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full border border-line-2 bg-ink-950 align-middle", className)}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-[22%] rounded-full border border-white/[0.07]" />
      <span className="absolute inset-[44%] rounded-full border border-white/[0.07]" />
      <span className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
      <span className="absolute inset-y-0 left-1/2 w-px bg-white/[0.06]" />
      <span
        className="fx-radar__sweep absolute inset-0 rounded-full"
        style={{ ...fade, opacity: active ? 1 : 0, background: `conic-gradient(from ${-w}deg, transparent 0deg, color-mix(in srgb, ${color} 34%, transparent) ${w - 1}deg, ${color} ${w}deg, transparent ${w + 0.6}deg)` }}
      />
      {!reduced &&
        RADAR_SWEEP.blips.map(([deg, r]) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          return (
            <span
              key={deg}
              className="fx-radar__blip absolute size-[3px] rounded-full"
              style={{
                left: `calc(${50 + Math.cos(rad) * r * 50}% - 1.5px)`,
                top: `calc(${50 + Math.sin(rad) * r * 50}% - 1.5px)`,
                background: color,
                boxShadow: `0 0 6px ${color}`,
                animationDelay: `${((deg / 360) * period).toFixed(3)}s`,
              }}
            />
          );
        })}
      <span className="absolute left-1/2 top-1/2 size-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: active ? color : "var(--color-faint)" }} />
    </span>
  );
}
