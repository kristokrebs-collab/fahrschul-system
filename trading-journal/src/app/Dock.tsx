import { AnimatePresence, animate, cancelFrame, frame, motion, motionValue, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from "react";
import { expoCurve, springCurve } from "@/app/cssEasing";
import { useIntroPhase, type IntroPhase } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { usePressable } from "@/motion/usePressable";
import { useCanHover } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Icon, type IconName } from "@/primitives/icons";
import { Magnetic } from "@/primitives/Magnetic";
import { navigate } from "@/store/router";
import { PAGES, useUi, type Page } from "@/store/uiStore";

/** Bundle `Dhe`. */
export const PAGE_LABELS: Record<Page, string> = { overview: "Übersicht", trades: "Trades", setups: "Entscheidungsgrundlagen", settings: "Einstellungen" };
export const FAB_LABEL = "Trade eintragen";
const PAGE_ICON: Record<Page, IconName> = { overview: "grid", trades: "list", setups: "target", settings: "sliders" };

/**
 * pulse-motion `dock` (measured) + its magnification remix. Label: opacity `1 − e^(−t/τ)` in 38 ms / out 35 ms, rises
 * from +6 px on a 1000/38 spring (≈ 0.6 px overshoot), position does not return on hover-out; pill: in 40 ms after a
 * 25 ms delay, out 45 ms. Magnification: `scale = 1 + 0.8 · bell(d)`, Gaussian bell (σ), amount on a 400/20 spring.
 */
export const DOCK_CONFIG = {
  tipInTauMs: 38,
  tipOutTauMs: 35,
  tipRiseFrom: 6,
  tipSpring: { stiffness: 1000, damping: 38 },
  pillInTauMs: 40,
  pillOutTauMs: 45,
  pillDelayMs: 25,
  magnify: 0.8,
  sigma: 48,
  magnifySpring: { type: "spring", stiffness: 400, damping: 20 },
  /** gap between the label and the top of the (magnified) icon, px (SH-03: clear of the page text above the dock) */
  tipGap: 14,
  /** intro build: the tray rises from this far below on a soft-bounce spring */
  introRise: 96,
} as const;

/** Items rest at `base`; the item under the pointer magnifies to `magnification` (px); the bell ends at `distance`. */
export const DOCK = { magnification: 44 * (1 + DOCK_CONFIG.magnify), distance: 140, panelHeight: 60, base: 44, sigma: DOCK_CONFIG.sigma } as const;

const TIP_IN = expoCurve(DOCK_CONFIG.tipInTauMs);
const TIP_OUT = expoCurve(DOCK_CONFIG.tipOutTauMs);
const TIP_RISE = springCurve(DOCK_CONFIG.tipSpring);
const PILL_IN = expoCurve(DOCK_CONFIG.pillInTauMs);
const PILL_OUT = expoCurve(DOCK_CONFIG.pillOutTauMs);
/** CSS transitions of label and pill (set once on the nav; hover/focus swap the in/out variant – compositor only). */
const DOCK_FX_VARS = {
  // surface: an opaque plate uncovered bottom-up by clip-path on the label's opacity curve (never translucent over the
  // page text behind it, SH-03); it rises on the spring. Hover-out: the plate closes, the position resets once hidden
  "--dock-tip-in": `clip-path ${TIP_IN.ms}ms ${TIP_IN.easing}, translate ${TIP_RISE.ms}ms ${TIP_RISE.easing}`,
  "--dock-tip-out": `clip-path ${TIP_OUT.ms}ms ${TIP_OUT.easing}, translate 0s linear ${TIP_OUT.ms}ms`,
  // label text: the pack's exponential fade (τ 38 ms in / 35 ms out) on top of the opaque plate
  "--dock-tiptext-in": `opacity ${TIP_IN.ms}ms ${TIP_IN.easing}`,
  "--dock-tiptext-out": `opacity ${TIP_OUT.ms}ms ${TIP_OUT.easing}`,
  "--dock-pill-in": `opacity ${PILL_IN.ms}ms ${PILL_IN.easing} ${DOCK_CONFIG.pillDelayMs}ms`,
  "--dock-pill-out": `opacity ${PILL_OUT.ms}ms ${PILL_OUT.easing}`,
  "--dock-tip-rise": `${DOCK_CONFIG.tipRiseFrom}px`,
} as CSSProperties;

/** Session flag of the dock entrance (its own key: the wordmark's `tj2-intro` must stay untouched). */
export const DOCK_INTRO_KEY = "tj2-dock-intro";
/** Upward launch speed of the icon hop on activation (px/s); `spring.pop` brings it back with one small rebound. */
const HOP_VELOCITY = -600;
/** Entrance: icons start popping once the tray has risen about halfway (s), then follow `stagger.cards`. */
const ICON_INTRO_DELAY = 0.14;
/** Tray caps: width of the rounded end pieces and how far the stretchable middle reaches under them (px). */
const CAP = 24;
const CAP_OVERLAP = 8;
/** FAB ring: pings `tween.pingFew` times when the FAB (re)appears, then rests – no endless loop on an idle page. */
const FAB_PING_STYLE = {
  "--fx-ping-opacity": "0.35",
  "--fx-ping-scale": "1.5",
  animationDuration: `${tween.pingFew.duration}s`,
  animationIterationCount: tween.pingFew.repeat + 1,
} as CSSProperties;

/* ------------------------------------------------------------------ magnification model (pure) */

/**
 * Gaussian bell `e^(−d²/2σ²)` (pack remix), windowed so it reaches exactly 0 at `distance`: 1 under the pointer,
 * no step where the pointer leaves the range.
 */
export function dockBell(d: number, distance: number = DOCK.distance, sigma: number = DOCK.sigma): number {
  const a = Math.abs(d);
  if (a >= distance) return 0;
  const g = (x: number) => Math.exp(-(x * x) / (2 * sigma * sigma));
  const floor = g(distance);
  return (g(a) - floor) / (1 - floor);
}

/**
 * Compositor-only magnified geometry. Every scalable slot grows by `extra = (magnification − base) · amount ·
 * bell(pointer − centre)`; slots then shift so the row widens symmetrically about its centre:
 * `shift_k = Σ_{j<k} extra_j + extra_k / 2 − W / 2` with `W = Σ extra`. Writes into `scale` / `shift` (no allocation
 * per frame) and returns `W`. Non-finite centres (unmeasured slots) neither grow nor move.
 */
export function dockLayout(
  centres: readonly number[],
  scalable: readonly boolean[],
  pointer: number,
  amount: number,
  scale: number[],
  shift: number[],
  cfg: { magnification: number; base: number; distance: number; sigma: number } = DOCK,
): number {
  const growth = (cfg.magnification - cfg.base) * Math.max(0, Math.min(1, amount));
  let spread = 0;
  for (let k = 0; k < centres.length; k++) {
    const c = centres[k] ?? NaN;
    const extra = scalable[k] && Number.isFinite(c) ? growth * dockBell(pointer - c, cfg.distance, cfg.sigma) : 0;
    scale[k] = 1 + extra / cfg.base;
    shift[k] = spread + extra / 2;
    spread += extra;
  }
  for (let k = 0; k < centres.length; k++) shift[k] = (shift[k] ?? 0) - spread / 2;
  return spread;
}

/* ------------------------------------------------------------------ session flag */

function dockIntroSeen(): boolean {
  try {
    return sessionStorage.getItem(DOCK_INTRO_KEY) !== null;
  } catch {
    return true;
  }
}

function markDockIntroSeen(): void {
  try {
    sessionStorage.setItem(DOCK_INTRO_KEY, "1");
  } catch {
    /* private mode: the entrance simply plays again next time */
  }
}

/* ------------------------------------------------------------------ item */

/** Per-slot MotionValues written by the dock's magnification loop. */
export interface DockSlotFx {
  x: MotionValue<number>;
  scale: MotionValue<number>;
}

export interface DockItemProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Renders the `dock-bg` / `dock-dot` shared-layout markers when active (the four tabs). */
  tab?: boolean;
  /** Magnification values of this slot (x shift + scale); the item never changes its layout box. */
  fx: DockSlotFx;
  /** Extra visual layers between the disc and the icon (the FAB's ping ring and `new-trade` disc). */
  layer?: ReactNode;
  /** Once-per-session entrance: the icon pops in at `index` in the stagger. */
  intro?: boolean;
  /** Intro stage: the icon waits hidden and pops in (same stagger) when the dock rises on "build". */
  waiting?: boolean;
  /** Changes whenever the shared-layout markers must re-measure (page / editor); see SH-01 in the Dock doc. */
  layoutKey?: string;
  index?: number;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
  children: ReactNode;
}

/**
 * Dock item (Bundle `Kw`). The 44 px button keeps its layout box; magnification is a transform only: the button shifts
 * by `fx.x` and its visual (disc, `dock-bg` pill, icon) scales by `fx.scale` from the bottom edge, so the item grows
 * up out of the tray like the macOS dock without a single layout per frame. The tooltip rides above the scaled visual
 * (CSS `:hover` / `:focus-visible`, no React state). On activation the icon hops (`spring.pop` with an upward launch);
 * `whileTap .94`.
 */
export function DockItem({ label, onClick, active = false, tab = false, fx, layer, intro = false, waiting = false, layoutKey, index = 0, ref, className, children }: DockItemProps) {
  const reduced = useReducedFx();
  const press = usePressable({ scale: 0.94 });
  const hop = useMotionValue(0);
  const tipY = useTransform(fx.scale, (s) => -DOCK.base * (s - 1));

  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    if (!active || was || reduced) return;
    const c = animate(hop, 0, { ...spring.pop, velocity: HOP_VELOCITY });
    return () => c.stop();
  }, [active, reduced, hop]);

  const iconDelay = ICON_INTRO_DELAY + Math.min(index, stagger.max) * stagger.cards;
  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      whileTap={press.whileTap}
      transition={press.transition}
      style={{ x: fx.x }}
      // own layer for the shift; the scaled visual inside is re-painted at its displayed size, so icons stay crisp
      className={cn(
        "group/dock relative grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-200 will-change-transform hover:z-10 focus-visible:z-10",
        className,
      )}
    >
      <motion.span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ scale: fx.scale, originY: 1 }}>
        {tab && <span className="absolute inset-0 rounded-full bg-white/[0.05]" />}
        {/* pack hover pill: fades in 25 ms after the label (τ 40 ms), out a little slower (τ 45 ms) */}
        <span className="absolute inset-0 rounded-full bg-line-2 opacity-0 [transition:var(--dock-pill-out)] group-hover/dock:opacity-100 group-hover/dock:[transition:var(--dock-pill-in)] group-focus-visible/dock:opacity-100 group-focus-visible/dock:[transition:var(--dock-pill-in)]" />
        {tab && (
          <AnimatePresence initial={false}>
            {active && (
              // `layoutKey` includes the editor state: the markers' willUpdate when the editor opens is what snapshots the
              // layout group, so the unmounting `new-trade` disc has a box to morph from
              <motion.span
                key="bg"
                layoutId="dock-bg"
                layoutDependency={layoutKey}
                className="absolute inset-0 rounded-full bg-white"
                style={{ borderRadius: radius.pill }}
                transition={spring.layout}
              />
            )}
          </AnimatePresence>
        )}
        {layer}
        <motion.span
          className="absolute inset-0 grid place-items-center"
          style={{ y: hop }}
          initial={intro ? { opacity: 0, scale: 0.5 } : false}
          animate={waiting ? { opacity: 0, scale: 0.5 } : { opacity: 1, scale: 1 }}
          transition={{ scale: { ...spring.pop, delay: iconDelay }, opacity: { ...tween.fade, delay: iconDelay } }}
        >
          <Magnetic intensity={0.5} range={60} remeasure className="size-5 items-center justify-center [&_svg]:size-full">
            {children}
          </Magnetic>
        </motion.span>
      </motion.span>
      {tab && (
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="dot"
              layoutId="dock-dot"
              layoutDependency={layoutKey}
              aria-hidden="true"
              className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal"
              style={{ borderRadius: radius.pill }}
              transition={spring.layout}
            />
          )}
        </AnimatePresence>
      )}
      <motion.span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2" style={{ y: tipY, marginBottom: DOCK_CONFIG.tipGap }}>
        {/* pack label (fades in, rising from +6 px on the 1000/38 spring) on an opaque Nothing plate that is uncovered by
            clip-path instead of fading, so page text behind it is either fully covered or untouched (SH-03).
            CSS transitions with the measured curves as linear() (compositor: clip-path, opacity, translate) */}
        <span className="block translate-y-[var(--dock-tip-rise)] whitespace-pre rounded-md border border-white/15 bg-ink-700 px-2 py-0.5 text-xs font-medium text-fg [clip-path:inset(100%_0_0_0_round_6px)] [transition:var(--dock-tip-out)] group-hover/dock:translate-y-0 group-hover/dock:[clip-path:inset(0_0_0_0_round_6px)] group-hover/dock:[transition:var(--dock-tip-in)] group-focus-visible/dock:translate-y-0 group-focus-visible/dock:[clip-path:inset(0_0_0_0_round_6px)] group-focus-visible/dock:[transition:var(--dock-tip-in)]">
          <span className="block opacity-0 [transition:var(--dock-tiptext-out)] group-hover/dock:opacity-100 group-hover/dock:[transition:var(--dock-tiptext-in)] group-focus-visible/dock:opacity-100 group-focus-visible/dock:[transition:var(--dock-tiptext-in)]">
            {label}
          </span>
        </span>
      </motion.span>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ dock */

/** Slots in DOM order: four tabs, the divider (moves, never scales), the FAB. */
const SLOT_COUNT = PAGES.length + 2;
const DIVIDER = PAGES.length;
const FAB_SLOT = PAGES.length + 1;
const SCALABLE: readonly boolean[] = Array.from({ length: SLOT_COUNT }, (_, k) => k !== DIVIDER);

interface Geometry {
  /** resting slot centres (client px, minus any shift still in flight) */
  centres: number[];
  /** resting width of the stretchable tray middle (px) */
  mid: number;
}

/**
 * Stretchable tray behind the items (aria-hidden): two rounded caps that slide out by `∓W/2` and a flat middle that
 * scales by `1 + W / mid`, so the tray widens with the magnified row while its corners keep their radius.
 */
function DockTray({ left, right, mid }: { left: MotionValue<number>; right: MotionValue<number>; mid: MotionValue<number> }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <motion.span className="absolute inset-y-0 border-y border-line-2 bg-ink-850 shadow-dock will-change-transform" style={{ left: CAP - CAP_OVERLAP, right: CAP - CAP_OVERLAP, scaleX: mid }} />
      <motion.span className="absolute inset-y-0 left-0 rounded-l-2xl border border-r-0 border-line-2 bg-ink-850 will-change-transform" style={{ width: CAP, x: left }} />
      <motion.span className="absolute inset-y-0 right-0 rounded-r-2xl border border-l-0 border-line-2 bg-ink-850 will-change-transform" style={{ width: CAP, x: right }} />
    </span>
  );
}

interface TrayEntrance {
  initial: false | { y: number; opacity: number; filter?: string };
  animate: undefined | { y: number; opacity: number; filter?: string; transitionEnd?: { filter: string } };
  transition: Record<string, unknown>;
}

/**
 * Pure: the tray's entrance for the intro phase. "stage": parked below the edge (the intro covers the app); "build":
 * rises with a soft bounce (`spring.reveal`, ζ ≈ 0.68); otherwise the once-per-session entrance (`spring.sheet` + blur)
 * or nothing. Always ends at y 0 / opacity 1, whatever phase sequence arrives (skip → "done" straight from "stage").
 */
export function dockEntrance(phase: IntroPhase, sessionIntro: boolean, reduced: boolean): TrayEntrance {
  if (reduced) return { initial: false, animate: { y: 0, opacity: 1 }, transition: { duration: 0 } };
  // the tray mounts before the intro starts (phase "off" → the session entrance's blurred `initial`): "stage" drops
  // that blur at once, so the build rise is crisp
  if (phase === "stage") return { initial: false, animate: { y: DOCK_CONFIG.introRise, opacity: 0, filter: "none" }, transition: { duration: 0 } };
  if (phase === "build") return { initial: false, animate: { y: 0, opacity: 1, filter: "none" }, transition: { y: spring.reveal, opacity: tween.fade, filter: { duration: 0 } } };
  // the blurred session entrance only without an intro: after a played intro ("done") the tray is already in place
  if (sessionIntro && phase === "off")
    return {
      initial: { y: 72, opacity: 0, filter: "blur(8px)" },
      animate: { y: 0, opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } },
      transition: { y: spring.sheet, opacity: tween.reveal, filter: tween.reveal },
    };
  return { initial: false, animate: { y: 0, opacity: 1 }, transition: { y: spring.reveal, opacity: tween.fade } };
}

/**
 * macOS-style dock (Bundle `i2`, Plan 2.5 "Dock", 6.6): four tabs + divider + FAB, `role="toolbar"
 * aria-label="Navigation"`. Magnification (mouse pointers only, never under reduced motion) is compositor-only: slot
 * centres are measured once per `pointerenter` in `frame.read`, one smoothed pointer and one smoothed amount
 * (pointer `spring.dock`, amount on the pack's 400/20 spring) drive a windowed Gaussian bell, and each frame writes item `x` / `scale` and the tray's caps and middle –
 * no width, height or layout read per move. Once per session the dock rises in (`spring.sheet`, blur, icon pop), and
 * the FAB pings a red ring three times whenever it (re)appears with the editor closed (hover devices, not under
 * reduced motion), then rests. The `new-trade-{fabCycle}` disc morphs one way into the editor sheet; on the way back
 * it remounts under a fresh id and acknowledges the return with a `spring.pop` scale (never a sheet-sized red blob).
 */
export function Dock() {
  const page = useUi((s) => s.page);
  const editor = useUi((s) => s.editor);
  const fabCycle = useUi((s) => s.fabCycle);
  const openEditor = useUi((s) => s.openEditor);
  const reduced = useReducedFx();
  const canHover = useCanHover();
  const magnify = canHover && !reduced;
  const phase = useIntroPhase();

  // read once per mount, written after commit (a StrictMode double render must not consume the flag)
  const [introFresh] = useState(() => !dockIntroSeen());
  const intro = introFresh && !reduced;
  useEffect(() => {
    markDockIntroSeen();
  }, []);

  const [slots] = useState<DockSlotFx[]>(() => Array.from({ length: SLOT_COUNT }, () => ({ x: motionValue(0), scale: motionValue(1) })));
  const [tray] = useState(() => ({ left: motionValue(0), right: motionValue(0), mid: motionValue(1) }));
  const slotEls = useRef<(HTMLElement | null)[]>([]);
  const [slotRefs] = useState(() =>
    Array.from({ length: SLOT_COUNT }, (_, k) => (el: HTMLElement | null) => {
      slotEls.current[k] = el;
    }),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const geometry = useRef<Geometry | null>(null);

  const pointerTarget = useMotionValue(0);
  const amountTarget = useMotionValue(0);
  const pointer = useSpring(pointerTarget, spring.dock);
  const amount = useSpring(amountTarget, DOCK_CONFIG.magnifySpring);

  // one layout pass per frame, after the springs stepped (preRender), straight into the slot MotionValues
  useEffect(() => {
    const scale = new Array<number>(SLOT_COUNT).fill(1);
    const shift = new Array<number>(SLOT_COUNT).fill(0);
    const apply = () => {
      const g = geometry.current;
      if (!g) return;
      const spread = dockLayout(g.centres, SCALABLE, pointer.get(), amount.get(), scale, shift);
      slots.forEach((s, k) => {
        s.scale.set(scale[k] ?? 1);
        s.x.set(shift[k] ?? 0);
      });
      tray.left.set(-spread / 2);
      tray.right.set(spread / 2);
      tray.mid.set(1 + spread / g.mid);
    };
    const schedule = () => frame.preRender(apply);
    const offPointer = pointer.on("change", schedule);
    const offAmount = amount.on("change", schedule);
    return () => {
      offPointer();
      offAmount();
      cancelFrame(apply);
    };
  }, [pointer, amount, slots, tray]);

  useEffect(() => {
    const invalidate = () => {
      geometry.current = null;
    };
    window.addEventListener("resize", invalidate, { passive: true });
    return () => window.removeEventListener("resize", invalidate);
  }, []);

  useEffect(() => {
    if (!magnify) amountTarget.set(0);
  }, [magnify, amountTarget]);

  /** Resting geometry; runs inside `frame.read` (the current shift is subtracted, so a settling leave never skews it). */
  const measure = () => {
    const panel = panelRef.current;
    if (!panel) return;
    const centres = slots.map((s, k) => {
      const el = slotEls.current[k];
      if (!el) return NaN;
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 - s.x.get();
    });
    geometry.current = { centres, mid: Math.max(1, panel.getBoundingClientRect().width - 2 * (CAP - CAP_OVERLAP)) };
  };

  const track = (clientX: number) => {
    frame.read(() => {
      if (!geometry.current) measure();
      // waking up from rest: start the bell at the pointer instead of sweeping in from the last position
      if (amount.get() < 0.01) {
        pointerTarget.jump(clientX);
        pointer.jump(clientX);
      } else pointerTarget.set(clientX);
      amountTarget.set(1);
    });
  };
  const onPointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !magnify) return;
    geometry.current = null;
    track(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !magnify) return;
    if (!geometry.current || amountTarget.get() !== 1) {
      track(e.clientX);
      return;
    }
    pointerTarget.set(e.clientX);
  };
  const onPointerLeave = () => amountTarget.set(0);

  const fabVisible = !(editor.open && editor.fromFab);
  const breathing = fabVisible && !editor.open && canHover && !reduced && phase !== "stage";
  const layoutKey = `${page}|${editor.open ? 1 : 0}`;
  const entrance = dockEntrance(phase, intro, reduced);

  return (
    // layoutRoot (SH-01): the nav is position:fixed, so Motion must never read a page-scroll clamp (the document got
    // shorter while scrolled) as movement of the dock-bg / dock-dot / new-trade markers inside it
    <motion.nav
      layoutRoot
      className="pointer-events-none fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center"
      aria-label="Navigation"
      style={DOCK_FX_VARS}
    >
      <motion.div
        ref={panelRef}
        role="toolbar"
        aria-label="Navigation"
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        initial={entrance.initial}
        animate={entrance.animate}
        transition={entrance.transition}
        style={{ height: DOCK.panelHeight }}
        className="pointer-events-auto relative mx-2 flex max-w-full items-end gap-3 px-3 pb-2"
      >
        <DockTray left={tray.left} right={tray.right} mid={tray.mid} />
        {PAGES.map((p, k) => (
          <DockItem
            key={p}
            ref={slotRefs[k]}
            tab
            fx={slots[k] as DockSlotFx}
            intro={intro}
            waiting={phase === "stage"}
            layoutKey={layoutKey}
            index={k}
            label={PAGE_LABELS[p]}
            active={page === p}
            onClick={() => navigate(p)}
            className={page === p ? "text-ink-950" : "text-mute hover:text-fg"}
          >
            <Icon name={PAGE_ICON[p]} />
          </DockItem>
        ))}
        <motion.span ref={slotRefs[DIVIDER]} aria-hidden="true" className="relative mb-2.5 h-7 w-px self-end bg-line-2 will-change-transform" style={{ x: (slots[DIVIDER] as DockSlotFx).x }} />
        <DockItem
          ref={slotRefs[FAB_SLOT]}
          fx={slots[FAB_SLOT] as DockSlotFx}
          intro={intro}
          waiting={phase === "stage"}
          index={FAB_SLOT}
          label={FAB_LABEL}
          onClick={() => openEditor({ fromFab: true })}
          className="text-ink-950"
          layer={
            <>
              {/* breathing ring: 3 × fx-ping (= tween.pingFew) each time it mounts, compositor only */}
              {breathing && <span className="fx-ping bg-signal" style={FAB_PING_STYLE} />}
              {fabVisible && (
                <motion.span
                  layoutId={`new-trade-${fabCycle}`}
                  layoutDependency={layoutKey}
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-[#ff3b47] to-signal"
                  style={{ borderRadius: radius.fab }}
                  initial={fabCycle > 0 && !reduced ? { scale: 0.9 } : false}
                  animate={{ scale: 1 }}
                  transition={{ layout: spring.sheet, scale: spring.pop }}
                />
              )}
            </>
          }
        >
          <Icon name="plus" />
        </DockItem>
      </motion.div>
    </motion.nav>
  );
}
