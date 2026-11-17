import { motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { mulberry32 } from "@/motion/Celebrate";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

const COLS = 12;
const ROWS = 6;

export interface PixelDissolveProps {
  /** Start dissolving. */
  active: boolean;
  /** Called once the surface is gone. */
  onDone?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Pixel dissolve for destructive endings (P09 account deletion; local stand-in for P01's `DissolveOut`): when
 * `active`, a 12 × 6 grid of page-coloured cells covers the surface in a seeded random order (opacity only,
 * `tween.reveal` each, spread over `tween.burst`) while the content sinks and fades (`tween.burst`). Decorative layer
 * `aria-hidden`; reduced motion: a plain fade.
 */
export function PixelDissolve({ active, onDone, children, className }: PixelDissolveProps) {
  const reduced = useReducedFx();
  const order = useMemo(() => {
    const rnd = mulberry32(7);
    return Array.from({ length: COLS * ROWS }, () => rnd());
  }, []);
  const span = tween.burst.duration;
  return (
    <div className={cn("relative", className)}>
      <motion.div
        initial={false}
        animate={active ? { opacity: 0, y: reduced ? 0 : 6 } : { opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
        transition={active ? { duration: span, ease: tween.burst.ease, delay: reduced ? 0 : span * 0.35 } : tween.fade}
        onAnimationComplete={() => {
          if (active) onDone?.();
        }}
      >
        {children}
      </motion.div>
      {active && !reduced && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid overflow-hidden rounded-[inherit]" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
          {order.map((v, i) => (
            <motion.span
              key={i}
              className={i % 7 === 0 ? "bg-signal/40" : "bg-ink-900"}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, i % 7 === 0 ? 0 : 1] }}
              transition={{ ...tween.reveal, delay: v * span * 0.8 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
