import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert"));
}

/**
 * Focus trap for portal-less dialogs (Plan 3.2 rule 12): moves focus into the panel on open,
 * cycles Tab/Shift+Tab inside it and restores the previously focused element on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = focusables(panel)[0] ?? panel;
    if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    first.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables(panel);
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const head = list[0] as HTMLElement;
      const tail = list[list.length - 1] as HTMLElement;
      const current = document.activeElement;
      if (e.shiftKey && (current === head || current === panel)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && current === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
}

/** Body scroll lock (Bundle `v2`/`Y$`: `overflow:hidden`), restored on close. Re-entrant across stacked dialogs. */
let lockCount = 0;
let savedOverflow = "";
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}

/**
 * Marks everything outside `ref` as `inert` (siblings of every ancestor up to `<body>`), so the
 * page behind a portal-less dialog is neither focusable nor read by screen readers.
 */
export function useInertOutside(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const touched: HTMLElement[] = [];
    let node: HTMLElement | null = el;
    while (node && node !== document.body && node.parentElement) {
      const parent: HTMLElement = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute("inert")) continue;
        if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
        sibling.setAttribute("inert", "");
        touched.push(sibling);
      }
      node = parent;
    }
    return () => {
      for (const s of touched) s.removeAttribute("inert");
    };
  }, [ref, active]);
}

/** Escape closes. */
export function useEscape(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

/** All dialog behaviours in one call (focus trap, scroll lock, inert siblings, Escape). */
export function useDialogBehaviour(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void): void {
  useScrollLock(active);
  useInertOutside(ref, active);
  useFocusTrap(ref, active);
  useEscape(active, onClose);
}
