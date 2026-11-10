import { useState } from "react";
import { useCloudSession } from "@/cloud/session";
import { Button } from "@/primitives/Button";
import { WarnBanner } from "@/primitives/WarnBanner";
import { storageKey } from "@/store/storage";
import { daysUntil, formatDay } from "../format";
import { changeSubscription, openPortal, useBilling, useBillingMode } from "../store";
import { BANNER, PLAN_CARD } from "../strings";

/** Days before the trial end from which the banner shows. */
export const TRIAL_BANNER_DAYS = 3;

const DISMISS_KEY = storageKey("billing-banner");

function dismissedKey(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Dunning + trial-end banner (P10) for the app shell (P14 mounts it under the LocalModeBanner): a failed payment
 * (past_due / unpaid → "Zahlung aktualisieren", portal payment flow), a trial that ends within 3 days (with the hint to
 * add a card when none is on file) and a paused abo ("Fortsetzen"). Dismissable for the session (per state). WarnBanner
 * motion (drop + clip wipe, finite pings). Nothing without cloud, payments or an own subscription.
 */
export function BillingBanner({ className }: { className?: string }) {
  const mode = useBillingMode();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const sub = useBilling((s) => s.account?.subscription ?? null);
  const busy = useBilling((s) => s.busy);
  const [dismissed, setDismissed] = useState<string | null>(dismissedKey);
  if (mode !== "open" || !signedIn || !sub) return null;

  let key: string | null = null;
  let text = "";
  let action: { label: string; run: () => void } | null = null;
  if (sub.status === "past_due" || sub.status === "unpaid") {
    key = `due:${sub.id}`;
    text = BANNER.pastDue;
    action = { label: PLAN_CARD.pay, run: () => void openPortal("payment") };
  } else if (sub.status === "paused" && sub.pausedUntil) {
    key = `paused:${sub.id}`;
    text = BANNER.paused(formatDay(sub.pausedUntil));
    action = { label: PLAN_CARD.unpause, run: () => void changeSubscription("resume") };
  } else if (sub.status === "trialing" && !sub.cancelAtPeriodEnd) {
    const d = daysUntil(sub.trialEnd);
    if (d !== null && d <= TRIAL_BANNER_DAYS) {
      key = `trial:${sub.id}:${d}`;
      const noCard = sub.hasPaymentMethod === false;
      text = `${BANNER.trialEnds(d)}${noCard ? ` ${BANNER.trialNoCard}` : ""}`;
      action = noCard ? { label: BANNER.addCard, run: () => void openPortal("payment") } : null;
    }
  }
  const open = !!key && dismissed !== key;
  const dismiss = () => {
    if (!key) return;
    try {
      sessionStorage.setItem(DISMISS_KEY, key);
    } catch {
      /* private mode: dismissed for this render tree only */
    }
    setDismissed(key);
  };
  return (
    <WarnBanner
      open={open}
      className={className}
      action={
        <span className="flex flex-wrap items-center gap-2">
          {action && (
            <Button size="sm" variant="primary" disabled={!!busy} onClick={action.run}>
              {action.label}
            </Button>
          )}
          <Button size="sm" onClick={dismiss}>
            {BANNER.dismiss}
          </Button>
        </span>
      }
    >
      <span data-testid="billing-banner">{text}</span>
    </WarnBanner>
  );
}
