import { animate, type MotionValue, type Transition } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useReducedFx } from "@/motion/useReducedFx";
import { physics } from "@/motion/physics/constants";
import { releaseSpring, tempoOf } from "@/motion/physics/apple";
import { axisLock } from "@/motion/physics/gesture";
import { createVelocityTracker } from "@/motion/physics/velocity";
import type { PointerKind } from "@/motion/physics/tempo";

export type DragAxis = "x" | "y" | "xy";

export interface AxisXY {
  x: number;
  y: number;
}

/** Engaged (after hysteresis + angle lock). Stop / catch your own animations here. */
export interface AxisDragStart {
  pointerType: PointerKind;
  /** pointerdown position (client px). */
  startX: number;
  startY: number;
  /** values of the driven MotionValues at engagement (0 for absent ones). */
  base: AxisXY;
}

export interface AxisDragMove {
  /** px from the ENGAGEMENT point (no jump at engagement), 0 on a locked-out axis. */
  dx: number;
  dy: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  base: AxisXY;
  /** Current finger velocity in px/s (weighted LSQ, computed on demand — cheap, but only call it when needed). */
  velocity: () => AxisXY;
}

export interface AxisDragRelease extends Omit<AxisDragMove, "velocity"> {
  /** px/s at release (0 if the finger rested ≥ 40 ms before lifting), 0 on a locked-out axis. */
  vx: number;
  vy: number;
  /** |v| px/s and its tempo 0 … 1 (`tempoOf`). */
  speed: number;
  tempo: number;
  /** ms from pointerdown to release. */
  durationMs: number;
  pointerType: PointerKind;
}

/**
 * What the hook does with the driven MotionValues after `onRelease`:
 * - `undefined` → spring them to `home` (default 0) with `releaseSpring(v)` carrying the finger velocity;
 * - an object → spring to those targets (e.g. a snapped slot) with the same velocity hand-off;
 * - `"none"` → leave them (the consumer animates: dismissal, own engine).
 */
export type AxisDragReleaseResult = void | "none" | Partial<AxisXY>;

export interface UseAxisDragOptions {
  /** Axes that are tracked and driven. */
  axis: DragAxis;
  /** Axis whose dominance engages the gesture (default = `axis`). E.g. zoom-dismiss: `axis "xy", lock "y"`. */
  lock?: DragAxis;
  /** MotionValues written per move (base + offset, or `map`). Stopped at engagement, so a running spring is caught mid-flight. */
  x?: MotionValue<number>;
  y?: MotionValue<number>;
  /** raw = base + finger offset → values to write (rubber bands live here: `rubberClamp`, `rubberBand`). */
  map?: (raw: AxisXY, base: AxisXY) => Partial<AxisXY>;
  /** Rest position for the default release (default {x: 0, y: 0}). */
  home?: Partial<AxisXY>;
  /** Default ["touch", "pen"]: mouse keeps text selection / precise clicks unless it is asked for. */
  pointerTypes?: readonly PointerKind[];
  enabled?: boolean;
  hysteresis?: number;
  axisRatio?: number;
  /** pointerdown on these descendants never starts a gesture (default: form fields, contenteditable, `[data-no-drag]`). */
  ignore?: string;
  /** `touch-action` of the handle (default: the cross axis stays with the browser – "pan-y" for x, "pan-x" for y, "none" for xy). */
  touchAction?: CSSProperties["touchAction"];
  /** Reduced motion: releases jump instead of springing (tracking stays 1:1). Default `useReducedFx()`. */
  reduced?: boolean;
  /** Element that gets `will-change: transform` from engagement until the release spring ends. */
  willChange?: RefObject<HTMLElement | null>;
  /** pointerdown accepted (before engagement): measure here (one layout read per gesture). Do not stop animations here. */
  onPress?: (e: ReactPointerEvent<Element>) => void;
  onStart?: (s: AxisDragStart) => void;
  /** Per move after engagement: write MotionValues / imperative styles only — never setState. */
  onMove?: (s: AxisDragMove) => void;
  onRelease?: (s: AxisDragRelease) => AxisDragReleaseResult;
  /** pointercancel, lost capture or `enabled` → false while engaged (values spring home). */
  onCancel?: () => void;
  /** pointerup without engagement (a tap; the click still fires normally). */
  onTap?: (e: ReactPointerEvent<Element>) => void;
}

export interface AxisDragHandlers {
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
  onLostPointerCapture: (e: ReactPointerEvent<Element>) => void;
  onClickCapture: (e: ReactMouseEvent<Element>) => void;
}

export interface AxisDrag {
  /** Spread on the handle element. */
  handlers: AxisDragHandlers;
  /** `touch-action` + `user-select: none` for the handle (merge into its style). */
  style: CSSProperties;
  /** True while engaged (read in handlers / effects, never in render). */
  isDragging: () => boolean;
  /** Abort an engaged gesture: values spring home, `onCancel` runs. */
  cancel: () => void;
}

export const DEFAULT_DRAG_IGNORE = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-drag]";

/**
 * Springs a MotionValue to `to`, handing over `velocity` (units/s) on a physics spring (Motion 13 drops velocity on
 * time-defined springs). Default spring: `releaseSpring(velocity, speed)`. Reduced motion: jumps. Resolves when done.
 */
export function springTo(mv: MotionValue<number>, to: number, velocity = 0, opts: { speed?: number; reduced?: boolean; transition?: Transition } = {}): Promise<void> {
  if (opts.reduced) {
    mv.stop();
    mv.set(to);
    return Promise.resolve();
  }
  if (mv.get() === to && velocity === 0) return Promise.resolve();
  const transition = opts.transition ?? releaseSpring(velocity, opts.speed ?? Math.abs(velocity));
  const controls = animate(mv, to, transition);
  return controls.finished.then(
    () => undefined,
    () => undefined,
  );
}

type Phase = "idle" | "pending" | "drag" | "rejected";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Generic one- or two-axis drag on MotionValues (direct manipulation, WWDC18):
 * - pointerdown (filtered by pointer type, primary button, `ignore`) only arms the gesture: no capture and nothing
 *   stopped, so taps on buttons inside the handle stay clicks and running springs are not disturbed by a tap;
 * - every move feeds the velocity tracker with the coalesced samples; after 10 px with the `lock` axis dominant
 *   (|primary| > 1.2·|cross|) the gesture engages: running springs on `x`/`y` are caught where they are (base), the
 *   pointer is captured and tracking is 1:1 from that point (no jump); if the cross axis wins first the gesture gives
 *   up and the browser keeps its scroll;
 * - release hands the finger velocity to `onRelease` and, unless told otherwise, to a velocity-carrying spring home;
 * - the click that follows an engaged drag is swallowed. Zero React state per move.
 */
export function useAxisDrag(options: UseAxisDragOptions): AxisDrag {
  const reducedFx = useReducedFx();
  const opts = useRef(options);
  const reducedRef = useRef(options.reduced ?? reducedFx);
  useIsoLayoutEffect(() => {
    opts.current = options;
    reducedRef.current = options.reduced ?? reducedFx;
  });

  const st = useRef({
    phase: "idle" as Phase,
    pid: -1,
    ptype: "touch" as PointerKind,
    sx: 0,
    sy: 0,
    ex: 0,
    ey: 0,
    downT: 0,
    base: { x: 0, y: 0 } as AxisXY,
    last: { dx: 0, dy: 0, clientX: 0, clientY: 0, timeStamp: 0 },
    captured: null as Element | null,
    swallow: false,
    swallowTimer: 0 as ReturnType<typeof setTimeout> | 0,
    gen: 0,
  });
  const tracker = useRef<ReturnType<typeof createVelocityTracker> | null>(null);

  const api = useMemo<AxisDrag>(() => {
    const trk = () => (tracker.current ??= createVelocityTracker());
    const s = () => st.current;
    const o = () => opts.current;

    const clearWillChange = (gen: number) => {
      const el = o().willChange?.current;
      if (el && s().gen === gen) el.style.willChange = "";
    };

    const springHome = (target: Partial<AxisXY>, v: AxisXY, speed: number) => {
      const { x, y } = o();
      const reduced = reducedRef.current;
      const gen = s().gen;
      const jobs: Promise<void>[] = [];
      if (x && target.x !== undefined) jobs.push(springTo(x, target.x, v.x, { speed, reduced }));
      if (y && target.y !== undefined) jobs.push(springTo(y, target.y, v.y, { speed, reduced }));
      void Promise.all(jobs).then(() => clearWillChange(gen));
    };

    const homeOf = (): AxisXY => ({ x: o().home?.x ?? 0, y: o().home?.y ?? 0 });

    const releaseCapture = () => {
      const el = s().captured;
      const pid = s().pid;
      s().captured = null;
      if (!el) return;
      try {
        if (el.hasPointerCapture?.(pid)) el.releasePointerCapture(pid);
      } catch {
        /* element gone */
      }
    };

    const finishCancel = () => {
      const state = s();
      const wasDrag = state.phase === "drag";
      state.phase = "idle";
      releaseCapture();
      if (!wasDrag) return;
      springHome(homeOf(), { x: 0, y: 0 }, 0);
      o().onCancel?.();
    };

    const applyMove = (clientX: number, clientY: number, timeStamp: number) => {
      const state = s();
      const { axis, x, y, map } = o();
      const dx = axis === "y" ? 0 : clientX - state.ex;
      const dy = axis === "x" ? 0 : clientY - state.ey;
      state.last = { dx, dy, clientX, clientY, timeStamp };
      const raw = { x: state.base.x + dx, y: state.base.y + dy };
      const out = map ? map(raw, state.base) : raw;
      if (x && axis !== "y" && out.x !== undefined) x.set(out.x);
      if (y && axis !== "x" && out.y !== undefined) y.set(out.y);
      o().onMove?.({
        dx,
        dy,
        clientX,
        clientY,
        timeStamp,
        base: state.base,
        velocity: () => {
          const v = trk().velocity(timeStamp);
          return { x: axis === "y" ? 0 : v.x, y: axis === "x" ? 0 : v.y };
        },
      });
    };

    const handlers: AxisDragHandlers = {
      onPointerDown(e) {
        const opt = o();
        const state = s();
        if (opt.enabled === false || state.phase === "drag") return;
        // a second finger while the first is still deciding: ignore (a stale mouse press may be replaced — its
        // pointerup can land outside the handle before capture)
        if (state.phase === "pending" && state.ptype !== "mouse" && e.pointerId !== state.pid) return;
        const ptype = (e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse") as PointerKind;
        if (!(opt.pointerTypes ?? ["touch", "pen"]).includes(ptype)) return;
        if (ptype === "mouse" && e.button !== 0) return;
        const t = e.target as Element | null;
        if (t && typeof t.closest === "function" && t.closest(opt.ignore ?? DEFAULT_DRAG_IGNORE)) return;
        state.phase = "pending";
        state.pid = e.pointerId;
        state.ptype = ptype;
        state.sx = e.clientX;
        state.sy = e.clientY;
        state.downT = e.timeStamp;
        state.swallow = false;
        trk().reset();
        trk().add(e.timeStamp, e.clientX, e.clientY);
        opt.onPress?.(e);
      },
      onPointerMove(e) {
        const state = s();
        if (e.pointerId !== state.pid || (state.phase !== "pending" && state.phase !== "drag")) return;
        trk().addEvent(e.nativeEvent);
        if (state.phase === "pending") {
          const opt = o();
          const lock = axisLock(e.clientX - state.sx, e.clientY - state.sy, opt.lock ?? opt.axis, opt.hysteresis ?? physics.hysteresis, opt.axisRatio ?? physics.axisRatio);
          if (lock === "pending") return;
          if (lock === "reject") {
            state.phase = "rejected";
            return;
          }
          state.phase = "drag";
          state.ex = e.clientX;
          state.ey = e.clientY;
          state.gen++;
          // catch a running spring where it is NOW (a tap never disturbs it: nothing is stopped before engagement)
          opt.x?.stop();
          opt.y?.stop();
          state.base = { x: opt.x?.get() ?? 0, y: opt.y?.get() ?? 0 };
          const el = e.currentTarget as Element;
          try {
            el.setPointerCapture?.(e.pointerId);
            state.captured = el;
          } catch {
            state.captured = null;
          }
          const wc = opt.willChange?.current;
          if (wc) wc.style.willChange = "transform";
          opt.onStart?.({ pointerType: state.ptype, startX: state.sx, startY: state.sy, base: state.base });
        }
        applyMove(e.clientX, e.clientY, e.timeStamp);
      },
      onPointerUp(e) {
        const state = s();
        if (e.pointerId !== state.pid) return;
        const phase = state.phase;
        state.phase = "idle";
        if (phase !== "drag") {
          if (phase === "pending") o().onTap?.(e);
          return;
        }
        releaseCapture();
        const opt = o();
        const v = trk().velocity(e.timeStamp);
        const vx = opt.axis === "y" ? 0 : v.x;
        const vy = opt.axis === "x" ? 0 : v.y;
        const speed = Math.hypot(vx, vy);
        state.swallow = true;
        if (state.swallowTimer) clearTimeout(state.swallowTimer);
        state.swallowTimer = setTimeout(() => {
          state.swallow = false;
          state.swallowTimer = 0;
        }, physics.clickSwallowMs);
        const res = opt.onRelease?.({
          ...state.last,
          base: state.base,
          vx,
          vy,
          speed,
          tempo: tempoOf(speed),
          durationMs: Math.max(0, e.timeStamp - state.downT),
          pointerType: state.ptype,
        });
        if (res === "none") {
          clearWillChange(state.gen);
          return;
        }
        springHome(res && typeof res === "object" ? res : homeOf(), { x: vx, y: vy }, speed);
      },
      onPointerCancel(e) {
        if (e.pointerId !== s().pid) return;
        finishCancel();
      },
      onLostPointerCapture(e) {
        const state = s();
        // only OUR capture: the implicit touch capture of a child moving to the handle bubbles here too
        if (e.pointerId !== state.pid || state.phase !== "drag" || !state.captured || e.target !== state.captured) return;
        state.captured = null;
        finishCancel();
      },
      onClickCapture(e) {
        const state = s();
        if (!state.swallow) return;
        state.swallow = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };

    return {
      handlers,
      style: {},
      isDragging: () => s().phase === "drag",
      cancel: () => {
        if (s().phase === "drag" || s().phase === "pending") finishCancel();
      },
    };
  }, []);

  // `enabled` → false mid-gesture: abort (values spring home)
  const enabled = options.enabled !== false;
  useEffect(() => {
    if (!enabled) api.cancel();
  }, [enabled, api]);

  useEffect(() => {
    const state = st.current;
    return () => {
      if (state.swallowTimer) clearTimeout(state.swallowTimer);
    };
  }, []);

  const touchAction = options.touchAction ?? (options.axis === "x" ? "pan-y" : options.axis === "y" ? "pan-x" : "none");
  const style = useMemo<CSSProperties>(() => ({ touchAction, userSelect: "none", WebkitUserSelect: "none" }), [touchAction]);
  return useMemo(() => ({ ...api, style }), [api, style]);
}
