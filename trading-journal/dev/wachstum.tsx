import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { EditorHost } from "@/app/EditorHost";
import { TradeDetail } from "@/app/overlays";
import { toIslandToast } from "@/app/toasts";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { RiskGuardHost } from "@/views/risiko";
import { PostTradeReviewHost, useGrowthUi, WachstumView } from "@/views/wachstum";

/*
 * Dev harness of the P08 Wachstum page until the integrator registers `wachstum` (P14): `/dev/wachstum.html` under
 * `npm run dev`. The real journal store (`bootJournal`), the real trade editor + detail (closing a trade there queues
 * the post-trade review – `PostTradeReviewHost`, as P14 mounts it in App.tsx), the P05 risk guard (its pause feeds the
 * pre-trade check), toasts and confetti. No market boot: the page needs no market data.
 */
void bootJournal({ autoBackup: false });
// e2e hooks (dev harness only): read / write the journal and the growth UI like the app does
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;
(window as unknown as { __tjUi?: typeof useUi }).__tjUi = useUi;
(window as unknown as { __tjGrowth?: typeof useGrowthUi }).__tjGrowth = useGrowthUi;

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
        <WachstumView />
      </main>
      <EditorHost />
      <TradeDetail />
      <div data-layer="risk-guard">
        <RiskGuardHost />
      </div>
      <div data-layer="post-trade-review">
        <PostTradeReviewHost />
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
