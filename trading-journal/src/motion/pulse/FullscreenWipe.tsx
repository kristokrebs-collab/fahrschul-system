import { AnimatePresence, motion, useIsPresent, type Transition } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useDialogBehaviour } from "@/motion/a11y";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `immersive-full-screen-navigation` (measured, the same timings as the app's command navigation, which
 * stays untouched) as a generic full-screen moment: "Bericht bereit", "Ziel erreicht", the return from the checkout,
 * a search overlay. A black panel wipes in from the left (800 ms, cubic-bezier(.76,0,.24,1)) – transform-only: the
 * shell translates in while its content counter-translates – led by a red signal curtain 80 ms ahead (the pack's
 * "Doppelvorhang" remix); the content blocks (`WipeItem index={i}`) then fade up 24 px in the pack's stagger (650 ms,
 * cubic-bezier(.22,1,.36,1), from 620 ms). Closing wipes everything out to the right with the content still visible.
 *
 * Dialog semantics (`useDialogBehaviour`: focus trap, Escape, scroll lock, isolated page, Android back), portalled
 * to `<body>` (never caught in a transformed ancestor), `autoCloseMs` closes it on its own with a countdown hairline.
 * Reduced motion: an instant fade.
 */
export const CONFIG = {
  wipeMs: 800,
  wipeEase: [0.76, 0, 0.24, 1] as [number, number, number, number],
  itemMs: 650,
  itemEase: [0.22, 1, 0.36, 1] as [number, number, number, number],
  lift: 24,
  /** content delays (ms after the open): first block, then this step (pack links 620 / 720 / 820 / 900) */
  firstItem: 620,
  itemStep: 95,
  /** the red curtain leads the black panel by this much */
  curtainLead: 80,
} as const;

/** Delay (s) of content block `index`. */
export function wipeItemDelay(index: number): number {
  return (CONFIG.firstItem + Math.max(0, index) * CONFIG.itemStep) / 1000;
}

const WIPE: Transition = { duration: CONFIG.wipeMs / 1000, ease: CONFIG.wipeEase };

export interface FullscreenWipeProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  /** Red signal curtain ahead of the black panel (default true). */
  curtain?: boolean;
  /** Close by itself after this many ms (a hairline counts down). */
  autoCloseMs?: number;
  closeLabel?: string;
  className?: string;
}

/** A content block of the wipe that fades up in the pack's stagger. */
export function WipeItem({ index, children, className }: { index: number; children: ReactNode; className?: string }) {
  const reduced = useReducedFx();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, transform: `translateY(${CONFIG.lift}px)` }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: CONFIG.itemMs / 1000, ease: CONFIG.itemEase, delay: wipeItemDelay(index) }}
    >
      {children}
    </motion.div>
  );
}

function Panel({ onClose, label, children, curtain, autoCloseMs, closeLabel, className, reduced }: Omit<FullscreenWipeProps, "open"> & { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(reduced);
  // the session ends when the close starts; the page is released (and focus returned) after the exit wipe
  const present = useIsPresent();
  useDialogBehaviour(ref, present, onClose, { settled: present ? opened : false });

  useEffect(() => {
    if (!autoCloseMs) return;
    const id = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(id);
  }, [autoCloseMs, onClose]);

  const delay = curtain && !reduced ? CONFIG.curtainLead / 1000 : 0;
  return (
    <>
      {curtain && !reduced && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-0 z-[77] bg-signal"
          initial={{ transform: "translateX(-100%)" }}
          animate={{ transform: "translateX(0%)" }}
          exit={{ transform: "translateX(100%)", transition: { ...WIPE, delay: CONFIG.curtainLead / 1000 } }}
          transition={WIPE}
        />
      )}
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-pulse="fullscreen-wipe"
        className="fixed inset-0 z-[78] overflow-hidden bg-black outline-none"
        initial={reduced ? { opacity: 0 } : { transform: "translateX(-100%)" }}
        animate={reduced ? { opacity: 1 } : { transform: "translateX(0%)" }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { transform: "translateX(100%)", transition: WIPE }}
        transition={reduced ? { duration: 0 } : { ...WIPE, delay }}
        onAnimationComplete={() => setOpened(true)}
      >
        <motion.div
          className={cn("absolute inset-0 overflow-y-auto overscroll-contain", className)}
          initial={reduced ? false : { transform: "translateX(100%)" }}
          animate={{ transform: "translateX(0%)" }}
          exit={reduced ? undefined : { transform: "translateX(-100%)", transition: WIPE }}
          transition={{ ...WIPE, delay }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-[1] grid size-10 place-items-center rounded-full border border-white/15 text-mute transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-steel"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {children}
          {autoCloseMs ? (
            <span aria-hidden="true" className="fx-countdown absolute inset-x-0 bottom-0 h-[2px] bg-signal/80" style={{ ["--fx-countdown" as string]: `${autoCloseMs}ms` }} />
          ) : null}
        </motion.div>
      </motion.div>
    </>
  );
}

export function FullscreenWipe({ open, onClose, label, children, curtain = true, autoCloseMs, closeLabel = "Schließen", className }: FullscreenWipeProps) {
  const reduced = useReducedFx();
  if (typeof document === "undefined") return null;
  return createPortal(
    <NoLayoutCascade>
      <AnimatePresence>
        {open && (
          <Panel key="wipe" onClose={onClose} label={label} curtain={curtain} autoCloseMs={autoCloseMs} closeLabel={closeLabel} className={className} reduced={reduced}>
            {children}
          </Panel>
        )}
      </AnimatePresence>
    </NoLayoutCascade>,
    document.body,
  );
}
