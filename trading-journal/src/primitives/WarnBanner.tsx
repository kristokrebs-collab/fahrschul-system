import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface WarnBannerProps {
  /** Mount/unmount with exit `{opacity:0}` (`tween.exit`); siblings with `layout` move up on `spring.layout`. */
  open?: boolean;
  children: ReactNode;
  /** Right-aligned action (e.g. close button `aria-label="Schließen"`). */
  action?: ReactNode;
  className?: string;
}

/** Enter: drops 8 px into place while a top-down clip wipe uncovers it; ends at `clip-path: none`. */
const ENTER = { opacity: 0, y: -8, clipPath: `inset(0 0 100% 0 round ${radius.card}px)` };
const SHOWN = { opacity: 1, y: 0, clipPath: `inset(0 0 0% 0 round ${radius.card}px)`, transitionEnd: { clipPath: "none" } };
const ENTER_TRANSITION = { default: tween.reveal, y: spring.layout };

/** The warn dot pings softly a few times when the banner appears, then rests (no endless loop on an idle page). */
const PING_STYLE = { "--fx-ping-scale": "2.6", "--fx-ping-opacity": "0.5", animationDuration: `${tween.ping.duration}s`, animationIterationCount: 3 } as CSSProperties;

/**
 * `Lokaler Modus` banner: `rounded-2xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-warn`, led by a
 * warn dot with a soft ping. Appearing after boot it drops in with a clip wipe (`AnimatePresence initial={false}` skips
 * the first paint); `role="status"` without `aria-live` (the toast island is the only live region).
 * Reduced motion: opacity only, static dot.
 */
export function WarnBanner({ open = true, children, action, className }: WarnBannerProps) {
  const reduced = useReducedFx();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          layout
          role="status"
          style={{ borderRadius: radius.card }}
          initial={reduced ? { opacity: 0 } : ENTER}
          animate={reduced ? { opacity: 1 } : SHOWN}
          transition={{ ...(reduced ? { default: tween.crossfade } : ENTER_TRANSITION), layout: spring.layout }}
          exit={{ opacity: 0, transition: tween.exit }}
          className={cn("flex items-start justify-between gap-3 rounded-2xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] text-warn", className)}
        >
          <span aria-hidden="true" className="relative mt-[7px] size-1.5 shrink-0 rounded-full bg-warn">
            {!reduced && <span className="fx-ping bg-warn" style={PING_STYLE} />}
          </span>
          <div className="min-w-0 flex-1">{children}</div>
          {action}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
