import { animate, type AnimationPlaybackControls, type DOMKeyframesDefinition } from "motion/react";

/**
 * Replayable one-shot effects for live tick feedback (perf-120 phase C): the per-trade ping of `PulseDot`, the up/down
 * wash of `ValueFlash`, the pooled pings of `StatusPill` fire up to several times a second on a 40 Hz feed, and each
 * `animate(el, …)` call built a new Motion animation (value + keyframe resolver + WAAPI object, ≈ 0.5–1 ms and a burst
 * of garbage – the feed's major GC pauses were ≈ 40 ms on the tablet probe). `replay()` keeps ONE native WAAPI
 * animation per element and restarts it: same keyframes, duration and easing, compositor-run (transform / opacity),
 * nothing allocated per tick. `fill: "none"`: after the run the element shows its own (resting) style again – the
 * layers it is used on rest at `opacity-0`. Without WAAPI (jsdom) it falls back to Motion's `animate`.
 */

/** Motion easing of the tween tokens (`ease.out` arrays and the named curves). */
export type ReplayEase = readonly [number, number, number, number] | "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface ReplayTiming {
  /** seconds, like the tween tokens */
  duration: number;
  ease: ReplayEase;
}

/** Two-keyframe definition in Motion's object form (`{ opacity: [1, 0], transform: ["scale(1)", "scale(2)"] }`). */
export type ReplayKeyframes = Record<string, readonly [string | number, string | number]>;

export interface ReplayControls {
  stop(): void;
}

/** Motion's named cubic-bezier curves as CSS (`easeOut` = cubic-bezier(0, 0, .58, 1) etc.). */
const NAMED: Record<Exclude<ReplayEase, readonly number[]>, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(0.42, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.58, 1)",
  easeInOut: "cubic-bezier(0.42, 0, 0.58, 1)",
};

/** Pure: a tween token's easing as a WAAPI `easing` string. */
export function cssEasing(ease: ReplayEase): string {
  return typeof ease === "string" ? NAMED[ease] : `cubic-bezier(${ease.join(", ")})`;
}

/** Pure: Motion's two-keyframe object form as a WAAPI keyframe list. */
export function toWaapiKeyframes(frames: ReplayKeyframes): Keyframe[] {
  const from: Keyframe = {};
  const to: Keyframe = {};
  for (const [prop, [a, b]] of Object.entries(frames)) {
    from[prop] = a;
    to[prop] = b;
  }
  return [from, to];
}

const effects = new WeakMap<Element, { key: string; anim: Animation }>();
/** Without WAAPI: the running Motion fallback per element (for `cancelReplay`). */
const fallbacks = new WeakMap<Element, { controls: AnimationPlaybackControls; frames: ReplayKeyframes }>();

/** Pure: the end values of a two-keyframe definition (the resting look of every replayed effect). */
function endValues(frames: ReplayKeyframes): Record<string, string | number> {
  return Object.fromEntries(Object.entries(frames).map(([prop, [, to]]) => [prop, to]));
}

/** Restarts the element's effect for `frames` / `timing` (created on first use, rebuilt when they change). */
export function replay(el: HTMLElement, frames: ReplayKeyframes, timing: ReplayTiming): ReplayControls {
  if (typeof el.animate !== "function") {
    fallbacks.get(el)?.controls.stop();
    const controls: AnimationPlaybackControls = animate(el, frames as unknown as DOMKeyframesDefinition, { duration: timing.duration, ease: timing.ease as never });
    fallbacks.set(el, { controls, frames });
    return { stop: () => controls.stop() };
  }
  const key = `${JSON.stringify(frames)}|${timing.duration}|${cssEasing(timing.ease)}`;
  let held = effects.get(el);
  if (!held || held.key !== key) {
    held?.anim.cancel();
    const anim = el.animate(toWaapiKeyframes(frames), { duration: timing.duration * 1000, easing: cssEasing(timing.ease), fill: "none" });
    anim.cancel();
    held = { key, anim };
    effects.set(el, held);
  }
  const { anim } = held;
  anim.currentTime = 0;
  anim.play();
  return { stop: () => anim.cancel() };
}

/** Cuts the element's replayed effect at once (it shows its resting style – the effects end where they rest). */
export function cancelReplay(el: HTMLElement | null | undefined): void {
  if (!el) return;
  effects.get(el)?.anim.cancel();
  const fb = fallbacks.get(el);
  if (fb) {
    fb.controls.stop();
    animate(el, endValues(fb.frames) as DOMKeyframesDefinition, { duration: 0 });
  }
}
