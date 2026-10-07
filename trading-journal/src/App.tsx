import { motion } from "motion/react";
import { useDeferredValue, useEffect, useMemo, type ReactNode } from "react";
import { BottomFade } from "@/app/BottomFade";
import { CommandNav } from "@/app/CommandNav";
import { Dock } from "@/app/Dock";
import { EditorHost } from "@/app/EditorHost";
import { Footer } from "@/app/Footer";
import { Header } from "@/app/Header";
import { LocalModeBanner, useLocalBannerOpen } from "@/app/LocalModeBanner";
import { SetupEditor, TradeDetail } from "@/app/overlays";
import { PageHost } from "@/app/PageHost";
import { installViewportInset } from "@/app/pwa";
import { OverviewView, SettingsView, SetupsView, TradesView } from "@/app/pages";
import { ScenarioWatcher } from "@/app/ScenarioWatcher";
import { toIslandToast } from "@/app/toasts";
import { useDetailCandles } from "@/app/useDetailCandles";
import { Celebrate } from "@/motion/Celebrate";
import { IntroHost } from "@/intro/IntroHost";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { spring } from "@/motion/tokens";
import { ToastIsland } from "@/primitives/Toast";
import { useUi, type Page } from "@/store/uiStore";

/** Pages that stay mounted (hidden) while another tab is shown: the overview keeps its state, DOM and chart data. */
const KEEP_ALIVE: readonly Page[] = ["overview"];

function renderPage(page: Page): ReactNode {
  switch (page) {
    case "trades":
      return <TradesView />;
    case "setups":
      return <SetupsView />;
    case "settings":
      return <SettingsView />;
    default:
      return <OverviewView />;
  }
}

/**
 * The page switch. Zustand updates always render synchronously (`useSyncExternalStore`), so wrapping `setPage` in
 * `startTransition` would not help; instead the page is read through `useDeferredValue`: the dock (which reads the
 * store directly) reacts in the click's own frame, and the new page renders afterwards in an interruptible, time-sliced
 * background render. `PageHost` is memoised, so the urgent pass re-renders nothing here.
 */
function Pages() {
  const page = useUi((s) => s.page);
  const setTransitioning = useUi((s) => s.setTransitioning);
  const shown = useDeferredValue(page);
  return <PageHost page={shown} renderPage={renderPage} keepAlive={KEEP_ALIVE} onTransitioning={setTransitioning} />;
}

/** Toast island fed from `uiStore.toasts` (its own subscription, so a toast never re-renders the shell). */
function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

/** Trade detail with the 1h candle slice around the open trade (re-renders on detail / journal changes only). */
function Detail() {
  const candles = useDetailCandles();
  return <TradeDetail candles={candles} />;
}

/**
 * App shell (Plan 6.6): header, `main` container (page host with the keep-alive overview, local banner), the
 * visual-viewport bottom inset (`--vv-bottom`, `@/app/pwa`), the
 * in-flow footer with its staggered reveal, dock, command navigation (⌘K), toast island, the app-level overlays and the celebration layer (no portal, inside the group-less `LayoutGroup` of
 * `MotionRoot`). Every store subscription lives in a leaf host, so the shell itself only re-renders when the local
 * banner opens or closes; the page, toasts, detail and editor each re-render on their own.
 */
export default function App() {
  const bannerOpen = useLocalBannerOpen();
  // grey-bar fix: `--vv-bottom` follows host UI laid over the bottom of the page (visualViewport, event driven)
  useEffect(() => installViewportInset(), []);
  return (
    <MorphDialogProvider>
      <ScenarioWatcher />
      <div className="relative min-h-dvh">
        <Header />
        <main className="mx-auto max-w-[1320px] px-4 pb-10 pt-6 sm:px-6">
          <LocalModeBanner />
          {/* moves only when the banner enters / leaves (strict dependency: page switches never measure this subtree);
              scroll memory lives in the router, applied by the page host at the commit that shows a page */}
          <motion.div layout="position" layoutDependency={bannerOpen} transition={{ layout: spring.layout }} style={{ borderRadius: 0 }}>
            <Pages />
          </motion.div>
        </main>
      </div>
      <Footer />
      <BottomFade />
      <Dock />
      {/* before the overlays: a quick action's close runs before the editor takes focus */}
      <CommandNav />
      <Toasts />
      {/* always mounted: the overlays own their AnimatePresence / open state (uiStore.detail | editor | setupEditor) */}
      <Detail />
      <EditorHost />
      <SetupEditor />
      <Celebrate />
      <IntroHost />
    </MorphDialogProvider>
  );
}
