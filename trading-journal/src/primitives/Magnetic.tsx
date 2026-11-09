import { frame, motion, useMotionValue, useSpring } from "motion/react";
import { useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { isScrolling } from "@/motion/scrollGate";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";

export interface MagneticProps {
  children: ReactNode;
  /** Pull strength (Bundle default .35, dock icons .5). */
  intensity?: number;
  /** Radius in px within which the pull applies (Bundle 90, dock 60). */
  range?: number;
  /**
   * Re-measure on every move (batched in `frame.read`) instead of once per hover – for hosts whose layout changes
   * under the pointer, e.g. the magnifying dock.
   */
  remeasure?: boolean;
  className?: string;
}

/**
 * Bundle `Zw`: element follows the mouse on `spring.magnet`; mouse pointers only, off under reduced motion.
 * The resting rect is measured once per hover (minus the current pull, so the magnet never chases its own offset)
 * and only re-read after scroll/resize – `pointermove` itself never touches layout (unless `remeasure`).
 */
export function Magnetic({ children, intensity = 0.35, range = 90, remeasure = false, className }: MagneticProps) {
  const reduced = useReducedFx();
  const hoverRect = useHoverRect();
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, spring.magnet);
  const y = useSpring(ty, spring.magnet);

  // resting centre of the element (measured rect minus the pull it had at that moment); null = re-measure
  const rest = useRef<{ cx: number; cy: number } | null>(null);
  const measure = (r: DOMRect) => {
    rest.current = { cx: r.left + r.width / 2 - x.get(), cy: r.top + r.height / 2 - y.get() };
  };
  const invalidate = () => {
    rest.current = null;
  };

  const onPointerEnter = (e: PointerEvent<HTMLSpanElement>) => {
    // scrolling under a resting pointer: no rect read now, the first real move measures (`onPointerMove`)
    if (reduced || e.pointerType !== "mouse" || isScrolling()) return;
    measure(hoverRect.enter(e.currentTarget, invalidate));
  };
  const apply = (clientX: number, clientY: number) => {
    const c = rest.current;
    if (!c) return;
    const dx = clientX - c.cx;
    const dy = clientY - c.cy;
    const k = Math.max(0, 1 - Math.hypot(dx, dy) / range);
    tx.set(dx * intensity * k);
    ty.set(dy * intensity * k);
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    if (remeasure) {
      frame.read(() => {
        measure(el.getBoundingClientRect());
        apply(clientX, clientY);
      });
      return;
    }
    if (!rest.current) {
      const r = hoverRect.tracks(el) ? hoverRect.read() : hoverRect.enter(el, invalidate);
      if (r) measure(r);
    }
    apply(clientX, clientY);
  };
  const onPointerLeave = () => {
    hoverRect.leave();
    rest.current = null;
    tx.set(0);
    ty.set(0);
  };

  return (
    <motion.span className={cn("inline-flex", className)} style={{ x, y }} onPointerEnter={onPointerEnter} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      {children}
    </motion.span>
  );
}
