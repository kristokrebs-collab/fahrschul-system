/**
 * Small shared pieces of the billing UI (P10): the rolling price, the lock glyph, the honest "no payments" notice.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { BILLING } from "../strings";
import type { BillingMode } from "../store";
import type { BillingConfig } from "../contract";

/** `12 €` as rolling Doto digits (value mode: only changed columns roll – the Monat/Jahr switch). */
export function PriceDigits({ cents, className, currencyClassName }: { cents: number; className?: string; currencyClassName?: string }) {
  const decimals = cents % 100 === 0 ? 0 : 2;
  const value = cents / 100;
  const label = `${value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: 2 })} €`;
  return (
    <span className={cn("inline-flex items-baseline gap-1 leading-none", className)}>
      <RollingDigits value={value} decimals={decimals} className="dot-num" aria-label={label} />
      <span aria-hidden="true" className={cn("font-sans text-[0.42em] font-semibold text-mute", currencyClassName)}>
        €
      </span>
    </span>
  );
}

export function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("size-5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <path d="M12 14.6v2" />
    </svg>
  );
}

/** A check that draws itself (`tween.draw`), or a muted dash. */
export function Mark({ on, delay = 0, className }: { on: boolean; delay?: number; className?: string }) {
  const reduced = useReducedFx();
  if (!on)
    return (
      <span aria-hidden="true" className={cn("block h-px w-3 rounded bg-faint/60", className)}>
        {" "}
      </span>
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("size-[18px] text-win", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <motion.path d="M5 12.5l4.2 4.2L19 7" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...tween.draw, delay }} />
    </svg>
  );
}

/** Honest note while nothing can be bought (no cloud / no Stripe / no functions). */
export function ClosedNotice({ mode, config, className, action }: { mode: BillingMode; config: BillingConfig | null; className?: string; action?: ReactNode }) {
  const reduced = useReducedFx();
  if (mode === "open") return null;
  const text = mode === "off" ? BILLING.offNoCloud : config?.reason === "functions_missing" ? BILLING.functionsMissing : BILLING.closedText;
  return (
    <motion.div
      role="note"
      data-testid="billing-closed"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-warn/25 bg-warn/[0.06] px-4 py-3", className)}
      initial={reduced ? false : { opacity: 0, y: -6, clipPath: "inset(0 0 100% 0 round 16px)" }}
      animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0 round 16px)", transitionEnd: { clipPath: "none", transform: "none" } }}
      transition={{ default: tween.reveal, y: spring.layout }}
    >
      <span aria-hidden="true" className="relative size-2 shrink-0 rounded-full bg-warn">
        <span className="fx-ping bg-warn" />
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        <strong className="font-semibold text-fg">{mode === "off" ? "Keine Abos in dieser Version" : BILLING.closedTitle}</strong>
        <span className="text-mute"> – {text}</span>
      </span>
      {action}
    </motion.div>
  );
}
