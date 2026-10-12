import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { EditorHost } from "@/app/EditorHost";
import { bootMarket } from "@/app/marketBoot";
import { TradeDetail } from "@/app/overlays";
import { toIslandToast } from "@/app/toasts";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { RiskGuardHost, RisikoView, useRiskGuardStore } from "@/views/risiko";

/*
 * Dev harness of the P05 Risiko page until the integrator registers `risiko` (P14): `/dev/risiko.html` under
 * `npm run dev`. The real journal store (`bootJournal`), the real market provider (`bootMarket`: live price, the
 * Box-zu-Box 4h bars for the stop helpers), the real trade editor (`In Trade übernehmen` opens it pre-filled), the
 * risk guard host (toasts after a save, the pause), toasts and confetti.
 */
void bootJournal({ autoBackup: false });
bootMarket();
// e2e hooks (dev harness only): read / write the journal and the guard like the app does
(window as unknown as { __tjJournal?: typeof useJournal; __tjUi?: typeof useUi; __tjGuard?: typeof useRiskGuardStore }).__tjJournal = useJournal;
(window as unknown as { __tjUi?: typeof useUi }).__tjUi = useUi;
(window as unknown as { __tjGuard?: typeof useRiskGuardStore }).__tjGuard = useRiskGuardStore;

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

function Harness() {
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <span className="grid size-9 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">₿</span>
          <span className="text-[15px] font-semibold tracking-tight">Trade Journal</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <RisikoView />
      </main>
      <EditorHost />
      <TradeDetail />
      <div data-layer="risk-guard">
        <RiskGuardHost />
      </div>
      <Toasts />
      <Celebrate />
    </MorphDialogProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Harness />
    </MotionRoot>
  </StrictMode>,
);
