/**
 * The narrow sidebar's "peek": the rail opens over the page (an overlay, the page keeps its width) while the pointer rests on it,
 * while keyboard focus is inside it, or after a touch (the foot button, or a long press on a row). It closes again without a
 * hurry, so a pointer that slips off the edge for a moment does not shut it:
 *   - hover opens after `OPEN_MS` (a pointer that only crosses the rail does not open it), closes after `CLOSE_MS`;
 *   - keyboard focus (`:focus-visible`) opens at once and closes when focus leaves the sidebar;
 *   - touch opens it and holds it open until a tap outside, Escape or a page switch – a finger that lifts does not close it;
 *   - Escape closes it for good until the pointer or focus comes back.
 * The hook only decides; `Sidebar.tsx` writes `data-open` / `data-peek` and the CSS does the moving.
 */
import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";

export const PEEK = { openMs: 120, closeMs: 340, longPressMs: 450, moveSlop: 10 } as const;

export interface PeekFlags {
  hover: boolean;
  focus: boolean;
  held: boolean;
  dismissed: boolean;
}

/** Pure: is the rail open? Dismissed (Escape) beats everything until a new pointer / focus entry clears it. */
export function peekOpen(f: PeekFlags, enabled: boolean): boolean {
  return enabled && !f.dismissed && (f.hover || f.focus || f.held);
}

const REST: PeekFlags = { hover: false, focus: false, held: false, dismissed: false };

function focusVisible(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    // no `:focus-visible` (old engines, jsdom): any focus that arrives through the keyboard-less path counts
    return true;
  }
}

export interface SidebarPeek {
  open: boolean;
  /** props for the `<aside>` */
  bind: {
    onPointerEnter: (e: PointerEvent) => void;
    onPointerLeave: (e: PointerEvent) => void;
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onFocusCapture: (e: FocusEvent) => void;
    onBlurCapture: (e: FocusEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  };
  /** touch: open and hold (the foot button) */
  hold: () => void;
  /** true once for the click that ends a long press (the row must not navigate); reading it clears it */
  takeLongPress: () => boolean;
}

export function useSidebarPeek(enabled: boolean, canHover: boolean, page: string): SidebarPeek {
  const [flags, setFlags] = useState<PeekFlags>(REST);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout>; press?: ReturnType<typeof setTimeout> }>({});
  const press = useRef<{ x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const swallow = useRef(false);
  const set = useCallback((patch: Partial<PeekFlags>) => setFlags((f) => ({ ...f, ...patch })), []);
  const clear = useCallback((which: "open" | "close" | "press") => {
    const t = timers.current[which];
    if (t) clearTimeout(t);
    timers.current[which] = undefined;
  }, []);

  // pinned open (or gone): nothing to peek at; a page switch lets go of a touch hold (state from props, no effect)
  const [seen, setSeen] = useState({ enabled, page });
  if (seen.enabled !== enabled || seen.page !== page) {
    setSeen({ enabled, page });
    setFlags((f) => (!enabled ? REST : f.held ? { ...f, held: false } : f));
  }
  useEffect(
    () => () => {
      for (const k of ["open", "close", "press"] as const) {
        const t = timers.current[k];
        if (t) clearTimeout(t);
      }
    },
    [],
  );

  // a held (touch) peek ends with a tap outside the sidebar
  useEffect(() => {
    if (!flags.held) return;
    const onDown = (e: Event) => {
      const aside = document.querySelector('[data-layer="Seitenleiste"]');
      if (aside && e.target instanceof Node && aside.contains(e.target)) return;
      set({ held: false });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [flags.held, set]);

  const hold = useCallback(() => set({ held: true, dismissed: false }), [set]);

  const bind: SidebarPeek["bind"] = {
    onPointerEnter: (e) => {
      if (!enabled || !canHover || e.pointerType === "touch") return;
      clear("close");
      clear("open");
      timers.current.open = setTimeout(() => set({ hover: true, dismissed: false }), PEEK.openMs);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === "touch") return;
      clear("open");
      clear("close");
      // leaving also re-arms a dismissed (Escape) peek for the next visit
      timers.current.close = setTimeout(() => set({ hover: false, dismissed: false }), PEEK.closeMs);
    },
    onPointerDown: (e) => {
      swallow.current = false;
      if (!enabled || e.pointerType === "mouse") return;
      press.current = { x: e.clientX, y: e.clientY, fired: false };
      clear("press");
      timers.current.press = setTimeout(() => {
        timers.current.press = undefined;
        press.current.fired = true;
        swallow.current = true;
        set({ held: true, dismissed: false });
      }, PEEK.longPressMs);
    },
    onPointerMove: (e) => {
      if (!timers.current.press) return;
      if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > PEEK.moveSlop) clear("press");
    },
    onPointerUp: () => clear("press"),
    onPointerCancel: () => clear("press"),
    onFocusCapture: (e) => {
      if (!enabled || !focusVisible(e.target)) return;
      clear("close");
      set({ focus: true, dismissed: false });
    },
    onBlurCapture: (e) => {
      const next = e.relatedTarget;
      if (next instanceof Node && e.currentTarget.contains(next)) return;
      set({ focus: false });
    },
    onKeyDown: (e) => {
      if (e.key !== "Escape" || !peekOpen(flags, enabled)) return;
      set({ hover: false, focus: false, held: false, dismissed: true });
    },
  };

  const takeLongPress = useCallback(() => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  }, []);

  return { open: peekOpen(flags, enabled), bind, hold, takeLongPress };
}
