/**
 * Page host of the shell: one layer per page, directional page transitions, keep-alive pages.
 *
 * - Keep-alive pages (the overview) stay mounted while another page is shown: React `<Activity mode="hidden">` hides
 *   them with `display: none`, keeps their state and DOM, and destroys their effects (subscriptions, the chart
 *   instance) until they are shown again. They are pre-rendered hidden at idle priority when the app starts on another
 *   page, so the first switch to them only reconnects effects instead of mounting ~1 500 components. Motion's
 *   projection around a hide / show: a hold in front of the page (`useHoldProjectionOnHide`, no `layoutId` snapshots of
 *   a hidden page) and a settle behind it (`useSettleProjectionOnShow`, the re-mounted nodes are not all measured by the
 *   next layout update) – `src/motion/activityProjection.ts`.
 * - Other pages mount when shown and unmount once their exit has played.
 * - Parking (perf-120 phase C): the leaving layer is collapsed out of the document's scroll extent when its exit has
 *   played (height 0, overflow and visibility hidden – its layout is kept, so no resize reaches its observers), and parked (hidden) or
 *   unmounted only when the switch has settled AND the main thread is idle (`requestIdleCallback`, bounded by
 *   `PARK_TIMEOUT_MS`): hiding the Übersicht is a ≈ 50 ms commit (every effect and motion component of ~600 detaches)
 *   that used to land in the middle of the new page's entrance. A switch back before that shows the page without any
 *   re-mount.
 * - Transition (the PageSwitch spec): the entering page comes in from `x dir·16`, scale .985 and blur 4 px (transform on
 *   `spring.enter` – after a fast dock flick its context spring, `consumeNavTempo()` – opacity/filter on `tween.page`
 *   delayed by the exit, SH-02), the leaving page leaves to `x −dir·12` and fades on `tween.exit`
 *   while pinned absolutely in place, so the new page lays out immediately. Everything is a single `transform` / `opacity`
 *   / `filter` animation per layer, which Motion hands to WAAPI: the slide keeps running on the compositor while React
 *   reconnects the page's effects. Layers always end at `transform: none` / `filter: none` (no containing block for the
 *   chart's fixed marker ghost or the table ghost). Reduced motion: opacity crossfade only. Samsung-Internet-safe effects
 *   (`html[data-safe-fx]`): no blur.
 * - Scroll: the router queues the restore for a page that is not on screen yet; `showPage()` applies it in the layout
 *   effect of the commit that shows the page, before paint, and the leaving layer is offset by the same distance so it
 *   fades out exactly where it was.
 * - `onTransitioning(true)` at the switch commit, `false` once enter and exit have both finished (locks the trade detail).
 * - Switch timing (perf-120 phase C): the host takes a new `page` one painted frame after it arrived (`afterNextPaint`,
 *   then a transition). The tap's own response – the dock's active tab and its marker slide, a compositor animation –
 *   is painted first and keeps running on the compositor while the new page's (long, unsliceable) commit blocks the
 *   main thread; before, the deferred page render often ran before any frame, so the dock showed nothing for the
 *   whole commit and its marker only started after it (≈ 8 ms more latency at 120 Hz for a tap that answers at once).
 */
import { animate, frame, type AnimationPlaybackControls } from "motion/react";
import { Activity, memo, startTransition, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { isSafeFx } from "@/app/pwa";
import { cn } from "@/lib/cn";
import { useHoldProjectionOnHide, useSettleProjectionOnShow } from "@/motion/activityProjection";
import { LayoutCascade } from "@/motion/NoLayoutCascade";
import { consumeNavTempo, contextSpringAt } from "@/motion/physics";
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
/**
 * SH-02: the entering page stays invisible until the leaving page has fully faded (`tween.exit`), so two pages are
 * never drawn over each other; its slide and scale start at once (invisible at opacity 0) and still settle on time.
 */
export const ENTER_FADE = { ...tween.page, delay: tween.exit.duration };
/** Upper bound (ms) for the idle wait before a settled switch parks / unmounts the page it left. */
export const PARK_TIMEOUT_MS = 600;

type CancelIdle = () => void;
/** `requestIdleCallback` with a timeout; a short timer where it is missing (Safari). Returns the cancel. */
function whenIdle(fn: () => void): CancelIdle {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: PARK_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(fn, 50);
  return () => window.clearTimeout(t);
}

/**
 * The leaving layer after its exit (opacity 0): out of the scroll extent and out of hit testing, its layout kept – no
 * 0 × 0 resize reaches its observers, nothing is laid out again when it is shown before it was parked. Height and
 * overflow only: `visibility` / `pointer-events` are inherited and restyle every element of the page (≈ 11 ms for the
 * Übersicht on the tablet probe, `flick/restyle.mjs`), height 0 + overflow hidden cost nothing.
 */
function collapseLayer(el: HTMLElement): void {
  el.style.height = "0px";
  el.style.overflow = "hidden";
}

function restoreLayer(el: HTMLElement): void {
  el.style.height = "";
  el.style.overflow = "";
}

/** Pointer input that a leaving layer swallows while it fades out (capture phase, before Motion / React see it). */
const LEAVING_SWALLOW = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend"] as const;
const swallow = (e: Event) => {
  e.stopPropagation();
  // no focus / activation from a page that is leaving; touch defaults (scrolling) stay
  if (e.cancelable && !e.type.startsWith("touch")) e.preventDefault();
};

/** Runs `fn` after the next frame has been painted (a frame callback, then a task); returns the cancel. */
export function afterNextPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raf = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    if (timer !== undefined) clearTimeout(timer);
  };
}

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
  /** The page gets its own layout cascade (`LayoutCascade`): finished exits re-render this page, never the app. */
  cascade: boolean;
  renderPage: (page: Page) => ReactNode;
  layerRef: (el: HTMLDivElement | null) => void;
}

/** First child of a keep-alive page: its layout cleanup (the hide) runs before any motion node of the page detaches. */
function HideHold() {
  useHoldProjectionOnHide();
  return null;
}

/** Last child of a keep-alive page: its layout effect (the show) runs after every motion node of the page mounted. */
function ShowSettle({ layer }: { layer: RefObject<HTMLElement | null> }) {
  useSettleProjectionOnShow(layer);
  return null;
}

/**
 * One page. The content element is memoised per page, so a role change (current → leaving → parked) re-renders this
 * wrapper only, never the page itself.
 */
const PageLayer = memo(function PageLayer({ page, role, keepAlive, cascade, renderPage, layerRef }: LayerProps) {
  const content = useMemo(() => {
    const node = renderPage(page);
    return cascade ? <LayoutCascade>{node}</LayoutCascade> : node;
  }, [renderPage, page, cascade]);
  const own = useRef<HTMLDivElement | null>(null);
  // the leaving page ignores pointer input (Apple: no interaction during a transition) – by listeners, not by
  // `pointer-events: none`, which restyled every element of the page in the switch frame
  const leaving = role === "leaving";
  useLayoutEffect(() => {
    const el = own.current;
    if (!leaving || !el) return;
    for (const t of LEAVING_SWALLOW) el.addEventListener(t, swallow, { capture: true });
    return () => {
      for (const t of LEAVING_SWALLOW) el.removeEventListener(t, swallow, { capture: true });
    };
  }, [leaving]);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      layerRef(el);
    },
    [layerRef],
  );
  return (
    <div
      ref={setRef}
      data-page={page}
      data-page-role={role}
      // `inert` only while parked (display:none inside – free); on the leaving layer it restyled every element of the page
      // that is fading out in the switch frame (≈ 2 200 on the Übersicht, 20–30 ms) – that layer is aria-hidden, swallows
      // pointer input, releases focus at the switch and is collapsed once its exit has played
      inert={role === "parked"}
      aria-hidden={leaving ? true : undefined}
      className={cn(leaving && "absolute inset-x-0 top-0")}
    >
      {keepAlive ? (
        <Activity mode={role === "parked" ? "hidden" : "visible"}>
          <HideHold />
          {content}
          <ShowSettle layer={own} />
        </Activity>
      ) : (
        content
      )}
    </div>
  );
});

export interface PageHostProps {
  page: Page;
  /** Renders a page; must be referentially stable (a module-level function). */
  renderPage: (page: Page) => ReactNode;
  /** Pages kept mounted while hidden (React `Activity`); pass a module-level array. */
  keepAlive?: readonly Page[];
  /**
   * Pages wrapped in their own `LayoutCascade` (a scoped `LayoutGroup` with its own `forceRender`): a finished sync-mode
   * exit there FLIPs the page's `layout` siblings (the settings page: `Reorder` rules glide up after a confirm strip
   * leaves) and re-renders that page only. `MotionRoot` itself has no cascade. Pass a module-level array.
   */
  cascade?: readonly Page[];
  onTransitioning?: (transitioning: boolean) => void;
  className?: string;
}

const NONE: readonly Page[] = [];

function settleStyles(el: HTMLElement): void {
  el.style.transform = "none";
  el.style.filter = "none";
  el.style.opacity = "";
}

export const PageHost = memo(function PageHost({ page, renderPage, keepAlive = NONE, cascade = NONE, onTransitioning, className }: PageHostProps) {
  const reduced = useReducedFx();
  // the page this host switches to: `page`, taken one painted frame later (see "Switch timing" above)
  const [target, setTarget] = useState(page);
  useLayoutEffect(() => {
    if (target === page) return;
    return afterNextPaint(() => startTransition(() => setTarget(page)));
  }, [page, target]);
  const [nav, setNav] = useState<Nav>(() => ({ current: page, leaving: null, dir: 1, seq: 0 }));
  let view = nav;
  if (nav.current !== target) {
    // state from props: the previous page becomes the leaving layer (a still-leaving older page is dropped at once)
    view = { current: target, leaving: nav.current, dir: pageDirection(nav.current, target), seq: nav.seq + 1 };
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
  const parking = useRef<CancelIdle | null>(null);
  // unmount (and the StrictMode remount probe): stop the slide, hand scroll restores back to the router
  useLayoutEffect(
    () => () => {
      for (const c of running.current) c.stop();
      running.current = [];
      parking.current?.();
      parking.current = null;
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
    parking.current?.();
    parking.current = null;
    if (seq === 0 || !leaving) return;

    const enterEl = layers.current.get(current);
    const exitEl = layers.current.get(leaving);
    // a dock flick hands over its tempo (one-shot): a fast flick gets a slightly shorter, livelier slide; every other
    // switch (tap, keyboard, back button) gets `spring.pageEnter` itself
    const enterSpring = contextSpringAt(ENTER_SPRING, consumeNavTempo());
    const enter: AnimationPlaybackControls[] = [];
    const exit: AnimationPlaybackControls[] = [];
    if (exitEl) {
      // the window may have scrolled to the new page's position: hold the old page where it was on screen
      exitEl.style.top = delta ? `${delta}px` : "";
      // what `inert` did for the leaving page: focus does not stay on an element that fades out
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && exitEl.contains(focused)) focused.blur();
      exit.push(animate(exitEl, reduced ? { opacity: [1, 0] } : { transform: [EXIT_FROM, EXIT_TO(dir)], opacity: [1, 0] }, tween.exit));
    }
    if (enterEl) {
      enterEl.style.top = "";
      // shown again before it was parked: the layer was collapsed after its exit
      restoreLayer(enterEl);
      // start values before paint: Motion resolves keyframes on the next frame, the first frame must not flash the page
      enterEl.style.opacity = "0";
      if (!reduced) {
        // Samsung-Internet-safe effects (`data-safe-fx`, decision 7): no blur – a filter over the whole page layer is the
        // most expensive thing the tablet's compositor could run during a switch; slide + fade stay
        const blur = !isSafeFx();
        enterEl.style.transform = ENTER_FROM(dir);
        enterEl.style.filter = blur ? BLUR_FROM : "none";
        enter.push(animate(enterEl, { transform: [ENTER_FROM(dir), ENTER_TO] }, enterSpring));
        enter.push(animate(enterEl, blur ? { opacity: [0, 1], filter: [BLUR_FROM, BLUR_TO] } : { opacity: [0, 1] }, ENTER_FADE));
      } else {
        // a parked page may still carry its last exit offset
        enterEl.style.transform = "none";
        enterEl.style.filter = "none";
        enter.push(animate(enterEl, { opacity: [0, 1] }, ENTER_FADE));
      }
    }
    running.current = [...enter, ...exit];
    notify.current?.(true);

    // stopped animations never resolve; the `handled` check also ignores a switch that was overtaken
    const live = () => handled.current === seq;
    void Promise.all(exit.map((c) => c.finished)).then(() => {
      if (live() && exitEl) collapseLayer(exitEl);
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
      // park (keep-alive) / unmount the page that left once nothing moves any more
      parking.current = whenIdle(() => {
        parking.current = null;
        if (live()) setNav((n) => (n.seq === seq && n.leaving ? { ...n, leaving: null } : n));
      });
    });
  }, [current, leaving, dir, seq, reduced]);

  return (
    <div className={cn("relative", className)}>
      {PAGES.map((p) => {
        const role = layerRole(p, current, leaving, keepAlive);
        return role ? <PageLayer key={p} page={p} role={role} keepAlive={keepAlive.includes(p)} cascade={cascade.includes(p)} renderPage={renderPage} layerRef={layerRefs[p]} /> : null;
      })}
    </div>
  );
});
