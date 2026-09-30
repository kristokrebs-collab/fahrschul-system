import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";

export type StatusTone = "live" | "warn" | "error" | "muted";

export interface StatusPillProps {
  tone: StatusTone;
  /** Label shown in the expanded pill (German UI string, e.g. `Live · alle 5 min`). */
  label?: ReactNode;
  /** `false` → 6 px dot, `true` → 28 px pill with label. */
  expanded: boolean;
  /** Optional countdown ring 0..1 (age until next refresh); replaces the dot with a 14 px `LiveRing`. */
  ring?: number | null;
  /** Spinner while refreshing (`animate-spin` on the ring). */
  spinning?: boolean;
  /** Feed id → `layoutId="status-{feed}"` so the pill can travel between header and card. */
  feed?: string;
  className?: string;
  title?: string;
}

const TONE_DOT: Record<StatusTone, string> = { live: "bg-win", warn: "bg-warn", error: "bg-loss", muted: "bg-faint" };
const TONE_LAYER: Record<StatusTone, string> = {
  live: "border-win/25 bg-win/12",
  warn: "border-warn/25 bg-warn/12",
  error: "border-loss/25 bg-loss/12",
  muted: "border-line-2 bg-white/[0.04]",
};
const TONE_TEXT: Record<StatusTone, string> = { live: "text-win", warn: "text-warn", error: "text-loss", muted: "text-mute" };
const TONE_STROKE: Record<StatusTone, string> = { live: "text-win", warn: "text-warn", error: "text-signal", muted: "text-faint" };
const TONES: StatusTone[] = ["live", "warn", "error", "muted"];

/**
 * Dot ↔ labelled pill (Plan 3.3 "Status live/stale/fallback/offline"). The size change is ONE layout
 * spring (`spring.pill`, 0.42 s response) – interruptible, retargets with velocity, no width tween.
 * Tone changes crossfade four pre-rendered layers (`tween.crossfade`); the label wipes in with
 * `tween.fade` and out with `tween.exit` (`AnimatePresence mode="popLayout"`).
 */
export function StatusPill({ tone, label, expanded, ring, spinning, feed, className, title }: StatusPillProps) {
  const hasRing = ring != null;
  return (
    <motion.div
      layout
      layoutId={feed ? `status-${feed}` : undefined}
      transition={{ layout: spring.pill }}
      style={{ borderRadius: radius.pill }}
      title={title}
      role="status"
      className={cn(
        "relative inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap",
        expanded ? "h-7 gap-1.5 pl-2.5 pr-3 text-[11px] font-semibold" : hasRing ? "size-3.5" : "size-1.5",
        TONE_TEXT[tone],
        className,
      )}
    >
      {TONES.map((t) => (
        <motion.span
          key={t}
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0 rounded-[inherit] border", TONE_LAYER[t])}
          initial={false}
          animate={{ opacity: expanded && t === tone ? 1 : 0 }}
          transition={tween.crossfade}
        />
      ))}
      <motion.span layout className={cn("relative grid shrink-0 place-items-center", hasRing ? "size-3.5" : "size-1.5")} aria-hidden="true">
        {hasRing ? (
          <LiveRingGlyph progress={ring} className={cn("size-3.5", TONE_STROKE[tone], spinning && "animate-spin")} />
        ) : (
          TONES.map((t) => (
            <motion.span
              key={t}
              className={cn("absolute inset-0 rounded-full", TONE_DOT[t])}
              initial={false}
              animate={{ opacity: t === tone ? 1 : 0 }}
              transition={tween.crossfade}
            />
          ))
        )}
      </motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        {expanded && label != null && (
          <motion.span
            key="label"
            layout="position"
            className="relative transition-colors duration-200"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: tween.fade }}
            exit={{ opacity: 0, y: -4, transition: tween.exit }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const RING_C = 2 * Math.PI * 6;

/** Two circles r 6 stroke 2, track `strokeOpacity .2`, `-rotate-90`, dashoffset transitions 1 s linear (CSS). */
function LiveRingGlyph({ progress, className }: { progress: number; className?: string }) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg viewBox="0 0 16 16" className={cn("-rotate-90", className)} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="8" cy="8" r="6" strokeOpacity="0.2" />
      <circle cx="8" cy="8" r="6" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - p)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear" }} />
    </svg>
  );
}
