import { animate } from "motion/react";
import { useCallback, useRef, type RefObject } from "react";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Horizontal shake keyframes for invalid input (px). */
export const SHAKE_X = [0, -6, 6, -4, 4, 0];
/** Invalid-border pulse: flash, dip, flash, fade (opacity of the pre-rendered `[data-input-pulse]` ring). */
export const PULSE_OPACITY = [0, 1, 0.3, 0.85, 0];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resolve(target: Element | string | null | undefined): Element | null {
  if (!target) return null;
  if (typeof target !== "string") return target;
  return typeof document === "undefined" ? null : document.getElementById(target);
}

/**
 * Error feedback for a form control: shakes its `Field` (the closest `[data-field]`, else the element itself) on
 * `tween.shake` and pulses the pre-rendered loss ring of every `Input` inside it (`tween.flash`). Accepts the
 * element or its id (`shakeField("s-makro")`); `self` shakes exactly that element. Reduced motion: no shake, a single
 * soft ring fade.
 */
export function shakeField(target: Element | string | null | undefined, opts: { reduced?: boolean; self?: boolean } = {}): void {
  const el = resolve(target);
  if (!el) return;
  const root = opts.self ? el : (el.closest("[data-field]") ?? el);
  const reduced = opts.reduced ?? prefersReducedMotion();
  const pulses = root.matches("[data-input-pulse]") ? [root] : Array.from(root.querySelectorAll("[data-input-pulse]"));
  // a lone Input (no Field around it) carries its own pulse next to the control
  if (pulses.length === 0) {
    const own = el.closest("[data-input]")?.querySelector("[data-input-pulse]");
    if (own) pulses.push(own);
  }
  for (const pulse of pulses) animate(pulse, { opacity: reduced ? [0.8, 0] : PULSE_OPACITY }, tween.flash);
  if (!reduced) animate(root, { x: SHAKE_X }, tween.shake);
}

/**
 * Imperative shake for any element: `const { ref, shake } = useShake<HTMLDivElement>(); <div ref={ref} />; shake()`.
 * Shakes exactly that element (pulsing any `Input` rings inside it) and respects reduced motion.
 */
export function useShake<T extends Element = HTMLElement>(): { ref: RefObject<T | null>; shake: () => void } {
  const ref = useRef<T>(null);
  const reduced = useReducedFx();
  const shake = useCallback(() => shakeField(ref.current, { reduced, self: true }), [reduced]);
  return { ref, shake };
}

/* ------------------------------------------------------------------ reveal an invalid control */

/**
 * Safety net for browsers without `scrollend`: a smooth `scrollIntoView` over a long form settles well within this.
 * Not an animation duration – only the latest moment the shake may wait for the scroll.
 */
export const SCROLL_SETTLE_MS = 650;

/** Top inset that the sticky app header covers when the page itself scrolls. */
const PAGE_TOP_INSET_PX = 72;

/** `true` when `rect` lies fully inside the visible band `[top, bottom]`. */
export function rectFullyVisible(rect: Pick<DOMRect, "top" | "bottom">, band: { top: number; bottom: number }): boolean {
  return rect.top >= band.top && rect.bottom <= band.bottom;
}

function scrollParent(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Validation feedback for one control (id or element): focus it without the browser's jump, bring it into view
 * (smooth, centred; instant under reduced motion) and shake + pulse its `Field` once it is actually on screen –
 * a shake that plays while the field is still scrolling in would never be seen. Works for the page and for a
 * scrolling sheet body alike.
 */
export function revealInvalid(target: string | HTMLElement | null | undefined, { reduced = false }: { reduced?: boolean } = {}): void {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return;
  el.focus({ preventScroll: true });
  const shake = () => shakeField(el, { reduced });
  if (typeof el.scrollIntoView !== "function") {
    shake();
    return;
  }
  const scroller = scrollParent(el);
  const band = scroller ? scroller.getBoundingClientRect() : { top: PAGE_TOP_INSET_PX, bottom: window.innerHeight };
  if (rectFullyVisible(el.getBoundingClientRect(), band)) {
    shake();
    return;
  }
  el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  if (reduced) {
    shake();
    return;
  }
  const source: HTMLElement | Window = scroller ?? window;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    source.removeEventListener("scrollend", finish);
    shake();
  };
  const timer = setTimeout(finish, SCROLL_SETTLE_MS);
  source.addEventListener("scrollend", finish, { once: true });
}
