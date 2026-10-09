import { AnimatePresence, motion, type HTMLMotionProps, type TargetAndTransition, type Variants } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialogBehaviour, useTouchMoveGuard } from "@/motion/a11y";
import { confirmSwapMotion, useConfirmFocus } from "@/motion/HoldConfirm";
import { LayoutCascade, NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { flingExit, useSwipeDismiss, type SwipeDismissInfo } from "@/motion/physics";
import { STAGGER_HIDDEN, STAGGER_SHOWN, bodyRevealDelay, sectionDelay, withSectionStagger } from "@/motion/Stagger";
import { radius, spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { useOverlayLane } from "@/primitives/toastStore";

export { StaggerItem } from "@/motion/Stagger";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Header title (`h2 text-[17px] font-semibold`), also the accessible name. */
  title: string;
  /** `md` = `sm:max-w-[540px]` (editor, import), `lg` = `sm:max-w-[860px]` (trade form). */
  size?: "md" | "lg";
  /** Shared-layout source id (`new-trade-{fabCycle}`, `setup-card-{id}`); without it the sheet slides in. */
  layoutId?: string;
  /** Extra header content (right of the title, left of the close button). */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  /** Body content. Wrap its top-level sections in `StaggerItem` to cascade them in (`stagger.sections`). */
  children: ReactNode;
  className?: string;
  /** Called once the morphed body is revealed (≈ 65 % into the layoutId morph). */
  onOpened?: () => void;
  /**
   * Hand-off from another overlay that is still leaving (detail → editor): the backdrop starts at this opacity instead
   * of 0 (the leaving overlay's dim level, so the page never brightens in between) and the panel waits `enterDelay`
   * seconds (the leaving panel's exit) before it enters.
   */
  handoff?: { backdropFrom: number; enterDelay: number };
  /**
   * `true` while closing would lose input (a dirty form, "alle eingetragenen Werte bleiben"): Escape, a backdrop
   * press, the header close button and a swipe do NOT close – the swipe is resisted with a rubber band – and
   * `onDismissAttempt` runs instead (show "Änderungen verwerfen?"). Read at the moment of the attempt.
   * Default (omitted): a safety net – guarded as soon as any field inside the sheet received input. `false` = never
   * guarded (e.g. a dialog without user input to lose).
   */
  dismissGuard?: (() => boolean) | false;
  /**
   * A guarded dismissal was attempted (`via` = what tried to close). Omitted: the sheet asks itself with an inline
   * "Änderungen verwerfen?" strip above the footer (`Verwerfen` closes, `Weiter bearbeiten` stays).
   */
  onDismissAttempt?: (via: DismissVia) => void;
}

/** What tried to close a sheet. */
export type DismissVia = "escape" | "backdrop" | "close" | "swipe";

/** Copy of the sheet's own unsaved-input confirm (same words as the trade editor's). */
export const SHEET_DISCARD_COPY = { ask: "Änderungen verwerfen?", discard: "Verwerfen", keep: "Weiter bearbeiten" } as const;

/** A swiped-away sheet: the release info plus the absolute travel that takes the column off-screen. */
interface Flung extends SwipeDismissInfo {
  distance: number;
}
/** The morphed body starts revealing ≈ 65 % into the morph (OV-06): never a blank panel landing, never a body over a small one. */
const BODY_REVEAL_MS = bodyRevealDelay(spring.sheet) * 1000;

const SHADOW = "shadow-[0_30px_80px_rgb(0_0_0/0.6)]";
const WIDTH: Record<NonNullable<SheetProps["size"]>, string> = { md: "sm:max-w-[540px]", lg: "sm:max-w-[860px]" };

/** Morph body: fades up from ≈ 65 % of the morph (no extra delay) and cascades its `StaggerItem`s. */
const BODY_MORPH: Variants = {
  [STAGGER_HIDDEN]: { opacity: 0, y: 8 },
  [STAGGER_SHOWN]: { opacity: 1, y: 0, transition: withSectionStagger({ duration: 0.25, ease: tween.sheetBody.ease }) },
  gone: (f: Flung | null | undefined) => (f ? KEEP : { opacity: 0, transition: tween.exit }),
};
/**
 * Slide-in body: the panel itself moves, the body only orchestrates its `StaggerItem`s – they start a beat
 * (`tween.body.delay`) after the panel has begun to move, while it is still settling.
 */
const BODY_SLIDE: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: { delayChildren: sectionDelay(tween.body.delay) } },
  gone: (f: Flung | null | undefined) => (f ? KEEP : { opacity: 0, transition: tween.exit }),
};

interface Readiness {
  open: boolean;
  /** Morph finished (or fallback) → body revealed (and no longer inert). Always `true` without a morph. */
  ready: boolean;
  /** Close animation still running (between `open → false` and `onExitComplete`). */
  exiting: boolean;
}

/** Close order: contents fade out first … */
const CONTENT_EXIT = { opacity: 0, transition: tween.exit };
/** … then the (emptied, opaque) panel. */
const PANEL_EXIT = { ...tween.exit, delay: tween.exit.duration };
/**
 * Swiped away: the opaque panel rides out with its contents (no text-over-text fade) while the column flies on the
 * release velocity. Exit label of everything inside the sheet; the AnimatePresence `custom` is the `Flung` or null.
 */
const KEEP: TargetAndTransition = { opacity: 1, transition: { duration: 0 } };
const CONTENT_VARIANTS: Variants = { gone: (f: Flung | null | undefined) => (f ? KEEP : CONTENT_EXIT) };

/**
 * Bottom sheet on mobile / centred dialog from `sm` (Bundle `Y$`, Plan 2.5 "Sheet"). Portal-less,
 * with focus trap + scroll lock + inert siblings + Escape/overlay close. With `layoutId` the panel
 * morphs out of its source (FAB, setup card) on `spring.sheet` straight to its final box: the body is laid out at
 * once (hidden and inert) and fades in ≈ 65 % into the morph (`bodyRevealDelay`, or `onLayoutAnimationComplete` if
 * that comes first); the dim layer fades with the panel (never the wrapper, so the panel is opaque from frame 1);
 * otherwise desktop
 * `{y:40,opacity:0,scale:.98}`
 * on `spring.sheet`, mobile `y:100%→0` on `tween.sheetIos`. Body sections wrapped in `StaggerItem` cascade in.
 *
 * Swipe to dismiss (Apple physics, `useSwipeDismiss`): on touch and pen at EVERY width (phones and tablets; the
 * mouse keeps the close button / Escape), from the header row and its grabber pill only – the body scrolls natively
 * (`overscroll-contain`, so a pull at the top never chains into pull-to-refresh). The opaque column moves 1:1 with
 * the finger (the panel's `layoutId` is never transformed), the dim follows the progress, a pull upwards stretches
 * like iOS. The release is decided on the projected distance / velocity: a slow drag springs back gently, a flick
 * dismisses and the column leaves on the release velocity with its contents inside (no text-over-text fade).
 * `dismissGuard` (dirty form): Escape, backdrop, close button and swipe never close – the swipe is resisted with a
 * rubber band – and `onDismissAttempt` runs instead.
 *
 * Paint budget: a morphing panel carries no shadow (its radius is scale-corrected every frame); the drop shadow
 * sits on an unscaled sibling (sm+) that fades in once the body is ready. `inert` waits for the morph and is
 * lifted – with the focus return – after the exit. `layoutRoot` sits on the fixed overlay, never on the morphing
 * panel (Motion forces a layoutRoot node's own layout animation to `type: false`, which killed the morph).
 */
export function Sheet({ open, onClose, title, size = "md", layoutId, headerExtra, footer, children, className, onOpened, handoff, dismissGuard, onDismissAttempt }: SheetProps) {
  const desktop = useIsDesktop();
  const reduced = useReducedFx();
  const panelRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // reduced motion → no morph, the body mounts immediately
  const morph = Boolean(layoutId) && !reduced;

  // Body readiness lives on the PANEL (the element that owns the `layoutId` animation): `onLayoutAnimationComplete`
  // only fires on layout elements, so the body itself could never observe the morph. Fallback timer for the case
  // that no layout animation runs at all (source already unmounted, first paint, …).
  const [readiness, setReadiness] = useState<Readiness>({ open, ready: !morph, exiting: false });
  const [flung, setFlung] = useState<Flung | null>(null);
  /** The sheet's own "Änderungen verwerfen?" strip (only without `onDismissAttempt`). */
  const [asking, setAsking] = useState(false);
  // state-from-props: every open/close toggle starts a fresh readiness cycle (and forgets the last fling)
  if (readiness.open !== open) {
    setReadiness({ open, ready: !morph, exiting: !open });
    if (open && flung) setFlung(null);
    if (asking) setAsking(false);
  }
  /** Default guard: any field inside received input since the sheet opened. */
  const touched = useRef(false);
  useEffect(() => {
    if (open) touched.current = false;
  }, [open]);
  const { trigger: askTrigger, no: askNo } = useConfirmFocus(asking);
  const bodyReady = readiness.ready;
  const setBodyReady = () => setReadiness((r) => (r.ready ? r : { ...r, ready: true }));
  const openedRef = useRef(onOpened);
  const guardRef = useRef(dismissGuard);
  const attemptRef = useRef(onDismissAttempt);
  const closeRef = useRef(onClose);
  useEffect(() => {
    openedRef.current = onOpened;
    guardRef.current = dismissGuard;
    attemptRef.current = onDismissAttempt;
    closeRef.current = onClose;
  }, [onOpened, dismissGuard, onDismissAttempt, onClose]);
  useEffect(() => {
    if (!open || bodyReady) return;
    const t = setTimeout(() => setReadiness((r) => (r.ready ? r : { ...r, ready: true })), BODY_REVEAL_MS);
    return () => clearTimeout(t);
  }, [open, bodyReady]);
  useEffect(() => {
    if (open && bodyReady && morph) openedRef.current?.();
  }, [open, bodyReady, morph]);

  const isGuarded = useCallback(() => {
    const g = guardRef.current;
    return g === undefined ? touched.current : g === false ? false : g();
  }, []);
  const attempt = useCallback((via: DismissVia) => {
    if (attemptRef.current) attemptRef.current(via);
    else setAsking(true);
  }, []);
  /** Every implicit close goes through the guard; explicit actions (Save, Cancel) call `onClose` themselves. */
  const requestClose = useCallback(
    (via: DismissVia) => {
      if (isGuarded()) attempt(via);
      else closeRef.current();
    },
    [isGuarded, attempt],
  );
  const onEscape = useCallback(() => requestClose("escape"), [requestClose]);

  useDialogBehaviour(panelRef, open, onEscape, { settled: open ? bodyReady : !readiness.exiting });
  useOverlayLane(open);
  const enterDelay = handoff && !reduced ? handoff.enterDelay : 0;

  const swipe = useSwipeDismiss({
    // after the open morph / enter; never while exiting
    enabled: open && bodyReady,
    open,
    target: columnRef,
    guard: isGuarded,
    onAttempt: () => attempt("swipe"),
    onDismiss: (info) => {
      // absolute travel that takes the whole column below the viewport (a centred tablet dialog needs more than its height)
      const col = columnRef.current;
      const top = col ? col.getBoundingClientRect().top : 0;
      const distance = Math.max(info.size, swipe.y.get() + Math.max(0, window.innerHeight - top)) + 24;
      setFlung({ ...info, distance });
      closeRef.current();
    },
  });

  const touchGuard = useTouchMoveGuard(swipe.isDragging);

  // close: head, body and footer fade first (CONTENT_EXIT), the panel – by then an empty opaque surface – after them,
  // so a fading panel never shows its text over the page's text. Swiped away (`custom` = Flung): everything stays
  // opaque and the column flies out on the release velocity.
  const panelExit: TargetAndTransition = morph ? { opacity: 0, scale: 0.98, transition: PANEL_EXIT } : desktop ? { y: 30, opacity: 0, scale: 0.98, transition: PANEL_EXIT } : { y: "100%", transition: tween.sheetIos };
  const panelVariants: Variants = { gone: (f: Flung | null | undefined) => (f ? KEEP : panelExit) };
  const columnVariants: Variants = { gone: (f: Flung | null | undefined) => (f ? flingExit(f, { distance: f.distance, reduced }) : {}) };
  const enterExit: HTMLMotionProps<"div"> = morph
    ? { transition: { layout: spring.sheet } }
    : desktop
      ? {
          initial: { y: 40, opacity: 0, scale: 0.98 },
          animate: { y: 0, opacity: 1, scale: 1 },
          transition: { ...spring.sheet, delay: enterDelay, opacity: { ...tween.fade, delay: enterDelay } },
        }
      : { initial: { y: "100%" }, animate: { y: 0 }, transition: { ...tween.sheetIos, delay: enterDelay } };

  return (
    // a fixed overlay: its exit never moves a sibling, so no app-wide re-render once it has left
    <NoLayoutCascade>
      <AnimatePresence
        custom={flung}
        onExitComplete={() => {
          setReadiness((r) => (r.exiting ? { ...r, exiting: false } : r));
          // the flung column was left off-screen: back to rest while nothing is mounted
          swipe.reset({ instant: true });
        }}
      >
        {open && (
          // the wrapper itself never fades (a fading parent would make the morphing panel translucent, OV-04): the dim
          // layer is a decorative sibling under the panel that fades with it; the wrapper stays the close target
          <motion.div
            key="overlay"
            layoutRoot
            className="fixed inset-0 z-[60] grid items-end justify-items-center sm:place-items-center sm:p-4"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) requestClose("backdrop");
            }}
          >
            {/* the body's own presences (discard strip, form sections) keep the root group's cascade */}
            <LayoutCascade>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                initial={{ opacity: handoff && !reduced ? handoff.backdropFrom : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: tween.exit }}
                transition={tween.fade}
              >
                {/* the swipe dims through this inner layer, so enter/exit and drag opacity multiply */}
                <motion.div className="absolute inset-0 bg-ink-950/80" style={{ opacity: swipe.dim }} />
              </motion.div>
              {/* `min-h-0` is load-bearing: as a grid item with `overflow: visible` the column's automatic minimum height
                  would be its full content height, which stretches the overlay's single row past the viewport – the
                  percentage max-height then resolves against that oversized row and the footer ends up off-screen.
                  The column is what the swipe moves (panel + shadow sibling together, the `layoutId` panel untouched);
                  below `sm` it carries a bleed under the bottom sheet, so a pull upwards never opens a gap. */}
              <motion.div
                ref={columnRef}
                className={cn(
                  "relative flex min-h-0 max-h-[94%] w-full flex-col sm:max-h-[calc(100%-16px)]",
                  "max-sm:after:pointer-events-none max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:top-[calc(100%-1px)] max-sm:after:h-24 max-sm:after:bg-ink-850 max-sm:after:content-['']",
                  WIDTH[size],
                )}
                style={swipe.style}
                variants={columnVariants}
                exit="gone"
              >
                {morph && (
                  <motion.div
                    aria-hidden="true"
                    className={cn("pointer-events-none absolute inset-0 max-sm:hidden", SHADOW)}
                    style={{ borderRadius: radius.sheet }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: bodyReady ? 1 : 0 }}
                    exit={{ opacity: 0, transition: tween.exit }}
                    transition={tween.fade}
                  />
                )}
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  layoutId={layoutId}
                  style={{ borderRadius: radius.sheet }}
                  className={cn(
                    "relative flex min-h-0 w-full flex-col overflow-hidden rounded-t-3xl border border-line-2 bg-ink-850 outline-none sm:rounded-3xl",
                    // a sliding panel only moves by transform, so its own shadow is never repainted mid-flight
                    !morph && SHADOW,
                    WIDTH[size],
                    className,
                  )}
                  {...enterExit}
                  variants={panelVariants}
                  exit="gone"
                  // opaque from the first frame: the source hides when the panel takes over instead of both crossfading
                  layoutCrossfade={morph ? false : undefined}
                  onLayoutAnimationComplete={morph ? setBodyReady : undefined}
                  onInputCapture={() => {
                    touched.current = true;
                  }}
                >
                  <motion.div
                    ref={touchGuard}
                    data-sheet-handle=""
                    className="relative flex items-center justify-between gap-3 border-b border-line px-6 py-4 pointer-coarse:cursor-grab pointer-coarse:active:cursor-grabbing"
                    // a morphing panel starts at the source's size: head and footer (not scale-corrected) appear with the body
                    initial={morph ? { opacity: 0 } : false}
                    animate={{ opacity: !morph || bodyReady ? 1 : 0 }}
                    variants={CONTENT_VARIANTS}
                    exit="gone"
                    transition={tween.fade}
                    {...swipe.handle}
                  >
                    {/* grabber: the visible handle of the swipe on touch screens (decorative, the header row is the handle) */}
                    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1.5 hidden h-[5px] w-9 -translate-x-1/2 rounded-full bg-white/15 pointer-coarse:block" />
                    <h2 id={titleId} className="text-[17px] font-semibold">
                      {title}
                    </h2>
                    <div className="flex items-center gap-2">
                      {headerExtra}
                      <button
                        ref={askTrigger}
                        type="button"
                        onClick={() => requestClose("close")}
                        aria-label="Schließen"
                        className="grid size-9 place-items-center rounded-xl border border-line-2 text-mute transition-colors hover:text-fg pointer-coarse:size-11 [&>svg]:size-4"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                  <SheetBody morph={morph} ready={bodyReady}>
                    {children}
                  </SheetBody>
                  {/* the sheet's own unsaved-input confirm (callers without `onDismissAttempt`) */}
                  <AnimatePresence initial={false}>
                    {asking && (
                      <motion.div
                        key="ask"
                        role="group"
                        aria-label={SHEET_DISCARD_COPY.ask}
                        data-testid="sheet-discard-confirm"
                        className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line bg-ink-900 px-6 py-3"
                        {...confirmSwapMotion(reduced)}
                      >
                        <span className="basis-full text-[12.5px] font-medium text-[#ff8a90] sm:mr-auto sm:basis-auto">{SHEET_DISCARD_COPY.ask}</span>
                        <span className="inline-flex gap-2">
                          <Button variant="danger" className="pointer-coarse:min-h-11" onClick={() => closeRef.current()}>
                            {SHEET_DISCARD_COPY.discard}
                          </Button>
                          <Button ref={askNo} variant="primary" className="pointer-coarse:min-h-11" onClick={() => setAsking(false)}>
                            {SHEET_DISCARD_COPY.keep}
                          </Button>
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {footer && (
                    <motion.div
                      className="flex flex-wrap items-center gap-2.5 border-t border-line bg-ink-900/60 px-6 py-3.5 pb-[calc(14px+var(--safe-bottom,env(safe-area-inset-bottom,0px)))]"
                      initial={morph ? { opacity: 0 } : false}
                      animate={{ opacity: !morph || bodyReady ? 1 : 0 }}
                      variants={CONTENT_VARIANTS}
                      exit="gone"
                      transition={tween.fade}
                    >
                      {footer}
                    </motion.div>
                  )}
                </motion.div>
              </motion.div>
            </LayoutCascade>
          </motion.div>
        )}
      </AnimatePresence>
    </NoLayoutCascade>
  );
}

/**
 * Sheet body (`min-h-[40vh] overflow-y-auto overscroll-y-contain px-6 py-5`, `layoutScroll`). The content is laid out at once, so a
 * morphing panel targets its final height in one gesture; with `morph` it stays hidden and `inert` (out of the tab
 * order and hit-testing) until the panel reports `ready` (its layout animation completed, or the fallback timer fired;
 * replaces the Bundle's 380 ms timeout `Nhe`), then fades up. Either way it is the stagger parent of the
 * `StaggerItem` sections inside.
 */
function SheetBody({ children, morph, ready }: { children: ReactNode; morph: boolean; ready: boolean }) {
  return (
    <motion.div layoutScroll className="min-h-[40vh] overflow-y-auto overscroll-y-contain px-6 py-5">
      <motion.div
        variants={morph ? BODY_MORPH : BODY_SLIDE}
        initial={STAGGER_HIDDEN}
        animate={ready ? STAGGER_SHOWN : STAGGER_HIDDEN}
        exit="gone"
        inert={!ready || undefined}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
