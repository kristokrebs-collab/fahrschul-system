import { animate } from "motion/react";
import { tween } from "@/motion/tokens";

export interface RippleGeometry {
  /** Top-left of the circle's box in the host's local px. */
  x: number;
  y: number;
  /** Diameter: large enough to cover the host's farthest corner from the origin. */
  size: number;
}

/** Circle centred on (`px`, `py`) that reaches the farthest corner of a `width × height` box. */
export function rippleGeometry(width: number, height: number, px: number, py: number): RippleGeometry {
  const r = Math.hypot(Math.max(px, width - px), Math.max(py, height - py));
  return { x: px - r, y: py - r, size: r * 2 };
}

/** Ripples kept alive per host; a fast double-press drops the oldest instead of stacking layers. */
export const MAX_RIPPLES = 3;

/**
 * Press ripple (21st.dev "Ripple / Sonar"): appends a PRE-RENDERED circle to `host` (an empty, overflow-hidden,
 * `aria-hidden` layer the caller renders) and grows it from the origin (`scale 0 → 1`) while it fades
 * (`tween.ripple`) – transform/opacity only, no React state. The circle removes itself when done.
 */
export function spawnRipple(host: HTMLElement, geo: RippleGeometry, color: string): void {
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "absolute",
    left: `${geo.x}px`,
    top: `${geo.y}px`,
    width: `${geo.size}px`,
    height: `${geo.size}px`,
    borderRadius: "9999px",
    background: color,
    pointerEvents: "none",
    transform: "scale(0)",
  });
  host.appendChild(dot);
  while (host.childElementCount > MAX_RIPPLES) host.firstElementChild?.remove();
  animate(dot, { scale: [0, 1], opacity: [1, 0.8, 0] }, tween.ripple).then(
    () => dot.remove(),
    () => dot.remove(),
  );
}
