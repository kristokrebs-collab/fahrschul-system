import { AnimatePresence, animate, cancelFrame, frame, motion, motionValue, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from "react";
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

/** Bundle `i2` defaults: items rest at `base`, the item under the pointer magnifies to `magnification` (px). */
export const DOCK = { magnification: 64, distance: 140, panelHeight: 60, base: 44 } as const;

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

/** Raised-cosine bell (21st.dev macOS dock): 1 under the pointer, easing smoothly to 0 at `distance`. */
export function dockBell(d: number, distance: number = DOCK.distance): number {
  const a = Math.abs(d);
  return a >= distance ? 0 : 0.5 * (1 + Math.cos((Math.PI * a) / distance));
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
  cfg: { magnification: number; base: number; distance: number } = DOCK,
): number {
  const growth = (cfg.magnification - cfg.base) * Math.max(0, Math.min(1, amount));
  let spread = 0;
  for (let k = 0; k < centres.length; k++) {
    const c = centres[k] ?? NaN;
    const extra = scalable[k] && Number.isFinite(c) ? growth * dockBell(pointer - c, cfg.distance) : 0;
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
export function DockItem({ label, onClick, active = false, tab = false, fx, layer, intro = false, index = 0, ref, className, children }: DockItemProps) {
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
        {tab && (
          <AnimatePresence initial={false}>
            {active && (
              // no `layoutDependency` on the two markers: their willUpdate on a Dock re-render is what snapshots the
              // layout group when the editor opens, so the unmounting `new-trade` disc has a box to morph from
              <motion.span
                key="bg"
                layoutId="dock-bg"
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
          animate={{ opacity: 1, scale: 1 }}
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
              aria-hidden="true"
              className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal"
              style={{ borderRadius: radius.pill }}
              transition={spring.layout}
            />
          )}
        </AnimatePresence>
      )}
      <motion.span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2.5 -translate-x-1/2" style={{ y: tipY }}>
        {/* 0.2 s ease-out = tween.tooltipIn (CSS transition, compositor: opacity + translate) */}
        <span className="block translate-y-1 whitespace-pre rounded-md border border-line-2 bg-ink-800 px-2 py-0.5 text-xs text-fg opacity-0 shadow-tooltip transition-[opacity,translate] duration-200 ease-out group-hover/dock:translate-y-0 group-hover/dock:opacity-100 group-focus-visible/dock:translate-y-0 group-focus-visible/dock:opacity-100">
          {label}
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

/**
 * macOS-style dock (Bundle `i2`, Plan 2.5 "Dock", 6.6): four tabs + divider + FAB, `role="toolbar"
 * aria-label="Navigation"`. Magnification (mouse pointers only, never under reduced motion) is compositor-only: slot
 * centres are measured once per `pointerenter` in `frame.read`, one smoothed pointer and one smoothed amount
 * (`spring.dock`) drive a raised-cosine bell, and each frame writes item `x` / `scale` and the tray's caps and middle –
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
  const amount = useSpring(amountTarget, spring.dock);

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
  const breathing = fabVisible && !editor.open && canHover && !reduced;

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center" aria-label="Navigation">
      <motion.div
        ref={panelRef}
        role="toolbar"
        aria-label="Navigation"
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        initial={intro ? { y: 72, opacity: 0, filter: "blur(8px)" } : false}
        animate={intro ? { y: 0, opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } } : undefined}
        transition={{ y: spring.sheet, opacity: tween.reveal, filter: tween.reveal }}
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
    </nav>
  );
}
