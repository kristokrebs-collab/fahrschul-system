import { useState } from "react";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { stagger } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Segmented } from "@/primitives/Segmented";
import { displayPrice, formatMoney } from "../format";
import { FEATURE_INFO, featuresGained, PAID_PLANS, PLAN_CATALOG, planIncludes, upgradePlanFor, yearlySavingsPct, type PaidPlanId } from "../plans";
import { closeUpgrade, setBillingInterval, startCheckout, useBilling, useBillingMode, useEffectivePlan, useTrialDays } from "../store";
import { BILLING, UPGRADE } from "../strings";
import type { BillingInterval } from "../types";
import { ClosedNotice, Mark, PriceDigits } from "./parts";

export interface UpgradeSheetProps {
  /** "Alle Tarife vergleichen" → the pricing page (`navigate("preise")`); hidden without it. */
  onNavigate?: (page: "preise" | "konto") => void;
}

/**
 * The upgrade sheet (P10) – opened by `openUpgrade(feature?, plan?)` from an UpgradeTeaser, a LimitMeter or the plan
 * card; mounted once by `BillingHost`. The feature name wipes in with the TactileHighlight marker as the sheet lands,
 * the plan's price rolls between Monat / Jahr (shared toggle with the pricing page), the gained features check in one
 * after another (drawn ticks). The CTA starts Stripe Checkout (signed out: the login sheet first, then the checkout).
 */
export function UpgradeSheet({ onNavigate }: UpgradeSheetProps) {
  const upgrade = useBilling((s) => s.upgrade);
  const interval = useBilling((s) => s.interval);
  const config = useBilling((s) => s.config);
  const busy = useBilling((s) => s.busy);
  const mode = useBillingMode();
  const current = useEffectivePlan();
  const trial = useTrialDays();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const [landed, setLanded] = useState(false);
  const feature = upgrade.feature;
  const eligible = PAID_PLANS.filter((p) => (feature ? planIncludes(p, feature) : true));
  const [picked, setPicked] = useState<PaidPlanId | null>(null);
  const plan: PaidPlanId = picked && eligible.includes(picked) ? picked : (upgrade.plan ?? (feature ? upgradePlanFor(feature) : "pro"));
  const cat = PLAN_CATALOG[plan];
  const price = displayPrice(plan, interval, config?.prices);
  const monthly = displayPrice(plan, "month", config?.prices);
  const yearly = displayPrice(plan, "year", config?.prices);
  const savings = yearlySavingsPct(monthly.amount, yearly.amount);
  // the feature that opened the sheet first ("trade the best"), then the plan's other gains
  const gained = featuresGained(plan, current.plan)
    .sort((a, b) => Number(b === feature) - Number(a === feature))
    .slice(0, 6);
  const close = () => {
    setLanded(false);
    setPicked(null);
    closeUpgrade();
  };
  const go = () => {
    if (!signedIn) {
      openAuthSheet("signup", "card");
      useBilling.setState({
        pending: { plan, interval, ...(plan === "team" ? { seats: useBilling.getState().seats } : {}) },
        upgrade: { ...upgrade, open: false },
      });
      return;
    }
    void startCheckout({ plan, interval, ...(plan === "team" ? { seats: useBilling.getState().seats } : {}) });
  };

  return (
    <Sheet
      open={upgrade.open}
      onClose={close}
      title={UPGRADE.title}
      size="md"
      dismissGuard={false}
      onOpened={() => setLanded(true)}
      footer={
        <>
          {onNavigate && (
            <Button
              size="sm"
              onClick={() => {
                close();
                onNavigate("preise");
              }}
            >
              {UPGRADE.compare}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="primary" disabled={mode !== "open" || !!busy} onClick={go} data-testid="upgrade-cta">
            {busy === "checkout" ? BILLING.redirecting : signedIn ? UPGRADE.cta(trial) : UPGRADE.ctaSignIn}
          </Button>
        </>
      }
    >
      <div className="grid gap-5" data-testid="upgrade-sheet">
        <StaggerItem className="grid gap-2">
          <span className="label flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
            {feature ? UPGRADE.inPlan(cat.name) : cat.name}
          </span>
          <h3 className="text-[clamp(22px,6vw,28px)] font-semibold leading-tight tracking-tight">
            <TactileHighlight active={landed} tab={false} padX={0.1}>
              {feature ? FEATURE_INFO[feature].label : cat.name}
            </TactileHighlight>
          </h3>
          <p className="text-[13.5px] leading-relaxed text-mute">{feature ? FEATURE_INFO[feature].pitch : cat.tagline}</p>
        </StaggerItem>

        {mode !== "open" && (
          <StaggerItem>
            <ClosedNotice mode={mode} config={config} />
          </StaggerItem>
        )}

        <StaggerItem className="grid gap-4 rounded-2xl border border-line bg-ink-950/50 p-4">
          {eligible.length > 1 && (
            <Segmented<PaidPlanId>
              aria-label="Tarif"
              size="sm"
              options={eligible.map((p) => ({ v: p, label: PLAN_CATALOG[p].name }))}
              value={plan}
              onChange={setPicked}
            />
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-1">
              <PriceDigits cents={price.perMonth} className="text-[44px]" />
              <span className="text-[12px] text-mute">
                {cat.perSeat ? "pro Sitz und Monat" : "pro Monat"}
                {interval === "year" ? ` · ${formatMoney(price.amount, price.currency)} jährlich` : ""}
              </span>
            </div>
            <Segmented<BillingInterval>
              aria-label="Abrechnung"
              size="sm"
              options={[
                { v: "month", label: "Monatlich" },
                { v: "year", label: savings > 0 ? `Jährlich −${savings} %` : "Jährlich" },
              ]}
              value={interval}
              onChange={setBillingInterval}
            />
          </div>
        </StaggerItem>

        {gained.length > 0 && (
          <StaggerItem className="grid gap-2">
            <span className="text-[12px] font-semibold text-mute">{UPGRADE.gained}</span>
            <ul className="grid gap-2 sm:grid-cols-2">
              {gained.map((f, i) => (
                <li key={f} className="flex items-center gap-2.5 text-[13.5px]">
                  <Mark on delay={0.25 + i * stagger.lead * 0.6} />
                  <span className={f === feature ? "font-semibold text-fg" : "text-fg/90"}>{FEATURE_INFO[f].label}</span>
                </li>
              ))}
            </ul>
          </StaggerItem>
        )}

        {trial > 0 && mode === "open" && (
          <StaggerItem>
            <p className="text-[12px] text-faint">
              {BILLING.trialDays(trial)}
              {config?.cardless ? ` · ${BILLING.trialNoCard}` : ""} · jederzeit zum Laufzeitende kündbar · Zahlung über Stripe
            </p>
          </StaggerItem>
        )}
      </div>
    </Sheet>
  );
}
