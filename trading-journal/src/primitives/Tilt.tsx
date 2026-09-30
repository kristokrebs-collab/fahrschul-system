import { frame, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface TiltProps {
  children: ReactNode;
  /** Max tilt in degrees (Bundle default 6, setup cards 4). */
  factor?: number;
  className?: string;
}

/** Bundle `m2`: 3D tilt (`rotateX/Y ±factor`, `transformPerspective 900`) on `spring.tilt`; mouse only, gated by reduced motion. */
export function Tilt({ children, factor = 6, className }: TiltProps) {
  const reduced = useReducedFx();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, spring.tilt);
  const sy = useSpring(py, spring.tilt);
  const rotateX = useTransform(sy, [0, 1], [factor, -factor]);
  const rotateY = useTransform(sx, [0, 1], [-factor, factor]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    frame.read(() => {
      const r = el.getBoundingClientRect();
      px.set((clientX - r.left) / r.width);
      py.set((clientY - r.top) / r.height);
    });
  };
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div className={cn("[transform-style:preserve-3d]", className)} style={{ rotateX, rotateY, transformPerspective: 900 }} onPointerMove={onPointerMove} onPointerLeave={reset}>
      {children}
    </motion.div>
  );
}
