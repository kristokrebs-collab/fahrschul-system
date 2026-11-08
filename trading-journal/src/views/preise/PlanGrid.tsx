import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { themePaint } from "@/lib/themePaint";
import { planSaving, savingLabel } from "@/billing/purchase/order";
import "@/billing/purchase/purchase.css";
import { useCloudSession } from "@/cloud/session";
import { CTA, planCta } from "@/billing/ctas";
import type { CodeLookup } from "@/billing/contract";
import { displayPrice, formatMoney, priceDigits, withCoupon, type DisplayPrice } from "@/billing/format";
import { highlightsFor, PLAN_CATALOG, type PaidPlanId } from "@/billing/plans";
import { openDetail, openManage, openPortal, requestFree, requestOrder, setSeats, useBilling, useBillingMode, useEffectivePlan, useOffer, usePurchaseGate } from "@/billing/store";
import { Mark, PriceDigits } from "@/billing/ui/parts";
import type { PlanId } from "@/billing/types";
import { Float } from "@/motion/rich/Float";
import { useFirstInView } from "@/motion/inView";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { TextPrism } from "@/motion/pulse/TextPrism";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ValueFlash } from "@/motion/ValueFlash";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Stepper } from "@/primitives/Stepper";
import { PREISE } from "./strings";

const ORDER: readonly PlanId[] = ["free", "pro", "premium", "team"];
/** The plan that carries the one border-beam lap (the flagship); "Beliebt" stays with the catalog's recommended plan. */
const BEAM_PLAN: PlanId = "premium";

function PriceBlock({ plan, price, base, promo }: { plan: PaidPlanId; price: DisplayPrice; base: DisplayPrice; promo: CodeLookup | null }) {
  const cat = PLAN_CATALOG[plan];
  const interval = price.interval;
  const yearly = interval === "year";
  const seats = useBilling((s) => s.seats);
  const saving = planSaving(plan, useBilling.getState().config?.prices);
  const months = saving.monthsFree ?? 0;
  const discounted = price.amount !== base.amount;
  const digits = priceDigits(price.amount);
  const per = cat.perSeat ? (yearly ? PREISE.perSeatYear : PREISE.perSeatMonth) : yearly ? PREISE.perYear : PREISE.perMonth;
  const perWord = yearly ? PREISE.perYear : PREISE.perMonth;
  const teamSeats = cat.perSeat ? Math.max(cat.minSeats ?? 2, seats) : 0;
  return (
    <div className="grid gap-1.5" data-testid={`price-${plan}`} data-interval={interval}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {discounted ? (
          // the code decodes the new price; a lower price flashes green (ValueFlash on the negated price)
          <ValueFlash value={-price.amount} className="rounded-lg">
            <span className="inline-flex items-baseline gap-1 leading-none">
              <TextScramble key={digits} text={digits} as="span" className="dot-num text-[48px] leading-none text-fg" />
              <span aria-hidden="true" className="font-sans text-[20px] font-semibold text-mute">
                €
              </span>
            </span>
          </ValueFlash>
        ) : (
          <TextPrism className="-my-[0.12em] py-[0.12em]">
            <PriceDigits cents={price.amount} className="text-[48px]" />
          </TextPrism>
        )}
        {discounted && <span className="num font-mono text-[14px] text-faint line-through">{formatMoney(base.amount, base.currency)}</span>}
      </div>
      {/* the big number is what is DUE per payment (120 € per year); the monthly value of a yearly price is only a comparison line */}
      <span className="text-[12px] text-mute">
        {per}
        {" · "}
        {yearly ? PREISE.perMonthEquiv(formatMoney(price.perMonth, price.currency)) : PREISE.monthlyNote}
        {yearly && months > 0 ? ` · ${PREISE.yearlyNote(months)}` : ""}
        {yearly && saving.cents > 0 ? ` · spart ${formatMoney(saving.cents, price.currency)} gegenüber 12 Monatszahlungen${savingLabel(saving) ? ` (${savingLabel(saving)})` : ""}` : ""}
      </span>
      {cat.perSeat && (
        <span className="text-[12.5px] font-semibold text-fg" data-testid="team-total">
          {PREISE.seatsTotal(teamSeats, formatMoney(price.amount * teamSeats, price.currency), perWord)}
        </span>
      )}
      {discounted && promo?.message && (
        <span className="text-[12px] font-semibold text-win">
          {promo.code}: {promo.message}
        </span>
      )}
    </div>
  );
}

function SeatStepper() {
  const seats = useBilling((s) => s.seats);
  const min = PLAN_CATALOG.team.minSeats ?? 2;
  const max = PLAN_CATALOG.team.maxSeats ?? 50;
  return (
    <div className="flex items-center gap-3" role="group" aria-label={PREISE.seats}>
      <span className="text-[12.5px] text-mute">{PREISE.seats}</span>
      <Stepper value={seats} min={min} max={max} onChange={setSeats} decreaseLabel={PREISE.seatsLess} increaseLabel={PREISE.seatsMore} testId="team-seats" />
    </div>
  );
}

function PlanTile({ plan, index }: { plan: PlanId; index: number }) {
  const reduced = useReducedFx();
  const mode = useBillingMode();
  const interval = useBilling((s) => s.interval);
  const config = useBilling((s) => s.config);
  const promo = useBilling((s) => s.promo);
  const busy = useBilling((s) => s.busy);
  const seats = useBilling((s) => s.seats);
  const subscription = useBilling((s) => s.account?.subscription ?? null);
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const current = useEffectivePlan();
  const gate = usePurchaseGate();
  const cat = PLAN_CATALOG[plan];
  const highlights = highlightsFor(plan, useOffer());
  const isCurrent = mode === "open" && signedIn && current.plan === plan;
  const paid = plan !== "free";
  const available = !config || config.available.includes(plan as PaidPlanId);
  const base = paid ? displayPrice(plan as PaidPlanId, interval, config?.prices) : null;
  const price = base ? withCoupon(base, promo?.valid ? promo : null) : null;
  const ref = useRef<HTMLElement>(null);
  const seen = useFirstInView(ref, !reduced);

  // what the bottom of the card offers – a real action or an honest line, never a dead button
  // (`planCta` is the one place that decides it – the same words in the cards, the detail and the upgrade sheet; a plan that is
  // the person's own is a STATUS, never a button that looks clickable and is not)
  const decided = planCta({ plan, signedIn, currentPlan: current.plan, hasSubscription: !!subscription, mode, purchaseOpen: gate.open, available });
  const run = (): void => {
    if (decided.kind === "free-start") requestFree();
    else if (decided.kind === "switch") void openPortal("update");
    else requestOrder({ plan: plan as PaidPlanId, interval, ...(plan === "team" ? { seats } : {}) });
  };
  const cta = decided.clickable ? { label: decided.label, run, variant: cat.recommended && decided.kind !== "switch" ? ("primary" as const) : ("secondary" as const), testId: `cta-${plan}` } : null;
  const note = decided.clickable ? null : decided.label;
  /** the own plan with a running subscription: a quiet way to the management, in the account's words */
  const manageLink = decided.kind === "current" && paid && !!subscription;

  return (
    <article ref={ref} className="relative h-full" aria-labelledby={`plan-${plan}-name`} data-testid={`plan-${plan}`} data-current={isCurrent ? "" : undefined}>
      {/* the flagship plan: ONE lap once the card is in view */}
      {plan === BEAM_PLAN && seen && !reduced && (
        // the beam's disc is larger than the card: clip it here (a mask clips the paint, not the scroll overflow)
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[22px]">
          <BorderBeam fire={1} colorFrom={themePaint("#e5202e")} colorTo="var(--color-white, #ffffff)" />
        </span>
      )}
      <div className={cn("pay-glass flex h-full flex-col", isCurrent && "ring-1 ring-white/30")} data-tone={cat.recommended ? "hot" : undefined}>
        <div className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-5">
          <header className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`plan-${plan}-name`} className="text-[19px] font-semibold tracking-tight">
                {cat.name}
              </h3>
              {cat.recommended && (
                <Float>
                  <Badge tone="loss" className="border-signal/30 bg-signal/15 text-(--color-danger-text)">
                    {PREISE.recommended}
                  </Badge>
                </Float>
              )}
              {isCurrent && (
                <Float delay={2.2}>
                  <Badge tone="win" dot>
                    {PREISE.current}
                  </Badge>
                </Float>
              )}
            </div>
            <p className="text-[13px] leading-snug text-mute">{cat.tagline}</p>
          </header>

          {price && base ? (
            <PriceBlock plan={plan as PaidPlanId} price={price} base={base} promo={promo} />
          ) : (
            <div className="grid gap-1.5">
              <span className="inline-flex items-baseline gap-1 leading-none">
                <span className="sr-only">{PREISE.free}</span>
                <span aria-hidden="true" className="dot-num text-[48px]">
                  0
                </span>
                <span aria-hidden="true" className="font-sans text-[20px] font-semibold text-mute">
                  €
                </span>
              </span>
              <span className="text-[12px] text-mute">{PREISE.freeNote}</span>
            </div>
          )}

          {plan === "team" && mode === "open" && <SeatStepper />}

          <ul className="grid gap-2.5 text-[13.5px]">
            {highlights.map((h, i) => (
              <motion.li
                key={h}
                className="flex items-start gap-2.5"
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={seen ? { opacity: 1, x: 0, transitionEnd: { transform: "none" } } : { opacity: 0, x: -6 }}
                transition={{
                  x: { ...spring.enter, delay: 0.35 + index * 0.05 + i * 0.06 },
                  opacity: { ...tween.fade, delay: 0.35 + index * 0.05 + i * 0.06 },
                }}
              >
                {seen ? <Mark on delay={0.45 + index * 0.05 + i * 0.06} className="mt-px shrink-0" /> : <span aria-hidden="true" className="size-[18px] shrink-0" />}
                <span>{h}</span>
              </motion.li>
            ))}
          </ul>

          <div className="mt-auto grid gap-2" style={{ minHeight: 40 }}>
            {cta ? (
              <Button variant={cta.variant} fx={false} disabled={!!busy} onClick={cta.run} className="w-full" data-testid={cta.testId}>
                {cta.label}
              </Button>
            ) : note ? (
              <span className="inline-flex h-9 items-center text-[13px] text-mute" data-testid={`note-${plan}`} data-state={decided.kind}>
                {note}
              </span>
            ) : null}
            {manageLink && (
              <Button variant="secondary" size="sm" className="w-full" onClick={() => openManage()} data-testid={`manage-${plan}`} disabled={!!busy}>
                {CTA.manage}
              </Button>
            )}
            {/* mode "off" (no cloud, e.g. the plain preview): the purchase host is never mounted (`BillingHost` is inert), so the button would do nothing */}
            {paid && mode !== "off" && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => openDetail(plan as PaidPlanId)} data-testid={`details-${plan}`}>
                {PREISE.details}
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The four plan cards (P10): dealt into the grid from a slanted deck (`CardSpread deal`, `spring.deal`), each in a
 * NotchedFrame whose art turns from grey to colour on hover; the price rolls when Monat / Jahr switches (RollingDigits)
 * with a prism lens on hover (TextPrism); the recommended plan runs ONE BorderBeam lap; a valid code decodes the new
 * price (TextScramble) with a green ValueFlash; the highlight ticks draw in one after another.
 */
export function PlanGrid({ className }: { className?: string }) {
  return (
    <CardSpread variant="deal" label="Tarife" className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} itemClassName="h-full min-w-0">
      {ORDER.map((p, i) => (
        <PlanTile key={p} plan={p} index={i} />
      ))}
    </CardSpread>
  );
}
