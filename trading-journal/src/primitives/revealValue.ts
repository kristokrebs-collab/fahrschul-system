import { animate, useMotionValue, type AnimationPlaybackControls, type MotionValue, type Transition } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useIntroGate } from "@/intro/introStore";
import { canObserveInView, observeInView, useFirstInView } from "@/motion/inView";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * "Fill on first view" for gauges, bars and counters, driven by one MotionValue (zero React renders):
 * the value rests at `from` until `ref` first scrolls into view (shared `IntersectionObserver`), then animates to
 * `target` on `transition` after `delay`; every later change animates straight from the current value.
 */
export interface RevealValueOptions {
  /** Transition of the first reveal and of every later change. */
  transition: Transition;
  /** Resting value until the first reveal (default 0). */
  from?: number;
  /** Extra delay in seconds of the first reveal only (stagger). */
  delay?: number;
  /** `false`: the value simply follows `target` (no observer) – for callers that render an external source. */
  enabled?: boolean;
  /** Called once when the first reveal starts (from the observer callback, never during render). */
  onReveal?: () => void;
}

/** `true` when a first-view reveal may animate: motion allowed and an observer exists to trigger it. */
export function canRevealOnView(reduced: boolean): boolean {
  return !reduced && canObserveInView();
}

/**
 * The value shown by a fill-on-view element. Reduced motion or no `IntersectionObserver` (jsdom/SSR): it starts at
 * `target` and follows changes instantly, so nothing ever rests empty. The first reveal also waits for the intro
 * (`useIntroGate`): not while the stage covers the app, not before the surrounding intro cell has landed.
 */
export function useRevealValue(ref: RefObject<Element | null>, target: number, { transition, from = 0, delay = 0, enabled = true, onReveal }: RevealValueOptions): MotionValue<number> {
  const reduced = useReducedFx();
  const [armed] = useState(() => enabled && canRevealOnView(reduced));
  const mv = useMotionValue(armed ? from : target);
  const seen = useRef(!armed);
  const running = useRef<AnimationPlaybackControls | null>(null);
  const latest = useRef({ target, transition, delay, onReveal });
  const gate = useIntroGate();

  useEffect(() => {
    latest.current = { target, transition, delay, onReveal };
  });

  useEffect(() => {
    if (!armed || !gate) return;
    const el = ref.current;
    if (!el) return;
    const off = observeInView(el, (inView) => {
      if (!inView || seen.current) return;
      seen.current = true;
      off();
      const l = latest.current;
      running.current?.stop();
      running.current = animate(mv, l.target, { ...l.transition, delay: l.delay });
      l.onReveal?.();
    });
    return off;
  }, [armed, gate, ref, mv]);

  useEffect(() => {
    if (!seen.current) {
      // reduced motion switched on before the first reveal: show the value, never the empty state
      if (!reduced) return;
      seen.current = true;
    }
    running.current?.stop();
    running.current = null;
    if (reduced || !enabled) {
      mv.jump(target);
      return;
    }
    if (mv.get() !== target) running.current = animate(mv, target, latest.current.transition);
  }, [target, reduced, enabled, mv]);

  useEffect(() => () => running.current?.stop(), []);
  return mv;
}

/**
 * One boolean that flips to `true` the first time `ref` is in view (one React commit, then the observer is
 * released). `true` from the start under reduced motion or without `IntersectionObserver`.
 */
export function useSeenOnce(ref: RefObject<Element | null>): boolean {
  return useFirstInView(ref, !useReducedFx());
}
