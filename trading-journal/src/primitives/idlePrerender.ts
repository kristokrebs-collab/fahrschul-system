/**
 * First render of `content-visibility: auto` cells in idle time (perf-120 phase B).
 *
 * A deferred cell (`[content-visibility:auto]`, marked `data-defer`) is skipped by the browser until it nears the
 * viewport, and its FIRST style + layout + paint then lands inside a scroll frame (20–40 ms per cell on the desktop
 * probe, a multiple on the tablet; observers inside it – chart sizes, reveals – fire in that frame too).
 * `startIdlePrerender(root)` renders the cells once, one per idle period, top to bottom, after the page settled: the cell
 * is made `content-visibility: visible` for one frame and handed back to `auto` – it keeps its layout and its
 * remembered size, so scrolling to it later only paints, and while off screen it is skipped again.
 * - idle: `requestIdleCallback` with a timeout; without it (older engines) a short timer;
 * - never while the user scrolls (waits for `SCROLL_QUIET_MS` of quiet), never before `START_DELAY_MS` after start;
 * - returns `stop()` (call it when the page hides or unmounts; a later start continues with the cells left).
 */
export const START_DELAY_MS = 1500;
export const SCROLL_QUIET_MS = 400;
const IDLE_TIMEOUT_MS = 2000;
const FALLBACK_MS = 120;
export const DEFER_SELECTOR = "[data-defer]:not([data-prerendered])";

function onIdle(cb: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, FALLBACK_MS);
  return () => clearTimeout(id);
}

export function startIdlePrerender(root: HTMLElement): () => void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return () => undefined;
  let stopped = false;
  let cancel: (() => void) | null = null;
  let lastScroll = -Infinity;
  const onScroll = () => {
    lastScroll = performance.now();
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  const schedule = () => {
    if (!stopped) cancel = onIdle(step);
  };
  const step = () => {
    if (stopped) return;
    const quiet = performance.now() - lastScroll;
    if (quiet < SCROLL_QUIET_MS) {
      const t = setTimeout(schedule, SCROLL_QUIET_MS - quiet);
      cancel = () => clearTimeout(t);
      return;
    }
    const el = root.querySelector<HTMLElement>(DEFER_SELECTOR);
    if (!el) {
      stop();
      return;
    }
    el.dataset.prerendered = "";
    el.style.contentVisibility = "visible";
    let r2 = 0;
    // the frame after the next one: the cell has been rendered – back to `auto`, then the next cell
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        el.style.contentVisibility = "";
        schedule();
      });
    });
    cancel = () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      el.style.contentVisibility = "";
      delete el.dataset.prerendered;
    };
  };

  const t0 = setTimeout(schedule, START_DELAY_MS);
  cancel = () => clearTimeout(t0);

  function stop() {
    stopped = true;
    cancel?.();
    cancel = null;
    window.removeEventListener("scroll", onScroll);
  }
  return stop;
}
