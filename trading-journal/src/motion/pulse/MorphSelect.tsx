import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { axisLock, haptic, physics, progressVelocity, createVelocityTracker } from "@/motion/physics";
import { clamp01, createFrameLoop, easeOutCubic, prefersReducedMotion } from "@/motion/pulse/engine";
import { springRests, stepSpring, type SpringState } from "@/motion/pulse/springStep";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `morphing-language-selector` (measured): the field morphs on a spring into a scrollable list panel
 * (content fades in 90 ms, radius eases 140 ms); choosing hides the content at once, holds 40 ms and the panel
 * retracts critically damped into the field, which now shows the new value.
 */
export const CONFIG = {
  springOpen: { stiffness: 660, damping: 40, mass: 1 }, // ζ≈0.78, ~1.8 % overshoot, peak ~195 ms
  springClose: { stiffness: 560, damping: 47, mass: 1 }, // ζ≈1, no overshoot
  closeDelay: 40, // ms hold before the retract
  radiusOpenMs: 140, // ease-out cubic, field radius → panel radius
  contentInMs: 90,
  thumbIdleMs: 1400, // scroll thumb fades this long after the last scroll
  closeFadeFrom: 0.35, // spring progress below which the retracting ghost fades out (it ends under the field)
  rowH: 40,
  /** Coarse pointers: 44 px rows (tap targets ≥ 44 × 44). */
  rowHCoarse: 44,
  /** Touch / pen press-drag-release: holding this long (ms, still) opens the panel under the finger. */
  pressHoldMs: 300,
  rowGap: 3,
  headH: 36,
  listPad: 6,
  panelMaxH: 275, // pack panel 230 × 275
  panelMinW: 240, // pack 230; room for the longest setup name + hint
  gap: 6, // px between field and panel
  edge: 8, // px kept free to the viewport edge
  minBelow: 160, // flip up when less room than this below (and more above)
  fieldRadius: 12, // radius.input
  panelRadius: 16, // radius.card (pack 24 at a 38 px pill)
  typeaheadMs: 500,
  /** Nothing palette (pack: #1e1e1e panel, blue active row). */
  panelShadow: "0 14px 40px rgb(0 0 0 / 0.45), 0 2px 8px rgb(0 0 0 / 0.3)",
  zIndex: 75, // above Sheet (60) / MorphDialog (70), below Celebrate (80)
} as const;

export interface MorphSelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Small right-aligned mono hint (count, unit). */
  hint?: string;
}

export interface MorphSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly MorphSelectOption<T>[];
  /** Id of the trigger button – `<label htmlFor>` points here. */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** Classes for the trigger (width, min-width). */
  className?: string;
  size?: "sm" | "md";
  /** Optional uppercase panel header with a close button. */
  heading?: string;
  "data-testid"?: string;
}

type Phase = "closed" | "open" | "closing";

interface Geo {
  left: number;
  top: number;
  w: number;
  h: number;
  up: boolean;
  sx0: number;
  sy0: number;
  ox: number;
  scrollable: boolean;
  /** row height (px): `CONFIG.rowH`, `CONFIG.rowHCoarse` on coarse pointers */
  rowH: number;
}

interface Anim {
  mode: "idle" | "opening" | "open" | "closing";
  s: SpringState;
  t0: number;
  startAt: number;
  sx0: number;
  sy0: number;
  scrollTop: number;
  scrollH: number;
  clientH: number;
  scrollDirty: boolean;
  lastScroll: number;
  thumbOn: boolean;
  radiusDone: boolean;
}

const SIZE = {
  md: "px-3 py-2 text-[13.5px] leading-5",
  sm: "px-2.5 py-1.5 text-[12.5px] leading-5",
} as const;

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Panel placement from ONE measurement of the trigger: below (or flipped above), clamped to the viewport. */
export function placePanel(r: { left: number; top: number; width: number; height: number }, rows: number, heading: boolean, vw: number, vh: number, rowH: number = CONFIG.rowH): Geo {
  const C = CONFIG;
  const needed = (heading ? C.headH : 0) + C.listPad * 2 + rows * rowH + Math.max(0, rows - 1) * C.rowGap + 2;
  const w = Math.min(Math.max(r.width, C.panelMinW), vw - C.edge * 2);
  const left = Math.min(Math.max(r.left, C.edge), Math.max(C.edge, vw - C.edge - w));
  const below = vh - (r.top + r.height) - C.gap - C.edge;
  const above = r.top - C.gap - C.edge;
  const up = below < Math.min(needed, C.minBelow) && above > below;
  const room = Math.max(rowH + C.listPad * 2 + 2, up ? above : below);
  const h = Math.min(needed, C.panelMaxH, room);
  const top = up ? r.top - C.gap - h : r.top + r.height + C.gap;
  const sx0 = Math.min(1, r.width / w);
  const sy0 = Math.min(1, r.height / h);
  // transform-origin x so the scaled box starts exactly under the field even when the panel was shifted left
  const ox = sx0 < 1 ? (r.left - left) / (1 - sx0) : 0;
  return { left, top, w, h, up, sx0, sy0, ox, scrollable: needed > h, rowH };
}

/**
 * Pure: the option row under a client point while the panel is open (press-drag-release, arithmetic only – no layout
 * reads): -1 outside the panel's list, in the gap between rows or past the last row.
 */
export function rowAtPoint(g: Pick<Geo, "left" | "top" | "w" | "h" | "rowH">, heading: boolean, scrollTop: number, count: number, x: number, y: number): number {
  const C = CONFIG;
  if (x < g.left || x > g.left + g.w || y < g.top || y > g.top + g.h) return -1;
  const listTop = g.top + 1 + (heading ? C.headH : 0);
  const off = y - listTop - C.listPad + scrollTop;
  if (off < 0) return -1;
  const pitch = g.rowH + C.rowGap;
  const i = Math.floor(off / pitch);
  if (off - i * pitch > g.rowH || i >= count) return -1;
  return i;
}

function coarsePointer(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Next option index for a typeahead buffer (cycles from the current one for repeated single letters). */
export function typeaheadIndex(labels: readonly string[], buffer: string, from: number): number {
  if (!buffer || labels.length === 0) return -1;
  const q = fold(buffer);
  const single = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = single ? q[0]! : q;
  const start = needle.length === 1 ? from + 1 : from;
  for (let k = 0; k < labels.length; k++) {
    const i = (((start + k) % labels.length) + labels.length) % labels.length;
    if (fold(labels[i]!).startsWith(needle)) return i;
  }
  return -1;
}

/**
 * Physics / touch (additive): UIMenu press-drag-release – press the field and drag (mouse: 10 px vertical; touch / pen:
 * hold 300 ms still, then drag) and the panel opens under the pointer; the row under it is highlighted (arithmetic hit
 * test, selection haptic on touch) and releasing on a row picks it; releasing elsewhere keeps the panel open, a fling
 * away (≥ 600 px/s) dismisses it with the throw's speed. A plain tap still toggles. Rows are 44 px on coarse pointers.
 *
 * Drop-in replacement for a native `<select>` (WAI-ARIA listbox popup): trigger `button[aria-haspopup=listbox]`
 * shows the selected label; the panel lives in a fixed layer (escapes clipping/scroll containers, positioned from
 * one measurement at open, flips up when there is no room) and grows out of the field without covering it.
 * Keyboard: Enter/Space/ArrowDown/ArrowUp open; arrows, Home/End, PageUp/PageDown, typeahead move; Enter/Space
 * choose; Esc/Tab close with focus back on the trigger. Per frame only transform/opacity are written (plus the
 * pack's 140 ms radius ease at open).
 */
export function MorphSelect<T extends string = string>({
  value,
  onChange,
  options,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  placeholder = "–",
  disabled,
  className,
  size = "md",
  heading,
  "data-testid": testId,
}: MorphSelectProps<T>) {
  const reduced = useReducedFx();
  const uid = useId();
  const triggerId = id ?? `ms-${uid}`;
  const listId = `${triggerId}-list`;
  const valueId = `${triggerId}-value`;
  const optId = (i: number) => `${triggerId}-opt-${i}`;

  const [phase, setPhase] = useState<Phase>("closed");
  const [geo, setGeo] = useState<Geo | null>(null);
  // pre-mounted (hidden) panel while the trigger is hovered/focused: opening then only restyles existing DOM
  const [warm, setWarm] = useState(false);
  const [active, setActive] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  const typeRef = useRef({ buffer: "", timer: 0 as ReturnType<typeof setTimeout> | 0 });
  const geoRef = useRef<Geo | null>(null);
  // press-drag-release on the trigger (UIMenu): armed on pointerdown, "drag" once the panel opened under the pointer
  const pressRef = useRef({ mode: "idle" as "idle" | "armed" | "drag", pid: -1, touch: false, sx: 0, sy: 0, timer: 0 as ReturnType<typeof setTimeout> | 0, row: -1, suppressClick: false });
  const tracker = useRef(createVelocityTracker());
  const anim = useRef<Anim>({ mode: "idle", s: { x: 0, v: 0 }, t0: 0, startAt: 0, sx0: 1, sy0: 1, scrollTop: 0, scrollH: 0, clientH: 0, scrollDirty: false, lastScroll: -1e9, thumbOn: false, radiusDone: true });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // --- frame loop: spring + radius + content fade + scroll thumb; sleeps when nothing moves ---
  useEffect(() => {
    const C = CONFIG;
    const setRadius = (u: number) => {
      const box = boxRef.current;
      if (!box) return;
      const a = anim.current;
      const rx = C.fieldRadius / a.sx0;
      const ry = C.fieldRadius / a.sy0;
      box.style.borderRadius = `${(rx + (C.panelRadius - rx) * u).toFixed(1)}px / ${(ry + (C.panelRadius - ry) * u).toFixed(1)}px`;
    };
    const paint = (p: number) => {
      const box = boxRef.current;
      if (!box) return;
      const a = anim.current;
      box.style.transform = `scale(${(a.sx0 + (1 - a.sx0) * p).toFixed(4)},${(a.sy0 + (1 - a.sy0) * p).toFixed(4)})`;
    };
    const tick = (dt: number): boolean => {
      // absolute times share performance.now()'s origin (t0/startAt are set from it in event handlers)
      const now = performance.now();
      const a = anim.current;
      const box = boxRef.current;
      let busy = false;
      if (a.mode === "opening") {
        stepSpring(a.s, 1, C.springOpen, dt);
        const e = now - a.t0;
        const content = contentRef.current;
        if (content && content.style.opacity !== "1") {
          content.style.opacity = String(clamp01(e / C.contentInMs));
          if (e >= C.contentInMs) content.style.willChange = "";
        }
        if (!a.radiusDone) {
          setRadius(easeOutCubic(e / C.radiusOpenMs));
          a.radiusDone = e >= C.radiusOpenMs;
        }
        if (springRests(a.s, 1, 0.0004) && e >= C.radiusOpenMs) {
          a.s.x = 1;
          a.s.v = 0;
          a.mode = "open";
          if (box) {
            box.style.transform = "none";
            box.style.willChange = "";
          }
        } else {
          paint(a.s.x);
          busy = true;
        }
      } else if (a.mode === "closing") {
        if (now >= a.startAt) stepSpring(a.s, 0, C.springClose, dt);
        paint(a.s.x);
        if (box) box.style.opacity = String(clamp01(a.s.x / C.closeFadeFrom));
        if (now >= a.startAt && springRests(a.s, 0, 0.002, 0.05)) {
          a.mode = "idle";
          a.s.x = 0;
          a.s.v = 0;
          if (box) box.style.willChange = "";
          setPhase("closed");
        } else busy = true;
      }
      const thumb = thumbRef.current;
      if (thumb && (a.mode === "open" || a.mode === "opening")) {
        if (a.scrollDirty) {
          a.scrollDirty = false;
          const th = Math.max(24, (a.clientH * a.clientH) / Math.max(1, a.scrollH) - 8);
          const travel = a.clientH - th - 16;
          const y = 8 + travel * (a.scrollTop / Math.max(1, a.scrollH - a.clientH));
          thumb.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
          if (!a.thumbOn) {
            a.thumbOn = true;
            thumb.dataset.on = "";
          }
        }
        if (a.thumbOn && now - a.lastScroll > C.thumbIdleMs) {
          a.thumbOn = false;
          delete thumb.dataset.on;
        }
        if (a.thumbOn) busy = true;
      }
      return busy;
    };
    const loop = createFrameLoop(tick);
    loopRef.current = loop;
    const type = typeRef.current;
    return () => {
      loop.stop();
      loopRef.current = null;
      if (type.timer) clearTimeout(type.timer);
    };
  }, []);

  const open = useCallback(() => {
    const t = triggerRef.current;
    if (!t || disabled || options.length === 0) return;
    const r = t.getBoundingClientRect();
    const g = placePanel(r, options.length, !!heading, window.innerWidth, window.innerHeight, coarsePointer() ? CONFIG.rowHCoarse : CONFIG.rowH);
    geoRef.current = g;
    setGeo(g);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setPhase("open");
  }, [disabled, options.length, heading, selectedIndex]);

  const close = useCallback(
    (choose?: T, focusTrigger = true, flingVelocity = 0) => {
      const a = anim.current;
      if (a.mode === "idle" || a.mode === "closing") return;
      if (choose !== undefined && choose !== value) onChange(choose);
      if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
      if (reduced || prefersReducedMotion() || !boxRef.current) {
        a.mode = "idle";
        a.s = { x: 0, v: 0 };
        setPhase("closed");
        return;
      }
      const box = boxRef.current;
      a.mode = "closing";
      // a fling retracts at once and keeps the throw's speed (progress units / s); a choice holds 40 ms first
      a.startAt = performance.now() + (flingVelocity ? 0 : CONFIG.closeDelay);
      if (flingVelocity) a.s.v = flingVelocity;
      a.thumbOn = false;
      if (contentRef.current) contentRef.current.style.opacity = "0";
      const rx = CONFIG.fieldRadius / a.sx0;
      const ry = CONFIG.fieldRadius / a.sy0;
      box.style.borderRadius = `${rx.toFixed(1)}px / ${ry.toFixed(1)}px`;
      box.style.willChange = "transform, opacity";
      setPhase("closing");
      loopRef.current?.wake();
    },
    [onChange, reduced, value],
  );

  // open edge (and re-open while retracting): first frame state is written before paint
  useLayoutEffect(() => {
    if (phase !== "open" || !geo) return;
    const a = anim.current;
    if (a.mode === "opening" || a.mode === "open") return;
    const box = boxRef.current;
    const list = listRef.current;
    if (!box || !list) return;
    const fromRest = a.mode === "idle";
    a.sx0 = geo.sx0;
    a.sy0 = geo.sy0;
    a.scrollH = list.scrollHeight;
    a.clientH = list.clientHeight;
    if (selectedIndex >= 0) {
      const rowTop = CONFIG.listPad + selectedIndex * (geo.rowH + CONFIG.rowGap);
      list.scrollTop = Math.max(0, rowTop - (a.clientH - geo.rowH) / 2);
    }
    a.scrollTop = list.scrollTop;
    if (thumbRef.current) thumbRef.current.style.height = `${Math.max(24, (a.clientH * a.clientH) / Math.max(1, a.scrollH) - 8).toFixed(1)}px`;
    list.focus({ preventScroll: true });
    box.style.opacity = "1";
    if (reduced || prefersReducedMotion()) {
      a.mode = "open";
      a.s = { x: 1, v: 0 };
      box.style.transform = "none";
      box.style.borderRadius = `${CONFIG.panelRadius}px`;
      if (contentRef.current) contentRef.current.style.opacity = "1";
      return;
    }
    if (fromRest) {
      a.s = { x: 0, v: 0 };
      box.style.transform = `scale(${geo.sx0},${geo.sy0})`;
      if (contentRef.current) contentRef.current.style.opacity = "0";
    }
    box.style.willChange = "transform";
    // content fades on its own layer, so the 90 ms fade never repaints the panel
    if (contentRef.current && contentRef.current.style.opacity !== "1") contentRef.current.style.willChange = "opacity";
    a.radiusDone = false;
    a.t0 = performance.now();
    a.mode = "opening";
    loopRef.current?.wake();
  }, [phase, geo, reduced, selectedIndex]);

  // keep the active option inside the scroll viewport (cached row geometry, no per-frame reads)
  useLayoutEffect(() => {
    if (phase !== "open") return;
    const list = listRef.current;
    if (!list) return;
    const a = anim.current;
    const rowH = geoRef.current?.rowH ?? CONFIG.rowH;
    const top = CONFIG.listPad + active * (rowH + CONFIG.rowGap);
    const st = list.scrollTop;
    if (top - CONFIG.listPad < st) list.scrollTop = top - CONFIG.listPad;
    else if (top + rowH + CONFIG.listPad > st + a.clientH) list.scrollTop = top + rowH + CONFIG.listPad - a.clientH;
  }, [active, phase]);

  // outside press / outside scroll / resize close (the panel was placed from one measurement)
  useEffect(() => {
    if (phase !== "open") return;
    const inside = (n: EventTarget | null) => n instanceof Node && (!!boxRef.current?.contains(n) || !!triggerRef.current?.contains(n));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close(undefined, false);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return;
      close(undefined, false);
    };
    const onResize = () => close(undefined, false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [phase, close]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (phase === "open") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  };

  const onTriggerClick = () => {
    // the click that ends a press-drag-release (pointerup lands on the trigger, which holds the capture)
    if (pressRef.current.suppressClick) {
      pressRef.current.suppressClick = false;
      return;
    }
    if (phase === "open") close();
    else open();
  };

  /* ---------------------------------------------------------------- press-drag-release (UIMenu) */

  const blockTouch = useCallback((e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  }, []);
  const endPress = () => {
    const p = pressRef.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = 0;
    p.mode = "idle";
    p.row = -1;
    window.removeEventListener("touchmove", blockTouch, true);
  };
  const beginDragOpen = (target: HTMLElement, pid: number) => {
    const p = pressRef.current;
    p.mode = "drag";
    p.row = -1;
    if (phase !== "open") open();
    // the moves keep coming to the trigger while the pointer travels over the portal panel (touch: implicit capture)
    try {
      target.setPointerCapture(pid);
    } catch {
      /* pointer gone */
    }
    if (p.touch) {
      // the page must not start scrolling under a held menu (non-passive only for this gesture)
      window.addEventListener("touchmove", blockTouch, { passive: false, capture: true });
      haptic();
    }
  };
  const onTriggerPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0 || (e.pointerType === "mouse" && e.button !== 0)) return;
    endPress();
    const p = pressRef.current;
    p.mode = "armed";
    p.pid = e.pointerId;
    p.touch = e.pointerType !== "mouse";
    p.sx = e.clientX;
    p.sy = e.clientY;
    p.suppressClick = false;
    tracker.current.reset();
    tracker.current.add(e.timeStamp, e.clientX, e.clientY);
    if (p.touch && phase !== "open") {
      const el = e.currentTarget;
      const pid = e.pointerId;
      // touch: hold still to open under the finger (a plain move is the page scroll)
      p.timer = setTimeout(() => {
        p.timer = 0;
        if (p.mode === "armed") beginDragOpen(el, pid);
      }, CONFIG.pressHoldMs);
    }
  };
  const onTriggerPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    if (e.pointerId !== p.pid || p.mode === "idle") return;
    tracker.current.addEvent(e.nativeEvent);
    if (p.mode === "armed") {
      const lock = axisLock(e.clientX - p.sx, e.clientY - p.sy, "y", physics.hysteresis, physics.axisRatio);
      if (lock === "pending") return;
      // mouse: a vertical drag opens the menu; touch before the hold: the browser scrolls, give up
      if (lock === "engage" && !p.touch && phase !== "open") beginDragOpen(e.currentTarget, e.pointerId);
      else endPress();
      return;
    }
    const g = geoRef.current;
    if (!g) return;
    const i = rowAtPoint(g, !!heading, anim.current.scrollTop, options.length, e.clientX, e.clientY);
    if (i !== p.row) {
      p.row = i;
      if (i >= 0) {
        setActive(i);
        if (p.touch) haptic();
      }
    }
  };
  const onTriggerPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    if (e.pointerId !== p.pid) return;
    const wasDrag = p.mode === "drag";
    const g = geoRef.current;
    const v = tracker.current.velocity(e.timeStamp);
    endPress();
    if (!wasDrag) return;
    p.suppressClick = true;
    // a capture-less browser fires the click elsewhere: never let the flag swallow a later, unrelated click
    setTimeout(() => {
      p.suppressClick = false;
    }, physics.clickSwallowMs);
    const i = g ? rowAtPoint(g, !!heading, anim.current.scrollTop, options.length, e.clientX, e.clientY) : -1;
    const o = i >= 0 ? options[i] : undefined;
    if (o) {
      close(o.value);
      return;
    }
    // released outside the rows: a fling away dismisses (the retract keeps its speed), a slow release keeps it open
    const speed = Math.hypot(v.x, v.y);
    if (g && speed >= physics.flickMinSpeed) close(undefined, true, Math.min(-0.5, progressVelocity(-speed, Math.max(1, g.h * (1 - g.sy0)))));
  };
  const onTriggerPointerCancel = () => endPress();
  useEffect(() => endPress, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(n - 1, i)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(n - 1);
      case "PageDown":
        return move(active + 5);
      case "PageUp":
        return move(active - 5);
      case "Enter":
      case " ": {
        if (e.key === " " && typeRef.current.buffer) break;
        e.preventDefault();
        const o = options[active];
        if (o) close(o.value);
        return;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // a surrounding sheet/dialog must stay open
        close();
        return;
      case "Tab":
        // no preventDefault: focus lands on the trigger first, the browser then tabs on from there (native select)
        close();
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = typeRef.current;
      t.buffer += e.key;
      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(() => {
        t.buffer = "";
        t.timer = 0;
      }, CONFIG.typeaheadMs);
      const i = typeaheadIndex(
        options.map((o) => o.label),
        t.buffer,
        active,
      );
      if (i >= 0) {
        e.preventDefault();
        setActive(i);
      }
    }
  };

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const a = anim.current;
    a.scrollTop = list.scrollTop;
    a.scrollDirty = true;
    a.lastScroll = performance.now();
    loopRef.current?.wake();
  };

  const onOptionHover = (i: number) => (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && i !== active) setActive(i);
  };

  const isOpen = phase === "open";
  const mounted = phase !== "closed" || warm;
  const g: Geo = geo ?? { left: 0, top: 0, w: CONFIG.panelMinW, h: CONFIG.panelMaxH, up: false, sx0: 1, sy0: 1, ox: 0, scrollable: false, rowH: CONFIG.rowH };
  const cool = () => {
    if (phase === "closed" && document.activeElement !== triggerRef.current) setWarm(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaLabel || ariaLabelledby || id ? valueId : undefined}
        data-value={value}
        data-state={phase}
        data-testid={testId}
        onClick={onTriggerClick}
        onPointerDown={onTriggerPointerDown}
        onPointerMove={onTriggerPointerMove}
        onPointerUp={onTriggerPointerUp}
        onPointerCancel={onTriggerPointerCancel}
        onContextMenu={(e) => {
          if (pressRef.current.mode !== "idle") e.preventDefault();
        }}
        onPointerEnter={() => setWarm(true)}
        onFocus={() => setWarm(true)}
        onPointerLeave={cool}
        onBlur={cool}
        onKeyDown={onTriggerKey}
        className={cn(
          "group/ms relative flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-line bg-ink-950/70 text-left text-fg outline-none transition-[border-color] duration-200 focus-visible:border-white/40 disabled:cursor-not-allowed disabled:opacity-40 aria-expanded:border-white/40 select-none [-webkit-touch-callout:none]",
          SIZE[size],
          // coarse pointers: a ≥ 44 px tall tap area without changing the field's height (it lines up with the inputs)
          "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
          // the ::after sits in the padding box (inside the 1 px border): md 36 + 2·4, sm 32 + 2·6 → 44
          size === "sm" ? "pointer-coarse:after:-inset-y-1.5" : "pointer-coarse:after:-inset-y-1",
          className,
        )}
      >
        <span id={valueId} className={cn("min-w-0 flex-1 truncate", !selected && "text-faint")}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-faint transition-transform duration-200 ease-out", isOpen && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 6l4.5 4.5L12.5 6" />
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px scale-[0.985] rounded-xl opacity-0 transition-[opacity,scale] duration-200 ease-out group-focus-visible/ms:scale-100 group-focus-visible/ms:opacity-100"
          style={{ boxShadow: "var(--ring-glow-input)" }}
        />
      </button>
      {mounted &&
        createPortal(
          <div
            ref={boxRef}
            data-pulse-select=""
            data-placement={g.up ? "top" : "bottom"}
            data-state={phase}
            inert={phase !== "open" || undefined}
            aria-hidden={phase === "closed" || undefined}
            className="fixed overflow-hidden border border-line-2 bg-ink-850 text-fg"
            style={{
              left: g.left,
              top: g.top,
              width: g.w,
              height: g.h,
              visibility: phase === "closed" ? "hidden" : undefined,
              zIndex: CONFIG.zIndex,
              borderRadius: CONFIG.panelRadius,
              boxShadow: CONFIG.panelShadow,
              transformOrigin: `${g.ox.toFixed(1)}px ${g.up ? "100%" : "0"}`,
              contain: "layout paint",
            }}
          >
            <div ref={contentRef} className="absolute inset-0 flex flex-col">
              {heading && (
                <div className="relative flex shrink-0 items-center justify-between pl-4 pr-1.5 after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-line-2" style={{ height: CONFIG.headH }}>
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{heading}</span>
                  <button type="button" tabIndex={-1} aria-label="Schließen" onClick={() => close()} className="touch-hit grid size-7 place-items-center rounded-lg text-faint hover:text-fg">
                    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />
                    </svg>
                  </button>
                </div>
              )}
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-labelledby={ariaLabelledby ?? triggerId}
                aria-activedescendant={isOpen ? optId(active) : undefined}
                onKeyDown={onListKey}
                onScroll={onListScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ gap: CONFIG.rowGap, paddingTop: CONFIG.listPad, paddingBottom: CONFIG.listPad, touchAction: "pan-y" }}
              >
                {options.map((o, i) => {
                  const isSel = o.value === value;
                  return (
                    <div
                      key={o.value}
                      id={optId(i)}
                      role="option"
                      aria-selected={isSel}
                      data-active={i === active || undefined}
                      onClick={() => close(o.value)}
                      onPointerMove={onOptionHover(i)}
                      className={cn(
                        "flex shrink-0 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-3 text-[13.5px] transition-colors duration-[120ms] ease-out",
                        isSel ? "bg-ink-700 font-medium text-fg" : "text-fg/80 data-[active]:bg-ink-750 data-[active]:text-fg",
                        i === active && "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]",
                      )}
                      style={{ height: g.rowH }}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 font-mono text-[11px] text-faint">{o.hint}</span>}
                      <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-3.5 shrink-0 text-signal", !isSel && "opacity-0")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5l3.2 3.2L13 4.8" />
                      </svg>
                    </div>
                  );
                })}
              </div>
              {g.scrollable && (
                <div
                  ref={thumbRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute right-[5px] top-0 w-1 rounded-full bg-[#4a4a4a] opacity-0 transition-opacity duration-300 ease-out data-[on]:opacity-100 data-[on]:duration-[60ms]"
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
