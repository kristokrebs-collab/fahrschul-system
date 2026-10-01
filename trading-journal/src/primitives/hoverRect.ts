import { useEffect, useState } from "react";

/**
 * Rect cache for pointer-tracking effects (Card spotlight, Magnetic, Tilt): measured once on `pointerenter`,
 * invalidated by scroll/resize while hovered and re-read lazily, so `pointermove` never forces a style/layout pass.
 */
export class HoverRectTracker {
  private el: Element | null = null;
  private rect: DOMRect | null = null;
  private onChange: (() => void) | null = null;
  private listening = false;

  private readonly invalidate = () => {
    this.rect = null;
    this.onChange?.();
  };

  /** Starts tracking `el` (call on `pointerenter`); `onChange` runs after a scroll/resize invalidated the rect. */
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
