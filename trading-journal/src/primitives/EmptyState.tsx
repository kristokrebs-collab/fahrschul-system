import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useIntroLanded } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { canObserveInView, observeInView } from "@/motion/inView";
import { Typewriter } from "@/motion/pulse/Typewriter";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EMPTY_GLYPH_FRAMES } from "@/primitives/emptyGlyph";

export interface EmptyStateProps {
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  /** Mono status line typed under the text the first time the box is seen (pulse `text-animate`); `false` = none. */
  line?: string | false;
  className?: string;
}

/** Default status line of an empty state. */
export const EMPTY_LINE = "Bereit für den ersten Eintrag.";

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
 * first seen, and a mono status line (`line`) typed once (pulse `text-animate`, after the intro cell landed) into a
 * box reserved from the first paint. Title / text / CTA are rendered once, synchronously. Reduced motion: static
 * dashes, one static glyph frame, no sheen, the line shown at once.
 */
export function EmptyState({ title, text, action, line = EMPTY_LINE, className }: EmptyStateProps) {
  const reduced = useReducedFx();
  const landed = useIntroLanded();
  const [seen, setSeen] = useState(false);
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
      if (inView) setSeen(true);
    });
  }, [reduced, hasAction]);
  // the line types once: first time in view AND after the surrounding intro cell landed (no observer → at once)
  const typeNow = landed && (seen || reduced || !canObserveInView());

  return (
    <div ref={root} className={cn("relative grid h-full min-h-[180px] place-items-center rounded-xl p-6 text-center", className)}>
      <span ref={ants} aria-hidden="true" className="fx-ants data-[idle]:before:[animation-play-state:paused]" style={ANTS_STYLE} />
      <div className="grid justify-items-center gap-2">
        <DotMatrix frames={EMPTY_GLYPH_FRAMES} fps={12} size={3} gap={2} tone="fg" className="mb-1.5" />
        <strong className="text-[14px] font-semibold text-fg">{title}</strong>
        {text && <span className="max-w-[38ch] text-[13px] text-mute">{text}</span>}
        {line &&
          (typeNow ? (
            <Typewriter text={line} className="max-w-[38ch] font-mono text-[11px] text-faint" />
          ) : (
            // reserves the typed line's final box until it plays (same text + caret width, invisible)
            <span aria-hidden="true" className="invisible inline-block max-w-[38ch] whitespace-pre-wrap pr-[3px] font-mono text-[11px]">
              {line}
            </span>
          ))}
        {action && (
          <span ref={cta} className={CTA_SHINE} style={CTA_TIMING}>
            {action}
          </span>
        )}
      </div>
    </div>
  );
}
