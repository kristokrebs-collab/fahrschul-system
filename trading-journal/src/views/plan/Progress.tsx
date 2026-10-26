/**
 * The state of the plan on top of the page: five steps as a progress bar – finished steps filled, the one to work on marked, a
 * step that needs attention in amber, a blocked one in red. Every step also says its state in words (never colour alone). The bar
 * grows with `transform` only (`spring.smooth`; reduced motion: no animation).
 */
import { motion } from "motion/react";
import { STEP_IDS, type StepState, type StepStatus } from "@/domain/plan";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { STATUS_WORD } from "./ui";

const LABEL = { entry: "Einstieg", exit: "Ausstieg", size: "Größe", risk: "Risiko", ticket: "Ticket" } as const;
const FILL: Record<StepStatus, string> = { done: "bg-win", warn: "bg-warn", blocked: "bg-loss", todo: "bg-white/20" };
const DOT: Record<StepStatus, string> = { done: "bg-win", warn: "bg-warn", blocked: "bg-loss", todo: "bg-faint-line" };

export function Progress({ steps, progress, className }: { steps: readonly StepState[]; progress: number; className?: string }) {
  const reduced = useReducedFx();
  return (
    <div className={cn("grid gap-2", className)} data-testid="hplan-progress" data-done={progress}>
      <p className="num text-[12px] text-mute" data-testid="hplan-progress-text">
        {progress} von {STEP_IDS.length} Schritten fertig
        {steps.find((s) => s.current) ? ` · jetzt: ${LABEL[steps.find((s) => s.current)!.id]}` : " · der Plan ist vollständig"}
      </p>
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Fortschritt des Handelsplans">
        {steps.map((s, i) => (
          <li key={s.id} className="grid min-w-0 gap-1.5" data-testid={`hplan-progress-${s.id}`} data-status={s.status} aria-current={s.current ? "step" : undefined}>
            <span aria-hidden="true" className="relative h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.span className={cn("absolute inset-0 origin-left rounded-full", FILL[s.status])} initial={false} animate={{ scaleX: s.status === "todo" ? (s.current ? 0.12 : 0) : 1 }} transition={reduced ? { duration: 0 } : spring.smooth} />
            </span>
            <span className={cn("flex min-w-0 flex-col gap-0.5 text-[11.5px] leading-tight sm:flex-row sm:items-center sm:gap-1.5 sm:text-[12.5px]", s.current ? "font-semibold text-fg" : "text-mute")}>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[s.status])} />
                <span className="num font-mono">{i + 1}</span>
              </span>
              <span>
                {LABEL[s.id]}
                <span className="sr-only">: {STATUS_WORD[s.status]}</span>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
