/**
 * Bringing a place of a page to the eye: wait until the (possibly lazy) page layer shows it, scroll it under the header
 * and sweep once across its card. Used by the global search (settings sections, setup cards) and by the function
 * register (`featureOpen.ts`). Moved out of `search/actions.ts` unchanged so that the register does not pull the search
 * actions (and everything they open) with it; `actions.ts` re-exports both.
 */
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { tween } from "@/motion/tokens";

/** Polls (rAF, ≤ `maxMs`, default 2.5 s) until `find` returns an element of the current page layer, then runs `then`. */
export function whenShown(page: string, find: (layer: Element) => HTMLElement | null, then: (el: HTMLElement) => void, onMiss?: () => void, maxMs = 2500): void {
  if (typeof document === "undefined") return;
  const deadline = performance.now() + maxMs;
  const tick = () => {
    const layer = document.querySelector(`[data-page="${page}"][data-page-role="current"]`) ?? (document.querySelector("[data-page]") ? null : document.body);
    const el = layer ? find(layer) : null;
    if (el) {
      then(el);
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(tick);
    else onMiss?.();
  };
  requestAnimationFrame(tick);
}

/** Scrolls `el` under the header and runs one signal sweep across its card (decorative, removed after). */
export function revealCard(el: HTMLElement): void {
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  const card = el.closest<HTMLElement>(".rounded-2xl, [class*='rounded-[']") ?? el;
  if (reduced || typeof card.animate !== "function") return;
  const sweep = document.createElement("span");
  sweep.setAttribute("aria-hidden", "true");
  Object.assign(sweep.style, {
    position: "absolute",
    inset: "0",
    zIndex: "30",
    pointerEvents: "none",
    borderRadius: "inherit",
    background: "linear-gradient(100deg, transparent 35%, color-mix(in srgb, var(--color-signal) 18%, transparent) 50%, transparent 65%)",
    transform: "translateX(-100%)",
  } satisfies Partial<CSSStyleDeclaration>);
  if (getComputedStyle(card).position === "static") card.style.position = "relative";
  card.appendChild(sweep);
  const a = sweep.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }], { duration: tween.sweep.duration * 1000, delay: 250, easing: "cubic-bezier(0.22,1,0.36,1)", fill: "forwards" });
  a.onfinish = () => sweep.remove();
  a.oncancel = () => sweep.remove();
}
