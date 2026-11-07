import { useEffect, type RefObject } from "react";
import { observeInView } from "@/motion/inView";

/**
 * Pause gate of a decorative loop: toggles `data-idle` on `el` while `watch` (default: `el` itself) is off screen or the
 * tab is hidden. The loop's CSS says `[data-idle] … { animation-play-state: paused }`. One shared `IntersectionObserver`
 * (`observeInView`), no React state, no per-frame work. Without an observer (jsdom) the loop counts as visible.
 */
export function useIdleGate(el: RefObject<Element | null>, watch?: RefObject<Element | null>): void {
  useEffect(() => {
    const node = el.current;
    const target = watch?.current ?? node;
    if (!node || !target) return;
    let onScreen = true;
    let tabShown = typeof document === "undefined" || !document.hidden;
    const sync = (): void => {
      node.toggleAttribute("data-idle", !(onScreen && tabShown));
    };
    const stop = observeInView(target, (inView) => {
      onScreen = inView;
      sync();
    });
    const onVisibility = (): void => {
      tabShown = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    sync();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [el, watch]);
}
