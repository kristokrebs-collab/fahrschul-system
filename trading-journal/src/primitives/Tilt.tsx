import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";

export interface TiltProps {
  children: ReactNode;
  /** Max tilt in degrees (Bundle default 6, setup cards 4). */
  factor?: number;
  className?: string;
}

/**
 * Bundle `m2`: 3D tilt (`rotateX/Y ±factor`, `transformPerspective 900`) on `spring.tilt`; mouse only, gated by
 * reduced motion. The rect is measured on `pointerenter` (before the tilt skews its projection) and after
 * scroll/resize only, so moving the pointer never forces a layout.
 */
export function Tilt({ children, factor = 6, className }: TiltProps) {
  const reduced = useReducedFx();
  const hoverRect = useHoverRect();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, spring.tilt);
  const sy = useSpring(py, spring.tilt);
  const rotateX = useTransform(sy, [0, 1], [factor, -factor]);
  const rotateY = useTransform(sx, [0, 1], [-factor, factor]);

  const onPointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    hoverRect.enter(e.currentTarget);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = hoverRect.tracks(e.currentTarget) ? hoverRect.read() : hoverRect.enter(e.currentTarget);
    if (!r || r.width === 0 || r.height === 0) return;
    px.set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    py.set(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  const onPointerLeave = () => {
    hoverRect.leave();
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div
      className={cn("[transform-style:preserve-3d]", className)}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </motion.div>
  );
}
