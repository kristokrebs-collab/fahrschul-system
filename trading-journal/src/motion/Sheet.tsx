import { AnimatePresence, motion, type HTMLMotionProps, type PanInfo, type Variants } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { STAGGER_HIDDEN, STAGGER_SHOWN, bodyRevealDelay, sectionDelay, withSectionStagger } from "@/motion/Stagger";
import { radius, spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
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
}

const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 800;
/** The morphed body starts revealing ≈ 65 % into the morph (OV-06): never a blank panel landing, never a body over a small one. */
const BODY_REVEAL_MS = bodyRevealDelay(spring.sheet) * 1000;

const SHADOW = "shadow-[0_30px_80px_rgb(0_0_0/0.6)]";
const WIDTH: Record<NonNullable<SheetProps["size"]>, string> = { md: "sm:max-w-[540px]", lg: "sm:max-w-[860px]" };

/** Morph body: fades up from ≈ 65 % of the morph (no extra delay) and cascades its `StaggerItem`s. */
const BODY_MORPH: Variants = {
  [STAGGER_HIDDEN]: { opacity: 0, y: 8 },
  [STAGGER_SHOWN]: { opacity: 1, y: 0, transition: withSectionStagger({ duration: 0.25, ease: tween.sheetBody.ease }) },
};
/**
 * Slide-in body: the panel itself moves, the body only orchestrates its `StaggerItem`s – they start a beat
 * (`tween.body.delay`) after the panel has begun to move, while it is still settling.
 */
const BODY_SLIDE: Variants = {
  [STAGGER_HIDDEN]: {},
  [STAGGER_SHOWN]: { transition: { delayChildren: sectionDelay(tween.body.delay) } },
};

interface Readiness {
  open: boolean;
  /** Morph finished (or fallback) → body revealed (and no longer inert). Always `true` without a morph. */
  ready: boolean;
  /** Close animation still running (between `open → false` and `onExitComplete`). */
  exiting: boolean;
}

/**
 * Bottom sheet on mobile / centred dialog from `sm` (Bundle `Y$`, Plan 2.5 "Sheet"). Portal-less,
 * with focus trap + scroll lock + inert siblings + Escape/overlay close. With `layoutId` the panel
 * morphs out of its source (FAB, setup card) on `spring.sheet` straight to its final box: the body is laid out at
 * once (hidden and inert) and fades in ≈ 65 % into the morph (`bodyRevealDelay`, or `onLayoutAnimationComplete` if
 * that comes first); the dim layer fades with the panel (never the wrapper, so the panel is opaque from frame 1);
 * otherwise desktop
 * `{y:40,opacity:0,scale:.98}`
 * on `spring.sheet`, mobile `y:100%→0` on `tween.sheetIos` with drag-to-dismiss
 * (`offset.y > 120 || velocity.y > 800`). Body sections wrapped in `StaggerItem` cascade in.
 *
 * Paint budget: a morphing panel carries no shadow (its radius is scale-corrected every frame); the drop shadow
 * sits on an unscaled sibling (sm+) that fades in once the body is ready. `inert` waits for the morph and is
 * lifted – with the focus return – after the exit. `layoutRoot` sits on the fixed overlay, never on the morphing
 * panel (Motion forces a layoutRoot node's own layout animation to `type: false`, which killed the morph).
 */
export function Sheet({ open, onClose, title, size = "md", layoutId, headerExtra, footer, children, className, onOpened, handoff }: SheetProps) {
  const desktop = useIsDesktop();
  const reduced = useReducedFx();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // reduced motion → no morph, the body mounts immediately
  const morph = Boolean(layoutId) && !reduced;

  // Body readiness lives on the PANEL (the element that owns the `layoutId` animation): `onLayoutAnimationComplete`
  // only fires on layout elements, so the body itself could never observe the morph. Fallback timer for the case
  // that no layout animation runs at all (source already unmounted, first paint, …).
  const [readiness, setReadiness] = useState<Readiness>({ open, ready: !morph, exiting: false });
  // state-from-props: every open/close toggle starts a fresh readiness cycle
  if (readiness.open !== open) setReadiness({ open, ready: !morph, exiting: !open });
  const bodyReady = readiness.ready;
  const setBodyReady = () => setReadiness((r) => (r.ready ? r : { ...r, ready: true }));
  const openedRef = useRef(onOpened);
  useEffect(() => {
    openedRef.current = onOpened;
  }, [onOpened]);
  useEffect(() => {
    if (!open || bodyReady) return;
    const t = setTimeout(() => setReadiness((r) => (r.ready ? r : { ...r, ready: true })), BODY_REVEAL_MS);
    return () => clearTimeout(t);
  }, [open, bodyReady]);
  useEffect(() => {
    if (open && bodyReady && morph) openedRef.current?.();
  }, [open, bodyReady, morph]);

  useDialogBehaviour(panelRef, open, onClose, { settled: open ? bodyReady : !readiness.exiting });
  useOverlayLane(open);
  const enterDelay = handoff && !reduced ? handoff.enterDelay : 0;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
  };

  const enterExit: HTMLMotionProps<"div"> = morph
    ? { exit: { opacity: 0, scale: 0.98, transition: tween.exit }, transition: { layout: spring.sheet } }
    : desktop
      ? {
          initial: { y: 40, opacity: 0, scale: 0.98 },
          animate: { y: 0, opacity: 1, scale: 1 },
          exit: { y: 30, opacity: 0, scale: 0.98, transition: tween.exit },
          transition: { ...spring.sheet, delay: enterDelay, opacity: { ...tween.fade, delay: enterDelay } },
        }
      : { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%", transition: tween.sheetIos }, transition: { ...tween.sheetIos, delay: enterDelay } };
  const dragProps: HTMLMotionProps<"div"> = desktop
    ? {}
    : { drag: "y", dragConstraints: { top: 0, bottom: 0 }, dragElastic: 0.05, dragSnapToOrigin: true, onDragEnd };

  return (
    <AnimatePresence onExitComplete={() => setReadiness((r) => (r.exiting ? { ...r, exiting: false } : r))}>
      {open && (
        // the wrapper itself never fades (a fading parent would make the morphing panel translucent, OV-04): the dim
        // layer is a decorative sibling under the panel that fades with it; the wrapper stays the close target
        <motion.div
          key="overlay"
          layoutRoot
          className="fixed inset-0 z-[60] grid items-end justify-items-center sm:place-items-center sm:p-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-ink-950/80"
            initial={{ opacity: handoff && !reduced ? handoff.backdropFrom : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={tween.fade}
          />
          {/* `min-h-0` is load-bearing: as a grid item with `overflow: visible` the column's automatic minimum height
              would be its full content height, which stretches the overlay's single row past the viewport – the
              percentage max-height then resolves against that oversized row and the footer ends up off-screen. */}
          <div className={cn("relative flex min-h-0 max-h-[94%] w-full flex-col sm:max-h-[calc(100%-16px)]", WIDTH[size])}>
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
              {...dragProps}
              // opaque from the first frame: the source hides when the panel takes over instead of both crossfading
              layoutCrossfade={morph ? false : undefined}
              onLayoutAnimationComplete={morph ? setBodyReady : undefined}
            >
              <motion.div
                className="flex items-center justify-between gap-3 border-b border-line px-6 py-4"
                // a morphing panel starts at the source's size: head and footer (not scale-corrected) appear with the body
                initial={morph ? { opacity: 0 } : false}
                animate={{ opacity: !morph || bodyReady ? 1 : 0 }}
                transition={tween.fade}
              >
                <h2 id={titleId} className="text-[17px] font-semibold">
                  {title}
                </h2>
                <div className="flex items-center gap-2">
                  {headerExtra}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Schließen"
                    className="grid size-9 place-items-center rounded-xl border border-line-2 text-mute transition-colors hover:text-fg [&>svg]:size-4"
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
              {footer && (
                <motion.div
                  className="flex flex-wrap items-center gap-2.5 border-t border-line bg-ink-900/60 px-6 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))]"
                  initial={morph ? { opacity: 0 } : false}
                  animate={{ opacity: !morph || bodyReady ? 1 : 0 }}
                  transition={tween.fade}
                >
                  {footer}
                </motion.div>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Sheet body (`min-h-[40vh] overflow-y-auto px-6 py-5`, `layoutScroll`). The content is laid out at once, so a
 * morphing panel targets its final height in one gesture; with `morph` it stays hidden and `inert` (out of the tab
 * order and hit-testing) until the panel reports `ready` (its layout animation completed, or the fallback timer fired;
 * replaces the Bundle's 380 ms timeout `Nhe`), then fades up. Either way it is the stagger parent of the
 * `StaggerItem` sections inside.
 */
function SheetBody({ children, morph, ready }: { children: ReactNode; morph: boolean; ready: boolean }) {
  return (
    <motion.div layoutScroll className="min-h-[40vh] overflow-y-auto px-6 py-5">
      <motion.div
        variants={morph ? BODY_MORPH : BODY_SLIDE}
        initial={STAGGER_HIDDEN}
        animate={ready ? STAGGER_SHOWN : STAGGER_HIDDEN}
        inert={!ready || undefined}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
