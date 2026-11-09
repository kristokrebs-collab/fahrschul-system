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
import { BerichteView, ReportReadyHost, berichtePeriodFromQuery, openReport, useBerichteUi } from "@/views/berichte";

/*
 * Dev harness of the P04 Berichte page until the integrator registers `berichte` (P14): `/dev/berichte.html` under
 * `npm run dev`. The real journal store, the trade detail (best / worst trade buttons), the "Bericht bereit" host
 * (full-screen wipe once per finished period), toasts and confetti. `?p=<key>` opens a report like the deep link
 * `#berichte?p=<key>` will.
 */
void bootJournal({ autoBackup: false });
bootMarket();
const deep = berichtePeriodFromQuery(location.search);
if (deep) openReport(deep);
// e2e hooks (dev harness only)
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;
(window as unknown as { __tjUi?: typeof useUi }).__tjUi = useUi;
(window as unknown as { __tjBerichte?: typeof useBerichteUi }).__tjBerichte = useBerichteUi;

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
        <BerichteView />
      </main>
      <EditorHost />
      <TradeDetail />
      <div data-layer="report-ready">
        <ReportReadyHost onOpen={() => window.scrollTo({ top: 0 })} />
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
