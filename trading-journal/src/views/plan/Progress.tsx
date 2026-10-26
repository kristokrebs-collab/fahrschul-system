/**
 * The state of the plan on top of the page – and its way through: five steps as a progress bar (finished steps filled, the one
 * to work on marked, a step that needs attention in amber, a blocked one in red). Every step also says its state in words
 * (never colour alone) and is a button that brings its card under the bar. The bar sticks under the app header like the
 * "Inhalt" strip of the long pages (it takes that strip's place here: one guide, not two) and grows with `transform` only
 * (`spring.smooth`; reduced motion: no animation).
 */
import { motion } from "motion/react";
import { useRef } from "react";
import { revealCard } from "@/app/reveal";
import { STEP_IDS, type StepState, type StepStatus } from "@/domain/plan";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { SECTION_NAV_TOP } from "@/primitives/SectionNav";
import { STATUS_WORD } from "./ui";

const LABEL = { entry: "Einstieg", exit: "Ausstieg", size: "Größe", risk: "Risiko", ticket: "Ticket" } as const;
const FILL: Record<StepStatus, string> = { done: "bg-win", warn: "bg-warn", blocked: "bg-loss", todo: "bg-white/20" };
const DOT: Record<StepStatus, string> = { done: "bg-win", warn: "bg-warn", blocked: "bg-loss", todo: "bg-faint-line" };

export function Progress({ steps, progress, className }: { steps: readonly StepState[]; progress: number; className?: string }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const jump = (id: string): void => {
    const layer = root.current?.closest("[data-page]") ?? document;
    const el = layer.querySelector<HTMLElement>(`[data-testid="hplan-${id}"]`);
    if (el) revealCard(el);
  };
  const current = steps.find((s) => s.current);
  return (
    <div ref={root} className={cn("sticky z-30 -mx-4 bg-ink-900 px-4 sm:-mx-6 sm:px-6", className)} style={{ top: SECTION_NAV_TOP }} data-testid="hplan-progress" data-done={progress}>
      <div className="grid gap-1.5 border-b border-line pb-2 pt-2.5">
        <p className="num text-[12px] text-mute" data-testid="hplan-progress-text">
          {progress} von {STEP_IDS.length} Schritten fertig
          {current ? ` · jetzt: ${LABEL[current.id]}` : " · der Plan ist vollständig"}
        </p>
        <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Fortschritt des Handelsplans">
          {steps.map((s, i) => (
            <li key={s.id} className="min-w-0" data-testid={`hplan-progress-${s.id}`} data-status={s.status} aria-current={s.current ? "step" : undefined}>
              <button type="button" onClick={() => jump(s.id)} className="touch-hit-y group grid w-full min-w-0 gap-1.5 rounded-md text-left pointer-coarse:min-h-11" aria-label={`Zu Schritt ${i + 1}: ${LABEL[s.id]} – ${STATUS_WORD[s.status]}`}>
                <span aria-hidden="true" className="relative h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.span className={cn("absolute inset-0 origin-left rounded-full", FILL[s.status])} initial={false} animate={{ scaleX: s.status === "todo" ? (s.current ? 0.12 : 0) : 1 }} transition={reduced ? { duration: 0 } : spring.smooth} />
                </span>
                <span className={cn("flex min-w-0 flex-col gap-0.5 text-[11.5px] leading-tight transition-colors duration-200 sm:flex-row sm:items-center sm:gap-1.5 sm:text-[12.5px]", s.current ? "font-semibold text-fg" : "text-mute group-hover:text-fg")}>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[s.status])} />
                    <span className="num font-mono">{i + 1}</span>
                  </span>
                  <span>{LABEL[s.id]}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
