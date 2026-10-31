import { useMotionValue, useSpring, type MotionStyle } from "motion/react";
import { useEffect, useRef, type PointerEvent } from "react";
import { isScrolling } from "@/motion/scrollGate";
import { spring } from "@/motion/tokens";
import { useHoverRect } from "@/primitives/hoverRect";

/** Perspective (px) while a tile is tilted. */
const PERSPECTIVE = 900;

export interface HoverTilt {
  /** `rotateX` / `rotateY` / `transformPerspective` MotionValues for a `motion.*` element. */
  style: Pick<MotionStyle, "rotateX" | "rotateY" | "transformPerspective">;
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

/**
 * Very light 3D tilt of a tile toward a MOUSE pointer (rich pages): `rotateX/Y ±deg` on `spring.tilt`, perspective only
 * while the pointer is on the tile – at rest the tile has `transform: none` again (no containing block, no permanent
 * compositor layer, which `primitives/Tilt` keeps). The rect is read on enter and after scroll/resize, never per move.
 * `enabled = false` (touch, reduced motion, a page that is not rich) returns inert handlers.
 */
export function useHoverTilt(deg: number, enabled: boolean): HoverTilt {
  const hoverRect = useHoverRect();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, spring.tilt);
  const sry = useSpring(ry, spring.tilt);
  const persp = useMotionValue(0);
  const hovering = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const settle = (): void => {
      if (!hovering.current && Math.abs(srx.get()) < 0.02 && Math.abs(sry.get()) < 0.02) persp.set(0);
    };
    const offs = [srx.on("change", settle), sry.on("change", settle)];
    return () => offs.forEach((off) => off());
  }, [enabled, srx, sry, persp]);

  const aim = (e: PointerEvent<HTMLElement>, rect: DOMRect): void => {
    if (rect.width === 0 || rect.height === 0) return;
    const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) - 0.5;
    const v = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) - 0.5;
    ry.set(u * 2 * deg);
    rx.set(-v * 2 * deg);
  };
  return {
    style: { rotateX: srx, rotateY: sry, transformPerspective: persp },
    onPointerEnter: (e) => {
      // a tile scrolling under a resting pointer: no rect read now, the first real move measures
      if (!enabled || e.pointerType !== "mouse" || isScrolling()) return;
      hovering.current = true;
      persp.set(PERSPECTIVE);
      aim(e, hoverRect.enter(e.currentTarget));
    },
    onPointerMove: (e) => {
      if (!enabled || e.pointerType !== "mouse" || isScrolling()) return;
      if (!hovering.current) {
        hovering.current = true;
        persp.set(PERSPECTIVE);
      }
      const r = hoverRect.tracks(e.currentTarget) ? hoverRect.read() : hoverRect.enter(e.currentTarget);
      if (r) aim(e, r);
    },
    onPointerLeave: () => {
      hoverRect.leave();
      if (!enabled) return;
      hovering.current = false;
      rx.set(0);
      ry.set(0);
    },
  };
}
