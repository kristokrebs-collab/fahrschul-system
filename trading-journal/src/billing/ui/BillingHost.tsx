import { useEffect } from "react";
import { useCloudSession } from "@/cloud/session";
import { pushToast } from "@/store/uiStore";
import { billingActive, clearAccount, loadBilling, releaseBusy, setReturned, startCheckout, useBilling, verifyReferral } from "../store";
import { BILLING } from "../strings";
import { captureReferral, takeReturn } from "../url";
import { CancelSheet } from "./CancelSheet";
import { CheckoutReturn } from "./CheckoutReturn";
import { UpgradeSheet } from "./UpgradeSheet";

export interface BillingHostProps {
  /** Page navigation for "Alle Tarife vergleichen" (`navigate("preise")`). */
  onNavigate?: (page: "preise" | "konto") => void;
}

/**
 * Leaf host of the billing (P10) – mount ONCE in `App` (after `CloudSyncHost`, before `Celebrate`), wrapped in a
 * `data-layer` div like the other hosts. Inert without billing (file builds, claude.ai, no cloud env).
 * - reads `?ref=` (kept 30 days, validated once) and the Stripe return (`?billing=success|cancel|portal`) of this page
 *   load and cleans the address bar;
 * - loads config + account when the session settles / the user changes; drops the account on sign-out;
 * - continues a checkout that waited for the login (after the login sheet closed);
 * - frees the buttons when the browser comes back from Stripe via the back button (bfcache);
 * - mounts the UpgradeSheet, the CancelSheet and the checkout return (FullscreenWipe + confetti).
 * StrictMode-safe (every effect is idempotent).
 */
export function BillingHost({ onNavigate }: BillingHostProps) {
  const active = billingActive();
  const phase = useCloudSession((s) => s.phase);
  const userId = useCloudSession((s) => (s.phase === "signedIn" ? (s.user?.id ?? null) : null));
  const needsMfa = useCloudSession((s) => s.needsMfa);
  const pending = useBilling((s) => s.pending);
  const sheetOpen = useCloudSession((s) => s.sheet.open);

  useEffect(() => {
    if (!active) return;
    captureReferral();
    void verifyReferral();
    const r = takeReturn();
    if (!r) return;
    if (r.kind === "cancel") pushToast({ kind: "info", title: BILLING.checkoutCanceled });
    else if (r.kind === "portal") pushToast({ kind: "success", title: BILLING.portalBack, detail: BILLING.portalBackDetail });
    else setReturned(r);
  }, [active]);

  // `needsMfa`: a 2FA account gets its plan only after the code step (billing/status answers aal1 like a visitor)
  useEffect(() => {
    if (!active || phase === "idle" || phase === "loading") return;
    if (!userId) clearAccount();
    void loadBilling();
  }, [active, phase, userId, needsMfa]);

  // a checkout that waited for the login continues once the login sheet is closed (the first sync ran in it);
  // closing the sheet without signing in drops it
  useEffect(() => {
    if (!active || !pending || sheetOpen) return;
    if (userId) void startCheckout(pending);
    else useBilling.setState({ pending: null });
  }, [active, userId, pending, sheetOpen]);

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
      <CheckoutReturn />
    </>
  );
}
