import { isScrolling } from "@/motion/scrollGate";

/**
 * Fine magnet pull for large buttons (Runde 10, only inside `[data-rich]`, mouse only): while the pointer is over the
 * button it leans a few px towards it – at most `MAX_X` / `MAX_Y`, a tenth of the pointer's distance from the centre – and
 * springs back when the pointer leaves (CSS `transition: translate` with an overshoot curve, `controls.css`).
 *
 * Compositor only: the individual `translate` property (never `transform`, which the press spring owns). The rect is read
 * ONCE per hover (minus the lean it may still carry from the last hover), `pointermove` only writes one style per frame.
 * Nothing runs at rest: the listeners exist only while the pointer is over the button.
 */
export const MAGNET_PULL = 0.1;
export const MAGNET_MAX_X = 4;
export const MAGNET_MAX_Y = 3;

/** Pure: the lean for a pointer offset (px from the button's resting centre). */
export function magnetOffset(dx: number, dy: number): { x: number; y: number } {
  const c = (v: number, m: number) => Math.max(-m, Math.min(m, v * MAGNET_PULL));
  return { x: c(dx, MAGNET_MAX_X), y: c(dy, MAGNET_MAX_Y) };
}

function currentLean(el: HTMLElement): { x: number; y: number } {
  const t = getComputedStyle(el).translate;
  if (!t || t === "none") return { x: 0, y: 0 };
  const [x = 0, y = 0] = t.split(" ").map(parseFloat);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

const active = new WeakSet<HTMLElement>();

/**
 * Starts the pull for the pointer's current hover of `el`. Safe to call on every `pointerenter`: a second call while the
 * first hover is still tracked does nothing; a scroll under a resting pointer never starts it.
 */
export function attachMagnet(el: HTMLElement, clientX: number, clientY: number): void {
  if (active.has(el)) return;
  if (isScrolling()) {
    // the content scrolled under a resting pointer: the first real move after the scroll starts the pull instead
    el.addEventListener("pointermove", (e) => e.pointerType === "mouse" && attachMagnet(el, e.clientX, e.clientY), { once: true });
    return;
  }
  active.add(el);
  const lean = currentLean(el);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2 - lean.x;
  const cy = r.top + r.height / 2 - lean.y;
  let px = clientX;
  let py = clientY;
  let raf = 0;
  el.setAttribute("data-magnet", "");

  const apply = () => {
    raf = 0;
    const o = magnetOffset(px - cx, py - cy);
    el.style.translate = `${o.x.toFixed(1)}px ${o.y.toFixed(1)}px`;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", end);
    el.removeEventListener("pointercancel", end);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    el.style.translate = "";
    active.delete(el);
    // the spring-back keeps its transition until it has played
    setTimeout(() => {
      if (!active.has(el)) el.removeAttribute("data-magnet");
    }, 600);
  };
  el.addEventListener("pointermove", move, { passive: true });
  el.addEventListener("pointerleave", end);
  el.addEventListener("pointercancel", end);
  apply();
}
