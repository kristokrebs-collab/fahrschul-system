import { animate, motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef } from "react";
import { isScrolling } from "@/motion/scrollGate";
import { spring, tween } from "@/motion/tokens";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { useHoverRect } from "@/primitives/hoverRect";
import { useIdleGate } from "./idle";
import "./rich.css";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";
/** Edge of the pointer spotlight (px) – `rich.css` `.rich-aura__spot`. */
const SPOT = 360;

export interface PageAuraProps {
  /** A word set huge and outlined behind the header (wide screens only, 7 % ink): atmosphere, never information. */
  ghost?: string;
}

/**
 * Atmosphere behind a page header (rich pages only, mounted lazily by `PageHeader`): two soft light spots that drift
 * very slowly (CSS, transform only), a spotlight that follows a mouse over the header (MotionValues – no React render
 * per move; the rect is measured on enter and after scroll/resize only) and, where there is room, a ghost word.
 * The drift pauses while the header is off screen or the tab is hidden (`useIdleGate`); touch devices get no
 * spotlight; the parent decides about reduced motion (it does not mount this).
 */
export default function PageAura({ ghost }: PageAuraProps) {
  const root = useRef<HTMLDivElement>(null);
  const fine = useMediaQuery(FINE_POINTER, false);
  const hover = useHoverRect();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, spring.smooth);
  const sy = useSpring(py, spring.smooth);
  const glow = useMotionValue(0);
  useIdleGate(root);

  useEffect(() => {
    const host = root.current?.parentElement;
    if (!host || !fine) return;
    let on = false;
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse" || isScrolling()) return;
      const r = hover.tracks(host) ? hover.read() : hover.enter(host);
      if (!r) return;
      const x = e.clientX - r.left - SPOT / 2;
      const y = e.clientY - r.top - SPOT / 2;
      px.set(x);
      py.set(y);
      if (!on) {
        // waking from dark: appear under the pointer instead of gliding in from the corner
        on = true;
        sx.jump(x);
        sy.jump(y);
        animate(glow, 1, tween.fade);
      }
    };
    const onLeave = (): void => {
      hover.leave();
      if (!on) return;
      on = false;
      animate(glow, 0, tween.fade);
    };
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      hover.leave();
    };
  }, [fine, hover, px, py, sx, sy, glow]);

  return (
    <div ref={root} aria-hidden="true" className="rich-aura" data-testid="rich-aura">
      <span className="rich-aura__a" />
      <span className="rich-aura__b" />
      {fine && <motion.span className="rich-aura__spot" style={{ x: sx, y: sy, opacity: glow }} />}
      {ghost && <span className="rich-aura__ghost" data-ghost={ghost} />}
    </div>
  );
}
