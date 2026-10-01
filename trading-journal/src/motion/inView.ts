import { useEffect, useState, type RefObject } from "react";

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
 * `IntersectionObserver` exists (jsdom / SSR).
 */
export function useFirstInView<T extends Element>(ref: RefObject<T | null>, enabled = true): boolean {
  const [seen, setSeen] = useState(() => !enabled || !canObserveInView());
  useEffect(() => {
    const el = ref.current;
    if (seen || !enabled || !el) return;
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
  }, [ref, seen, enabled]);
  return seen || !enabled;
}

/** Test hook: drops the shared observer so a new `IntersectionObserver` mock is picked up. */
export function resetInViewObserverForTests(): void {
  observer?.disconnect();
  observer = null;
  listeners.clear();
}
