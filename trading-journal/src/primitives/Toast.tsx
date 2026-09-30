import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { GlyphCheck, GlyphCross, GlyphInfo } from "@/primitives/icons";
import { toastDuration, useToastStore, type Toast, type ToastKind } from "@/primitives/toastStore";

const KIND_DISC: Record<ToastKind, string> = { ok: "bg-win/20 text-win", error: "bg-loss/20 text-loss", warn: "bg-signal/25 text-signal" };

export interface ToastIslandProps {
  /** Override the store (tests, storybook). */
  toasts?: Toast[];
  onDismiss?: (id: number) => void;
  className?: string;
}

/**
 * Toast island (Bundle `Ehe`, Plan 3.3 "Toast-Insel"): fixed above the dock, `aria-live="polite"`,
 * one toast at a time. Grows 44×44 → auto×50 with `spring.toast`; exit `tween.toastExit`;
 * text `delay .12`; check mark `pathLength` on `tween.checkToast`. Reduced motion → `{duration:0}`.
 */
export function ToastIsland({ toasts, onDismiss, className }: ToastIslandProps) {
  const storeToasts = useToastStore((s) => s.toasts);
  const storeDismiss = useToastStore((s) => s.dismiss);
  const list = toasts ?? storeToasts;
  const dismiss = onDismiss ?? storeDismiss;
  const reduced = useReducedFx();
  const note = list[0];

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => dismiss(note.id), toastDuration(note.kind));
    return () => clearTimeout(t);
  }, [note, dismiss]);

  return (
    <div className={cn("pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom,0px))] z-[56] flex justify-center px-4", className)} aria-live="polite" role="status">
      <AnimatePresence>
        {note && (
          <motion.button
            key={note.id}
            type="button"
            onClick={() => dismiss(note.id)}
            layoutRoot
            className="pointer-events-auto flex items-center gap-3 overflow-hidden border border-line-2 bg-ink-800 pl-2 pr-4 text-left shadow-[0_18px_40px_rgb(0_0_0/0.35)]"
            style={{ maxWidth: "calc(100vw - 32px)" }}
            // motion-exception: toast-island — width/height/borderRadius animate as in the bundle (44×44 → auto×50), Plan 3.2 rule 1.
            initial={{ width: 44, height: 44, borderRadius: radius.toastStart, opacity: 0, y: 24, scale: 0.6 }}
            animate={{ width: "auto", height: 50, borderRadius: radius.toastEnd, opacity: 1, y: 0, scale: 1 }}
            exit={{ width: 44, opacity: 0, y: 16, scale: 0.7, transition: reduced ? { duration: 0 } : tween.toastExit }}
            transition={reduced ? { duration: 0 } : spring.toast}
          >
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", KIND_DISC[note.kind])} aria-hidden="true">
              {note.kind === "ok" ? (
                <GlyphCheck className="size-3.5" strokeWidth="2.2" drawn transition={reduced ? { duration: 0 } : tween.checkToast} />
              ) : note.kind === "error" ? (
                <GlyphCross className="size-3.5" />
              ) : (
                <GlyphInfo className="size-3.5" />
              )}
            </span>
            <motion.span className="flex items-center gap-3 whitespace-nowrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reduced ? { duration: 0 } : { ...tween.fade, delay: 0.12 }}>
              <span className="grid">
                <span className="text-[13px] font-medium text-fg">{note.title}</span>
                {note.detail && <span className="text-[11px] text-mute">{note.detail}</span>}
              </span>
              {note.value && (
                <span className={cn("dot-num text-[15px]", note.valueTone === "win" ? "text-win" : note.valueTone === "loss" ? "text-loss" : "text-mute")}>{note.value}</span>
              )}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
