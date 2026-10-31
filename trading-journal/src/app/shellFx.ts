/**
 * Shared helpers of the shell's richer motion (Runde 10): the sidebar's spring curve, the once-per-session stroke draw-in of the
 * icons, and a quiet "now and then" timer for the glints (centre button of the bottom bar, the local-mode badge).
 *
 * Everything here is cheap and finite: the springs are CSS `linear()` curves (no frame loop), the draw-in is a CSS animation on
 * `stroke-dashoffset` (the shapes carry `pathLength="1"`, set once), the timers sleep while the tab is hidden and stop after a
 * few rounds. Reduced motion: nothing starts (and `base.css` zeroes whatever a stylesheet would still play).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { springCurve } from "@/app/cssEasing";
import { storageKey } from "@/store/storage";

/** The sidebar's reveal: a spring that settles without overshoot (ζ ≈ 0.95), so the edge line never leaves the plate. */
export const SB_SPRING = { stiffness: 320, damping: 34, mass: 1 } as const;
const SB_CURVE = springCurve(SB_SPRING);
/** Written on the sidebar frame: `--sb-ms` / `--sb-ease` read by `shell-motion.css` (reveal, labels, group folds). */
export const SB_VARS = { "--sb-ms": `${SB_CURVE.ms}ms`, "--sb-ease": SB_CURVE.easing } as CSSProperties;

/** The finder's answers opening under the field: a slightly livelier spring (ζ ≈ 0.85), `--nf-ms` / `--nf-ease`. */
export const NF_SPRING = { stiffness: 300, damping: 30, mass: 1 } as const;
const NF_CURVE = springCurve(NF_SPRING);
export const NF_VARS = { "--nf-ms": `${NF_CURVE.ms}ms`, "--nf-ease": NF_CURVE.easing } as CSSProperties;

/* ------------------------------------------------------------------ stroke draw-in */

/** Session flag of the draw-in (its own key; share edition `tj2share-sb-draw`). */
export const DRAW_KEY: string = storageKey("sb-draw");
/** The draw-in lasts this long at most (19 rows · 46 ms + the last stroke's delay + 640 ms + the glint); the markers are removed after it. */
export const DRAW_MS = 2600;
/** A single icon redraw (bottom bar, on a tab switch). */
export const REDRAW_MS = 700;

const SHAPES = "path, circle, rect, line, polyline, ellipse";

/** Has the draw-in played in this session? A blocked storage reads as "yes" (it simply never plays). */
export function drawSeen(): boolean {
  try {
    return sessionStorage.getItem(DRAW_KEY) !== null;
  } catch {
    return true;
  }
}
export function markDrawSeen(): void {
  try {
    sessionStorage.setItem(DRAW_KEY, "1");
  } catch {
    /* private mode: it simply plays again next time */
  }
}

/** Gives every drawn shape under `root` the normalised length the CSS dash animation counts in. Idempotent. */
export function prepareStrokes(root: Element | null): void {
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll(SHAPES))) if (!el.hasAttribute("pathLength")) el.setAttribute("pathLength", "1");
}

/**
 * Replays the stroke draw on one element (an icon wrapper with the class `sb-ico`): sets `data-redraw` for `REDRAW_MS`.
 * Returns the cancel. Under reduced motion nothing starts.
 */
export function redrawStrokes(el: HTMLElement | null, reduced: boolean): () => void {
  if (!el || reduced) return () => {};
  prepareStrokes(el);
  el.removeAttribute("data-redraw");
  // one frame between remove and set, so the CSS animation restarts
  const raf = requestAnimationFrame(() => el.setAttribute("data-redraw", ""));
  const timer = window.setTimeout(() => el.removeAttribute("data-redraw"), REDRAW_MS + 80);
  return () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    el.removeAttribute("data-redraw");
  };
}

/* ------------------------------------------------------------------ now and then */

export interface IdleCycleOptions {
  /** the timer only runs while this is true */
  active: boolean;
  /** ms until the first round, then the gap between rounds */
  firstMs: number;
  everyMs: number;
  /** rounds per page load (the timer stops after them) */
  max: number;
}

/**
 * A counter that advances once per round: use it as a React `key` to restart a finite CSS animation. It waits while the tab is
 * hidden (no round is made up for), stops after `max` rounds and does nothing while inactive or under reduced motion.
 */
export function useIdleCycle({ active, firstMs, everyMs, max }: IdleCycleOptions, reduced: boolean): number {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active || reduced || round >= max) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(
        () => {
          // a hidden tab skips the round: it is tried again when the tab is back
          if (document.visibilityState !== "visible") return;
          setRound((n) => n + 1);
        },
        round === 0 ? firstMs : everyMs,
      );
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        arm();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, reduced, round, max, firstMs, everyMs]);
  return round;
}
