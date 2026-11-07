/**
 * The frame loop of a thinking orb (R11). It runs ONLY while all three are true: the orb is meant to run (`active`), it is
 * on screen (`inView`, an IntersectionObserver of the component) and the tab is visible (`visibilitychange`). Otherwise
 * no animation frame is requested at all – nothing loops for a hidden tab or a scrolled-away card. `t` counts seconds
 * the loop actually ran (a pause does not make the picture jump), a single step is clamped to `MAX_STEP`, so a tab that
 * comes back after a minute continues where it stopped instead of fast-forwarding.
 *
 * Time based, never frame based: 60, 120 or 144 Hz show the same motion (the frame callback gets the monotonic
 * timestamp of `requestAnimationFrame`). The pieces (`raf`, `caf`, `hidden`) are injected for the unit test.
 */

/** Longest time step one frame may advance (s). */
export const ORB_MAX_STEP = 0.1;

export interface OrbLoopEnv {
  raf: (cb: (now: number) => void) => number;
  caf: (id: number) => void;
  /** `true` while the tab is hidden. */
  hidden: () => boolean;
}

export interface OrbLoop {
  /** Sets one of the three conditions; the loop starts / stops when the combined answer changes. */
  set(cond: Partial<{ active: boolean; inView: boolean }>): void;
  /** Re-reads the tab visibility (call from the `visibilitychange` listener). */
  visibility(): void;
  /** Whether a frame request is pending right now. */
  running(): boolean;
  /** Seconds of motion so far. */
  time(): number;
  dispose(): void;
}

const browserEnv = (): OrbLoopEnv => ({
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  hidden: () => typeof document !== "undefined" && document.hidden,
});

/**
 * `draw(t)` paints one frame at `t` seconds. It is also called ONCE when the loop stops, so the last picture is a clean
 * frame, and once at creation so an orb that starts off screen is not blank.
 */
export function createOrbLoop(draw: (t: number) => void, env: OrbLoopEnv = browserEnv(), initial: { active?: boolean; inView?: boolean } = {}): OrbLoop {
  let active = initial.active ?? true;
  let inView = initial.inView ?? true;
  let id = 0;
  let pending = false;
  let last: number | null = null;
  let t = 0;
  let disposed = false;

  const wanted = (): boolean => !disposed && active && inView && !env.hidden();

  const frame = (now: number): void => {
    pending = false;
    if (!wanted()) {
      last = null;
      return;
    }
    if (last != null) t += Math.min(ORB_MAX_STEP, Math.max(0, (now - last) / 1000));
    last = now;
    draw(t);
    pending = true;
    id = env.raf(frame);
  };

  const sync = (): void => {
    const was = pending;
    if (wanted()) {
      if (!pending) {
        pending = true;
        last = null;
        id = env.raf(frame);
      }
    } else if (pending) {
      env.caf(id);
      pending = false;
      last = null;
    }
    // stopped just now: one clean frame (the still picture of a finished orb, not the frame the loop happened to stop on)
    if (was && !pending && !disposed) draw(t);
  };

  draw(t);
  sync();

  return {
    set(cond) {
      if (cond.active !== undefined) active = cond.active;
      if (cond.inView !== undefined) inView = cond.inView;
      sync();
    },
    visibility: sync,
    running: () => pending,
    time: () => t,
    dispose() {
      disposed = true;
      sync();
    },
  };
}
