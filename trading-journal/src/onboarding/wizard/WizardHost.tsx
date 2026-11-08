/**
 * Trigger of the setup wizard (Paket B) – a leaf host in `DeferredHosts`. It opens the wizard ONCE: only after a fresh
 * registration armed it (`armWizard`, status `pending`), only when the person is signed in with a loaded, EMPTY journal, the intro
 * is over and nothing else owns the screen (login sheet with its welcome step, the takeover question, an order or its return,
 * the editor, a share link …). An existing trader (a journal with trades) is marked as handled and never asked. After the first
 * opening the status is `active` / `done` / `skipped` – a reload never brings it back; "Einrichtung" in the settings card does.
 * The sheet's own chunk is fetched only when it opens.
 */
import { lazy, Suspense, useEffect } from "react";
import { useCommandNavOpen } from "@/app/CommandNav";
import { useBilling } from "@/billing/store";
import { useCloudSession } from "@/cloud/session";
import { useTakeover } from "@/cloud/takeover";
import { useIntroSettled } from "@/intro/introStore";
import { useJournal } from "@/store/journalStore";
import { useReturnTo } from "@/store/returnTo";
import { useShareRoute } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { markWizardExisting, openWizard, readWizard, useWizard, wizardDecision } from "./wizardStore";

const SetupWizard = lazy(() => import("./SetupWizard"));

/** How long the screen must stay quiet before the wizard opens (the closing login sheet's exit is ~200 ms). */
export const WIZARD_SETTLE_MS = 450;

export function WizardHost() {
  const loaded = useWizard((s) => s.loaded);
  const signedIn = useCloudSession((s) => s.phase === "signedIn" && !s.needsMfa);
  const authOpen = useCloudSession((s) => s.sheet.open);
  const takeoverOpen = useTakeover((s) => s.phase !== "idle" && s.phase !== "undone");
  const journalLoaded = useJournal((s) => s.loaded);
  const tradeCount = useJournal((s) => s.trades.length);
  const introSettled = useIntroSettled();
  const navOpen = useCommandNavOpen();
  const sharing = useShareRoute((s) => s.token !== null);
  // an order in progress (its sheet, the way back to it, the result page after Stripe) goes first: no wizard in front of a payment
  const orderBusy = useBilling((s) => s.order.open || s.returned !== null || s.manageOpen || s.upgrade.open || s.detail.open);
  const returning = useReturnTo((s) => s.pending !== null);
  const uiBusy = useUi((s) => s.editor.open || s.setupEditor.open || s.detail.id !== null);
  const busy = authOpen || takeoverOpen || navOpen || sharing || orderBusy || returning || uiBusy;

  useEffect(() => {
    const d = wizardDecision({ stored: readWizard(), signedIn, journalLoaded, tradeCount, introSettled, busy });
    if (d === "existing") markWizardExisting();
    if (d !== "open") return;
    // a beat after the screen went quiet: the login sheet that just closed finishes its exit first (two dialogs never overlap);
    // anything that takes the screen in the meantime cancels the opening (the effect re-runs with `busy`)
    const t = setTimeout(() => openWizard(false), WIZARD_SETTLE_MS);
    return () => clearTimeout(t);
  }, [signedIn, journalLoaded, tradeCount, introSettled, busy]);

  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <SetupWizard />
    </Suspense>
  );
}

export default WizardHost;
