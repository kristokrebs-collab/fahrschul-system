import { useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { appleSpring, clamp, createVelocityTracker, mixSpring, physics, projectPoint, tempoOf } from "@/motion/physics";
import { createFrameLoop, latestPointer, prefersReducedMotion, smoothing, type SpringConfig } from "@/motion/pulse/engine";
import { springRests, stepSpring, type SpringState } from "@/motion/pulse/springStep";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `draggable-widget-grid` (measured): press and hold a tile 250 ms → it lifts (scale 1.06 on a stiff
 * spring + a pre-rendered glow layer fading in, τ 70 ms) and follows the pointer through a 40 ms low-pass; when
 * its CENTRE enters another slot it takes that index (array move) and the others glide on the layout spring;
 * release settles it into its slot on the same spring while scale/glow return.
 */
export const CONFIG = {
  holdMs: 250,
  holdTolerance: { mouse: 120, touch: 10, pen: 10 } as Record<string, number>, // px of travel allowed while holding
  liftScale: 1.06,
  followTau: 40, // ms low-pass of the lifted tile
  springLayout: { stiffness: 230, damping: 27, mass: 1 }, // reorder + drop (ζ≈0.89)
  springScale: { stiffness: 900, damping: 40, mass: 1 }, // lift / drop (~120 ms)
  glowTau: 70, // ms
  reorderDelay: 10, // ms the centre must stay in a slot
  reorderCooldown: 90, // ms between two reorders
  hitInset: 10, // px
  /** Throw (physics, additive): a release at ≥ this speed (px/s) projects the centre (UIScrollView fast rate) to pick the slot. */
  throwMinSpeed: physics.throwMinSpeed,
  throwRate: physics.decelFast,
  /** Tilt while carried: degrees per px/s of horizontal speed, capped; swings back on its own spring (ζ ≈ .7). */
  tiltPerSpeed: 0.003,
  tiltMax: 4,
  tiltSpring: { stiffness: 400, damping: 28, mass: 1 },
  /** Drop of a thrown tile: `springLayout` for a slow release, blending to this short, slightly bouncy spring when fast. */
  dropFast: appleSpring(0.33, 0.26),
  /** Nothing palette (pack: light glow 0 20px 40px rgba(255,255,255,.075)). */
  glowShadow: "0 20px 40px rgb(255 255 255 / 0.075), 0 18px 36px rgb(0 0 0 / 0.45)",
  roleDescription: "verschiebbare Kachel",
  hint: "Leertaste oder Enter nimmt die Kachel auf, Pfeiltasten verschieben, Leertaste legt ab, Escape bricht ab. Mit der Maus oder dem Finger: gedrückt halten und ziehen.",
} as const;

export interface WidgetGridItem {
  id: string;
  node: ReactNode;
  /** Accessible name of the tile; without it the tile content names it. */
  label?: string;
}

export interface WidgetGridProps {
  items: readonly WidgetGridItem[];
  /** Controlled order (ids). Unknown ids are ignored, missing items are appended. */
  order?: readonly string[];
  onOrderChange?: (ids: string[]) => void;
  holdMs?: number;
  /** Grid layout classes (columns, gap). The container is `position: relative` (slots are measured from it). */
  className?: string;
  itemClassName?: string;
  "aria-label"?: string;
}

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Tile {
  el: HTMLElement | null;
  glow: HTMLElement | null;
  x: SpringState;
  y: SpringState;
  s: SpringState;
  /** tilt (deg) */
  r: SpringState;
  g: number;
  tx: number;
  ty: number;
  active: boolean;
  /** drop spring of a released tile (context spring from the release speed); `undefined` → `springLayout` */
  drop?: SpringConfig;
}

/** Normalised order: known ids from `order` first, then every item not mentioned. */
export function resolveOrder(items: readonly { id: string }[], order: readonly string[] | undefined): string[] {
  const ids = items.map((i) => i.id);
  if (!order) return ids;
  const known = new Set(ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of ids) if (!seen.has(id)) out.push(id);
  return out;
}

/** Array move: `id` goes to index `to`, the others keep their relative order. */
export function moveId(order: readonly string[], id: string, to: number): string[] {
  const from = order.indexOf(id);
  if (from < 0 || to < 0 || to >= order.length || from === to) return order.slice();
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Index of the slot (other than `self`) whose inset box contains the point, or -1. */
export function slotAt(slots: readonly Slot[], cx: number, cy: number, self: number, inset: number): number {
  for (let j = 0; j < slots.length; j++) {
    if (j === self) continue;
    const s = slots[j]!;
    if (cx >= s.x + inset && cx <= s.x + s.w - inset && cy >= s.y + inset && cy <= s.y + s.h - inset) return j;
  }
  return -1;
}

/**
 * Pure (throw-to-slot): the slot a tile released at `centre` with velocity `v` (px/s) lands in – the slot (other than
 * `self`) under the centre projected with UIScrollView's fast deceleration; between slots, the slot whose centre is
 * nearest to the projection (unless that is `self`). -1 when the release was slower than `minSpeed` or the projection
 * leaves the grid by more than half a slot (then the centre's own slot decides, as before).
 */
export function throwTarget(
  slots: readonly Slot[],
  centre: { x: number; y: number },
  v: { x: number; y: number },
  self: number,
  inset: number = CONFIG.hitInset,
  rate: number = CONFIG.throwRate,
  minSpeed: number = CONFIG.throwMinSpeed,
): number {
  if (!(Math.hypot(v.x, v.y) >= minSpeed) || slots.length === 0) return -1;
  const p = projectPoint(centre, v, rate);
  const hit = slotAt(slots, p.x, p.y, self, inset);
  if (hit >= 0) return hit;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let best = -1;
  let bestD = Infinity;
  slots.forEach((s, j) => {
    left = Math.min(left, s.x - s.w / 2);
    top = Math.min(top, s.y - s.h / 2);
    right = Math.max(right, s.x + s.w * 1.5);
    bottom = Math.max(bottom, s.y + s.h * 1.5);
    const d = Math.hypot(p.x - (s.x + s.w / 2), p.y - (s.y + s.h / 2));
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  });
  if (p.x < left || p.x > right || p.y < top || p.y > bottom || best === self) return -1;
  return best;
}

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const isInteractive = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button,input,select,textarea,[data-no-drag]");

/**
 * Hold-to-lift reorderable grid. DOM order = committed order; while dragging, tiles only move by transform to
 * their working slots (slots measured once at grab), the commit (`onOrderChange`) reorders the DOM and a FLIP
 * keeps every tile where it is, so the springs just continue. Keyboard: Space/Enter grab, arrows move
 * (Up/Down by a row), Home/End, Space/Enter drop, Escape cancels. Touch scrolls normally until a tile is lifted.
 * Physics (additive): a carried tile leans up to 4° into its horizontal motion; a thrown release (≥ 400 px/s) lands in
 * the slot under its projected centre on a drop spring that blends from `springLayout` (slow) to `dropFast` (fast).
 */
export function WidgetGrid({ items, order, onOrderChange, holdMs = CONFIG.holdMs, className, itemClassName, "aria-label": ariaLabel }: WidgetGridProps) {
  const reduced = useReducedFx();
  const uid = useId();
  const hintId = `wg-${uid}-hint`;
  const [inner, setInner] = useState<readonly string[] | undefined>(undefined);
  const domOrder = useMemo(() => resolveOrder(items, order ?? inner), [items, order, inner]);
  const [live, setLive] = useState<{ order: string[]; grabbed: string | null } | null>(null);
  const [, setSync] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, Tile>());
  const slots = useRef<Slot[]>([]);
  const work = useRef<string[]>(domOrder);
  const committed = useRef<string[]>(domOrder);
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  const reducedRef = useRef(reduced);
  const refocus = useRef<string | null>(null);
  const drag = useRef({
    phase: "idle" as "idle" | "hold" | "drag",
    id: "",
    pid: -1,
    ptype: "mouse",
    sx: 0,
    sy: 0,
    px: 0,
    py: 0,
    offX: 0,
    offY: 0,
    originX: 0,
    originY: 0,
    scrollX: 0,
    scrollY: 0,
    kbd: false,
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    cand: -1,
    candSince: 0,
    lastReorder: -1e9,
    startOrder: [] as string[],
    moved: false,
  });
  // coalesced pointer samples of the current press → release velocity for the throw (reset per press)
  const tracker = useRef(createVelocityTracker());

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  const tile = (id: string): Tile => {
    let t = tiles.current.get(id);
    if (!t) {
      t = { el: null, glow: null, x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, s: { x: 1, v: 0 }, r: { x: 0, v: 0 }, g: 0, tx: 0, ty: 0, active: false };
      tiles.current.set(id, t);
    }
    return t;
  };

  const measure = useCallback(() => {
    const ids = committed.current;
    slots.current = ids.map((id) => {
      const el = tiles.current.get(id)?.el;
      return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: 0, y: 0, w: 0, h: 0 };
    });
  }, []);

  /** Working-slot targets for every tile that is not following the pointer. */
  const retarget = useCallback(() => {
    const d = drag.current;
    const sl = slots.current;
    committed.current.forEach((id, domIdx) => {
      const t = tile(id);
      if (d.phase === "drag" && !d.kbd && id === d.id) return;
      const wi = work.current.indexOf(id);
      const to = sl[wi];
      const home = sl[domIdx];
      if (!to || !home) return;
      t.tx = to.x - home.x;
      t.ty = to.y - home.y;
      t.active = true;
    });
  }, []);

  // --- frame loop (one for the grid; sleeps when every tile rests) ---
  useEffect(() => {
    const C = CONFIG;
    const paint = (t: Tile) => {
      if (!t.el) return;
      const tilt = Math.abs(t.r.x) >= 0.005 ? ` rotate(${t.r.x.toFixed(3)}deg)` : "";
      t.el.style.transform = `translate3d(${t.x.x.toFixed(2)}px,${t.y.x.toFixed(2)}px,0)${tilt} scale(${t.s.x.toFixed(4)})`;
      if (t.glow) t.glow.style.opacity = Math.max(0, Math.min(1, t.g)).toFixed(3);
    };
    const tick = (dt: number): boolean => {
      const now = performance.now();
      const d = drag.current;
      const red = reducedRef.current || prefersReducedMotion();
      const sl = slots.current;
      let busy = d.phase === "hold";
      const dragging = d.phase === "drag" ? d.id : null;
      if (dragging && !d.kbd) {
        const t = tile(dragging);
        const domIdx = committed.current.indexOf(dragging);
        const home = sl[domIdx];
        if (home) {
          const gx = d.px - d.originX + (window.scrollX - d.scrollX);
          const gy = d.py - d.originY + (window.scrollY - d.scrollY);
          t.tx = gx + d.offX - home.w / 2 - home.x;
          t.ty = gy + d.offY - home.h / 2 - home.y;
          // reorder when the tile's centre (not the pointer) sits in another slot for reorderDelay
          const cx = home.x + t.x.x + home.w / 2;
          const cy = home.y + t.y.x + home.h / 2;
          const self = work.current.indexOf(dragging);
          const hit = slotAt(sl, cx, cy, self, C.hitInset);
          if (hit !== d.cand) {
            d.cand = hit;
            d.candSince = now;
          } else if (hit >= 0 && now - d.candSince >= C.reorderDelay && now - d.lastReorder > C.reorderCooldown) {
            work.current = moveId(work.current, dragging, hit);
            d.lastReorder = now;
            d.cand = -1;
            retarget();
            setLive({ order: work.current, grabbed: dragging });
          }
        }
      }
      for (const id of committed.current) {
        const t = tile(id);
        const isDrag = id === dragging;
        if (!isDrag && !t.active) continue;
        const ts = isDrag ? C.liftScale : 1;
        const tg = isDrag ? 1 : 0;
        // carried by the pointer: lean into the horizontal motion (the follower's velocity, px/s), upright otherwise
        const tr = isDrag && !d.kbd ? clamp(t.x.v * C.tiltPerSpeed, -C.tiltMax, C.tiltMax) : 0;
        if (red) {
          t.x = { x: t.tx, v: 0 };
          t.y = { x: t.ty, v: 0 };
          t.s = { x: 1, v: 0 };
          t.r = { x: 0, v: 0 };
          t.g = tg;
        } else {
          if (isDrag && !d.kbd) {
            const a = smoothing(1000 / C.followTau, dt);
            const nx = t.x.x + (t.tx - t.x.x) * a;
            const ny = t.y.x + (t.ty - t.y.x) * a;
            if (dt > 0) {
              t.x.v = (nx - t.x.x) / dt;
              t.y.v = (ny - t.y.x) / dt;
            }
            t.x.x = nx;
            t.y.x = ny;
          } else {
            const drop = t.drop ?? C.springLayout;
            stepSpring(t.x, t.tx, drop, dt);
            stepSpring(t.y, t.ty, drop, dt);
          }
          stepSpring(t.s, ts, C.springScale, dt);
          stepSpring(t.r, tr, C.tiltSpring, dt);
          t.g += (tg - t.g) * smoothing(1000 / C.glowTau, dt);
        }
        const rest =
          springRests(t.x, t.tx, 0.05, 0.5) && springRests(t.y, t.ty, 0.05, 0.5) && springRests(t.s, ts, 0.0005, 0.01) && springRests(t.r, tr, 0.01, 0.1) && Math.abs(t.g - tg) < 0.004;
        if (rest && !isDrag) {
          t.x = { x: t.tx, v: 0 };
          t.y = { x: t.ty, v: 0 };
          t.s = { x: 1, v: 0 };
          t.r = { x: 0, v: 0 };
          t.drop = undefined;
          t.g = 0;
          paint(t);
          t.active = false;
          if (t.el) {
            t.el.style.willChange = "";
            t.el.style.zIndex = "";
            if (t.tx === 0 && t.ty === 0) t.el.style.transform = "";
          }
        } else {
          paint(t);
          busy = true;
        }
      }
      return busy || d.phase === "drag";
    };
    const loop = createFrameLoop(tick);
    loopRef.current = loop;
    const d = drag.current;
    return () => {
      loop.stop();
      loopRef.current = null;
      if (d.timer) clearTimeout(d.timer);
    };
  }, [retarget]);

  const wake = () => {
    const loop = loopRef.current;
    if (loop) loop.wake();
  };

  const blockTouch = useCallback((e: TouchEvent) => {
    if (drag.current.phase === "drag" && e.cancelable) e.preventDefault();
  }, []);

  const lift = (id: string) => {
    const t = tile(id);
    t.active = true;
    if (t.el) {
      t.el.style.zIndex = "2";
      t.el.style.willChange = "transform";
    }
  };

  const beginDrag = () => {
    const d = drag.current;
    if (d.phase !== "hold") return;
    d.phase = "drag";
    d.startOrder = work.current.slice();
    d.moved = true;
    lift(d.id);
    const t = tile(d.id);
    if (!d.kbd && t.el && d.pid >= 0) {
      try {
        t.el.setPointerCapture(d.pid);
      } catch {
        /* pointer already gone */
      }
    }
    if (d.ptype === "touch") {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* vibration blocked */
      }
    }
    setLive({ order: work.current, grabbed: d.id });
    wake();
  };

  /**
   * `release` (pointer drops only): the release time for the velocity read. A throw (≥ `throwMinSpeed`) moves the tile
   * to the slot under its projected centre, and its drop spring blends from `springLayout` to `dropFast` with the speed.
   */
  const endDrag = (cancel: boolean, release?: number) => {
    const d = drag.current;
    if (d.timer) clearTimeout(d.timer);
    d.timer = 0;
    window.removeEventListener("touchmove", blockTouch, true);
    const id = d.id;
    const wasDrag = d.phase === "drag";
    const wasKbd = d.kbd;
    const t = tiles.current.get(id);
    if (t?.el && d.pid >= 0) {
      try {
        t.el.releasePointerCapture(d.pid);
      } catch {
        /* not captured */
      }
    }
    d.phase = "idle";
    d.pid = -1;
    d.kbd = false;
    if (!wasDrag) return;
    if (cancel) work.current = d.startOrder.slice();
    else if (!wasKbd && release !== undefined && t) {
      const v = tracker.current.velocity(release);
      const speed = Math.hypot(v.x, v.y);
      const sl = slots.current;
      const home = sl[committed.current.indexOf(id)];
      if (home && speed > 0) {
        const hit = throwTarget(sl, { x: home.x + t.x.x + home.w / 2, y: home.y + t.y.x + home.h / 2 }, v, work.current.indexOf(id));
        if (hit >= 0) work.current = moveId(work.current, id, hit);
        t.drop = mixSpring(CONFIG.springLayout, CONFIG.dropFast, tempoOf(speed));
      }
    }
    retarget();
    wake();
    setLive(null);
    const next = work.current.slice();
    if (!sameOrder(next, committed.current)) {
      if (onOrderChange) onOrderChange(next);
      if (order === undefined) setInner(next);
    }
    setSync((n) => n + 1);
    if (wasKbd) refocus.current = id;
  };

  // commit / external order change: FLIP every tile from its old natural slot to the new one, then reconcile
  useLayoutEffect(() => {
    const prev = committed.current;
    if (!sameOrder(prev, domOrder)) {
      const oldSlots = slots.current.length === prev.length ? slots.current : null;
      committed.current = domOrder;
      measure();
      if (oldSlots) {
        domOrder.forEach((id, i) => {
          const oi = prev.indexOf(id);
          const o = oldSlots[oi];
          const n = slots.current[i];
          if (!o || !n) return;
          const t = tile(id);
          t.x.x += o.x - n.x;
          t.y.x += o.y - n.y;
          if (t.x.x !== 0 || t.y.x !== 0) t.active = true;
        });
      }
    }
    if (drag.current.phase === "idle" && !sameOrder(work.current, domOrder)) work.current = domOrder.slice();
    if (drag.current.phase === "idle") {
      retarget();
      wake();
    }
    const id = refocus.current;
    if (id) {
      refocus.current = null;
      const el = tiles.current.get(id)?.el;
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    const t = tiles.current;
    const ids = new Set(items.map((i) => i.id));
    for (const id of t.keys()) if (!ids.has(id)) t.delete(id);
  }, [items]);

  // remeasure on container resize (column count may change) – never per frame
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      if (drag.current.phase === "idle") measure();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  const onPointerDown = (id: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.phase !== "idle" || (e.pointerType === "mouse" && e.button !== 0) || isInteractive(e.target)) return;
    const root = rootRef.current;
    if (!root) return;
    measure();
    const r = root.getBoundingClientRect();
    const t = tile(id);
    const home = slots.current[committed.current.indexOf(id)];
    if (!home) return;
    d.phase = "hold";
    d.id = id;
    d.pid = e.pointerId;
    d.ptype = e.pointerType || "mouse";
    d.kbd = false;
    d.moved = false;
    d.sx = d.px = e.clientX;
    d.sy = d.py = e.clientY;
    d.originX = r.left;
    d.originY = r.top;
    d.scrollX = window.scrollX;
    d.scrollY = window.scrollY;
    d.cand = -1;
    tracker.current.reset();
    tracker.current.add(e.timeStamp, e.clientX, e.clientY);
    const gx = e.clientX - r.left;
    const gy = e.clientY - r.top;
    // grab point relative to the tile centre (kept for the whole drag)
    d.offX = home.x + t.x.x + home.w / 2 - gx;
    d.offY = home.y + t.y.x + home.h / 2 - gy;
    if (d.ptype === "touch") window.addEventListener("touchmove", blockTouch, { passive: false, capture: true });
    d.timer = setTimeout(beginDrag, reduced ? Math.min(holdMs, 150) : holdMs);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (e.pointerId !== d.pid) return;
    const p = latestPointer(e.nativeEvent);
    d.px = p.x;
    d.py = p.y;
    tracker.current.addEvent(e.nativeEvent);
    if (d.phase === "hold") {
      const tol = CONFIG.holdTolerance[d.ptype] ?? 10;
      if (Math.hypot(d.px - d.sx, d.py - d.sy) > tol) endDrag(true);
    } else if (d.phase === "drag") wake();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (e.pointerId === d.pid && !d.kbd) endDrag(e.type === "pointercancel", e.type === "pointercancel" ? undefined : e.timeStamp);
  };

  const onKeyDown = (id: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const d = drag.current;
    if (d.phase === "drag" && d.kbd && d.id === id) {
      const i = work.current.indexOf(id);
      const n = work.current.length;
      const sl = slots.current;
      const cols = Math.max(1, sl.filter((s) => s.y === sl[0]?.y).length);
      let to: number | null = null;
      if (e.key === "ArrowLeft") to = i - 1;
      else if (e.key === "ArrowRight") to = i + 1;
      else if (e.key === "ArrowUp") to = i - cols;
      else if (e.key === "ArrowDown") to = i + cols;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = n - 1;
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        endDrag(false);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endDrag(true);
        return;
      }
      if (to !== null) {
        e.preventDefault();
        to = Math.max(0, Math.min(n - 1, to));
        if (to !== i) {
          work.current = moveId(work.current, id, to);
          retarget();
          setLive({ order: work.current, grabbed: id });
          wake();
        }
      }
    } else if (d.phase === "idle" && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      measure();
      d.phase = "hold";
      d.id = id;
      d.kbd = true;
      d.pid = -1;
      d.ptype = "key";
      beginDrag();
      retarget();
    }
  };

  const onBlur = (id: string) => () => {
    const d = drag.current;
    if (d.phase === "drag" && d.kbd && d.id === id) endDrag(false);
  };

  // a click that ends a drag must not activate the tile's content
  const onClickCapture = (e: ReactMouseEvent) => {
    const d = drag.current;
    if (d.moved && d.phase === "idle") {
      d.moved = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const positions = live?.order ?? domOrder;
  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <div ref={rootRef} role="list" aria-label={ariaLabel} className={cn("relative", className)} onClickCapture={onClickCapture}>
      {domOrder.map((id) => {
        const it = byId.get(id);
        if (!it) return null;
        const pos = positions.indexOf(id) + 1;
        const posText = `${pos} von ${positions.length}`;
        const grabbed = live?.grabbed === id;
        return (
          <div
            key={id}
            ref={(el) => {
              tile(id).el = el;
            }}
            role="listitem"
            tabIndex={0}
            aria-roledescription={CONFIG.roleDescription}
            aria-label={it.label ? `${it.label}, ${posText}` : undefined}
            aria-labelledby={it.label ? undefined : `wg-${uid}-${id}-c wg-${uid}-${id}-p`}
            aria-describedby={hintId}
            data-grabbed={grabbed || undefined}
            onPointerDown={onPointerDown(id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onLostPointerCapture={(e) => {
              if (e.pointerId === drag.current.pid && drag.current.phase === "drag" && !drag.current.kbd) endDrag(false);
            }}
            onContextMenu={(e) => {
              if (drag.current.phase !== "idle") e.preventDefault();
            }}
            onDragStart={(e) => e.preventDefault()}
            onKeyDown={onKeyDown(id)}
            onBlur={onBlur(id)}
            className={cn(
              "relative min-w-0 touch-pan-y select-none rounded-2xl outline-none [-webkit-touch-callout:none] focus-visible:shadow-[0_0_0_2px_rgb(255_255_255/0.35)] data-[grabbed]:cursor-grabbing",
              itemClassName,
            )}
          >
            <div
              aria-hidden="true"
              ref={(el) => {
                tile(id).glow = el;
              }}
              className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0"
              style={{ boxShadow: CONFIG.glowShadow }}
            />
            <div id={`wg-${uid}-${id}-c`} className="relative h-full">
              {it.node}
            </div>
            {!it.label && (
              <span id={`wg-${uid}-${id}-p`} hidden>
                {posText}
              </span>
            )}
          </div>
        );
      })}
      <span id={hintId} hidden>
        {CONFIG.hint}
      </span>
    </div>
  );
}

export interface LiftHandle {
  /** Bind to the dragged element: `style={{ scale }}`. */
  scale: MotionValue<number>;
  /** Bind to a pre-rendered glow/shadow layer: `style={{ opacity: glow }}`. */
  glow: MotionValue<number>;
  lift: () => void;
  settle: () => void;
}

/**
 * Lift/settle physics of the grid for an existing drag (e.g. motion `Reorder.Item`): `lift()` on drag start springs
 * scale to 1.06 (900/40) and fades the glow in (τ 70 ms), `settle()` returns both. Driven by MotionValues from one
 * sleeping frame loop – no React state per frame. Reduced motion: glow only, no scale.
 */
export function useLift(options: { scale?: number } = {}): LiftHandle {
  const liftScale = options.scale ?? CONFIG.liftScale;
  const reduced = useReducedFx();
  const scale = useMotionValue(1);
  const glow = useMotionValue(0);
  const state = useRef({ on: false, s: { x: 1, v: 0 } as SpringState, g: 0 });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  const cfg = useRef({ liftScale, reduced });

  useEffect(() => {
    cfg.current = { liftScale, reduced };
  }, [liftScale, reduced]);

  useEffect(() => {
    const st = state.current;
    const loop = createFrameLoop((dt) => {
      const { liftScale: ls, reduced: red } = cfg.current;
      const ts = st.on && !red && !prefersReducedMotion() ? ls : 1;
      const tg = st.on ? 1 : 0;
      stepSpring(st.s, ts, CONFIG.springScale, dt);
      st.g += (tg - st.g) * smoothing(1000 / CONFIG.glowTau, dt);
      const rest = springRests(st.s, ts, 0.0005, 0.01) && Math.abs(st.g - tg) < 0.004;
      if (rest) {
        st.s = { x: ts, v: 0 };
        st.g = tg;
      }
      scale.set(st.s.x);
      glow.set(st.g);
      return !rest;
    });
    loopRef.current = loop;
    return () => loop.stop();
  }, [scale, glow]);

  const run = useCallback(
    (on: boolean) => {
      state.current.on = on;
      const loop = loopRef.current;
      if (loop && typeof requestAnimationFrame === "function") loop.wake();
      else {
        state.current.s = { x: on && !cfg.current.reduced ? cfg.current.liftScale : 1, v: 0 };
        state.current.g = on ? 1 : 0;
        scale.set(state.current.s.x);
        glow.set(state.current.g);
      }
    },
    [scale, glow],
  );

  const lift = useCallback(() => run(true), [run]);
  const settle = useCallback(() => run(false), [run]);
  return { scale, glow, lift, settle };
}
