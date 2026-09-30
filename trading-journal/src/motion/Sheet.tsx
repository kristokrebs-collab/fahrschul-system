import { AnimatePresence, motion, type HTMLMotionProps, type PanInfo } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { radius, spring, tween } from "@/motion/tokens";
import { useIsDesktop } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Header title (`h2 text-[17px] font-semibold`), also the accessible name. */
  title: string;
  /** `md` = `sm:max-w-[540px]` (editor, import), `lg` = `sm:max-w-[860px]` (trade form). */
  size?: "md" | "lg";
  /** Shared-layout source id (`new-trade`, `setup-card-{id}`); without it the sheet slides in. */
  layoutId?: string;
  /** Extra header content (right of the title, left of the close button). */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Called after the open morph (layoutId) has finished – the body mounts then. */
  onOpened?: () => void;
}

const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 800;
/** Safety net: the body mounts at the latest after this delay even when no layout animation ran (no source in the DOM). */
const MORPH_FALLBACK_MS = 600;

/**
 * Bottom sheet on mobile / centred dialog from `sm` (Bundle `Y$`, Plan 2.5 "Sheet"). Portal-less,
 * with focus trap + scroll lock + inert siblings + Escape/overlay close. With `layoutId` the panel
 * morphs out of its source (FAB, setup card) on `spring.sheet` and the body mounts after
 * `onLayoutAnimationComplete` (`tween.sheetBody`); otherwise desktop `{y:40,opacity:0,scale:.98}`
 * on `spring.sheet`, mobile `y:100%→0` on `tween.sheetIos` with drag-to-dismiss
 * (`offset.y > 120 || velocity.y > 800`).
 */
export function Sheet({ open, onClose, title, size = "md", layoutId, headerExtra, footer, children, className, onOpened }: SheetProps) {
  const desktop = useIsDesktop();
  const reduced = useReducedFx();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehaviour(panelRef, open, onClose);
  // reduced motion → no morph, the body mounts immediately
  const morph = Boolean(layoutId) && !reduced;

  // Body readiness lives on the PANEL (the element that owns the `layoutId` animation): `onLayoutAnimationComplete`
  // only fires on layout elements, so the body itself could never observe the morph. Fallback timer for the case
  // that no layout animation runs at all (source already unmounted, first paint, …).
  const [readiness, setReadiness] = useState({ open, ready: !morph });
  // state-from-props: every open/close toggle starts a fresh readiness cycle
  if (readiness.open !== open) setReadiness({ open, ready: !morph });
  const bodyReady = readiness.ready;
  const setBodyReady = () => setReadiness((r) => (r.ready ? r : { ...r, ready: true }));
  const openedRef = useRef(onOpened);
  useEffect(() => {
    openedRef.current = onOpened;
  }, [onOpened]);
  useEffect(() => {
    if (!open || bodyReady) return;
    const t = setTimeout(() => setReadiness((r) => (r.ready ? r : { ...r, ready: true })), MORPH_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [open, bodyReady]);
  useEffect(() => {
    if (open && bodyReady && morph) openedRef.current?.();
  }, [open, bodyReady, morph]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
  };

  const enterExit: HTMLMotionProps<"div"> = morph
    ? { transition: { layout: spring.sheet } }
    : desktop
      ? { initial: { y: 40, opacity: 0, scale: 0.98 }, animate: { y: 0, opacity: 1, scale: 1 }, exit: { y: 30, opacity: 0, scale: 0.98, transition: tween.exit }, transition: spring.sheet }
      : { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%", transition: tween.sheetIos }, transition: tween.sheetIos };
  const dragProps: HTMLMotionProps<"div"> = desktop
    ? {}
    : { drag: "y", dragConstraints: { top: 0, bottom: 0 }, dragElastic: 0.05, dragSnapToOrigin: true, onDragEnd };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          className="fixed inset-0 z-[60] grid items-end justify-items-center bg-ink-950/80 sm:place-items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={tween.fade}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            layoutId={layoutId}
            layoutRoot
            style={{ borderRadius: radius.sheet }}
            className={cn(
              "flex max-h-[94%] w-full flex-col overflow-hidden rounded-t-3xl border border-line-2 bg-ink-850 shadow-[0_30px_80px_rgb(0_0_0/0.6)] outline-none sm:max-h-[calc(100%-16px)] sm:rounded-3xl",
              size === "lg" ? "sm:max-w-[860px]" : "sm:max-w-[540px]",
              className,
            )}
            {...enterExit}
            {...dragProps}
            onLayoutAnimationComplete={morph ? setBodyReady : undefined}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
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
            </div>
            <SheetBody morph={morph} ready={bodyReady}>
              {children}
            </SheetBody>
            {footer && (
              <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-ink-900/60 px-6 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Sheet body (`min-h-[40vh] overflow-y-auto px-6 py-5`, `layoutScroll`). With `morph` the content
 * mounts once the panel reports `ready` (its layout animation completed, or the fallback timer fired;
 * replaces the Bundle's 380 ms timeout `Nhe`).
 */
function SheetBody({ children, morph, ready }: { children: ReactNode; morph: boolean; ready: boolean }) {
  return (
    <motion.div layoutScroll className="min-h-[40vh] overflow-y-auto px-6 py-5">
      {ready && (
        <motion.div initial={morph ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={tween.sheetBody}>
          {children}
        </motion.div>
      )}
    </motion.div>
  );
}
