import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { bootMarket } from "@/app/marketBoot";
import { toIslandToast } from "@/app/toasts";
import { BoxAlertHost } from "@/market/boxes/alerts";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { MarktView } from "@/views/markt";

/*
 * Dev harness of the P02 Markt page until the integrator registers `markt` (P14): `/dev/markt.html` under `npm run dev`.
 * The real market provider (`bootMarket`), the real journal store, the real hosts (box alerts → toast island, confetti,
 * morph dialogs). `?symbol=ETHUSDT` follows another market. The e2e spec (tests/e2e/markt.spec.ts) routes Binance to the
 * fixtures (`mockMarket(page, "live", { boxes: true })`).
 */
const params = new URLSearchParams(location.search);
void bootJournal({ autoBackup: false }).then(() => {
  const sym = params.get("symbol");
  if (sym) {
    const s = useJournal.getState().settings;
    void useJournal.getState().saveSettings({ ...s, market: { ...s.market, symbol: `BINANCE:${sym.toUpperCase()}` } });
  }
});
bootMarket();
// e2e hook (dev harness only): read / write the journal like the app does
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;

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
        <MarktView />
      </main>
      <BoxAlertHost />
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
