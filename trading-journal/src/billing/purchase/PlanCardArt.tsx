/**
 * The "card" of the order window (Paket B) – an illustration of the CHOSEN PLAN, not a payment card. Idea from the payment
 * reference (a card that shows what you type and turns over): here it shows what you ordered – plan, interval, seats and the
 * amount DUE on the front (it follows every change of the order live), what the plan contains on the back. It turns over on
 * request (`flipped`), 3D with `backface-visibility`, `transform` / `opacity` only.
 *
 * What it never is: an input. No card number, no holder name, no CVC – the payment happens on Stripe's own checkout page,
 * we never see or store card data. It is decorative (`aria-hidden`); everything it says is also in the order summary as text.
 *
 * `tone` says what the card is part of:
 *   `idle`       the order summary, nothing happens
 *   `working`    the order was handed over, Stripe is being prepared – a calm white halo breathes three times, then rests
 *   `confirmed`  the SERVER says the subscription runs (result page only): one glow in the success colour. Never from a click,
 *                a timer or the return URL – the caller passes it only for the confirmed state.
 * Reduced motion: no turn (the faces swap at once), no halo animation (a still ring), no entry movement.
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { formatMoney } from "../format";
import { PLAN_CATALOG, type PaidPlanId } from "../plans";
import type { BillingInterval } from "../types";
import { PriceDigits } from "../ui/parts";
import "./purchase.css";

export type CardTone = "idle" | "working" | "confirmed";

export interface PlanCardArtProps {
  plan: PaidPlanId;
  interval: BillingInterval;
  seats: number;
  /** The amount due per payment, cents (seats included). */
  totalCents: number;
  currency: string;
  flipped?: boolean;
  tone?: CardTone;
  /** The back: what the plan contains (3–4 short lines from the tariff contract). */
  highlights: readonly string[];
  className?: string;
}

const FACE: CSSProperties = { position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" };

/** One halo behind the card: opacity / scale only, a blurred static disc. */
function Halo({ tone, reduced }: { tone: Exclude<CardTone, "idle">; reduced: boolean }) {
  const win = tone === "confirmed";
  return (
    <motion.span
      aria-hidden="true"
      data-testid="plan-card-halo"
      className="pointer-events-none absolute -inset-3 rounded-[30px]"
      style={{
        background: win
          ? "radial-gradient(closest-side, color-mix(in srgb, var(--color-win, #3ddc84) 55%, transparent), transparent)"
          : "radial-gradient(closest-side, color-mix(in srgb, var(--color-fg, #f2f2f2) 28%, transparent), transparent)",
        filter: "blur(14px)",
      }}
      initial={reduced ? false : { opacity: 0, scale: 0.92 }}
      animate={reduced ? { opacity: win ? 0.5 : 0.3 } : win ? { opacity: [0, 1, 0.45], scale: [0.92, 1.04, 1] } : { opacity: [0.15, 0.7, 0.15], scale: [0.96, 1.03, 0.96] }}
      transition={reduced ? { duration: 0 } : win ? { duration: 1.4, ease: "easeOut" } : tween.glow}
    />
  );
}

export function PlanCardArt({ plan, interval, seats, totalCents, currency, flipped = false, tone = "idle", highlights, className }: PlanCardArtProps) {
  const reduced = useReducedFx();
  const cat = PLAN_CATALOG[plan];
  const year = interval === "year";
  return (
    <div className={className} style={{ position: "relative", width: "100%", maxWidth: 320, perspective: 1100 }} aria-hidden="true" data-testid="plan-card-art" data-tone={tone} data-flipped={flipped ? "" : undefined} data-plan={plan}>
      {tone !== "idle" && <Halo tone={tone} reduced={reduced} />}
      <motion.div
        style={{ position: "relative", aspectRatio: "1.586", transformStyle: "preserve-3d" }}
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={reduced ? { duration: 0 } : spring.smooth}
      >
        {/* front: wordmark + plan glyph in dot matrix, the amount due, plan · interval · seats */}
        <div className="pay-card" style={FACE} data-face="front">
          <div className="flex items-start justify-between gap-3">
            <span className="font-dot text-[12px] leading-none tracking-[0.1em] text-mute">TRADE JOURNAL</span>
            <DotMatrixText text={cat.glyph} size={2} gap={1} tone="fg" decorative />
          </div>
          <div className="grid gap-1">
            <PriceDigits cents={totalCents} className="text-[40px]" />
            <span className="text-[11.5px] text-mute">{year ? "pro Jahr" : "pro Monat"}{plan === "team" ? ` · ${formatMoney(Math.round(totalCents / Math.max(1, seats)), currency)} je Sitz` : ""}</span>
          </div>
          <div className="flex items-end justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
            <span className="text-fg">{cat.name}</span>
            <span>
              {year ? "jährlich" : "monatlich"}
              {plan === "team" ? ` · ${seats} Sitze` : ""}
            </span>
          </div>
        </div>
        {/* back: the stripe and what the plan contains */}
        <div className="pay-card" style={{ ...FACE, transform: "rotateY(180deg)", padding: 0 }} data-face="back">
          <span aria-hidden="true" className="block h-9 w-full" style={{ background: "rgb(0 0 0 / 0.78)", marginTop: 22 }} />
          <ul className="grid gap-1.5 px-5 pt-3.5 text-[11.5px] leading-snug text-fg">
            {highlights.slice(0, 4).map((h) => (
              <li key={h} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[5px] size-1 shrink-0 rounded-full bg-fg/70" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
