import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { canObserveInView } from "@/motion/inView";
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
 * Once mounted a card stays mounted.
 */
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
