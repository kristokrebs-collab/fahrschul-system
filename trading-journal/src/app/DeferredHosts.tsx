/**
 * The feature hosts of the app (P14 wiring of P02 / P04 / P05 / P06 / P08 / P10 / P11 / P12) – ONE lazy chunk, mounted
 * by `App` right after the first commit (after `SetupEditor`, before `Celebrate`), so none of their domains (boxes,
 * coach, risk, reports, growth, billing sheets, exchange sheets, share sheet, replay) weighs on the first load. Every
 * host is a leaf with its own `data-layer` and error boundary (`HostSlot`); the watchers that belong to a paid feature
 * only run while the plan includes it (`src/billing/plans.ts`; without payments every gate is open).
 *
 * | host | package | does |
 * |---|---|---|
 * | `BoxAlertHost` | P02 | candle-close box alerts of the Markt symbol while `settings.boxes.alerts` is on (free, like the box chart); the watchlist-scanner alerts only with gate `boxScanner` (F03) |
 * | `CoachWatcher` | P04 | live coach alerts after a save (revenge, overtrading …) (gate `coach`) |
 * | `ReportReadyHost` | P04 | "Bericht bereit" wipe → Berichte (checks `reports` itself) |
 * | `RiskGuardHost` | P05 | limit / cooldown toasts after a save (gate `riskLive`) |
 * | `PostTradeReviewHost` | P08 | review prompt for closed trades + the review sheet (gate `growth`) |
 * | `DailyCheckinHost` | F61 | the daily check-in dialog at the first open of the day + the check-in sheet (gate `growth`) |
 * | `BillingHost` | P10 | upgrade / cancel sheets, Stripe return, `?ref=` (inert without billing) |
 * | `ExchangeHost` | P11 | connect / dry-run / CSV sheets, server pulls (CSV works without cloud) |
 * | `SocialHost` | P12 | the share sheet |
 * | `ReplayHost`, `ExcursionBackfillHost` | P06 | trade replay sheet, idle MAE / MFE backfill |
 * | `ShotImportHost` | F29 | the lazy preview sheet of „Aus Screenshot übernehmen“ + the pill for queued drafts |
 * | `BoxSnapBackfillHost` | P02 | idle Box-zu-Box context at entry for synced / imported trades and other pairs (F02) |
 * | `KeyLevelHost` | F22 / F08 | stage alerts of the user's own key levels + day-plan change toast, only while the app is open (no plan gate) |
 * | `WhatIfMount` | F33 | the „Was wäre wenn“ sheet of a trade – its own chunk, fetched the first time it is opened |
 * | `TrainingMount` | F38 | the training sheet (Lernmodus: situations without the future, decision, reveal, reflection) – its own chunk, fetched the first time it is opened |
 */
import { lazy, Suspense, type ReactNode } from "react";
import { installE2eHooks } from "@/app/e2eHooks";
import { HostSlot } from "@/app/HostSlot";
import { useAssistantOpen } from "@/assistant/open";
import { useEntitlement } from "@/billing/entitlements";
import type { Feature } from "@/billing/types";
import { BillingHost } from "@/billing/ui/BillingHost";
import { ExchangeHost } from "@/exchanges/ExchangeHost";
import { ExcursionBackfillHost } from "@/journal/ExcursionBackfillHost";
import { ShotImportHost } from "@/journal/extract/ShotImportHost";
import { BoxAlertHost } from "@/market/boxes/alerts";
import { BoxSnapBackfillHost } from "@/market/boxes/BoxSnapBackfillHost";
import { KeyLevelHost } from "@/market/keylevels/alerts";
import { SocialHost } from "@/social/ui/SocialHost";
import { navigate } from "@/store/router";
import { ReportReadyHost } from "@/views/berichte/ReportReady";
import { CoachWatcher } from "@/views/coach/CoachWatcher";
import { RiskGuardHost, useRiskGuardStore } from "@/views/risiko/guard";
import { ReplayHost } from "@/views/trades/replay/TradeReplay";
import { useWhatIf } from "@/views/trades/whatif/whatIfStore";
import { useTraining } from "@/views/ueben/trainingStore";
import { DailyCheckinHost } from "@/views/wachstum/DailyCheckinHost";
import { PostTradeReviewHost } from "@/views/wachstum/PostTradeReview";

const AssistantHost = lazy(() => import("@/assistant/AssistantHost"));
const WhatIfHost = lazy(() => import("@/views/trades/whatif/WhatIfHost"));
const TrainingHost = lazy(() => import("@/views/ueben/TrainingHost"));

/** The assistant sheet: its chunk is fetched the first time it is opened and then stays mounted (close animation). */
function AssistantMount() {
  const used = useAssistantOpen((s) => s.seq > 0);
  return used ? (
    <Suspense fallback={null}>
      <AssistantHost />
    </Suspense>
  ) : null;
}

/** „Was wäre wenn“ (F33): the chunk is fetched the first time a trade asks for it, then stays mounted (close animation). */
function WhatIfMount() {
  const used = useWhatIf((s) => s.seq > 0);
  return used ? (
    <Suspense fallback={null}>
      <WhatIfHost />
    </Suspense>
  ) : null;
}

/** Training (F38): same pattern – nothing of it loads before the first „Üben“. */
function TrainingMount() {
  const used = useTraining((s) => s.seq > 0);
  return used ? (
    <Suspense fallback={null}>
      <TrainingHost />
    </Suspense>
  ) : null;
}

// e2e only (`src/app/e2eHooks.ts`): the risk guard's store (override / marks)
installE2eHooks({ __tjGuard: useRiskGuardStore });

/** Renders a watcher only while the plan includes its feature. */
function Entitled({ feature, children }: { feature: Feature; children: ReactNode }) {
  return useEntitlement(feature) ? children : null;
}

/** Box alerts: the Markt symbol's close alerts for every plan, the scanner part only with `boxScanner`. */
function BoxAlerts() {
  return <BoxAlertHost scanner={useEntitlement("boxScanner")} />;
}

export default function DeferredHosts() {
  return (
    <>
      <HostSlot name="Assistent">
        <AssistantMount />
      </HostSlot>
      <HostSlot name="Abo">
        <BillingHost onNavigate={(p) => navigate(p)} />
      </HostSlot>
      <HostSlot name="Börse">
        <ExchangeHost />
      </HostSlot>
      <HostSlot name="Box-Alarme">
        <BoxAlerts />
      </HostSlot>
      <HostSlot name="Coach-Wächter">
        <Entitled feature="coach">
          <CoachWatcher />
        </Entitled>
      </HostSlot>
      <HostSlot name="Bericht bereit">
        <ReportReadyHost onOpen={() => navigate("berichte")} />
      </HostSlot>
      <HostSlot name="Risiko-Wächter">
        <Entitled feature="riskLive">
          <RiskGuardHost />
        </Entitled>
      </HostSlot>
      <HostSlot name="Trade-Review">
        <Entitled feature="growth">
          <PostTradeReviewHost />
        </Entitled>
      </HostSlot>
      <HostSlot name="Täglicher Check-in">
        <Entitled feature="growth">
          <DailyCheckinHost />
        </Entitled>
      </HostSlot>
      <HostSlot name="Teilen">
        <SocialHost />
      </HostSlot>
      <HostSlot name="Replay">
        <ReplayHost />
      </HostSlot>
      <HostSlot name="Was wäre wenn">
        <WhatIfMount />
      </HostSlot>
      <HostSlot name="Training">
        <TrainingMount />
      </HostSlot>
      <HostSlot name="MAE/MFE">
        <ExcursionBackfillHost />
      </HostSlot>
      <HostSlot name="Box-Kontext">
        <BoxSnapBackfillHost />
      </HostSlot>
      <HostSlot name="Screenshot-Import">
        <ShotImportHost />
      </HostSlot>
      <HostSlot name="Schlüsselmarken-Alarme">
        <KeyLevelHost />
      </HostSlot>
    </>
  );
}
