/**
 * Shared wall clock as a MotionValue: one timer for the whole app instead of a `useNow()` state per card.
 * `nowMv` ticks on every second boundary while at least one consumer holds it (`useNowMv()` / `retainClock()`),
 * so countdowns and age labels (`useTransform(nowMv, …)` → `motion.span` text) change exactly when the displayed
 * second changes, with zero React renders. With no consumer the timer is stopped and the page can go idle.
 */
import { motionValue, type MotionValue } from "motion/react";
import { useLayoutEffect } from "react";

/** Wall-clock milliseconds (`Date.now()`), refreshed on every second boundary while retained. */
export const nowMv: MotionValue<number> = motionValue(Date.now());

/**
 * Timers may fire a hair early relative to `Date.now()`; landing a few ms after the boundary guarantees the
 * new second is already visible when the tick runs (and never ticks twice within one second).
 */
export const CLOCK_SLACK_MS = 4;

/** Delay from `now` to just after the next whole second (pure; `(CLOCK_SLACK_MS, 1000 + CLOCK_SLACK_MS]`). */
export function msToNextSecond(now: number): number {
  return 1000 - (((now % 1000) + 1000) % 1000) + CLOCK_SLACK_MS;
}

let holders = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function tick(): void {
  nowMv.set(Date.now());
}

/**
 * A self-aligning timeout chain rather than `setInterval`: every tick re-targets the next boundary, so the clock
 * never drifts off the second and re-aligns by itself after the browser throttled a background tab.
 */
function arm(): void {
  timer = setTimeout(() => {
    tick();
    arm();
  }, msToNextSecond(Date.now()));
}

function onVisibility(): void {
  if (typeof document === "undefined" || document.hidden || holders === 0) return;
  if (timer) clearTimeout(timer);
  tick();
  arm();
}

function start(): void {
  tick();
  arm();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
}

/**
 * Ref-counted start of the shared clock; returns an idempotent release. The first holder refreshes `nowMv`
 * synchronously (a stale value from an earlier session never reaches the screen), the last release stops the timer.
 */
export function retainClock(): () => void {
  holders += 1;
  if (holders === 1) start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) stop();
  };
}

/** Number of current holders (diagnostics / tests). */
export function clockHolders(): number {
  return holders;
}

/**
 * The shared `nowMv`, kept ticking while the calling component is mounted. Retained in a layout effect so the
 * first tick lands before the first paint. Derive text with `useTransform(nowMv, …)` in leaf nodes.
 */
export function useNowMv(): MotionValue<number> {
  useLayoutEffect(() => retainClock(), []);
  return nowMv;
}
