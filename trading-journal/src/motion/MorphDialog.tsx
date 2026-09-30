import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { radius, spring, tween } from "@/motion/tokens";

export interface MorphDialogRequest {
  /** Shared id: source `MorphCard id` ↔ dialog (`layoutId="morph-{id}"`). */
  id: string;
  /** Dialog title (German UI string), also `aria-label`. */
  title: string;
  /** Dialog body; a function is evaluated once when the dialog opens (Bundle `aa` body()). */
  body: ReactNode | (() => ReactNode);
  /** Optional width override, default `max-w-[620px]`. */
  className?: string;
}

interface MorphDialogState {
  open: MorphDialogRequest | null;
  /** id whose open morph has completed → its source is `visibility:hidden` (Plan 3.2 rule 9). */
  settled: string | null;
  show: (req: MorphDialogRequest) => void;
  close: () => void;
}

const Ctx = createContext<MorphDialogState>({ open: null, settled: null, show: () => {}, close: () => {} });

/** `{ open, show, close }` – `show({ id, title, body })` opens the dialog morphing out of `MorphCard id`. */
export function useMorphDialog(): MorphDialogState {
  return useContext(Ctx);
}

const CLOSE_GLYPH = (
  <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M2 2l8 8M10 2 2 10" />
  </svg>
);

/**
 * Card → dialog morph provider (Bundle `v2`, Plan 2.5 "Morph-Dialog"). Renders the overlay and the
 * panel in the SAME React tree (no portal, rule 12), with focus trap, scroll lock, `inert` siblings,
 * Escape and overlay close. The panel shares `layoutId="morph-{id}"` with its `MorphCard`; the
 * title travels via `layoutId="morph-title-{id}"` (`MorphTitle` in the card). Body enters with
 * `tween.body`, exits with `tween.exit`; backdrop `tween.fade` / `tween.exit`.
 */
export function MorphDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<MorphDialogRequest | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [body, setBody] = useState<ReactNode>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(null);
    setSettled(null);
  }, []);
  const show = useCallback((req: MorphDialogRequest) => {
    setBody(typeof req.body === "function" ? req.body() : req.body);
    setSettled(null);
    setOpen(req);
  }, []);

  useDialogBehaviour(panelRef, open !== null, close);

  const value = useMemo<MorphDialogState>(() => ({ open, settled, show, close }), [open, settled, show, close]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.div
            key="bg"
            className="fixed inset-0 z-[70] bg-ink-950/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: tween.exit }}
            transition={tween.fade}
            onClick={close}
          />
        )}
        {open && (
          <div key="wrap" className="pointer-events-none fixed inset-0 z-[71] grid place-items-center p-4">
            <motion.div
              ref={panelRef}
              layoutId={`morph-${open.id}`}
              layoutRoot
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={cn(
                "pointer-events-auto relative max-h-[86vh] w-full max-w-[620px] overflow-y-auto border border-line-2 bg-gradient-to-b from-ink-750 to-ink-800 shadow-[0_40px_90px_rgb(0_0_0/0.45)] outline-none",
                open.className,
              )}
              style={{ borderRadius: radius.dialog }}
              transition={{ layout: spring.morph }}
              onLayoutAnimationComplete={() => setSettled(open.id)}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-ink-750 via-ink-750/95 to-transparent px-6 pb-3 pt-5">
                <motion.h2 id={titleId} layoutId={`morph-title-${open.id}`} layout="position" className="label !text-fg flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-signal" />
                  {open.title}
                </motion.h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Schließen"
                  className="grid size-8 place-items-center rounded-full border border-line-2 text-mute transition-colors hover:text-fg"
                >
                  {CLOSE_GLYPH}
                </button>
              </div>
              <motion.div
                className="px-6 pb-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: tween.exit }}
                transition={tween.body}
              >
                {body}
              </motion.div>
            </motion.div>
          </div>
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
