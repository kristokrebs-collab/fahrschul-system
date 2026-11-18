/**
 * Shared scroll gate: hover machinery stays quiet while content scrolls under a resting pointer.
 *
 * Chrome fires `pointerenter` / `mouseenter` / `pointerover` (but no `pointermove`) for every element that scrolls
 * under a static pointer. Without a gate each of those re-measured rects, re-rendered hover pills and ran layout
 * projections on every row passing by. One passive capture `scroll` listener on `window` (so inner scrollers count
 * too) flips `isScrolling()` to `true` and clears it `dwell.scrollSettle` after the last scroll event, then runs the
 * `onScrollEnd` callbacks. Hover handlers return early while scrolling; their `mousemove` / `pointermove` twins
 * self-heal on the first real move afterwards.
 *
 * The listener is attached when this module is first imported, so it runs before the capture listeners of modules
 * that import it (e.g. `glowField`), which can therefore read the current state inside their own scroll handlers.
 */
import { dwell } from "@/motion/tokens";

let scrolling = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const endListeners = new Set<() => void>();

function settle(): void {
  timer = null;
  scrolling = false;
  for (const cb of [...endListeners]) cb();
}

function onScroll(): void {
  scrolling = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(settle, dwell.scrollSettle * 1000);
}

if (typeof window !== "undefined") window.addEventListener("scroll", onScroll, { passive: true, capture: true });

/** `true` from a scroll event until `dwell.scrollSettle` after the last one. */
export function isScrolling(): boolean {
  return scrolling;
}

/** Runs `cb` each time scrolling settles. Returns the unsubscribe. */
export function onScrollEnd(cb: () => void): () => void {
  endListeners.add(cb);
  return () => {
    endListeners.delete(cb);
  };
}
