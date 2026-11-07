/**
 * The view of the arrival note (`arrival.ts`): a calm card above the dock / at the bottom of the page. It says where the finder
 * has brought you and – when the card itself is not there – why and what to do next, as buttons (a plan, a login, a first
 * test run). Not a toast: it has no timer unless the note asks for one, it keeps its place until you dismiss it, change the
 * page or open something else, and it never steals the focus (the target takes it; this is a polite live region).
 *
 * Motion: one spring rise (`spring.enter`, opacity + translateY); reduced motion: it is simply there.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { dismissArrival, useArrival } from "@/app/arrival";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Icon } from "@/primitives/icons";
import { useUi } from "@/store/uiStore";

export const ARRIVAL_STRINGS = { close: "Hinweis schließen" } as const;

export function ArrivalNote() {
  const note = useArrival((s) => s.current);
  const page = useUi((s) => s.page);
  const reduced = useReducedFx();

  // leaving the page the note belongs to ends it
  useEffect(() => {
    if (note && note.page !== page) dismissArrival(note.seq);
  }, [note, page]);

  useEffect(() => {
    if (!note?.autoCloseMs) return;
    const t = setTimeout(() => dismissArrival(note.seq), note.autoCloseMs);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <AnimatePresence>
      {note && (
        <motion.section
          key={note.seq}
          data-testid="arrival-note"
          data-feature={note.featureId}
          data-tone={note.tone}
          aria-live="polite"
          aria-atomic="true"
          aria-label="Hinweis zur gefundenen Stelle"
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 8, transition: tween.exit }}
          transition={reduced ? { duration: 0 } : spring.enter}
          className="fixed inset-x-0 bottom-[calc(100px+max(env(safe-area-inset-bottom,0px),var(--vv-bottom,0px)))] z-30 mx-auto grid w-[min(calc(100%-32px),560px)] gap-2 rounded-2xl border border-line-2 bg-ink-850 p-3.5 pr-12 shadow-(--shadow-tooltip) md:bottom-8"
        >
          <p className="flex items-start gap-2 text-[13.5px] font-medium leading-snug text-fg">
            <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", note.tone === "warn" ? "bg-warn" : "bg-win")} />
            <span className="min-w-0">{note.title}</span>
          </p>
          <p className="pl-3.5 text-[12.5px] leading-relaxed text-mute">{note.text}</p>
          {note.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pl-3.5 pt-0.5">
              {note.actions.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  fx={false}
                  data-testid={`arrival-${a.id}`}
                  onClick={() => {
                    dismissArrival(note.seq);
                    a.run();
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => dismissArrival(note.seq)}
            aria-label={ARRIVAL_STRINGS.close}
            data-testid="arrival-close"
            className="absolute right-1 top-1 grid size-11 place-items-center rounded-xl text-mute outline-none transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-white [&>svg]:size-4"
          >
            <Icon name="x" />
          </button>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
