import { motion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import type { CodeLookup } from "@/billing/contract";
import { displayPrice, formatMoney, priceDigits, withCoupon, type DisplayPrice } from "@/billing/format";
import { PLAN_CATALOG, yearlySavingsPct, type PaidPlanId } from "@/billing/plans";
import { openPortal, setSeats, startCheckout, useBilling, useBillingMode, useEffectivePlan, useTrialDays } from "@/billing/store";
import { Mark, PriceDigits } from "@/billing/ui/parts";
import type { PlanId } from "@/billing/types";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { useFirstInView } from "@/motion/inView";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { NotchedFrame } from "@/motion/pulse/NotchedFrame";
import { TextPrism } from "@/motion/pulse/TextPrism";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { ValueFlash } from "@/motion/ValueFlash";
import { Badge } from "@/primitives/Badge";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { PREISE } from "./strings";

const ORDER: readonly PlanId[] = ["free", "pro", "premium", "team"];
const NOTCH = 48;

/** Art in the card's media slot (grey at rest, colour on hover – NotchedFrame). */
function PlanArt({ plan }: { plan: PlanId }) {
  const cat = PLAN_CATALOG[plan];
  const wash =
    plan === "pro"
      ? "rgb(229 32 46 / 0.32)"
      : plan === "premium"
        ? "rgb(61 220 132 / 0.22)"
        : plan === "team"
          ? "rgb(255 176 32 / 0.2)"
          : "rgb(255 255 255 / 0.08)";
  return (
    <div
      aria-hidden="true"
      className="relative grid h-20 place-items-start overflow-hidden rounded-t-[16px] px-5 pt-4"
      style={{ background: `radial-gradient(120% 140% at 0% 0%, ${wash}, transparent 62%)` }}
    >
      <DotMatrixText text={cat.glyph} size={3} gap={1} tone="fg" decorative />
    </div>
  );
}

function PriceBlock({ plan, price, base, promo }: { plan: PaidPlanId; price: DisplayPrice; base: DisplayPrice; promo: CodeLookup | null }) {
  const cat = PLAN_CATALOG[plan];
  const interval = price.interval;
  const yearly = interval === "year";
  const monthly = displayPrice(plan, "month", null);
  const savings = yearlySavingsPct(monthly.amount, displayPrice(plan, "year", null).amount);
  const months = Math.round((savings / 100) * 12);
  const discounted = price.amount !== base.amount;
  const digits = priceDigits(price.perMonth);
  return (
    <div className="grid gap-1.5" data-testid={`price-${plan}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {discounted ? (
          // the code decodes the new price; a lower price flashes green (ValueFlash on the negated price)
          <ValueFlash value={-price.perMonth} className="rounded-lg">
            <span className="inline-flex items-baseline gap-1 leading-none">
              <TextScramble key={digits} text={digits} as="span" className="dot-num text-[48px] leading-none text-fg" />
              <span aria-hidden="true" className="font-sans text-[20px] font-semibold text-mute">
                €
              </span>
            </span>
          </ValueFlash>
        ) : (
          <TextPrism className="-my-[0.12em] py-[0.12em]">
            <PriceDigits cents={price.perMonth} className="text-[48px]" />
          </TextPrism>
        )}
        {discounted && <span className="num font-mono text-[14px] text-faint line-through">{formatMoney(base.perMonth, base.currency)}</span>}
      </div>
      <span className="text-[12px] text-mute">
        {cat.perSeat ? PREISE.perSeatMonth : PREISE.perMonth}
        {" · "}
        {yearly ? PREISE.yearlyNote(formatMoney(price.amount, price.currency), months) : PREISE.monthlyNote}
      </span>
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
      <div className="flex items-center rounded-full border border-line-2 bg-ink-950">
        <button
          type="button"
          aria-label={PREISE.seatsLess}
          disabled={seats <= min}
          onClick={() => setSeats(seats - 1)}
          className="touch-hit grid size-8 place-items-center rounded-full text-mute hover:text-fg disabled:opacity-40"
        >
          −
        </button>
        <output aria-live="off" className="num w-8 text-center font-mono text-[14px]" data-testid="team-seats">
          {seats}
        </output>
        <button
          type="button"
          aria-label={PREISE.seatsMore}
          disabled={seats >= max}
          onClick={() => setSeats(seats + 1)}
          className="touch-hit grid size-8 place-items-center rounded-full text-mute hover:text-fg disabled:opacity-40"
        >
          +
        </button>
      </div>
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
  const trial = useTrialDays();
  const cat = PLAN_CATALOG[plan];
  const isCurrent = mode === "open" && signedIn && current.plan === plan;
  const paid = plan !== "free";
  const available = !config || config.available.includes(plan as PaidPlanId);
  const base = paid ? displayPrice(plan as PaidPlanId, interval, config?.prices) : null;
  const price = base ? withCoupon(base, promo?.valid ? promo : null) : null;
  const ref = useRef<HTMLElement>(null);
  const seen = useFirstInView(ref, !reduced);

  // what the bottom of the card offers – a real action or an honest line, never a dead button
  let cta: { label: string; run: () => void; variant: "primary" | "ghost"; testId: string } | null = null;
  let note: string | null = null;
  if (mode !== "open") note = paid ? PREISE.ctaSoon : PREISE.closedCta;
  else if (!paid) {
    if (!signedIn) cta = { label: PREISE.ctaFree, run: () => openAuthSheet("signup", "card"), variant: "ghost", testId: "cta-free" };
    else note = isCurrent ? PREISE.current : PREISE.ctaFreeSignedIn;
  } else if (isCurrent) {
    if (subscription) cta = { label: PREISE.ctaManage, run: () => void openPortal("manage"), variant: "ghost", testId: `cta-${plan}` };
    else note = PREISE.current;
  } else if (subscription && current.plan !== "free")
    cta = { label: PREISE.ctaSwitch, run: () => void openPortal("update"), variant: "ghost", testId: `cta-${plan}` };
  else if (!available) note = PREISE.ctaSoon;
  else
    cta = {
      label: PREISE.ctaTrial(trial),
      run: () => void startCheckout({ plan: plan as PaidPlanId, interval, ...(plan === "team" ? { seats } : {}) }),
      variant: cat.recommended ? "primary" : "ghost",
      testId: `cta-${plan}`,
    };

  return (
    <article ref={ref} className="relative h-full" aria-labelledby={`plan-${plan}-name`} data-testid={`plan-${plan}`} data-current={isCurrent ? "" : undefined}>
      {/* the recommended plan: ONE lap once the card is in view */}
      {cat.recommended && seen && !reduced && (
        // the beam's disc is larger than the card: clip it here (a mask clips the paint, not the scroll overflow)
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[16px]">
          <BorderBeam fire={1} colorFrom="#e5202e" colorTo="#ffffff" />
        </span>
      )}
      <NotchedFrame
        radius={16}
        notchSize={NOTCH}
        active={isCurrent || undefined}
        outline={cat.recommended ? "rgb(229 32 46 / 0.55)" : isCurrent ? "rgb(242 242 242 / 0.5)" : "var(--color-line-2, #2c2c2c)"}
        wrapperClassName="h-full"
        className={cn("flex h-full flex-col", cat.recommended ? "bg-ink-850" : "bg-ink-900")}
        media={<PlanArt plan={plan} />}
      >
        <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-4">
          <header className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`plan-${plan}-name`} className="text-[19px] font-semibold tracking-tight">
                {cat.name}
              </h3>
              {cat.recommended && (
                <Badge tone="loss" className="border-signal/30 bg-signal/15 text-[#ff8a90]">
                  {PREISE.recommended}
                </Badge>
              )}
              {isCurrent && (
                <Badge tone="win" dot>
                  {PREISE.current}
                </Badge>
              )}
            </div>
            <p className="text-[13px] leading-snug text-mute">{cat.tagline}</p>
          </header>

          {price && base ? (
            <PriceBlock plan={plan as PaidPlanId} price={price} base={base} promo={promo} />
          ) : (
            <div className="grid gap-1.5">
              <span className="inline-flex items-baseline gap-1 leading-none" aria-label={PREISE.free}>
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
            {cat.highlights.map((h, i) => (
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

          <div className="mt-auto pr-12" style={{ minHeight: NOTCH - 8 }}>
            {cta ? (
              <Button variant={cta.variant} disabled={!!busy} onClick={cta.run} className="w-full" data-testid={cta.testId}>
                {busy === "checkout" && cta.variant === "primary" ? "Weiter zu Stripe …" : cta.label}
              </Button>
            ) : note ? (
              <span className="inline-flex h-9 items-center text-[13px] text-mute" data-testid={`note-${plan}`}>
                {note}
              </span>
            ) : null}
          </div>
        </div>
      </NotchedFrame>
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
