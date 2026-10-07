import { AnimatePresence, motion, type Variants } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialogBehaviour, useTouchMoveGuard } from "@/motion/a11y";
import { useSwipeDismiss } from "@/motion/physics";
import { STAGGER_HIDDEN, STAGGER_SHOWN, bodyRevealDelay, withSectionStagger } from "@/motion/Stagger";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useOverlayLane } from "@/primitives/toastStore";

export { StaggerItem } from "@/motion/Stagger";

export interface MorphDialogRequest {
  /** Shared id: source `MorphCard id` ↔ dialog (`layoutId="morph-{id}"`). */
  id: string;
  /** Dialog title (German UI string), also `aria-label`. */
  title: string;
  /** Dialog body; a function is evaluated once when the dialog opens (Bundle `aa` body()). Wrap its top-level
   *  blocks in `StaggerItem` to cascade them in (`stagger.sections`). */
  body: ReactNode | (() => ReactNode);
  /** Optional width override for the dialog column, default `max-w-[620px]`. */
  className?: string;
  /**
   * Set by pill sources (`MorphCard` with a pill radius): there is no title source to travel from, so the head fades in
   * with the body instead of riding scale-corrected on a panel that is still pill-sized.
   */
  pill?: boolean;
}

interface MorphDialogState {
  open: MorphDialogRequest | null;
  /** id whose open morph has completed → its source is `visibility:hidden` (Plan 3.2 rule 9). */
  settled: string | null;
  /** id whose dialog is closing and whose source has not reported its reverse morph back yet. */
  closing: string | null;
  /**
   * Release tempo (0 … 1) of the swipe that closed the dialog, 0 for every other close. The source `MorphCard` runs
   * its reverse morph on `contextSpringAt(spring.morph, closeTempo)`: a hard flick zooms back a little faster and
   * livelier, everything else keeps the tuned token (layout animations cannot take the finger's velocity).
   */
  closeTempo: number;
  show: (req: MorphDialogRequest) => void;
  close: () => void;
  /** Called by the source `MorphCard` when its reverse morph has finished (releases inert + focus). */
  returned: (id: string) => void;
}

const Ctx = createContext<MorphDialogState>({ open: null, settled: null, closing: null, closeTempo: 0, show: () => {}, close: () => {}, returned: () => {} });

/** `{ open, show, close }` – `show({ id, title, body })` opens the dialog morphing out of `MorphCard id`. */
export function useMorphDialog(): MorphDialogState {
  return useContext(Ctx);
}

const CLOSE_GLYPH = (
  <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M2 2l8 8M10 2 2 10" />
  </svg>
);

/** Body (and a pill source's head) start revealing ≈ 65 % into the morph, no extra delay (OV-06). */
export const MORPH_BODY_DELAY = bodyRevealDelay(spring.morph);
const BODY_IN = { duration: 0.25, ease: tween.body.ease, delay: MORPH_BODY_DELAY };
const BODY: Variants = {
  [STAGGER_HIDDEN]: { opacity: 0, y: 10 },
  [STAGGER_SHOWN]: { opacity: 1, y: 0, transition: withSectionStagger(BODY_IN, MORPH_BODY_DELAY) },
};
const HEAD: Variants = {
  [STAGGER_HIDDEN]: { opacity: 0 },
  [STAGGER_SHOWN]: { opacity: 1, transition: BODY_IN },
};

/**
 * Card → dialog morph provider (Bundle `v2`, Plan 2.5 "Morph-Dialog"). Renders the overlay (`z-[70]`,
 * `bg-ink-950/75`) and the panel in the SAME React tree (no portal, rule 12), with focus trap, scroll lock,
 * `inert` siblings, Escape and overlay close. The panel shares `layoutId="morph-{id}"` with its `MorphCard`; the
 * title travels via `layoutId="morph-title-{id}"` (`MorphTitle` in the card). Body enters with
 * `tween.body` and staggers its `StaggerItem` sections, exits with `tween.exit`; backdrop `tween.fade` / `tween.exit`.
 *
 * Paint budget: the 90-px drop shadow lives on an unscaled sibling of the panel and only fades in once the morph
 * has settled, so the per-frame radius correction repaints the panel alone. `inert` and the focus return wait
 * for the morph (open) / the source's reverse morph (close).
 *
 * Fluidity (OV-04/05/06): the panel is opaque from its first frame (`layoutCrossfade={false}` – the source hides the
 * moment the panel takes over, nothing shows through a half-transparent pair); the body starts revealing at ≈ 65 % of
 * the morph (`MORPH_BODY_DELAY`); the backdrop fades on `tween.fade`, in step with the panel.
 *
 * Swipe to dismiss (iOS 18 zoom, `useSwipeDismiss` mode "zoom"): on touch and pen, from the sticky head (with a
 * grabber pill on coarse pointers) once the open morph has settled. The column follows the finger 1:1 down, the cross
 * axis at half speed, and shrinks to 0.88 while the dim lifts; a slow drag springs back, a projected flick closes and
 * the source card zooms the shrunk panel back in (`closeTempo` → context spring). The panel scrolls with
 * `overscroll-contain` (no scroll chaining into the page or pull-to-refresh).
 */
export function MorphDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<MorphDialogRequest | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [closeTempo, setCloseTempo] = useState(0);
  const [body, setBody] = useState<ReactNode>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<MorphDialogRequest | null>(null);
  const titleId = useId();
  const reduced = useReducedFx();

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const closeWith = useCallback((tempo: number) => {
    const current = openRef.current;
    if (current) setClosing(current.id);
    setCloseTempo(tempo);
    setOpen(null);
    setSettled(null);
  }, []);
  const close = useCallback(() => closeWith(0), [closeWith]);
  const show = useCallback((req: MorphDialogRequest) => {
    setBody(typeof req.body === "function" ? req.body() : req.body);
    setSettled(null);
    setClosing(null);
    setCloseTempo(0);
    setOpen(req);
  }, []);
  const returned = useCallback((id: string) => setClosing((c) => (c === id ? null : c)), []);

  const morphDone = open !== null && settled === open.id;
  useDialogBehaviour(panelRef, open !== null, close, { settled: open ? morphDone : closing === null });

  useOverlayLane(open !== null);

  const swipe = useSwipeDismiss({
    mode: "zoom",
    enabled: morphDone,
    open: open !== null,
    target: columnRef,
    onDismiss: (info) => closeWith(info.tempo),
  });
  const touchGuard = useTouchMoveGuard(swipe.isDragging);

  const value = useMemo<MorphDialogState>(() => ({ open, settled, closing, closeTempo, show, close, returned }), [open, settled, closing, closeTempo, show, close, returned]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* the swiped column was left transformed for the zoom back: rest again once the dialog is gone */}
      <AnimatePresence onExitComplete={() => swipe.reset({ instant: true })}>
        {open && (
          // The click target for "close on backdrop" is this wrapper – an ancestor of the panel, so it is never made
          // inert; the dimming layer itself is decorative and lets clicks through. The fixed wrapper (not the panel)
          // is the `layoutRoot`: on the panel itself Motion would force its layout animation to `type: false`.
          <motion.div
            key="wrap"
            layoutRoot
            className="fixed inset-0 z-[70] grid place-items-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={tween.fade}
            >
              <motion.div className="absolute inset-0 bg-ink-950/75" style={{ opacity: swipe.dim }} />
            </motion.div>
            {/* the swipe moves this column (shadow sibling + panel together), never the `layoutId` panel itself */}
            <motion.div ref={columnRef} className={cn("pointer-events-none relative w-full max-w-[620px]", open.className)} style={swipe.style}>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 shadow-[0_40px_90px_rgb(0_0_0/0.45)]"
                style={{ borderRadius: radius.dialog }}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: morphDone || reduced ? 1 : 0 }}
                exit={{ opacity: 0, transition: tween.exit }}
                transition={tween.fade}
              />
              <motion.div
                ref={panelRef}
                layoutId={`morph-${open.id}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="pointer-events-auto relative max-h-[86vh] w-full overflow-y-auto overscroll-contain border border-line-2 bg-gradient-to-b from-ink-750 to-ink-800 outline-none"
                style={{ borderRadius: radius.dialog }}
                layoutCrossfade={false}
                transition={{ layout: spring.morph }}
                onLayoutAnimationComplete={() => setSettled(open.id)}
              >
                <motion.div
                  ref={touchGuard}
                  data-dialog-handle=""
                  className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-ink-750 via-ink-750/95 to-transparent px-6 pb-3 pt-5 pointer-coarse:cursor-grab pointer-coarse:active:cursor-grabbing"
                  variants={open.pill && !reduced ? HEAD : undefined}
                  initial={STAGGER_HIDDEN}
                  animate={STAGGER_SHOWN}
                  {...swipe.handle}
                >
                  <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1.5 hidden h-[5px] w-9 -translate-x-1/2 rounded-full bg-white/15 pointer-coarse:block" />
                  <motion.h2 id={titleId} layoutId={`morph-title-${open.id}`} layout="position" className="label !text-fg flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-signal" />
                    {open.title}
                  </motion.h2>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Schließen"
                    className="touch-hit grid size-8 place-items-center rounded-full border border-line-2 text-mute transition-colors hover:text-fg"
                  >
                    {CLOSE_GLYPH}
                  </button>
                </motion.div>
                <motion.div className="px-6 pb-6" variants={BODY} initial={STAGGER_HIDDEN} animate={STAGGER_SHOWN} exit={{ opacity: 0, transition: tween.exit }}>
                  {body}
                </motion.div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

/** Cleanup helper for consumers that unmount while a dialog is open (e.g. page switch). */
export function useCloseMorphDialogOnUnmount(): void {
  const { close } = useMorphDialog();
  useEffect(() => close, [close]);
}
