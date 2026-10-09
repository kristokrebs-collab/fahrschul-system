/**
 * Shared runtime for the pulse text primitives (AsciiCascade, PixelTextFill, Typewriter, TextMorph, TextPrism,
 * DancingLetters, TactileHighlight): a time-based one-shot timeline that pauses its frame loop while the element
 * is offscreen or the tab is hidden, plus small jsdom-safe helpers. No React state, no per-frame layout reads.
 */
import { createFrameLoop } from "@/motion/pulse/engine";
import { useEffect, useEffectEvent, useRef } from "react";
import { canObserveInView, observeInView } from "@/motion/inView";
import { stepSpring, type SpringState } from "@/motion/pulse/springStep";

/** Calls `cb(active)` when the element enters/leaves the viewport or the tab is hidden/shown. jsdom: always active. */
export function watchActivity(el: Element, cb: (active: boolean) => void): () => void {
  let inView = true;
  let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  let last = inView && visible;
  const emit = () => {
    const next = inView && visible;
    if (next === last) return;
    last = next;
    cb(next);
  };
  const stopView = canObserveInView()
    ? observeInView(el, (v) => {
        inView = v;
        emit();
      })
    : () => {};
  const onVis = () => {
    visible = document.visibilityState !== "hidden";
    emit();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  return () => {
    stopView();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
  };
}

export interface Timeline {
  /** (Re)starts at elapsed 0 after `delayMs`. `step(elapsedMs)` returns false when the timeline is finished. */
  start(delayMs?: number): void;
  /** Stops without calling `step` again. */
  stop(): void;
  running(): boolean;
}

/**
 * One-shot timeline on the shared frame loop. Elapsed time comes from the rAF timestamp minus the start time, so it
 * is identical at 60/120/240 Hz. While inactive (offscreen / hidden tab) no frames run; the clock keeps going, so a
 * timeline that finished in the background lands on its final frame on return.
 */
export function createTimeline(el: Element, step: (elapsedMs: number) => boolean): Timeline {
  let t0 = 0;
  let live = false;
  let active = true;
  let unwatch: (() => void) | null = null;
  const loop = createFrameLoop((_dt, now) => {
    if (!live) return false;
    if (!step(Math.max(0, now - t0))) {
      end();
      return false;
    }
    return true;
  });
  const end = () => {
    live = false;
    unwatch?.();
    unwatch = null;
  };
  return {
    start(delayMs = 0) {
      loop.stop();
      t0 = performance.now() + delayMs;
      live = true;
      active = true;
      unwatch?.();
      unwatch = watchActivity(el, (a) => {
        active = a;
        if (!live) return;
        if (a) loop.wake();
        else loop.stop();
      });
      if (active) loop.wake();
    },
    stop() {
      loop.stop();
      end();
    },
    running: () => live,
  };
}

/** Small stable hash of a string (FNV-1a) – seeds the glyph PRNG per text so scrambles are deterministic. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** `(hover: hover) and (pointer: fine)` right now (jsdom/SSR: false). */
export function canHoverNow(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
}

/** Split into user-perceived characters (keeps surrogate pairs such as emoji together). */
export function splitChars(text: string): string[] {
  return Array.from(text);
}

/**
 * Normalises the `play` replay trigger: a number replays on every change, a boolean plays on false→true.
 * Returns a key that changes exactly when a play is requested (undefined = no request yet).
 */
export function playKey(play: number | boolean | undefined): number | undefined {
  if (typeof play === "number") return play;
  return play ? 1 : undefined;
}

/**
 * Replay trigger shared by the timeline primitives. Plays on mount when `playOnMount` (or `play === true`), then
 * every time `playKey(play)` changes to a defined value. StrictMode's simulated unmount/remount plays again, because
 * the owning component tears its engine down in between.
 */
export function usePlayTrigger(play: number | boolean | undefined, playOnMount: boolean, run: () => void): void {
  const onRun = useEffectEvent(run);
  const key = playKey(play);
  const seen = useRef<{ key: number | undefined } | null>(null);
  useEffect(
    () => () => {
      seen.current = null;
    },
    [],
  );
  const mountPlay = playOnMount || play === true;
  useEffect(() => {
    const prev = seen.current;
    seen.current = { key };
    if (prev === null) {
      if (mountPlay) onRun();
      return;
    }
    if (key !== undefined && key !== prev.key) onRun();
  }, [key, mountPlay]);
}

export type { SpringState } from "@/motion/pulse/springStep";

/**
 * Exact damped-spring step towards `target` over `dt` seconds (all damping regimes), carrying velocity. Immutable
 * wrapper over springStep.ts `stepSpring` (one implementation for every pulse component).
 */
export function springStep(x: number, v: number, target: number, dt: number, cfg: { stiffness: number; damping: number; mass: number } = { stiffness: 350, damping: 30, mass: 1 }): SpringState {
  const s = { x, v };
  stepSpring(s, target, cfg, dt);
  return s;
}
