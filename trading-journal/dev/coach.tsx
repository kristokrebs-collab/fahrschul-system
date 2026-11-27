import { motion } from "motion/react";
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
import { STAGGER_HIDDEN, STAGGER_SHOWN } from "@/motion/Stagger";
import { Card } from "@/primitives/Card";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { CoachView, CoachWatcher, TradeCoachPanel, useCoachUi } from "@/views/coach";

/*
 * Dev harness of the P04 Coach page until the integrator registers `coach` (P14): `/dev/coach.html` under
 * `npm run dev`. The real journal store, the market provider (trade detail chart), the trade editor and detail, the
 * live coach watcher (toast after a save), toasts and confetti. Below the page: the `TradeCoachPanel` that P14 mounts
 * in the trade detail – for `?trade=<id>` or the newest closed trade.
 */
void bootJournal({ autoBackup: false });
bootMarket();
// e2e hooks (dev harness only)
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;
(window as unknown as { __tjUi?: typeof useUi }).__tjUi = useUi;
(window as unknown as { __tjCoach?: typeof useCoachUi }).__tjCoach = useCoachUi;

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

const STAGGER_PARENT = { [STAGGER_HIDDEN]: {}, [STAGGER_SHOWN]: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } };

/** The trade-detail panel, as P14 will mount it (for `?trade=` or the newest closed trade). */
function TradePanelDemo() {
  const enriched = useEnriched();
  const wanted = new URLSearchParams(location.search).get("trade");
  const id = wanted ?? [...enriched].filter((t) => t.result !== "open").sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.id ?? null;
  if (!id) return null;
  return (
    <section className="mt-8" data-testid="trade-coach-demo">
      <Card title="Trade-Coach · Vorschau" note="So erscheint er ab P14 im Trade-Detail.">
        <motion.div initial={STAGGER_HIDDEN} animate={STAGGER_SHOWN} variants={STAGGER_PARENT}>
          <TradeCoachPanel tradeId={id} />
        </motion.div>
      </Card>
    </section>
  );
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
        <CoachView />
        <TradePanelDemo />
      </main>
      <EditorHost />
      <TradeDetail />
      <div data-layer="coach-watch">
        <CoachWatcher />
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
