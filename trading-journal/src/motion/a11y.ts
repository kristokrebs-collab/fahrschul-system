import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  // `closest` covers the element itself and inert wrappers (e.g. a sheet body still hidden during its open morph)
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]"));
}

/**
 * Elements that must stay live behind a dialog: the toast island and any other live region, plus the floating
 * layers of pulse selects / autocompletes (portalled to `<body>`, they belong to the field inside the dialog).
 */
export const INERT_EXEMPT_SELECTOR = "[aria-live],[data-toast-island],[data-pulse-select],[data-pulse-autocomplete]";

/**
 * Upper bound for the morph-aware deferrals: a dialog whose `settled` signal never arrives (no layout animation
 * ran, source gone) still inerts the page / releases it after this long – a little over the slowest morph spring.
 */
export const SETTLE_FALLBACK_MS = 700;

/**
 * Reference counts of the `inert` attributes set by dialog sessions. Two sessions can overlap (detail → editor
 * hand-off: the editor opens while the detail is still exiting); the element stays inert until the LAST session that
 * marked it releases it. Elements inert for other reasons (an exiting list row) are never touched.
 */
const inertRefs = new Map<HTMLElement, number>();

function acquireInert(el: HTMLElement): boolean {
  const n = inertRefs.get(el);
  if (n) {
    inertRefs.set(el, n + 1);
    return true;
  }
  if (el.hasAttribute("inert")) return false;
  el.setAttribute("inert", "");
  inertRefs.set(el, 1);
  return true;
}

function releaseInert(el: HTMLElement): void {
  const n = inertRefs.get(el);
  if (!n) return;
  if (n > 1) inertRefs.set(el, n - 1);
  else {
    inertRefs.delete(el);
    el.removeAttribute("inert");
  }
}

/**
 * Marks everything outside `el` as `inert` (siblings of every ancestor up to `<body>`); live regions are descended
 * into instead of inerted as a whole. Returns the undo.
 */
function inertOutside(el: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  const inertChildren = (parent: HTMLElement, skip: HTMLElement | null) => {
    for (const child of Array.from(parent.children)) {
      if (child === skip || !(child instanceof HTMLElement)) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      if (child.matches(INERT_EXEMPT_SELECTOR)) continue;
      if (child.querySelector(INERT_EXEMPT_SELECTOR)) {
        inertChildren(child, null);
        continue;
      }
      if (acquireInert(child)) touched.push(child);
    }
  };
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    inertChildren(parent, node);
    node = parent;
  }
  return () => {
    for (const t of touched) releaseInert(t);
  };
}

function trapTab(panel: HTMLElement): () => void {
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
  return () => document.removeEventListener("keydown", onKey);
}

interface ModalSession {
  panel: HTMLElement;
  /** Element focused before the dialog opened (focus returns here). */
  previous: HTMLElement | null;
  /** Focus target when `previous` is gone (removed, or inert while it exits) – e.g. the neighbour of a deleted row. */
  fallback?: () => HTMLElement | null;
  undoInert: (() => void) | null;
  closing: boolean;
  done: boolean;
}

interface ModalParts {
  focus: boolean;
  inert: boolean;
}

/** Lifts `inert` first, then returns focus – unless the user has meanwhile focused something outside the dialog. */
function endSession(s: ModalSession, parts: ModalParts, restoreFocus: boolean): void {
  if (s.done) return;
  s.done = true;
  s.undoInert?.();
  s.undoInert = null;
  if (!parts.focus || !restoreFocus) return;
  const prev = s.previous;
  const target = prev?.isConnected && !prev.closest("[inert]") ? prev : (s.fallback?.() ?? null);
  if (!target) return;
  const now = document.activeElement;
  const focusLost = !now || now === document.body || !now.isConnected || s.panel.contains(now);
  if (focusLost) target.focus?.({ preventScroll: true });
}

/**
 * The shared dialog session behind `useFocusTrap` / `useInertOutside` / `useDialogBehaviour`.
 *
 * Opening: focus moves into the panel at once (before any document-wide write, so it only lays out the new panel)
 * and Tab is trapped; marking the page `inert` – a style invalidation of the whole document – waits until
 * `settled` (the open morph has finished, bounded by `SETTLE_FALLBACK_MS`) so it never lands in the morph's first
 * frames. Closing: the trap is removed at once; lifting `inert` and restoring focus wait until `settled` again
 * (the exit / reverse morph has finished) and then run together, inert first. `settled` defaults to `true`,
 * which keeps everything immediate.
 */
function useModalSession(ref: RefObject<HTMLElement | null>, active: boolean, settled: boolean, parts: ModalParts, fallbackFocus?: () => HTMLElement | null): void {
  const session = useRef<ModalSession | null>(null);
  const { focus, inert } = parts;
  // latest fallback, read only when the session ends (never during render)
  const fallbackRef = useRef(fallbackFocus);
  useEffect(() => {
    fallbackRef.current = fallbackFocus;
  }, [fallbackFocus]);

  // open / close edges
  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    if (!panel) return;
    const prior = session.current;
    // re-opened before the previous close was released (or StrictMode's effect replay): keep its return target
    const carried = prior && !prior.done ? prior.previous : null;
    if (prior) endSession(prior, { focus, inert }, false);
    const s: ModalSession = {
      panel,
      previous: carried ?? (document.activeElement as HTMLElement | null),
      fallback: () => fallbackRef.current?.() ?? null,
      undoInert: null,
      closing: false,
      done: false,
    };
    session.current = s;
    let untrap: (() => void) | undefined;
    if (focus) {
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      if (!panel.contains(document.activeElement)) (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
      untrap = trapTab(panel);
    }
    return () => {
      untrap?.();
      s.closing = true;
    };
  }, [ref, active, focus, inert]);

  // settle-driven document-wide work (+ fallback when the signal never comes)
  useEffect(() => {
    const s = session.current;
    if (!s || s.done) return;
    const step = () => {
      if (s.done) return;
      if (s.closing) endSession(s, { focus, inert }, true);
      else if (inert && !s.undoInert) s.undoInert = inertOutside(s.panel);
    };
    if (settled) {
      step();
      return;
    }
    const t = setTimeout(step, SETTLE_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [active, settled, focus, inert]);

  // unmount: release whatever is still held
  useEffect(
    () => () => {
      const s = session.current;
      if (s) endSession(s, { focus, inert }, true);
    },
    [focus, inert],
  );
}

/**
 * Focus trap for portal-less dialogs (Plan 3.2 rule 12): moves focus into the panel on open,
 * cycles Tab/Shift+Tab inside it and restores the previously focused element on close
 * (after `settled`, see `useDialogBehaviour`).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, settled = true): void {
  useModalSession(ref, active, settled, { focus: true, inert: false });
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
 * Live regions (`[aria-live]`, `data-toast-island`) are exempt: a subtree that contains one is descended
 * into instead of being inerted as a whole, so toasts keep announcing while a sheet is open.
 * With `settled = false` the toggle waits for the morph (see `useDialogBehaviour`).
 */
export function useInertOutside(ref: RefObject<HTMLElement | null>, active: boolean, settled = true): void {
  useModalSession(ref, active, settled, { focus: false, inert: true });
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

export interface DialogBehaviourOptions {
  /**
   * Morph-aware timing. Pass `false` while the dialog's open morph or its exit / reverse morph is running and
   * `true` once it has finished: `inert` is applied after the open morph and lifted – together with the focus
   * return – after the close animation (each bounded by `SETTLE_FALLBACK_MS`). Omit for immediate behaviour.
   */
  settled?: boolean;
  /**
   * Where focus goes on close when the element that opened the dialog is gone (removed, or inert while it exits –
   * e.g. the row of a deleted trade). Called once, when the session ends; return `null` to leave focus alone.
   */
  fallbackFocus?: () => HTMLElement | null;
}

/** All dialog behaviours in one call (focus trap, scroll lock, inert siblings, Escape). */
export function useDialogBehaviour(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void, { settled = true, fallbackFocus }: DialogBehaviourOptions = {}): void {
  useModalSession(ref, active, settled, { focus: true, inert: true }, fallbackFocus);
  useScrollLock(active);
  useEscape(active, onClose);
}
