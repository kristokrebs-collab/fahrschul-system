import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { bootMarket } from "@/app/marketBoot";
import { toIslandToast } from "@/app/toasts";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { LaborView, useLabor } from "@/views/labor";

/*
 * Dev harness of the P07 Labor page until the integrator registers `labor` (P14): `/dev/labor.html` under
 * `npm run dev`. The real journal store (`bootJournal`: settings.signals for the MCB ladder, settings.backtest for the
 * reference), the real market provider (`bootMarket`), the lab's own Binance history loader (IndexedDB cache), the
 * worker, toasts and confetti.
 */
void bootJournal({ autoBackup: false });
bootMarket();
// e2e hooks (dev harness only)
(window as unknown as { __tjJournal?: typeof useJournal; __tjLabor?: typeof useLabor }).__tjJournal = useJournal;
(window as unknown as { __tjLabor?: typeof useLabor }).__tjLabor = useLabor;

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
        <LaborView />
      </main>
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
