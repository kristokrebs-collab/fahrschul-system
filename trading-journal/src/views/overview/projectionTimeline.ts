import { useEffect, type RefObject } from "react";
import { createFrameLoop, prefersReducedMotion, smoothing } from "@/motion/pulse/engine";

/**
 * pulse `product-timeline`, vertical: the Hochrechnung rows are milestones on a rail. Each milestone's progress runs
 * 0 → 1 while its dot travels from 74 % to 49 % of the viewport height (the pack's revealFrom / revealTo, here as
 * viewport fractions of the scroll axis); the segment leading to it draws with p^2.2 (the pack's stem power) and its
 * dot fills from p 0.25. Scroll-linked, smoothed with 1 − e^(−12·dt).
 */
export const TIMELINE = {
  revealFrom: 0.74,
  revealTo: 0.49,
  stemPow: 2.2,
  dotFrom: 0.25,
  smoothK: 12,
  /** below this |target − shown| everything counts as settled and the loop sleeps */
  epsilon: 0.0015,
} as const;

/** Progress of a milestone whose dot sits `y` px below the viewport top, in a viewport `vh` px high. */
export function milestoneProgress(y: number, vh: number): number {
  if (vh <= 0) return 1;
  const p = (TIMELINE.revealFrom * vh - y) / ((TIMELINE.revealFrom - TIMELINE.revealTo) * vh);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Segment draw (scaleY) and dot fill (scale) for a milestone progress. */
export function milestoneVisual(p: number): { stem: number; dot: number } {
  const dot = p <= TIMELINE.dotFrom ? 0 : (p - TIMELINE.dotFrom) / (1 - TIMELINE.dotFrom);
  return { stem: Math.pow(p, TIMELINE.stemPow), dot: 1 - Math.pow(1 - dot, 3) };
}

/** Document y of an element's layout box (offset chain: ignores transforms such as an intro flight or a page switch). */
function docTop(el: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

/** `ScrollTimeline` (scroll-driven animations; Chromium / Samsung Internet ≥ 115) – not in this TypeScript DOM lib. */
interface ScrollTimelineCtor {
  new (options: { source: Element; axis: "block" }): AnimationTimeline;
}
type ScrollDrivenOptions = KeyframeAnimationOptions & { timeline: AnimationTimeline; rangeStart?: string; rangeEnd?: string };

/** The rail runs on scroll-driven animations where the browser has `ScrollTimeline` and WAAPI (as the header edge). */
export function railScrollDriven(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline === "function" && typeof Element.prototype.animate === "function";
}

/** Keyframe samples per milestone: the stem's p^2.2 and the dot's cubic ease, piecewise linear in between (< 0.4 % off). */
export const RAIL_SAMPLES = 20;

export interface MilestoneTrack {
  /** document scroll offsets (px) where the milestone's progress starts / reaches 1 */
  start: number;
  end: number;
  /** dot fill `scale()` and stem `scaleY()` keyframes, evenly spaced over [start, end] */
  dot: Keyframe[];
  stem: Keyframe[];
}

/**
 * The scroll range of a milestone whose dot centre sits at document y `y`, in a viewport `vh` px high: progress 0 at
 * scroll `y − 74 % vh`, 1 at `y − 49 % vh` (`milestoneProgress` of its viewport y), sampled into keyframes. A range
 * that starts above the top of the page begins at scroll 0 with the progress it has there; `null` = already complete
 * at scroll 0 (no animation, the final state).
 */
export function milestoneTrack(y: number, vh: number, samples = RAIL_SAMPLES): MilestoneTrack | null {
  const end = y - TIMELINE.revealTo * vh;
  if (vh <= 0 || end <= 0) return null;
  const start = Math.max(0, y - TIMELINE.revealFrom * vh);
  const dot: Keyframe[] = [];
  const stem: Keyframe[] = [];
  for (let k = 0; k <= samples; k++) {
    const v = milestoneVisual(milestoneProgress(y - (start + ((end - start) * k) / samples), vh));
    dot.push({ transform: `scale(${v.dot.toFixed(4)})` });
    stem.push({ transform: `scaleY(${v.stem.toFixed(4)})` });
  }
  return { start, end, dot, stem };
}

/**
 * Drives the rail inside `root` (positioned): `[data-tl-row]` are the milestone rows (in order), `[data-tl-dot]` one
 * dot per row (its first child is the fill), `[data-tl-stem]` the segments (stem i leads INTO dot i + 1) and
 * `[data-tl-rail]` the grey track between the first and last dot. Dots, stems and rail are absolutely positioned
 * siblings of the rows (never inside a revealing row: its transform would change their containing block).
 * Geometry is measured once and on resize (ResizeObserver on the list and the page). Where the browser has
 * `ScrollTimeline` every dot fill and stem is a scroll-driven WAAPI animation on the document's timeline over its own
 * scroll range (`milestoneTrack`), recreated only when the geometry changed: the compositor moves them with the
 * scroll, no scroll listener, no `scrollY` read (the listener read it per scroll event, a forced style recalc whenever
 * the page was dirty: 20–31 per down-and-up scroll of the desktop probe) and no style write per frame; the rail then
 * sits exactly on the scroll, without the 1 − e^(−12·dt) lag (as the header edge). Elsewhere the passive scroll
 * listener reads `scrollY` while the rail is near the viewport and one sleeping frame loop smooths and writes
 * transforms. `enabled` = the intro cell landed.
 */
export function useMilestoneRail(root: RefObject<HTMLElement | null>, enabled: boolean, deps: unknown): void {
  useEffect(() => {
    const el = root.current;
    if (!el || !enabled || typeof window === "undefined") return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-tl-row]"));
    const dots = Array.from(el.querySelectorAll<HTMLElement>("[data-tl-dot]")).slice(0, rows.length);
    const stems = Array.from(el.querySelectorAll<HTMLElement>("[data-tl-stem]"));
    const rail = el.querySelector<HTMLElement>("[data-tl-rail]");
    if (dots.length === 0) return;
    const reduced = prefersReducedMotion();
    /** dot centres in document px, viewport height */
    let ys: number[] = [];
    let vh = window.innerHeight;
    const shown = dots.map(() => -1);
    const target = dots.map(() => 0);

    const write = (i: number, p: number) => {
      const v = milestoneVisual(p);
      const fillEl = dots[i]!.firstElementChild as HTMLElement | null;
      if (fillEl) fillEl.style.transform = `scale(${v.dot.toFixed(4)})`;
      const stem = stems[i - 1];
      if (stem) stem.style.transform = `scaleY(${v.stem.toFixed(4)})`;
    };
    const computeTargets = () => {
      const sy = window.scrollY;
      for (let i = 0; i < ys.length; i++) target[i] = milestoneProgress(ys[i]! - sy, vh);
    };
    const loop = createFrameLoop((dt) => {
      let moving = false;
      const a = reduced ? 1 : smoothing(TIMELINE.smoothK, Math.min(dt, 0.05));
      for (let i = 0; i < dots.length; i++) {
        const t = target[i]!;
        const cur = shown[i]! < 0 ? t : shown[i]!;
        let next = cur + (t - cur) * a;
        if (Math.abs(t - next) < TIMELINE.epsilon) next = t;
        else moving = true;
        if (next !== shown[i]) {
          shown[i] = next;
          write(i, next);
        }
      }
      return moving;
    });
    const place = (): number[] => {
      const top = docTop(el);
      vh = window.innerHeight;
      // row centres relative to the list (rows are in flow: offsetTop ignores their reveal transforms)
      const cy = rows.map((r) => r.offsetTop + r.offsetHeight / 2);
      ys = cy.map((y) => top + y);
      for (let i = 0; i < dots.length; i++) dots[i]!.style.top = `${cy[i]}px`;
      if (rail) {
        rail.style.top = `${cy[0]}px`;
        rail.style.height = `${Math.max(0, cy[cy.length - 1]! - cy[0]!)}px`;
      }
      for (let i = 0; i < stems.length; i++) {
        const y0 = cy[i];
        const y1 = cy[i + 1];
        if (y0 === undefined || y1 === undefined) continue;
        stems[i]!.style.top = `${y0}px`;
        stems[i]!.style.height = `${Math.max(0, y1 - y0)}px`;
      }
      return ys;
    };

    if (!reduced && railScrollDriven()) {
      const Timeline = (window as unknown as { ScrollTimeline: ScrollTimelineCtor }).ScrollTimeline;
      const timeline = new Timeline({ source: document.scrollingElement ?? document.documentElement, axis: "block" });
      let anims: Animation[] = [];
      let key = "";
      const build = () => {
        const at = place();
        const next = `${vh}|${at.map((y) => Math.round(y)).join(",")}`;
        if (next === key) return;
        key = next;
        for (const a of anims) a.cancel();
        anims = [];
        for (let i = 0; i < dots.length; i++) {
          const track = milestoneTrack(at[i]!, vh);
          const fillEl = dots[i]!.firstElementChild as HTMLElement | null;
          const stem = stems[i - 1];
          if (!track) {
            // complete at the top of the page: the final state, no animation
            write(i, 1);
            continue;
          }
          const range: ScrollDrivenOptions = { timeline, rangeStart: `${track.start.toFixed(1)}px`, rangeEnd: `${track.end.toFixed(1)}px`, fill: "both", easing: "linear" };
          if (fillEl) anims.push(fillEl.animate(track.dot, range));
          if (stem) anims.push(stem.animate(track.stem, range));
        }
      };
      build();
      const ro = typeof ResizeObserver === "function" ? new ResizeObserver(build) : null;
      ro?.observe(el);
      ro?.observe(document.body);
      window.addEventListener("resize", build, { passive: true });
      return () => {
        for (const a of anims) a.cancel();
        ro?.disconnect();
        window.removeEventListener("resize", build);
      };
    }

    const measure = () => {
      place();
      computeTargets();
      loop.wake();
    };
    // scrollY is only read while the rail is near the viewport: a scroll read forces a style recalc whenever the page
    // is dirty, which is wasted work for every frame of a long scroll that never reaches the card
    let near = typeof IntersectionObserver !== "function";
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              const e = entries[entries.length - 1];
              if (!e) return;
              near = e.isIntersecting;
              // settle on the true state when it enters or leaves (fast flings skip intermediate scroll events)
              computeTargets();
              loop.wake();
            },
            { rootMargin: "50% 0px 50% 0px" },
          )
        : null;
    io?.observe(el);
    const onScroll = () => {
      if (!near) return;
      computeTargets();
      loop.wake();
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      loop.stop();
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [root, enabled, deps]);
}
