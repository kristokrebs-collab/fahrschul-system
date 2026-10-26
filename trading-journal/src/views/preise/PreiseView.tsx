import { FeatureLinks } from "@/app/FeatureLinks";
import { LegalLinks } from "@/legal/LegalLinks";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { displayPrice } from "@/billing/format";
import { PLAN_CATALOG, yearlySavingsPct } from "@/billing/plans";
import { openCancel, setBillingInterval, useBilling, useBillingMode, useEffectivePlan } from "@/billing/store";
import type { BillingInterval } from "@/billing/types";
import { ClosedNotice } from "@/billing/ui/parts";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { Reveal } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Segmented } from "@/primitives/Segmented";
import { pushToast } from "@/store/uiStore";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";
import { CodeField } from "./CodeField";
import { PlanComparison } from "./PlanComparison";
import { PlanGrid } from "./PlanGrid";
import { PricingFaq } from "./PricingFaq";
import { PricingHero } from "./PricingHero";
import { StatsMarquee } from "./StatsMarquee";
import { PREISE } from "./strings";

export const PREISE_LEAD_FILL = { storageKey: storageKey("fill-preise"), highlight: PREISE.leadHighlight } as const;

export interface PreiseViewProps {
  className?: string;
}

/** Monat / Jahr toggle (shared with the upgrade sheet); the yearly label carries the real saving of Pro. */
function IntervalToggle() {
  const interval = useBilling((s) => s.interval);
  const config = useBilling((s) => s.config);
  const savings = yearlySavingsPct(displayPrice("pro", "month", config?.prices).amount, displayPrice("pro", "year", config?.prices).amount);
  return (
    <Segmented<BillingInterval>
      aria-label={PREISE.interval}
      options={[
        { v: "month", label: PREISE.monthly },
        { v: "year", label: savings > 0 ? `${PREISE.yearly} −${savings} %` : PREISE.yearly },
      ]}
      value={interval}
      onChange={setBillingInterval}
    />
  );
}

/** `?ref=` landing: a valid invitation gets its own line with one red sweep across it. */
function RefBanner() {
  const referral = useBilling((s) => s.referral);
  const mode = useBillingMode();
  const reduced = useReducedFx();
  if (mode !== "open" || !referral?.valid) return null;
  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl border border-line-2 bg-ink-900 px-4 py-3"
      data-testid="ref-banner"
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ y: spring.enter, opacity: tween.fade }}
    >
      <SpotlightSweep />
      <p className="text-[13.5px]">
        <strong className="font-semibold">{PREISE.refTitle}</strong>
        <span className="text-mute"> – {PREISE.refText(referral.trialDays ?? 30)}</span>
      </p>
    </motion.div>
  );
}

/** "Verträge hier kündigen" (§ 312k BGB) – always reachable from the pricing page. */
function LegalLine() {
  const phase = useCloudSession((s) => s.phase);
  const sub = useBilling((s) => s.account?.subscription ?? null);
  const mode = useBillingMode();
  if (mode === "off") return null;
  const cancel = () => {
    if (phase !== "signedIn") {
      openAuthSheet("signin", "card");
      return;
    }
    if (sub && !sub.cancelAtPeriodEnd && sub.status !== "canceled" && sub.status !== "incomplete_expired") openCancel();
    else pushToast({ kind: "info", title: PREISE.legalNoContract });
  };
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-4 text-[12.5px] text-faint">
      <span className="flex max-w-[70ch] flex-wrap items-center gap-x-2 gap-y-1">
        {PREISE.legalNote}
        <LegalLinks className="text-[12.5px]" />
      </span>
      <button
        type="button"
        onClick={cancel}
        className="touch-hit font-semibold text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg"
        data-testid="legal-cancel"
      >
        {PREISE.legalCancel}
      </button>
    </footer>
  );
}

function Cell({ index, children, className }: { index: number; children: ReactNode; className?: string }) {
  return (
    <Reveal index={index} className={cn("min-w-0", className)}>
      {children}
    </Reveal>
  );
}

/**
 * Pricing page (P10) – `h1 Preise`. Hero (LaunchGrid + ASCII "PRO" wordmark), honest notices (no payments / invitation),
 * Monat-Jahr toggle + code field, the four plan cards (dealt in, rolling prices, prism lens, one beam lap), the stats
 * band, the animated feature matrix, FAQ and the always-visible "Verträge hier kündigen". Works in every mode: without
 * cloud / Stripe it still shows the plans (list prices) and says plainly that nothing can be bought yet.
 * Mount the `BillingHost` once in the app (it owns the upgrade / cancel sheets and the checkout return).
 */
export function PreiseView({ className }: PreiseViewProps) {
  const mode = useBillingMode();
  const config = useBilling((s) => s.config);
  const plan = useEffectivePlan();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  return (
    <div className={cn("grid grid-cols-1 gap-5", className)} data-testid="preise-view" data-mode={mode}>
      <PageHeader
        title={PREISE.title}
        lead={PREISE.lead}
        leadFill={PREISE_LEAD_FILL}
        action={
          signedIn && mode === "open" ? (
            <span className="rounded-full border border-line-2 bg-white/[0.03] px-3 py-1 text-[12.5px] text-mute" data-testid="current-plan">
              {PREISE.current}: <strong className="font-semibold text-fg">{PLAN_CATALOG[plan.plan].name}</strong>
            </span>
          ) : undefined
        }
      />
      {mode !== "open" && <ClosedNotice mode={mode} config={config} />}
      <RefBanner />
      <Cell index={0}>
        <PricingHero />
      </Cell>
      <section aria-labelledby="preise-tarife" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="preise-tarife" className="label flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
            {PREISE.plansTitle}
          </h2>
          <IntervalToggle />
        </div>
        <PlanGrid />
        <CodeField className="w-full sm:max-w-[440px]" />
      </section>
      <Cell index={1}>
        <StatsMarquee />
      </Cell>
      <Cell index={2}>
        <PlanComparison />
      </Cell>
      <Cell index={3}>
        <PricingFaq />
      </Cell>
      {signedIn && mode === "open" && (
        <FeatureLinks
          lead="Siehe auch"
          items={[
            { id: "konto-cloud", label: "Konto und Abo verwalten" },
            { id: "empfehlung", label: "Freunde einladen" },
          ]}
        />
      )}
      <LegalLine />
    </div>
  );
}
