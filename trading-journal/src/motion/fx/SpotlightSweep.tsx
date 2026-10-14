import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { FX_TONE, playWaapi, useFxPlay, type FxTone } from "@/motion/fx/shared";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * SpotlightSweep – ONE red signal line crosses its card once (`tween.sweep`), trailing a soft glow, then the layer is
 * gone. Put it inside a `relative` card (it fills it, `rounded-[inherit]`, `overflow-hidden`). Transform / opacity
 * only (WAAPI on the compositor), aria-hidden, nothing at rest; reduced motion: nothing at all.
 *
 * ```tsx
 * <div className="relative rounded-2xl …"><SpotlightSweep play={leakCount} />…</div>
 * ```
 */
export const SPOTLIGHT_SWEEP = {
  /** Width of the travelling layer as a share of the card (the line rides its right edge). */
  width: 0.42,
} as const;

export interface SpotlightSweepProps {
  /** Replay key: every new number (or false → true) runs one sweep. */
  play?: number | boolean;
  /** Run once the first time the card is in view (default true; intro-gated). */
  playOnView?: boolean;
  tone?: Extract<FxTone, "signal" | "fg" | "win">;
  className?: string;
  onDone?: () => void;
}

export function SpotlightSweep({ play, playOnView = true, tone = "signal", className, onDone }: SpotlightSweepProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLSpanElement>(null);
  const bandRef = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);

  useFxPlay(rootRef, play, playOnView, !reduced, () => {
    const band = bandRef.current;
    anim.current?.cancel();
    const travel = `${(100 / SPOTLIGHT_SWEEP.width).toFixed(1)}%`;
    const a = playWaapi(
      band,
      [
        { transform: "translateX(-100%)", opacity: 0 },
        { transform: `translateX(-40%)`, opacity: 1, offset: 0.18 },
        { transform: `translateX(${travel})`, opacity: 0.85 },
      ],
      tween.sweep,
    );
    anim.current = a;
    if (!a) {
      onDone?.();
      return;
    }
    a.onfinish = () => {
      if (anim.current === a) anim.current = null;
      onDone?.();
    };
  });

  useEffect(() => () => anim.current?.cancel(), []);

  if (reduced) return null;
  const color = FX_TONE[tone];
  return (
    <span ref={rootRef} aria-hidden="true" data-fx="spotlight-sweep" className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}>
      <span
        ref={bandRef}
        className="absolute inset-y-0 left-0 opacity-0"
        style={{
          width: `${SPOTLIGHT_SWEEP.width * 100}%`,
          transform: "translateX(-100%)",
          background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${color} 7%, transparent) 62%, color-mix(in srgb, ${color} 22%, transparent) 94%, transparent 100%)`,
        }}
      >
        <span className="absolute inset-y-0 right-0 w-[1.5px]" style={{ background: color, boxShadow: `0 0 12px 1px ${color}` }} />
      </span>
    </span>
  );
}
