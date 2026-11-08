/**
 * The stage of the hand-over (Paket B): the moment between "Zahlungspflichtig bestellen" and Stripe's own page. The order
 * summary gives way to one calm glass surface – the plan card in the middle with a breathing halo (3×, then still), the
 * small waiting ring (`ThinkingOrb plan`: "waiting for a third party"), what is being done in words, and the AMOUNT and the
 * renewal (the terms of § 312j stay on screen while the stage covers the summary).
 *
 * It CONFIRMS NOTHING. It runs while the browser talks to the server (`confirming`) and while it leaves for Stripe
 * (`redirecting`); a failed order takes it away again (the summary is still there, unchanged). "Bezahlt" / "aktiv" is only
 * ever said by the result page, from the server state the Stripe webhook wrote.
 *
 * Mounted inside the sheet body over the (inert, transparent) summary – the sheet keeps its size, nothing jumps. Reduced
 * motion: no entry movement, the ring stands still (`ThinkingOrb` shows its still symbol), the halo is a still ring.
 */
import { motion } from "motion/react";
import { ThinkingOrb } from "@/motion/ThinkingOrb";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { PlanCardArt, type PlanCardArtProps } from "./PlanCardArt";
import type { OrderPhase } from "./orderState";
import { ORDER } from "./strings";

export interface PayStageProps extends Pick<PlanCardArtProps, "plan" | "interval" | "seats" | "totalCents" | "currency" | "highlights"> {
  phase: Exclude<OrderPhase, "idle">;
  /** `240 € pro Jahr` – the amount due, as the summary shows it. */
  totalLine: string;
  /** The renewal sentence of the summary (term and automatic renewal stay readable). */
  renewalLine: string;
}

export function PayStage({ phase, totalLine, renewalLine, ...card }: PayStageProps) {
  const reduced = useReducedFx();
  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-testid="pay-stage"
      data-phase={phase}
      className="absolute inset-0 z-[3] grid content-start justify-items-center gap-5 px-2 pb-8 pt-[4vh] text-center"
      style={{ background: "color-mix(in srgb, var(--color-ink-850, #111) 96%, transparent)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={tween.fade}
    >
      <motion.div className="w-full" style={{ maxWidth: 320 }} initial={reduced ? false : { opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={reduced ? { duration: 0 } : spring.enter}>
        <PlanCardArt {...card} tone="working" />
      </motion.div>
      <div className="flex items-center gap-3 text-left">
        <ThinkingOrb variant="plan" size={28} />
        <p className="max-w-[24rem] text-[14px] font-medium leading-snug text-fg" data-testid="pay-stage-text">
          {phase === "confirming" ? ORDER.stage.preparing : ORDER.stage.handover}
        </p>
      </div>
      <div className="grid gap-1">
        <p className="num font-mono text-[15px] font-semibold text-fg" data-testid="pay-stage-total">
          {totalLine}
        </p>
        <p className="max-w-[28rem] text-[12px] leading-snug text-mute">{renewalLine}</p>
        <p className="max-w-[28rem] text-[12px] leading-snug text-mute">{ORDER.stage.note}</p>
      </div>
    </motion.div>
  );
}
