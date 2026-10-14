import { motionValue, type MotionValue } from "motion/react";
import { useEffect } from "react";
import { physics } from "@/motion/physics/constants";
import { tempoOf } from "@/motion/physics/apple";
import { createVelocityTracker } from "@/motion/physics/velocity";

/**
 * Global, PASSIVE pointer-tempo probe ("how is the device being operated right now?"). Three passive capture listeners
 * on `window` (pointermove / pointerdown / pointerup): O(1) per event, no frame loop, no React state, no layout reads.
 * The only timer is a one-shot that zeroes `inputSpeed` 40 ms after the last move (sleeps while idle).
 *
 * Contract (react-hooks `refs` / `purity`): sample the tempo IN THE EVENT HANDLER that starts an animation (onClick,
 * onMouseEnter, onPointerUp) and store it with the state change — never read it during render. Keyboard, focus and
 * programmatic changes pass speed 0, so they always get the tuned token.
 */

export type PointerKind = "mouse" | "touch" | "pen";

/** Live pointer speed in px/s (0 once the pointer rests ≥ 40 ms). A MotionValue: subscribe or `.get()`, zero renders. */
export const inputSpeed: MotionValue<number> = motionValue(0);

const tracker = createVelocityTracker();
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

let installs = 0;
let target: Window | null = null;
let lastMoveAt = -Infinity; // performance.now() at handling (the stop rule compares handling times, not event clocks)
let downAt = NaN;
let pressMs = NaN;
let kind: PointerKind | null = null;
let decayTimer: ReturnType<typeof setTimeout> | 0 = 0;
let navTempo = 0;

const asKind = (t: string): PointerKind => (t === "touch" || t === "pen" ? t : "mouse");

function decay() {
  const idle = now() - lastMoveAt;
  if (idle >= physics.velocityStopped) {
    decayTimer = 0;
    inputSpeed.set(0);
  } else decayTimer = setTimeout(decay, physics.velocityStopped - idle + 1);
}

function onMove(e: PointerEvent) {
  const k = asKind(e.pointerType);
  if (k !== kind) {
    tracker.reset();
    kind = k;
  }
  tracker.add(e.timeStamp, e.clientX, e.clientY);
  lastMoveAt = now();
  inputSpeed.set(tracker.speed());
  if (!decayTimer) decayTimer = setTimeout(decay, physics.velocityStopped + 1);
}

function onDown(e: PointerEvent) {
  const k = asKind(e.pointerType);
  // a new touch / pen contact lands anywhere: never measure the jump from the previous lift
  if (k !== "mouse" || k !== kind) tracker.reset();
  kind = k;
  tracker.add(e.timeStamp, e.clientX, e.clientY);
  downAt = now();
}

function onUp() {
  if (Number.isFinite(downAt)) pressMs = now() - downAt;
}

const LISTEN: AddEventListenerOptions = { capture: true, passive: true };

/**
 * Installs the probe (idempotent, reference-counted). Call once at app level — `useEffect(() => installTempo(), [])`
 * in `MotionRoot` — the returned function uninstalls when the last holder leaves. `pointerSpeed()` also installs
 * lazily on first use (its first read is then 0).
 */
export function installTempo(win: Window | undefined = typeof window !== "undefined" ? window : undefined): () => void {
  if (!win) return () => {};
  installs++;
  if (installs === 1) {
    target = win;
    win.addEventListener("pointermove", onMove, LISTEN);
    win.addEventListener("pointerdown", onDown, LISTEN);
    win.addEventListener("pointerup", onUp, LISTEN);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installs--;
    if (installs === 0 && target) {
      target.removeEventListener("pointermove", onMove, LISTEN);
      target.removeEventListener("pointerdown", onDown, LISTEN);
      target.removeEventListener("pointerup", onUp, LISTEN);
      target = null;
      if (decayTimer) clearTimeout(decayTimer);
      decayTimer = 0;
      tracker.reset();
      lastMoveAt = -Infinity;
      inputSpeed.set(0);
    }
  };
}

/** True while the probe listens. */
export function tempoInstalled(): boolean {
  return installs > 0;
}

/** Current pointer speed in px/s; 0 once the pointer has rested ≥ 40 ms (or before the first move). */
export function pointerSpeed(): number {
  if (!installs) {
    installTempo();
    return 0;
  }
  if (now() - lastMoveAt >= physics.velocityStopped) return 0;
  return tracker.speed();
}

/** `tempoOf(pointerSpeed())`: 0 = slow / deliberate (≤ 400 px/s) … 1 = fast (≥ 1800 px/s). */
export function pointerTempo(): number {
  return tempoOf(pointerSpeed());
}

/** Kind of the last pointer seen (null before any pointer event). */
export function lastPointerType(): PointerKind | null {
  return kind;
}

/** Duration (ms) of the last completed press (pointerdown → pointerup); NaN before the first one. Dock hop: `hopFor(lastPressMs())`. */
export function lastPressMs(): number {
  return pressMs;
}

/** One-shot tempo hand-off between components (dock flick → PageHost picks a snappier page spring). */
export function setNavTempo(t: number): void {
  navTempo = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

/** Reads and clears the hand-off (read it in an effect, never in render). */
export function consumeNavTempo(): number {
  const t = navTempo;
  navTempo = 0;
  return t;
}

/**
 * Short haptic tick (Android `navigator.vibrate`; iOS/desktop ignore it). Only after a user activation (no Chrome
 * intervention warnings), wrapped for iframes / file:// / permission policies. Returns whether a tick was requested.
 */
export function haptic(ms: number = physics.haptic): boolean {
  try {
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }) : undefined;
    if (!nav || typeof nav.vibrate !== "function") return false;
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return false;
    return nav.vibrate(ms);
  } catch {
    return false;
  }
}

/** Installs the tempo probe for the lifetime of the calling component (MotionRoot): `useTempoProbe()`. */
export function useTempoProbe(): void {
  useEffect(() => installTempo(), []);
}
