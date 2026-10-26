import { useEffect, useState, type RefObject } from "react";
import { useIntroGate } from "@/intro/introStore";

/**
 * One shared `IntersectionObserver` (threshold .1) for every motion helper that only needs a cheap
 * "is it on screen" signal (`MotionNumber` gate / count-on-reveal). Hundreds of table cells then cost
 * one observer instead of one each, and callbacks write refs – never React state.
 */
export type InViewListener = (inView: boolean) => void;

const THRESHOLD = 0.1;
const listeners = new Map<Element, Set<InViewListener>>();
let observer: IntersectionObserver | null = null;

/** `false` in jsdom / SSR / very old engines – callers then treat the element as "not observed". */
export function canObserveInView(): boolean {
  return typeof IntersectionObserver !== "undefined";
}

function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const set = listeners.get(entry.target);
        if (!set) continue;
        for (const listener of Array.from(set)) listener(entry.isIntersecting);
      }
    },
    { threshold: THRESHOLD },
  );
  return observer;
}

/**
 * Calls `listener(inView)` whenever `el` crosses 10 % visibility; the observer also reports the initial
 * state right after the element's first listener subscribes. Returns the unsubscribe; the element is
 * unobserved when its last listener leaves.
 */
export function observeInView(el: Element, listener: InViewListener): () => void {
  if (!canObserveInView()) return () => {};
  const io = shared();
  let set = listeners.get(el);
  if (!set) {
    set = new Set();
    listeners.set(el, set);
    io.observe(el);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(el);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(el);
      io.unobserve(el);
    }
  };
}

/**
 * `true` from the first moment `ref` is at least 10 % on screen (shared observer, one React update per element,
 * ever). `true` whenever `enabled` is false (reduced motion: nothing waits for a reveal) and from the start when no
 * `IntersectionObserver` exists (jsdom / SSR). While the intro stage covers the app, or the surrounding intro cell
 * has not landed yet, nothing is observed – the first view starts when the cell lands.
 */
export function useFirstInView<T extends Element>(ref: RefObject<T | null>, enabled = true): boolean {
  const [seen, setSeen] = useState(() => !enabled || !canObserveInView());
  const gate = useIntroGate();
  useEffect(() => {
    const el = ref.current;
    if (seen || !enabled || !gate || !el) return;
    let live = true;
    const stop = observeInView(el, (inView) => {
      if (!inView || !live) return;
      live = false;
      stop();
      setSeen(true);
    });
    return () => {
      live = false;
      stop();
    };
  }, [ref, seen, enabled, gate]);
  return seen || !enabled;
}

/* ------------------------------------------------------------------------------------------------ reveal trigger */

/**
 * Reveal trigger (`Reveal` / `RevealGroup`): "enough of the element is on screen" – 15 % of it (the viewport shrunk by 50 px),
 * OR – for an element taller than the screen allows 15 % of (≥ 5 000 px on a phone) – a fifth of that shrunk viewport.
 * The old pure 15 % rule left a very tall card at opacity 0 for ever, because 15 % of it never fitted on the screen.
 * A callback only fires when a threshold is crossed, so the list is fine-grained (down to 0.2 % for a 50 000 px list).
 */
export const REVEAL_AMOUNT = 0.15;
export const REVEAL_SCREEN_SHARE = 0.2;
export const REVEAL_MARGIN_PX = 50;
const REVEAL_THRESHOLDS = [0, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.125, REVEAL_AMOUNT];

/** Pure: has the element reached the reveal point? `visiblePx` = height of the visible slice, `rootPx` = height of the (shrunk) viewport. */
export function revealReached(ratio: number, visiblePx: number, rootPx: number): boolean {
  return ratio >= REVEAL_AMOUNT || (rootPx > 0 && visiblePx >= rootPx * REVEAL_SCREEN_SHARE);
}

const revealListeners = new Map<Element, () => void>();
let revealObserver: IntersectionObserver | null = null;

function sharedReveal(): IntersectionObserver {
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const fire = revealListeners.get(entry.target);
        if (!fire || !entry.isIntersecting) continue;
        const root = entry.rootBounds?.height ?? (typeof window === "undefined" ? 0 : window.innerHeight - 2 * REVEAL_MARGIN_PX);
        if (!revealReached(entry.intersectionRatio, entry.intersectionRect?.height ?? 0, root)) continue;
        revealListeners.delete(entry.target);
        revealObserver?.unobserve(entry.target);
        fire();
      }
    },
    { rootMargin: `-${REVEAL_MARGIN_PX}px`, threshold: REVEAL_THRESHOLDS },
  );
  return revealObserver;
}

/** Calls `onReach` once, when `el` reaches the reveal point (one shared observer for all reveals). Returns the cancel. */
export function observeReveal(el: Element, onReach: () => void): () => void {
  if (!canObserveInView()) return () => {};
  const io = sharedReveal();
  revealListeners.set(el, onReach);
  io.observe(el);
  return () => {
    if (!revealListeners.delete(el)) return;
    io.unobserve(el);
  };
}

/**
 * `true` once `ref` reached the reveal point (sticky: a revealed element stays revealed). `true` from the start while
 * `enabled` is false (reduced motion: nothing waits) and without an `IntersectionObserver` (jsdom / SSR).
 */
export function useRevealSeen<T extends Element>(ref: RefObject<T | null>, enabled = true): boolean {
  const [seen, setSeen] = useState(() => !enabled || !canObserveInView());
  useEffect(() => {
    const el = ref.current;
    if (seen || !enabled || !el) return;
    return observeReveal(el, () => setSeen(true));
  }, [ref, seen, enabled]);
  return seen || !enabled;
}

/** Test hook: drops the shared observer so a new `IntersectionObserver` mock is picked up. */
export function resetInViewObserverForTests(): void {
  observer?.disconnect();
  observer = null;
  listeners.clear();
  revealObserver?.disconnect();
  revealObserver = null;
  revealListeners.clear();
}
