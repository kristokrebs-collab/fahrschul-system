import { frame, motion, useMotionValue, useSpring } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface MagneticProps {
  children: ReactNode;
  /** Pull strength (Bundle default .35, dock icons .5). */
  intensity?: number;
  /** Radius in px within which the pull applies (Bundle 90, dock 60). */
  range?: number;
  className?: string;
}

/** Bundle `Zw`: element follows the mouse on `spring.magnet`; mouse pointers only, off under reduced motion. */
export function Magnetic({ children, intensity = 0.35, range = 90, className }: MagneticProps) {
  const reduced = useReducedFx();
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, spring.magnet);
  const y = useSpring(ty, spring.magnet);

  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    frame.read(() => {
      const r = el.getBoundingClientRect();
      const dx = clientX - (r.left + r.width / 2);
      const dy = clientY - (r.top + r.height / 2);
      const k = Math.max(0, 1 - Math.hypot(dx, dy) / range);
      tx.set(dx * intensity * k);
      ty.set(dy * intensity * k);
    });
  };
  const reset = () => {
    tx.set(0);
    ty.set(0);
  };

  return (
    <motion.span className={cn("inline-flex", className)} style={{ x, y }} onPointerMove={onPointerMove} onPointerLeave={reset}>
      {children}
    </motion.span>
  );
}
