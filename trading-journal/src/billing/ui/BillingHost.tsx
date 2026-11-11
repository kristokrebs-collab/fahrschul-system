import { lazy, Suspense, useEffect } from "react";
import { useCloudSession } from "@/cloud/session";
import { captureOrderQuery } from "@/store/returnTo";
import { pushToast } from "@/store/uiStore";
import { billingActive, clearAccount, loadBilling, releaseBusy, setReturned, useBilling, verifyReferral } from "../store";
import { BILLING } from "../strings";
import { captureReferral, takeReturn } from "../url";
import { CancelSheet } from "./CancelSheet";
import { ContractHost } from "./ContractHost";
import { UpgradeSheet } from "./UpgradeSheet";

// the order sheet, the tariff detail, the management sheet and the result page: one lazy chunk, loaded when one is asked for
const PurchaseHost = lazy(() => import("../purchase/PurchaseHost"));

export interface BillingHostProps {
  /** Page navigation for "Alle Tarife vergleichen" (`navigate("preise")`). */
  onNavigate?: (page: "preise" | "konto") => void;
}

/**
 * Leaf host of the billing (P10, B4) – mount ONCE in `App` (after `CloudSyncHost`, before `Celebrate`), wrapped in a
 * `data-layer` div like the other hosts. Inert without billing (file builds, claude.ai, no cloud env).
 * - reads `?ref=` (kept 30 days, validated once) and the Stripe return (`?billing=success|cancel|portal`) of this page
 *   load and cleans the address bar; success and cancel open the result page (it asks the SERVER – the URL confirms nothing);
 * - loads config + account when the session settles / the user changes; drops the account on sign-out;
 * - frees the buttons when the browser comes back from Stripe via the back button (bfcache);
 * - mounts the UpgradeSheet and the CancelSheet, the contract pages (cancel / withdraw without a login) and, lazily, the
 *   purchase flow (order sheet, tariff detail, management, result page).
 * The login that an order waits for is no longer handled here: `requestOrder` notes the order for `returnTo`, the `ReturnHost`
 * reopens exactly that order. StrictMode-safe (every effect is idempotent).
 */
export function BillingHost({ onNavigate }: BillingHostProps) {
  const active = billingActive();
  const phase = useCloudSession((s) => s.phase);
  const userId = useCloudSession((s) => (s.phase === "signedIn" ? (s.user?.id ?? null) : null));
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const loaded = useBilling((s) => s.order.loaded);

  useEffect(() => {
    if (!active) return;
    captureReferral();
    // the pre-selection of a confirmation / magic link (`?order=premium.year.1`): validated, noted for the ReturnHost, out of the address
    captureOrderQuery();
    void verifyReferral();
    const r = takeReturn();
    if (!r) return;
    if (r.kind === "portal") pushToast({ kind: "success", title: BILLING.portalBack, detail: BILLING.portalBackDetail });
    else setReturned(r);
  }, [active]);

  // `needsMfa`: a 2FA account gets its plan only after the code step (billing/status answers aal1 like a visitor)
  useEffect(() => {
    if (!active || phase === "idle" || phase === "loading") return;
    if (!userId) clearAccount();
    void loadBilling();
  }, [active, phase, userId, needsMfa]);

  useEffect(() => {
    if (!active) return;
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) releaseBusy();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [active]);

  if (!active) return null;
  return (
    <>
      <UpgradeSheet onNavigate={onNavigate} />
      <CancelSheet />
      <ContractHost />
      {loaded && (
        <Suspense fallback={null}>
          <PurchaseHost onNavigate={onNavigate} />
        </Suspense>
      )}
    </>
  );
}
