import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { observeInView } from "@/motion/inView";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EMPTY_GLYPH_FRAMES } from "@/primitives/emptyGlyph";

export interface EmptyStateProps {
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Marching-ants border (`.fx-ants`): calm white dashes, paused while the box is off-screen. */
const ANTS_STYLE = { "--fx-ants-color": "rgb(255 255 255 / 0.16)", "--fx-ants-dash": "4px", "--fx-ants-speed": "1.8s" } as CSSProperties;

/**
 * One sheen across the CTA button (a `::after` band behind its label, parked off the left edge) that runs once when
 * the empty state is first seen – `[data-shine]` starts the `fx-shimmer-x` keyframe on `tween.shimmer` timing.
 */
const CTA_SHINE = [
  "contents",
  "[&>button]:overflow-hidden",
  "[&>button]:after:pointer-events-none [&>button]:after:absolute [&>button]:after:inset-0 [&>button]:after:-z-[1] [&>button]:after:rounded-[inherit] [&>button]:after:content-['']",
  "[&>button]:after:bg-[linear-gradient(100deg,transparent_30%,rgb(255_255_255/0.5)_50%,transparent_70%)] [&>button]:after:[transform:translateX(-100%)]",
  "data-[shine]:[&>button]:after:[animation:fx-shimmer-x_var(--cta-shine-duration)_ease-in-out_var(--cta-shine-delay)_1_both]",
].join(" ");
const CTA_TIMING = { "--cta-shine-duration": `${tween.shimmer.duration}s`, "--cta-shine-delay": `${tween.shimmer.delay}s` } as CSSProperties;

/**
 * Bundle `Qr` empty state (e.g. `Noch keine Trades`), Nothing-style: a marching-ants dashed border, a 7 × 7
 * dot-matrix "∅" whose dots breathe in sequence (`DotMatrix`, sleeps off-screen) and a CTA that shimmers once when
 * first seen. Texts are rendered once, synchronously (no animated copies). Reduced motion: static dashes, one static
 * glyph frame, no sheen.
 */
export function EmptyState({ title, text, action, className }: EmptyStateProps) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const ants = useRef<HTMLSpanElement>(null);
  const cta = useRef<HTMLSpanElement>(null);
  const hasAction = Boolean(action);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    return observeInView(el, (inView) => {
      if (ants.current) ants.current.toggleAttribute("data-idle", !inView);
      if (inView && cta.current) cta.current.setAttribute("data-shine", "");
    });
  }, [reduced, hasAction]);

  return (
    <div ref={root} className={cn("relative grid h-full min-h-[180px] place-items-center rounded-xl p-6 text-center", className)}>
      <span ref={ants} aria-hidden="true" className="fx-ants data-[idle]:before:[animation-play-state:paused]" style={ANTS_STYLE} />
      <div className="grid justify-items-center gap-2">
        <DotMatrix frames={EMPTY_GLYPH_FRAMES} fps={12} size={3} gap={2} tone="fg" className="mb-1.5" />
        <strong className="text-[14px] font-semibold text-fg">{title}</strong>
        {text && <span className="max-w-[38ch] text-[13px] text-mute">{text}</span>}
        {action && (
          <span ref={cta} className={CTA_SHINE} style={CTA_TIMING}>
            {action}
          </span>
        )}
      </div>
    </div>
  );
}
