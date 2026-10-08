/**
 * Proximity border-arc glow (21st.dev "Glowing Effect", Aceternity) – geometry + one shared pointer tracker.
 *
 * Every `Card` registers its surface here. A single passive `pointermove` listener on `document` (plus scroll /
 * resize invalidation; while scrolling, re-measuring waits for the scroll gate to settle) feeds one `frame.read` per frame, which reads cached rects of the cards currently on
 * screen, decides which arcs may glow (pointer within `GLOW_PROXIMITY` px of the card and outside its dead
 * centre, nearest first, at most `MAX_ACTIVE_GLOWS`), and hands each card its angle. Cards then rotate a
 * pre-rendered conic layer by transform – the border itself never repaints.
 */
import { frame } from "motion/react";
import { UNREACHABLE_SELECTOR } from "@/motion/a11y";
import { observeInView } from "@/motion/inView";
// imported first: its capture scroll listener is attached before ours, so `isScrolling()` is current in `invalidate`
import { isScrolling, onScrollEnd } from "@/motion/scrollGate";

export interface GlowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GlowReading {
  active: boolean;
  /** Conic angle in degrees (0 = up, clockwise) from the card centre toward the pointer. */
  angle: number;
  /** Distance from the pointer to the card's edge (0 inside). */
  distance: number;
}

/** Margin around a card within which its arc still lights up (px). */
export const GLOW_PROXIMITY = 64;
/** The arc is off while the pointer is within this fraction of half the card's shorter side from its centre. */
export const GLOW_INACTIVE_ZONE = 0.7;
/** At most this many arcs glow at once (the nearest win). */
export const MAX_ACTIVE_GLOWS = 4;

/** Conic angle from the rect centre toward the point: 0° points up, angles grow clockwise. */
export function pointerAngle(px: number, py: number, r: GlowRect): number {
  const dx = px - (r.left + r.width / 2);
  const dy = py - (r.top + r.height / 2);
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

/** `to` re-expressed within ±180° of `from`, so an eased rotation takes the short way round. */
export function nearestAngle(from: number, to: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  return from + diff;
}

/** Euclidean distance from a point to a rect's edge; 0 when the point is inside. */
export function distanceToRect(px: number, py: number, r: GlowRect): number {
  const dx = Math.max(r.left - px, 0, px - (r.left + r.width));
  const dy = Math.max(r.top - py, 0, py - (r.top + r.height));
  return Math.hypot(dx, dy);
}

export function readGlow(px: number, py: number, r: GlowRect, proximity = GLOW_PROXIMITY, inactiveZone = GLOW_INACTIVE_ZONE): GlowReading {
  const distance = distanceToRect(px, py, r);
  const fromCentre = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
  const dead = 0.5 * Math.min(r.width, r.height) * inactiveZone;
  return { active: distance <= proximity && fromCentre >= dead, angle: pointerAngle(px, py, r), distance };
}

/** Indices of the readings allowed to glow: active ones, nearest first, capped at `max`. */
export function pickGlows(readings: readonly GlowReading[], max = MAX_ACTIVE_GLOWS): Set<number> {
  const order = readings
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.active)
    .sort((a, b) => a.g.distance - b.g.distance)
    .slice(0, Math.max(0, max));
  return new Set(order.map(({ i }) => i));
}

/* ------------------------------------------------------------------------------------------------ registry */

export type GlowListener = (active: boolean, angle: number) => void;

interface Entry {
  el: HTMLElement;
  listener: GlowListener;
  rect: GlowRect | null;
  visible: boolean;
  active: boolean;
  stopObserving: () => void;
}

const entries = new Set<Entry>();
let pointer: { x: number; y: number } | null = null;
let scheduled = false;
let resizeObserver: ResizeObserver | null = null;

function measure(): void {
  scheduled = false;
  // cards behind an open dialog / sheet (marked `data-modal-behind` since bc292ec, no longer `inert`) or in an inert
  // subtree stay dark
  const live = [...entries].filter((e) => e.visible && !e.el.closest(UNREACHABLE_SELECTOR));
  for (const e of entries) {
    if (e.active && !live.includes(e)) {
      e.active = false;
      e.listener(false, 0);
    }
  }
  const p = pointer;
  const readings: GlowReading[] = p ? live.map((e) => readGlow(p.x, p.y, (e.rect ??= e.el.getBoundingClientRect()))) : [];
  const on = pickGlows(readings);
  live.forEach((e, i) => {
    const reading = readings[i];
    const active = on.has(i);
    if (active && reading) e.listener(true, reading.angle);
    else if (e.active) e.listener(false, reading?.angle ?? 0);
    e.active = active;
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  frame.read(measure);
}

function invalidate(): void {
  for (const e of entries) e.rect = null;
  // while content scrolls under a resting pointer, re-reading every rect each scroll event forced a layout per event:
  // the rects stay invalid and are measured once the scroll has settled (`onScrollEnd` below)
  if (pointer && !isScrolling()) schedule();
}

let offScrollEnd: (() => void) | null = null;

/** Quiet period after the last size change of a registered card before a resting pointer's arcs are re-measured. */
export const GLOW_RESIZE_SETTLE_MS = 160;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A card changed size (page switch, expander, async content, a sheet's height spring): the cached rects are dropped at
 * once – the next real pointer move measures fresh – but a resting pointer is only re-measured once the sizes have
 * settled. Re-reading every card rect in the frame after each report forced a layout per frame while a page mounted or
 * a box animated its height.
 */
function invalidateResized(): void {
  for (const e of entries) e.rect = null;
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (pointer && !isScrolling()) schedule();
  }, GLOW_RESIZE_SETTLE_MS);
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  pointer = { x: e.clientX, y: e.clientY };
  // synthetic moves during a scroll: remembered, measured once in `onScrollEnd`
  if (!isScrolling()) schedule();
}

function onPointerGone(e: Event): void {
  // `mouseout` with no related target = the pointer left the window
  if (e.type === "mouseout" && (e as MouseEvent).relatedTarget) return;
  pointer = null;
  schedule();
}

function attach(): void {
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("mouseout", onPointerGone, { passive: true });
  window.addEventListener("blur", onPointerGone);
  window.addEventListener("scroll", invalidate, { passive: true, capture: true });
  window.addEventListener("resize", invalidate, { passive: true });
  offScrollEnd = onScrollEnd(() => {
    if (pointer && entries.size) schedule();
  });
  // any registered card changing size usually shifts its neighbours too (expanders, async content)
  if (typeof ResizeObserver !== "undefined") resizeObserver = new ResizeObserver(invalidateResized);
}

function detach(): void {
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("mouseout", onPointerGone);
  window.removeEventListener("blur", onPointerGone);
  window.removeEventListener("scroll", invalidate, { capture: true });
  window.removeEventListener("resize", invalidate);
  offScrollEnd?.();
  offScrollEnd = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = null;
  pointer = null;
}

/**
 * Registers a surface for the proximity arc. `listener(true, angle)` fires on every frame the arc may glow,
 * `listener(false, angle)` once when it stops. Only on-screen surfaces are measured. Returns the unregister.
 */
export function registerGlow(el: HTMLElement, listener: GlowListener): () => void {
  if (typeof document === "undefined") return () => {};
  if (entries.size === 0) attach();
  const entry: Entry = { el, listener, rect: null, visible: true, active: false, stopObserving: () => {} };
  entries.add(entry);
  resizeObserver?.observe(el);
  entry.stopObserving = observeInView(el, (inView) => {
    entry.visible = inView;
    entry.rect = null;
    if (!inView && entry.active) {
      entry.active = false;
      entry.listener(false, 0);
    }
    if (inView && pointer) schedule();
  });
  return () => {
    entry.stopObserving();
    resizeObserver?.unobserve(el);
    entries.delete(entry);
    if (entries.size === 0) detach();
  };
}

/** Hands the registry a rect the caller just measured (e.g. on `pointerenter`) so the next frame need not re-read it. */
export function primeGlowRect(el: HTMLElement, rect: GlowRect): void {
  for (const e of entries) if (e.el === el) e.rect = rect;
}
