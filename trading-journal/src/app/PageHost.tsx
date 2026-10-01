/**
 * Page host of the shell: one layer per page, directional page transitions, keep-alive pages.
 *
 * - Keep-alive pages (the overview) stay mounted while another page is shown: React `<Activity mode="hidden">` hides
 *   them with `display: none`, keeps their state and DOM, and destroys their effects (subscriptions, the chart
 *   instance) until they are shown again. They are pre-rendered hidden at idle priority when the app starts on another
 *   page, so the first switch to them only reconnects effects instead of mounting ~1 500 components.
 * - Other pages mount when shown and unmount once their exit has played.
 * - Transition (the PageSwitch spec): the entering page comes in from `x dir·16`, scale .985 and blur 4 px (transform on
 *   `spring.enter`, opacity/filter on `tween.page`), the leaving page leaves to `x −dir·12` and fades on `tween.exit`
 *   while pinned absolutely in place, so the new page lays out immediately. Everything is a single `transform` / `opacity`
 *   / `filter` animation per layer, which Motion hands to WAAPI: the slide keeps running on the compositor while React
 *   reconnects the page's effects. Layers always end at `transform: none` / `filter: none` (no containing block for the
 *   chart's fixed marker ghost or the table ghost). Reduced motion: opacity crossfade only.
 * - Scroll: the router queues the restore for a page that is not on screen yet; `showPage()` applies it in the layout
 *   effect of the commit that shows the page, before paint, and the leaving layer is offset by the same distance so it
 *   fades out exactly where it was.
 * - `onTransitioning(true)` at the switch commit, `false` once enter and exit have both finished (locks the trade detail).
 */
import { animate, frame, type AnimationPlaybackControls } from "motion/react";
import { Activity, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { detachShell, showPage } from "@/store/router";
import { PAGES, type Page } from "@/store/uiStore";

export type PageRole = "current" | "leaving" | "parked";

/** Enter/exit offsets of the page transition (px), mirrored from `PageSwitch`. */
export const PAGE_ENTER_X = 16;
export const PAGE_EXIT_X = 12;
const ENTER_FROM = (dir: number) => `translateX(${dir * PAGE_ENTER_X}px) scale(0.985)`;
// same transform template at both ends (the jsdom / JS fallback can only mix matching templates); `none` is set after
const ENTER_TO = "translateX(0px) scale(1)";
const EXIT_FROM = "translateX(0px)";
const EXIT_TO = (dir: number) => `translateX(${-dir * PAGE_EXIT_X}px)`;
const BLUR_FROM = "blur(4px)";
const BLUR_TO = "blur(0px)";
/**
 * `spring.pageEnter`: Motion springs a string keyframe pair over 0…100; its rest thresholds are PageSwitch's
 * 0.5 px / 2 px·s⁻¹ on the `PAGE_ENTER_X` slide, so the transform settles as early as the old `x` spring (≈ 0.42 s).
 */
const ENTER_SPRING = spring.pageEnter;

/** Pure: slide direction of a switch in tab order (`+1` → the new page comes from the right). */
export function pageDirection(from: Page, to: Page): 1 | -1 {
  return PAGES.indexOf(to) >= PAGES.indexOf(from) ? 1 : -1;
}

/** Pure: the role of `page`'s layer, or `null` when it is not mounted. */
export function layerRole(page: Page, current: Page, leaving: Page | null, keepAlive: readonly Page[]): PageRole | null {
  if (page === current) return "current";
  if (page === leaving) return "leaving";
  return keepAlive.includes(page) ? "parked" : null;
}

interface Nav {
  current: Page;
  leaving: Page | null;
  dir: 1 | -1;
  /** increments per switch; the transition effect runs once per value */
  seq: number;
}

interface LayerProps {
  page: Page;
  role: PageRole;
  keepAlive: boolean;
  renderPage: (page: Page) => ReactNode;
  layerRef: (el: HTMLDivElement | null) => void;
}

/**
 * One page. The content element is memoised per page, so a role change (current → leaving → parked) re-renders this
 * wrapper only, never the page itself.
 */
const PageLayer = memo(function PageLayer({ page, role, keepAlive, renderPage, layerRef }: LayerProps) {
  const content = useMemo(() => renderPage(page), [renderPage, page]);
  return (
    <div
      ref={layerRef}
      data-page={page}
      data-page-role={role}
      inert={role !== "current"}
      aria-hidden={role === "leaving" ? true : undefined}
      className={cn(role === "leaving" && "pointer-events-none absolute inset-x-0 top-0")}
    >
      {keepAlive ? <Activity mode={role === "parked" ? "hidden" : "visible"}>{content}</Activity> : content}
    </div>
  );
});

export interface PageHostProps {
  page: Page;
  /** Renders a page; must be referentially stable (a module-level function). */
  renderPage: (page: Page) => ReactNode;
  /** Pages kept mounted while hidden (React `Activity`); pass a module-level array. */
  keepAlive?: readonly Page[];
  onTransitioning?: (transitioning: boolean) => void;
  className?: string;
}

const NONE: readonly Page[] = [];

function settleStyles(el: HTMLElement): void {
  el.style.transform = "none";
  el.style.filter = "none";
  el.style.opacity = "";
}

export const PageHost = memo(function PageHost({ page, renderPage, keepAlive = NONE, onTransitioning, className }: PageHostProps) {
  const reduced = useReducedFx();
  const [nav, setNav] = useState<Nav>(() => ({ current: page, leaving: null, dir: 1, seq: 0 }));
  let view = nav;
  if (nav.current !== page) {
    // state from props: the previous page becomes the leaving layer (a still-leaving older page is dropped at once)
    view = { current: page, leaving: nav.current, dir: pageDirection(nav.current, page), seq: nav.seq + 1 };
    setNav(view);
  }

  const layers = useRef(new Map<Page, HTMLDivElement>());
  const [layerRefs] = useState(() => {
    const out = {} as Record<Page, (el: HTMLDivElement | null) => void>;
    for (const p of PAGES) {
      out[p] = (el) => {
        if (el) layers.current.set(p, el);
        else layers.current.delete(p);
      };
    }
    return out;
  });

  const notify = useRef(onTransitioning);
  useLayoutEffect(() => {
    notify.current = onTransitioning;
  });

  const running = useRef<AnimationPlaybackControls[]>([]);
  const handled = useRef(-1);
  // unmount (and the StrictMode remount probe): stop the slide, hand scroll restores back to the router
  useLayoutEffect(
    () => () => {
      for (const c of running.current) c.stop();
      running.current = [];
      handled.current = -1;
      detachShell();
    },
    [],
  );

  const { current, leaving, dir, seq } = view;
  useLayoutEffect(() => {
    const delta = showPage(current);
    if (handled.current === seq) return;
    handled.current = seq;
    for (const c of running.current) c.stop();
    running.current = [];
    if (seq === 0 || !leaving) return;

    const enterEl = layers.current.get(current);
    const exitEl = layers.current.get(leaving);
    const enter: AnimationPlaybackControls[] = [];
    const exit: AnimationPlaybackControls[] = [];
    if (exitEl) {
      // the window may have scrolled to the new page's position: hold the old page where it was on screen
      exitEl.style.top = delta ? `${delta}px` : "";
      exit.push(animate(exitEl, reduced ? { opacity: [1, 0] } : { transform: [EXIT_FROM, EXIT_TO(dir)], opacity: [1, 0] }, tween.exit));
    }
    if (enterEl) {
      enterEl.style.top = "";
      // start values before paint: Motion resolves keyframes on the next frame, the first frame must not flash the page
      enterEl.style.opacity = "0";
      if (!reduced) {
        enterEl.style.transform = ENTER_FROM(dir);
        enterEl.style.filter = BLUR_FROM;
        enter.push(animate(enterEl, { transform: [ENTER_FROM(dir), ENTER_TO] }, ENTER_SPRING));
        enter.push(animate(enterEl, { opacity: [0, 1], filter: [BLUR_FROM, BLUR_TO] }, tween.page));
      } else {
        // a parked page may still carry its last exit offset
        enterEl.style.transform = "none";
        enterEl.style.filter = "none";
        enter.push(animate(enterEl, { opacity: [0, 1] }, tween.page));
      }
    }
    running.current = [...enter, ...exit];
    notify.current?.(true);

    // stopped animations never resolve; the `handled` check also ignores a switch that was overtaken
    const live = () => handled.current === seq;
    void Promise.all(exit.map((c) => c.finished)).then(() => {
      if (!live()) return;
      setNav((n) => (n.seq === seq && n.leaving ? { ...n, leaving: null } : n));
    });
    void Promise.all(enter.map((c) => c.finished)).then(() => {
      if (!live() || !enterEl) return;
      settleStyles(enterEl);
      // Motion may still render the final keyframe (`translateX(0px) scale(1)`) on its next render step, which would
      // leave a containing block for `position:fixed` descendants (the settings unsaved bar, the trades ghost): settle
      // once more after that render
      frame.postRender(() => {
        if (live()) settleStyles(enterEl);
      });
    });
    void Promise.all([...enter, ...exit].map((c) => c.finished)).then(() => {
      if (!live()) return;
      running.current = [];
      notify.current?.(false);
    });
  }, [current, leaving, dir, seq, reduced]);

  return (
    <div className={cn("relative", className)}>
      {PAGES.map((p) => {
        const role = layerRole(p, current, leaving, keepAlive);
        return role ? <PageLayer key={p} page={p} role={role} keepAlive={keepAlive.includes(p)} renderPage={renderPage} layerRef={layerRefs[p]} /> : null;
      })}
    </div>
  );
});
