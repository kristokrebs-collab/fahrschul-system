import { useEffect, useState } from "react";
// imported first: its capture scroll listener is attached before ours, so `isScrolling()` is current in `invalidate`
import { isScrolling, onScrollEnd } from "@/motion/scrollGate";

/**
 * Rect cache for pointer-tracking effects (Card spotlight, Magnetic, Tilt): measured once on `pointerenter`,
 * invalidated by scroll/resize while hovered and re-read lazily, so `pointermove` never forces a style/layout pass.
 * While content scrolls under a resting pointer the rect is only dropped and `onChange` runs once the scroll has
 * settled (scroll gate): a re-read per scroll event forced a style + layout per event whenever the page was dirty.
 * Callers skip `enter` while `isScrolling()` (a `pointerenter` of an element scrolling under the pointer) and enter on
 * the first real move instead.
 */
export class HoverRectTracker {
  private el: Element | null = null;
  private rect: DOMRect | null = null;
  private onChange: (() => void) | null = null;
  private listening = false;
  private offScrollEnd: (() => void) | null = null;

  private readonly invalidate = () => {
    this.rect = null;
    if (!this.onChange) return;
    if (isScrolling()) {
      this.offScrollEnd ??= onScrollEnd(this.settled);
      return;
    }
    this.onChange();
  };

  private readonly settled = () => {
    this.offScrollEnd?.();
    this.offScrollEnd = null;
    this.onChange?.();
  };

  /** Starts tracking `el` (call on `pointerenter`); `onChange` runs after a resize, or once a scroll settled. */
  enter(el: Element, onChange?: () => void): DOMRect {
    this.el = el;
    this.onChange = onChange ?? null;
    this.rect = el.getBoundingClientRect();
    if (!this.listening && typeof window !== "undefined") {
      window.addEventListener("scroll", this.invalidate, { passive: true, capture: true });
      window.addEventListener("resize", this.invalidate, { passive: true });
      this.listening = true;
    }
    return this.rect;
  }

  /** The cached rect, re-measured only after an invalidation; `null` while not tracking. */
  read(): DOMRect | null {
    if (!this.rect && this.el) this.rect = this.el.getBoundingClientRect();
    return this.rect;
  }

  /** Whether `enter` ran for `el` and `leave` has not. */
  tracks(el: Element): boolean {
    return this.el === el;
  }

  leave(): void {
    if (this.listening) {
      window.removeEventListener("scroll", this.invalidate, { capture: true });
      window.removeEventListener("resize", this.invalidate);
      this.listening = false;
    }
    this.offScrollEnd?.();
    this.offScrollEnd = null;
    this.el = null;
    this.rect = null;
    this.onChange = null;
  }
}

/** One `HoverRectTracker` per component instance, released on unmount. */
export function useHoverRect(): HoverRectTracker {
  const [tracker] = useState(() => new HoverRectTracker());
  useEffect(() => () => tracker.leave(), [tracker]);
  return tracker;
}
