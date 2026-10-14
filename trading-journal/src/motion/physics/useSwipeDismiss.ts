import { animate, useMotionValue, type MotionValue, type TargetAndTransition } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { physics } from "@/motion/physics/constants";
import { flingSpring, tempoOf } from "@/motion/physics/apple";
import { dismissThreshold, flickDecision, rubberBand, rubberBandInverse, swipeDecision } from "@/motion/physics/gesture";
import { haptic, type PointerKind } from "@/motion/physics/tempo";
import { springTo, useAxisDrag, type AxisDragHandlers } from "@/motion/physics/useAxisDrag";

/** Handed to `onDismiss` / `onAttempt`: everything an exit animation needs. */
export interface SwipeDismissInfo {
  /** Direction of the dismissal along the axis (+1 down/right, −1 up/left). */
  direction: 1 | -1;
  /** Release velocity along the axis, px/s (signed, screen direction). */
  velocity: number;
  /** Finger offset along the axis at release, px (signed). */
  offset: number;
  /** Size of the surface along the axis, px (measured once on pointerdown). */
  size: number;
  /** Release tempo 0 … 1 (`tempoOf(|velocity|)`). */
  tempo: number;
  pointerType: PointerKind;
}

export interface UseSwipeDismissOptions {
  /** Commit (not guarded): close the surface. The values stay where the finger left them — animate the exit with `flingExit(info)` (AnimatePresence) or `flingValue`. */
  onDismiss: (info: SwipeDismissInfo) => void;
  /** Dismissal axis (default "y"). */
  axis?: "x" | "y";
  /** Dismiss direction along the axis: 1 = down/right (default), −1 = up/left, 0 = either way (toast). */
  direction?: 1 | -1 | 0;
  /** Projected px past which a release commits; default `dismissThreshold(size)` = clamp(0.33·size, 140, 260). */
  threshold?: number | ((size: number) => number);
  /** Minimum finger travel toward the dismissal before anything commits (default 16 px). */
  minOffset?: number;
  /**
   * `true` while dismissal must NOT happen (unsaved input — "alle eingetragenen Werte bleiben"): the drag is resisted
   * with a rubber band (`physics.guardStretch`), never commits, springs back and calls `onAttempt` when the release
   * would have dismissed. Read once per gesture (at engagement).
   */
  guard?: () => boolean;
  /** Guarded release past the threshold: show the inline "Änderungen verwerfen?" confirm. */
  onAttempt?: (info: SwipeDismissInfo) => void;
  /** Gesture on/off (e.g. `open && settled`; never while exiting). Turning it off mid-drag springs back. */
  enabled?: boolean;
  /** When this turns true (the surface opens again), values jump back to rest — a previous exit left them off-screen. */
  open?: boolean;
  /** "slide" (default): the axis only. "zoom" (iOS 18 card dismiss): cross axis follows at 0.5×, scale 1 → 0.88. */
  mode?: "slide" | "zoom";
  /** The transformed element: its size along the axis is read once per gesture, and it gets `will-change: transform`
   *  from engagement until it is home again (kept after a commit — the exit animation still moves it). */
  target?: RefObject<HTMLElement | null>;
  /** Size along the axis (overrides `target`); default the viewport size along the axis. */
  measure?: () => number;
  /** Default ["touch", "pen"] (mouse users have the close button / Escape; pass "mouse" for e.g. the toast). */
  pointerTypes?: readonly PointerKind[];
  /** Default `useReducedFx()`: tracking stays 1:1, releases jump, no zoom/scale. */
  reduced?: boolean;
  /** Handle `touch-action` (default "none": a dedicated handle such as a header or grabber). Use "pan-y" for x-swipes inside scrolling content. */
  touchAction?: CSSProperties["touchAction"];
  /** Haptic tick when the projected release first crosses the threshold (default true). */
  haptics?: boolean;
}

export interface SwipeDismiss {
  /** Axis values (px) — bind via `style` on the TRANSFORMED wrapper (never on a `layoutId` panel). */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** 1 → 0.88 in zoom mode, constant 1 in slide mode / reduced motion. */
  scale: MotionValue<number>;
  /** 0 … 1: offset toward the dismissal / size (follows the release spring and exit animations, too). */
  progress: MotionValue<number>;
  /** Backdrop dim multiplier 1 → `physics.dimFloor` (0.25) with progress — `style={{ opacity: swipe.dim }}` on an inner dim layer. */
  dim: MotionValue<number>;
  /** `{ x, y, scale }` for the transformed wrapper's `style`. */
  style: { x: MotionValue<number>; y: MotionValue<number>; scale: MotionValue<number> };
  /** Spread on the handle (header row, grabber strip): pointer handlers + click swallow + `style` (touch-action, user-select). */
  handle: AxisDragHandlers & { style: CSSProperties };
  /** True while a finger drags (read in handlers / effects only). */
  isDragging: () => boolean;
  /** Spring everything back to rest (e.g. after "Weiter bearbeiten"); `instant` jumps. */
  reset: (opts?: { instant?: boolean }) => void;
  /** The last committed dismissal (for AnimatePresence `custom` when it is read in an event), or null. */
  lastDismiss: () => SwipeDismissInfo | null;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Exit target + transition for a swiped surface inside `AnimatePresence`: the axis value flies `distance` (default
 * size + 40 px) in the dismissal direction on a critically damped physics spring that keeps the release velocity
 * (≥ 900 px/s). Keep the contents opaque inside the moving panel (no text-over-text fade). Reduced motion: a plain
 * opacity fade (`tween.fade`). An exiting child no longer receives props, so pass the info through `custom`:
 *   <AnimatePresence custom={flung}>{open && <motion.div variants={{ gone: (f) => (f ? flingExit(f) : FADE) }} exit="gone" …/>}</AnimatePresence>
 * (verified in Chromium: 1875 px/s flick → off-screen 233 ms after the release, monotonic, zero React renders).
 */
export function flingExit(info: SwipeDismissInfo, opts: { axis?: "x" | "y"; distance?: number; reduced?: boolean } = {}): TargetAndTransition {
  if (opts.reduced) return { opacity: 0, transition: tween.fade };
  const axis = opts.axis ?? "y";
  const distance = opts.distance ?? info.size + physics.flingOvershoot;
  return { [axis]: info.direction * distance, transition: { [axis]: flingSpring(info.direction, info.velocity) } } as TargetAndTransition;
}

/** Imperative fling of a MotionValue out of view (no AnimatePresence): resolves when it is gone. Reduced motion: jumps. */
export function flingValue(mv: MotionValue<number>, info: SwipeDismissInfo, opts: { distance?: number; reduced?: boolean } = {}): Promise<void> {
  const to = info.direction * (opts.distance ?? info.size + physics.flingOvershoot);
  if (opts.reduced) {
    mv.stop();
    mv.set(to);
    return Promise.resolve();
  }
  return animate(mv, to, flingSpring(info.direction, info.velocity)).finished.then(
    () => undefined,
    () => undefined,
  );
}

const viewportSize = (axis: "x" | "y") => (typeof window === "undefined" ? 800 : axis === "y" ? window.innerHeight : window.innerWidth) || 800;

/**
 * Swipe-to-dismiss for overlays (sheet / trade detail / morph dialog: axis "y"; toast island: axis "x", direction 0),
 * built on `useAxisDrag`. Mapping per move (direction-normalised offset o, finger 1:1):
 * - toward the dismissal: o (guarded: `rubberBand(o, 120)`);
 * - against it: −`rubberBand(−o, 60)` (the iOS edge stretch: 100 px of finger ≈ 29 px, never 60);
 * - zoom mode: cross axis × 0.5, scale = 1 − 0.12·progress.
 * Release: commit = `swipeDecision` (or `flickDecision` for direction 0) on the PROJECTED finger offset → `onDismiss`.
 * Otherwise the FINGER-space offset springs home on `releaseSpring` carrying the finger's velocity (gentle when slow,
 * up to 0.3 bounce when thrown) and the screen shows it through the same mapping: a guarded pull returns damped, and
 * a flick back past the resting edge overshoots only as far as the iOS rubber band lets it (≈ 10 px, not 24).
 */
export function useSwipeDismiss(options: UseSwipeDismissOptions): SwipeDismiss {
  const reducedFx = useReducedFx();
  const x = useMotionValue(0);
  /** The FINGER-space offset along the axis. Springs run here; the on-screen value is `forward(raw)`, so an
   *  overshoot past the resting edge is rubber-banded like iOS instead of swinging freely (never bound to the DOM). */
  const raw = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const progress = useMotionValue(0);
  const dim = useMotionValue(1);

  const opts = useRef(options);
  const reducedRef = useRef(options.reduced ?? reducedFx);
  useIsoLayoutEffect(() => {
    opts.current = options;
    reducedRef.current = options.reduced ?? reducedFx;
  });

  const g = useRef({
    size: 0,
    guarded: false,
    rawBase: 0,
    crossBase: 0,
    crossed: false,
    last: null as SwipeDismissInfo | null,
    gen: 0, // gesture generation: a will-change cleanup from an older spring never strips a newer gesture's layer
  });

  const fns = useMemo(() => {
    const o = () => opts.current;
    const axisOf = () => o().axis ?? "y";
    const dirOf = () => o().direction ?? 1;
    const main = () => (axisOf() === "y" ? y : x);
    const cross = () => (axisOf() === "y" ? x : y);
    const zoom = () => o().mode === "zoom" && !reducedRef.current;
    const sizeNow = () => g.current.size || viewportSize(axisOf());

    /** finger offset (signed, screen) → on-screen value. */
    const forward = (raw: number, guarded: boolean): number => {
      const dir = dirOf();
      if (dir === 0) return guarded ? rubberBand(raw, physics.guardStretch) : raw;
      const n = raw * dir;
      const v = n >= 0 ? (guarded ? rubberBand(n, physics.guardStretch) : n) : -rubberBand(-n, physics.stretch);
      return v * dir;
    };
    /** on-screen value → finger offset (continuity when a spring is caught mid-flight). */
    const inverse = (val: number, guarded: boolean): number => {
      const dir = dirOf();
      if (dir === 0) return guarded ? rubberBandInverse(val, physics.guardStretch) : val;
      const n = val * dir;
      const r = n >= 0 ? (guarded ? rubberBandInverse(n, physics.guardStretch) : n) : -rubberBandInverse(-n, physics.stretch);
      return r * dir;
    };
    const thresholdOf = (size: number) => {
      const t = o().threshold;
      return typeof t === "function" ? t(size) : t ?? dismissThreshold(size);
    };
    const info = (offset: number, velocity: number, direction: 1 | -1, pointerType: PointerKind): SwipeDismissInfo => ({
      direction,
      velocity,
      offset,
      size: sizeNow(),
      tempo: tempoOf(velocity),
      pointerType,
    });
    /** Release decision on the finger's offset/velocity: the direction it would commit in, or 0. */
    const decide = (raw: number, v: number): -1 | 0 | 1 => {
      const dir = dirOf();
      const threshold = thresholdOf(sizeNow());
      const minOffset = o().minOffset;
      if (dir === 0) return flickDecision({ offset: raw, velocity: v, threshold, minOffset });
      return swipeDecision({ offset: raw * dir, velocity: v * dir, threshold, minOffset }) ? dir : 0;
    };
    /** vRaw = finger velocity along the axis (finger space), vCross = on-screen cross velocity (zoom). */
    const springHome = (vRaw: number, vCross: number, instant = false) => {
      const reduced = instant || reducedRef.current;
      const speed = Math.hypot(vRaw, vCross);
      const gen = g.current.gen;
      void Promise.all([springTo(raw, 0, vRaw, { speed, reduced }), springTo(cross(), 0, vCross, { speed, reduced })]).then(() => {
        // the layer stays promoted until the panel is home (a 2-D transform without it re-rasters the panel per frame)
        const el = o().target?.current;
        if (el && g.current.gen === gen) el.style.willChange = "";
      });
    };
    return { o, axisOf, dirOf, main, cross, zoom, sizeNow, forward, inverse, decide, info, springHome };
  }, [x, y, raw]);

  /** Finger-space write during a drag (the subscription maps it to the screen; equal values still sync). */
  const setRaw = (v: number) => {
    if (raw.get() === v) fns.main().set(fns.forward(v, g.current.guarded));
    else raw.set(v);
  };

  const axis = options.axis ?? "y";
  const zoomMode = options.mode === "zoom";
  const drag = useAxisDrag({
    axis: zoomMode ? "xy" : axis,
    lock: axis,
    pointerTypes: options.pointerTypes ?? ["touch", "pen"],
    enabled: options.enabled !== false,
    touchAction: options.touchAction ?? "none",
    reduced: options.reduced,

    onPress: () => {
      const s = g.current;
      const o = fns.o();
      const el = o.target?.current;
      const ax = fns.axisOf();
      let size = 0;
      if (o.measure) size = o.measure();
      else if (el) {
        const r = el.getBoundingClientRect();
        size = ax === "y" ? r.height : r.width;
      }
      s.size = size > 0 ? size : viewportSize(ax);
    },
    onStart: () => {
      // engaged: catch a running spring where it is, read the guard once for this gesture
      const s = g.current;
      s.gen++;
      const el = fns.o().target?.current;
      if (el) el.style.willChange = "transform";
      s.guarded = !!fns.o().guard?.();
      raw.stop();
      fns.main().stop();
      fns.cross().stop();
      s.rawBase = fns.inverse(fns.main().get(), s.guarded);
      s.crossBase = fns.zoom() ? fns.cross().get() / physics.crossFollow : 0;
      s.crossed = false;
    },
    onMove: (m) => {
      const s = g.current;
      const ax = fns.axisOf();
      const d = ax === "y" ? m.dy : m.dx;
      const r = s.rawBase + d;
      setRaw(r);
      if (fns.zoom()) fns.cross().set((s.crossBase + (ax === "y" ? m.dx : m.dy)) * physics.crossFollow);
      if (fns.o().haptics !== false) {
        const v = m.velocity();
        const crossed = fns.decide(r, ax === "y" ? v.y : v.x) !== 0;
        if (crossed && !s.crossed) haptic();
        s.crossed = crossed;
      }
    },
    onRelease: (r) => {
      const s = g.current;
      const ax = fns.axisOf();
      const at = s.rawBase + (ax === "y" ? r.dy : r.dx);
      const v = ax === "y" ? r.vy : r.vx;
      const vCross = ax === "y" ? r.vx : r.vy;
      const dir = fns.decide(at, v);
      if (dir !== 0) {
        const i = fns.info(at, v, dir, r.pointerType);
        if (!s.guarded) {
          s.last = i;
          fns.o().onDismiss(i);
          return "none";
        }
        fns.o().onAttempt?.(i);
      }
      // the spring runs in finger space with the finger's velocity; what shows is forward(raw), so a banded pull
      // returns damped and a flick back past the edge overshoots only as far as the rubber band lets it
      fns.springHome(v, fns.zoom() ? vCross * physics.crossFollow : 0);
      return "none";
    },
    onCancel: () => fns.springHome(0, 0),
  });

  // raw (finger space) drives the on-screen axis value through the rubber-band mapping
  useEffect(
    () =>
      raw.on("change", (v) => {
        fns.main().set(fns.forward(v, g.current.guarded));
      }),
    [raw, fns],
  );

  // progress / scale / dim follow the axis value — also during the release spring and exit animations (no React)
  useEffect(() => {
    const update = () => {
      const dir = fns.dirOf();
      const v = fns.main().get();
      const toward = dir === 0 ? Math.abs(v) : v * dir;
      const p = Math.min(1, Math.max(0, toward / fns.sizeNow()));
      progress.set(p);
      dim.set(1 - (1 - physics.dimFloor) * p);
      scale.set(fns.zoom() ? 1 - physics.dismissScale * p : 1);
    };
    const offX = x.on("change", update);
    const offY = y.on("change", update);
    return () => {
      offX();
      offY();
    };
  }, [fns, x, y, progress, dim, scale]);

  // reopened: a previous exit left the values off-screen
  const open = options.open;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      raw.stop();
      x.stop();
      y.stop();
      raw.set(0);
      x.set(0);
      y.set(0);
      g.current.last = null;
    }
    wasOpen.current = open;
  }, [open, x, y, raw]);

  return useMemo<SwipeDismiss>(
    () => ({
      x,
      y,
      scale,
      progress,
      dim,
      style: { x, y, scale },
      handle: { ...drag.handlers, style: drag.style },
      isDragging: drag.isDragging,
      reset: (r) => {
        if (drag.isDragging()) drag.cancel();
        // re-sync finger space with what shows (an exit animation may have moved the axis value directly)
        raw.stop();
        fns.main().stop();
        raw.set(fns.inverse(fns.main().get(), g.current.guarded));
        fns.springHome(0, 0, !!r?.instant);
      },
      lastDismiss: () => g.current.last,
    }),
    [x, y, raw, scale, progress, dim, drag, fns],
  );
}
