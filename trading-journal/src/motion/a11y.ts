import { useCallback, useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { openBackEntry } from "@/store/backStack";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/**
 * Elements a user cannot reach right now: `inert` subtrees (a sheet body still hidden during its open morph, an exiting
 * row, a parked page) and everything behind an open modal dialog (`data-modal-behind`, see `isolateOutside`). Use it for
 * "is this a usable focus / glow target" checks instead of `[inert]` alone.
 */
export const UNREACHABLE_SELECTOR = "[inert],[data-modal-behind]";

function focusables(root: HTMLElement): HTMLElement[] {
  // `closest` covers the element itself and unreachable wrappers
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest(UNREACHABLE_SELECTOR));
}

/**
 * Elements that must stay live behind a dialog: the toast island and any other live region, plus the floating
 * layers of pulse selects / autocompletes (portalled to `<body>`, they belong to the field inside the dialog).
 * `aria-live="off"` is no live region (e.g. the candle chart's OHLC legend, `role=status` muted): it is hidden with
 * the page like everything else, never left readable beside the dialog.
 */
export const INERT_EXEMPT_SELECTOR = '[aria-live]:not([aria-live="off"]),[data-toast-island],[data-pulse-select],[data-pulse-autocomplete]';

/**
 * Upper bound for the morph-aware deferrals: a dialog whose `settled` signal never arrives (no layout animation
 * ran, source gone) still inerts the page / releases it after this long – a little over the slowest morph spring.
 */
export const SETTLE_FALLBACK_MS = 700;

/**
 * Content behind a modal dialog (perf-120 phase C). It is `aria-hidden` (screen readers stay in the dialog, which also
 * carries `aria-modal`) and marked `data-modal-behind` (visual consumers: cards behind a dialog stay dark), and it is
 * kept out of reach without `inert`:
 * - pointer input never gets there: every modal overlay is a fixed full-viewport layer above the page, dock and header;
 * - Tab / Shift+Tab are trapped in the panel (`trapTab`), and focus that still lands behind the dialog (Tab in from the
 *   browser UI, a programmatic focus) is sent back into the panel (`guardFocus`);
 * - `UNREACHABLE_SELECTOR` includes the marker, so focus-target checks treat it like inert content.
 * `inert` itself is inherited style: setting and lifting it restyled every element of the page behind (≈ 1 900 on the
 * Übersicht – 15–24 ms, forced by the focus return in the frame after a sheet closed; `flick/restyle.mjs`: inert
 * 10.9 ms vs aria-hidden / data attribute 0). Reference counts: two sessions can overlap (detail → editor hand-off: the
 * editor opens while the detail is still exiting); an element stays marked until the LAST session that marked it
 * releases it. Elements already `aria-hidden="true"` for other reasons (decoration, the intro cover) are never touched.
 */
const behindRefs = new Map<HTMLElement, { n: number; ariaHidden: string | null }>();

function acquireBehind(el: HTMLElement): boolean {
  const held = behindRefs.get(el);
  if (held) {
    held.n += 1;
    return true;
  }
  const ariaHidden = el.getAttribute("aria-hidden");
  if (ariaHidden === "true") return false;
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-modal-behind", "");
  behindRefs.set(el, { n: 1, ariaHidden });
  return true;
}

function releaseBehind(el: HTMLElement): void {
  const held = behindRefs.get(el);
  if (!held) return;
  if (held.n > 1) {
    held.n -= 1;
    return;
  }
  behindRefs.delete(el);
  el.removeAttribute("data-modal-behind");
  if (held.ariaHidden == null) el.removeAttribute("aria-hidden");
  else el.setAttribute("aria-hidden", held.ariaHidden);
}

/** Panels of the sessions whose outside is isolated, latest last: focus that lands behind goes to the latest one. */
const guardedPanels: HTMLElement[] = [];

function onGuardedFocus(e: FocusEvent): void {
  const target = e.target;
  if (!(target instanceof Element) || !target.closest("[data-modal-behind]")) return;
  const panel = guardedPanels[guardedPanels.length - 1];
  if (!panel || panel.contains(target)) return;
  (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
}

function guardFocus(panel: HTMLElement): () => void {
  if (guardedPanels.length === 0) document.addEventListener("focusin", onGuardedFocus, true);
  guardedPanels.push(panel);
  return () => {
    const i = guardedPanels.lastIndexOf(panel);
    if (i >= 0) guardedPanels.splice(i, 1);
    if (guardedPanels.length === 0) document.removeEventListener("focusin", onGuardedFocus, true);
  };
}

/** An isolated outside: `unguard` ends the focus guard alone (the dialog started to close), `release` undoes everything. */
interface Isolation {
  unguard: () => void;
  release: () => void;
}

/**
 * Isolates everything outside `el` (siblings of every ancestor up to `<body>`, see `acquireBehind`); live regions are
 * descended into instead of hidden as a whole.
 */
function isolateOutside(el: HTMLElement): Isolation {
  const touched: HTMLElement[] = [];
  const hideChildren = (parent: HTMLElement, skip: HTMLElement | null) => {
    for (const child of Array.from(parent.children)) {
      if (child === skip || !(child instanceof HTMLElement)) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      if (child.matches(INERT_EXEMPT_SELECTOR)) continue;
      if (child.querySelector(INERT_EXEMPT_SELECTOR)) {
        hideChildren(child, null);
        continue;
      }
      if (acquireBehind(child)) touched.push(child);
    }
  };
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    hideChildren(parent, node);
    node = parent;
  }
  let guard: (() => void) | null = guardFocus(el);
  const unguard = () => {
    guard?.();
    guard = null;
  };
  return {
    unguard,
    release: () => {
      unguard();
      for (const t of touched) releaseBehind(t);
    },
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
  isolation: Isolation | null;
  closing: boolean;
  done: boolean;
}

interface ModalParts {
  focus: boolean;
  inert: boolean;
}

/**
 * Sessions that have not ended yet (open, or closing until their exit settled). A dialog opened from inside a CLOSING
 * one – the detail's `Bearbeiten` hands off to the editor while the detail fades out – returns focus to where that one
 * was opened from (the trade row), not to its button, which is gone by the time the editor closes (focus fell to <body>).
 */
const liveSessions = new Set<ModalSession>();

/** The element focus returns to for a dialog opened while `opener` had focus (see `liveSessions`). */
function returnTargetFor(opener: HTMLElement | null): HTMLElement | null {
  if (!opener) return null;
  for (const o of liveSessions) if (o.closing && !o.done && o.panel.contains(opener)) return o.previous;
  return opener;
}

/** Releases the outside first, then returns focus – unless the user has meanwhile focused something outside the dialog. */
function endSession(s: ModalSession, parts: ModalParts, restoreFocus: boolean): void {
  if (s.done) return;
  s.done = true;
  liveSessions.delete(s);
  s.isolation?.release();
  s.isolation = null;
  if (!parts.focus || !restoreFocus) return;
  const prev = s.previous;
  const target = prev?.isConnected && !prev.closest(UNREACHABLE_SELECTOR) ? prev : (s.fallback?.() ?? null);
  if (!target) return;
  const now = document.activeElement;
  const focusLost = !now || now === document.body || !now.isConnected || s.panel.contains(now);
  if (focusLost) target.focus?.({ preventScroll: true });
}

/**
 * The shared dialog session behind `useFocusTrap` / `useInertOutside` / `useDialogBehaviour`.
 *
 * Opening: focus moves into the panel at once (before any document-wide write, so it only lays out the new panel)
 * and Tab is trapped; isolating the page (`isolateOutside`: aria-hidden + `data-modal-behind` + focus guard – no style
 * change) waits until `settled` (the open morph has finished, bounded by `SETTLE_FALLBACK_MS`), so the morph's frames
 * carry no document-wide work. Closing: the trap and the focus guard are removed at once; releasing the page and restoring focus wait until
 * `settled` again (the exit / reverse morph has finished) and then run together, release first. `settled` defaults to
 * `true`, which keeps everything immediate.
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
      previous: carried ?? returnTargetFor(document.activeElement as HTMLElement | null),
      fallback: () => fallbackRef.current?.() ?? null,
      isolation: null,
      closing: false,
      done: false,
    };
    session.current = s;
    liveSessions.add(s);
    let untrap: (() => void) | undefined;
    if (focus) {
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      if (!panel.contains(document.activeElement)) (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
      untrap = trapTab(panel);
    }
    return () => {
      untrap?.();
      s.closing = true;
      // closing: the page is the next thing the user touches – a tap into it during the exit (the navigation's 800 ms
      // wipe uncovers the page long before it is released) keeps its focus instead of being sent back into the leaving
      // panel and then to the opener (the first tap into a field was lost). The release itself still waits for `settled`.
      s.isolation?.unguard();
    };
  }, [ref, active, focus, inert]);

  // settle-driven document-wide work (+ fallback when the signal never comes)
  useEffect(() => {
    const s = session.current;
    if (!s || s.done) return;
    const step = () => {
      if (s.done) return;
      if (s.closing) endSession(s, { focus, inert }, true);
      else if (inert && !s.isolation) s.isolation = isolateOutside(s.panel);
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
 * Isolates everything outside `ref` (siblings of every ancestor up to `<body>`: `aria-hidden`, `data-modal-behind`,
 * focus that lands there returns to the panel – see `isolateOutside`), so the page behind a portal-less dialog is
 * neither reachable nor read by screen readers, without restyling it the way `inert` did.
 * Live regions (`[aria-live]`, `data-toast-island`) are exempt: a subtree that contains one is descended
 * into instead of being hidden as a whole, so toasts keep announcing while a sheet is open.
 * With `settled = false` the toggle waits for the morph (see `useDialogBehaviour`).
 */
export function useInertOutside(ref: RefObject<HTMLElement | null>, active: boolean, settled = true): void {
  useModalSession(ref, active, settled, { focus: false, inert: true });
}

/**
 * Escape closes. The listener is subscribed once per open session and calls the latest `onClose` (an effect event):
 * callers pass inline closures, and re-subscribing on every render let a re-render that React committed inside the
 * Escape keydown itself (pending work flushed at the start of a discrete event) swap the listener mid-dispatch –
 * Chrome then ran neither the removed nor the added listener and that Escape was lost (command navigation stayed open).
 */
export function useEscape(active: boolean, onClose: () => void): void {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

/**
 * Android back (decision 26): while `active`, the session owns one history entry (`store/backStack.ts`); the system
 * back button / back gesture runs `onBack` – the dialog's normal close path, the same as Escape (an unsaved form asks
 * "Änderungen verwerfen?" and keeps its entry) – instead of switching the page underneath. Closing by any other path
 * consumes the entry without the router seeing it. Called with the latest `onBack` (an effect event), subscribed once
 * per open session; nested sessions stack (back closes the topmost first), a hand-off in one commit keeps the entry.
 */
export function useBackClose(active: boolean, onBack: () => void): void {
  const back = useEffectEvent(onBack);
  useEffect(() => {
    if (!active) return;
    return openBackEntry(() => back());
  }, [active]);
}

export interface DialogBehaviourOptions {
  /**
   * Morph-aware timing. Pass `false` while the dialog's open morph or its exit / reverse morph is running and
   * `true` once it has finished: the page is isolated after the open morph and released – together with the focus
   * return – after the close animation (each bounded by `SETTLE_FALLBACK_MS`). Omit for immediate behaviour.
   */
  settled?: boolean;
  /**
   * Where focus goes on close when the element that opened the dialog is gone (removed, or inert while it exits –
   * e.g. the row of a deleted trade). Called once, when the session ends; return `null` to leave focus alone.
   */
  fallbackFocus?: () => HTMLElement | null;
}

/** All dialog behaviours in one call (focus trap, scroll lock, isolated outside, Escape, Android back = Escape). */
export function useDialogBehaviour(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void, { settled = true, fallbackFocus }: DialogBehaviourOptions = {}): void {
  useModalSession(ref, active, settled, { focus: true, inert: true }, fallbackFocus);
  useScrollLock(active);
  useEscape(active, onClose);
  useBackClose(active, onClose);
}

/**
 * Ref callback for a swipe handle (sheet header, dialog head, detail grabber, toast): a native, NON-passive
 * `touchmove` listener that `preventDefault`s the moves while `isDragging()` – React's touch listeners are passive,
 * and an unconsumed fast touch sequence lets Chrome treat the next tap (within ~1 s) as a fling cancel and swallow its
 * click, so the FAB or a button tapped right after a swipe would not react. Engagement itself stays with the pointer
 * events (the first moves before the 10 px hysteresis are never touched). Stable identity; React 19 runs the
 * returned cleanup when the element detaches.
 */
export function useTouchMoveGuard(isDragging: () => boolean): (el: HTMLElement | null) => (() => void) | undefined {
  const fn = useRef(isDragging);
  useEffect(() => {
    fn.current = isDragging;
  }, [isDragging]);
  return useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    const onMove = (e: TouchEvent) => {
      if (e.cancelable && fn.current()) e.preventDefault();
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, []);
}
