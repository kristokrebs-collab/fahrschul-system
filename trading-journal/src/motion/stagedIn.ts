import { cssEasing } from "./replay";
import { ease, stagger } from "./tokens";

export interface StagedInOptions {
  /** s before the first piece starts (e.g. `stagger.lead`: the surface arrives first, then its content). Default 0. */
  delay?: number;
  /** s between two pieces. Default `stagger.reveal`. */
  step?: number;
  /** px each piece rises. Default 8. */
  rise?: number;
  /** s one piece takes. Default 0.42. */
  duration?: number;
  /** Pieces beyond this arrive with the last staged one (a long list never takes seconds). Default `stagger.max`. */
  max?: number;
}

/**
 * Pieces that build up one after another (Bewegungsprüfung Runde 14: empty states, the „Inhalt“ strip and the KPI tiles stood there
 * as one block while everything around them arrived in sequence). One native animation per piece – opacity and a short rise, ease-out,
 * `fill: backwards` (a piece is hidden only while it waits for its turn; afterwards it shows its own style again, so nothing can stay
 * invisible) – run by the compositor, no React state, no layout read.
 *
 * It animates the piece ITSELF, never a wrapper: a transformed ancestor becomes the containing block of what is inside it, and code
 * that reads `offsetTop` / `offsetLeft` of a child then measures from that ancestor (the sidebar marker of Runde 14).
 * A piece with `display: contents` has no box; its first child stands in for it.
 *
 * The caller decides WHEN (reduced motion, rich pages only …); without Web Animations (jsdom, very old browsers) nothing happens and
 * everything is simply there. Returns a function that cancels what is still running.
 */
export function stagedIn(pieces: Iterable<Element | null | undefined>, opts: StagedInOptions = {}): () => void {
  const { delay = 0, step = stagger.reveal, rise = 8, duration = 0.42, max = stagger.max } = opts;
  const runs: Animation[] = [];
  let i = 0;
  for (const piece of pieces) {
    if (!piece) continue;
    const el = boxOf(piece);
    if (!el || typeof el.animate !== "function") continue;
    const at = Math.min(i, max);
    i += 1;
    runs.push(
      el.animate(
        [
          { opacity: 0, transform: `translateY(${rise}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: duration * 1000, delay: (delay + at * step) * 1000, easing: cssEasing(ease.out), fill: "backwards" },
      ),
    );
  }
  return () => {
    for (const r of runs) r.cancel();
  };
}

/** The element that has a box: the piece, or the first child of a `display: contents` piece. */
function boxOf(piece: Element): Element | null {
  if (typeof getComputedStyle !== "function") return piece;
  return getComputedStyle(piece).display === "contents" ? piece.firstElementChild : piece;
}
