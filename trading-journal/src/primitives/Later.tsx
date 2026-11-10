import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { canObserveInView } from "@/motion/inView";
import { replay } from "@/motion/replay";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { CardSkeleton } from "@/primitives/Reserve";

/**
 * `Later` – a card that mounts after the page has painted (Feinschliff 2026-10, "teure Seitenwechsel"). A long page used to
 * mount all of its cards in ONE commit: one long task (hundreds of ms on the tablet, 4× throttled several hundred) between
 * the tap on the dock and the first frame of the page. Wrapped in `Later`, a card mounts in its own small commit instead:
 *
 *   <Later fallback={<CardSkeleton />}><MonteCarloCard … /></Later>
 *
 * - The cards queue in page order and mount one per idle slice (`requestIdleCallback`, bounded by `LATER_TIMEOUT_MS`, so a
 *   busy main thread still gets them); never while the user scrolls (the queue waits `LATER_SCROLL_QUIET_MS` of quiet).
 * - A card that comes within `LATER_NEAR_PX` of the viewport mounts at once (shared IntersectionObserver), whatever is queued:
 *   scrolling ahead of the queue never shows an empty hole for longer than one commit.
 * - `fallback` stands in until then – give it the card's end size (`CardSkeleton` inside a `Reserve` / `Reveal defer` cell) so
 *   nothing moves when the card lands. Each mount is a `startTransition`, so React renders it in time slices.
 * - Without `IntersectionObserver` or `requestIdleCallback` (jsdom, SSR, old engines) the children render at once: nothing
 *   is ever left out. Reduced motion changes nothing here (it is about when, not how).
 * - The landing is not a hard cut (motion review, Runde 13): the skeleton and the card used to swap inside one frame. When the card
 *   lands, its CELL (the parent that holds the reserved size – every user of `Later` gives it one of its own) brightens in once on
 *   `tween.fade`, opacity only, from `LATER_LAND_FROM` (not from zero: the cell keeps its shape, the content arrives in it). On a long
 *   page whose cards mount one per idle slice this reads as the page building itself up card by card. Skipped under reduced motion, in a
 *   cell that is still hidden by its own reveal (its opacity is not 1 yet – that reveal IS the entrance) and without WAAPI.
 * Once mounted a card stays mounted.
 */
/** The opacity the cell starts from when its card lands. */
export const LATER_LAND_FROM = 0.35;
export const LATER_TIMEOUT_MS = 120;
export const LATER_SCROLL_QUIET_MS = 200;
export const LATER_NEAR_PX = 500;

type Mount = () => void;

const queue: Mount[] = [];
let idleId: number | undefined;
let timerId: number | undefined;
let lastScroll = -Infinity;
let scrollBound = false;

function bindScroll(): void {
  if (scrollBound || typeof window === "undefined") return;
  scrollBound = true;
  window.addEventListener("scroll", () => (lastScroll = performance.now()), { passive: true });
}

function pump(): void {
  if (idleId !== undefined || timerId !== undefined || queue.length === 0 || typeof requestIdleCallback !== "function") return;
  idleId = requestIdleCallback(
    () => {
      idleId = undefined;
      const quiet = performance.now() - lastScroll;
      if (quiet < LATER_SCROLL_QUIET_MS) {
        timerId = window.setTimeout(() => {
          timerId = undefined;
          pump();
        }, LATER_SCROLL_QUIET_MS - quiet);
        return;
      }
      queue.shift()?.();
      pump();
    },
    { timeout: LATER_TIMEOUT_MS },
  );
}

let near: IntersectionObserver | null = null;
const nearListeners = new Map<Element, Mount>();

function sharedNear(): IntersectionObserver {
  near ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const fire = nearListeners.get(e.target);
        if (!fire) continue;
        nearListeners.delete(e.target);
        near?.unobserve(e.target);
        fire();
      }
    },
    { rootMargin: `${LATER_NEAR_PX}px 0px` },
  );
  return near;
}

/** Test hook: forget the queue and the shared observer (a new `IntersectionObserver` mock is picked up). */
export function resetLaterForTests(): void {
  queue.length = 0;
  if (idleId !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
  if (timerId !== undefined) clearTimeout(timerId);
  idleId = undefined;
  timerId = undefined;
  near?.disconnect();
  near = null;
  nearListeners.clear();
}

/** `true` when this engine can schedule the idle mount; otherwise `Later` renders at once. */
export function canMountLater(): boolean {
  return typeof requestIdleCallback === "function" && canObserveInView();
}

export interface LaterProps {
  children: ReactNode;
  /** Stands in until the card mounted (default: a `CardSkeleton` filling its cell). */
  fallback?: ReactNode;
  /** Mount at once (e.g. the card is part of the first screenful). */
  now?: boolean;
}

export function Later({ children, fallback, now = false }: LaterProps) {
  const immediate = now || !canMountLater();
  const [on, setOn] = useState(immediate);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedFx();
  /** The cell of a card that was deferred, remembered until it has landed (the fallback box is gone by then). */
  const cell = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = cell.current;
    if (!on || !el) return;
    cell.current = null;
    if (reduced || typeof el.animate !== "function") return;
    // a cell that its own reveal still hides (or is fading in) keeps that entrance – a style read, no layout
    if (getComputedStyle(el).opacity !== "1") return;
    replay(el, { opacity: [LATER_LAND_FROM, 1] }, tween.fade);
  }, [on, reduced]);
  useEffect(() => {
    if (on) return;
    const el = box.current;
    if (!el) return;
    bindScroll();
    let done = false;
    const mount: Mount = () => {
      if (done) return;
      done = true;
      const at = queue.indexOf(mount);
      if (at >= 0) queue.splice(at, 1);
      nearListeners.delete(el);
      near?.unobserve(el);
      cell.current = el.parentElement;
      startTransition(() => setOn(true));
    };
    queue.push(mount);
    nearListeners.set(el, mount);
    sharedNear().observe(el);
    pump();
    return () => {
      done = true;
      const at = queue.indexOf(mount);
      if (at >= 0) queue.splice(at, 1);
      nearListeners.delete(el);
      near?.unobserve(el);
    };
  }, [on]);
  if (on) return <>{children}</>;
  return (
    <div ref={box} className="flex min-h-0 flex-col [&>*]:flex-1" data-later="" aria-busy="true">
      {fallback ?? <CardSkeleton />}
    </div>
  );
}
