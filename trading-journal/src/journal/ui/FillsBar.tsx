import { AnimatePresence, motion } from "motion/react";
import type { FillStats } from "@/domain/fills";
import { positionSlices } from "@/domain/fills";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

const TONE: Record<"win" | "loss" | "be" | "open", string> = {
  win: "bg-win/85",
  loss: "bg-loss/85",
  be: "bg-mute/70",
  open: "bg-white/[0.14]",
};

/**
 * The position as one bar (Journal v3): every partial / final exit is a slice cut from the left, tinted by its P&L, the
 * rest stays open (hatched). A new exit slides its slice in while the remainder shrinks – `layout` on `spring.layout`
 * (every node sets `borderRadius`), new slices pop from `scaleX 0`. Decorative (`aria-hidden`); the numbers are in text
 * next to it.
 */
export function FillsBar({ stats, className }: { stats: FillStats; className?: string }) {
  const reduced = useReducedFx();
  const slices = positionSlices(stats);
  if (!slices.length) return null;
  return (
    <div aria-hidden="true" className={cn("flex h-2.5 w-full gap-[3px] overflow-hidden", className)}>
      <AnimatePresence initial={false}>
        {slices.map((s) => (
          <motion.span
            key={s.id}
            layout
            className={cn("relative h-full min-w-[3px] overflow-hidden", TONE[s.tone])}
            style={{ flexGrow: Math.max(0.0001, s.to - s.from), flexBasis: 0, borderRadius: radius.pill, transformOrigin: "left center" }}
            initial={reduced ? false : { opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={{ layout: spring.layout, scaleX: spring.enter, opacity: tween.fade }}
            title={s.label}
          >
            {s.tone === "open" && <span className="fx-ants absolute inset-0 opacity-60 [--fx-ants-color:rgb(var(--veil-rgb,255_255_255)/0.35)] before:[animation-play-state:paused]" />}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
