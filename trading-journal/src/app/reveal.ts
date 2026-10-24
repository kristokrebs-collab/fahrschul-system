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

/** After a jump the target is looked at again at these moments (ms): a smooth scroll is over by the first. */
const REALIGN_AT = [800, 1600, 2600] as const;
/** Further than this from its line (px) the target is brought back. */
const REALIGN_TOLERANCE = 24;

/**
 * Content above a target may still arrive after the jump (a lazy card swaps its skeleton for the card, an image loads): the
 * target then sits lower than the line it was scrolled to. For a few seconds it is brought back to that line – never against
 * the person: any wheel, touch, key or press ends this at once.
 */
export function keepAligned(el: HTMLElement): void {
  if (typeof window === "undefined" || typeof window.scrollBy !== "function") return;
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stop = (): void => {
    timers.forEach(clearTimeout);
    events.forEach((e) => window.removeEventListener(e, stop));
  };
  const line = (): number => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  for (const ms of REALIGN_AT) {
    timers.push(
      setTimeout(() => {
        if (!el.isConnected) return stop();
        const d = el.getBoundingClientRect().top - line();
        if (Math.abs(d) > REALIGN_TOLERANCE) window.scrollBy({ top: d, behavior: "instant" });
      }, ms),
    );
  }
  timers.push(setTimeout(stop, REALIGN_AT[REALIGN_AT.length - 1]! + 100));
  events.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }));
}

/**
 * The start of a section (`data-section`, the title row of a long page): scrolls it under the header – and under the section
 * navigation (`scroll-padding-top`, base.css) – and lets the title answer once with a short lift and fade. Opacity and
 * transform only; with reduced motion it just jumps there.
 */
export function revealSection(el: HTMLElement): void {
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  keepAligned(el);
  if (reduced || typeof el.animate !== "function") return;
  el.animate([{ opacity: 0.3, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: tween.reveal.duration * 1000, delay: 250, easing: "cubic-bezier(0.22,1,0.36,1)" });
}

/** A card is swept only when it is a card: not a whole page and not something taller than a screen and a half. */
const SWEEP_MAX_VIEWPORTS = 1.5;

/** Scrolls `el` under the header and runs one signal sweep across its card (decorative, removed after). */
export function revealCard(el: HTMLElement): void {
  if (el.hasAttribute("data-section")) return revealSection(el);
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  keepAligned(el);
  const card = el.closest<HTMLElement>(".rounded-2xl, [class*='rounded-[']") ?? el;
  if (reduced || typeof card.animate !== "function") return;
  if (card.getBoundingClientRect().height > window.innerHeight * SWEEP_MAX_VIEWPORTS) return;
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
