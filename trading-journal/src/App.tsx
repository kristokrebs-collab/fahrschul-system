import { motion } from "motion/react";
import { useCallback, useEffect } from "react";
import { BottomFade } from "@/app/BottomFade";
import { Dock } from "@/app/Dock";
import { Footer } from "@/app/Footer";
import { Header } from "@/app/Header";
import { LocalModeBanner, useLocalBannerOpen } from "@/app/LocalModeBanner";
import { SetupEditor, TradeDetail, TradeEditor } from "@/app/overlays";
import { OverviewView, SettingsView, SetupsView, TradesView } from "@/app/pages";
import { ScenarioWatcher } from "@/app/ScenarioWatcher";
import { toIslandToast } from "@/app/toasts";
import { useDetailCandles } from "@/app/useDetailCandles";
import { SOURCE_NAME } from "@/market";
import { usePriceSnapshot } from "@/views/overview/useMarket";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { PageSwitch } from "@/motion/PageSwitch";
import { spring } from "@/motion/tokens";
import { ToastIsland } from "@/primitives/Toast";
import { restoreScroll } from "@/store/router";
import { PAGES, useUi, type Page } from "@/store/uiStore";

const PAGE_INDEX: Record<Page, number> = { overview: 0, trades: 1, setups: 2, settings: 3 };

function CurrentPage({ page }: { page: Page }) {
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
 * App shell (Plan 6.6): header, `main` container, `PageSwitch` keyed `o|t|s|e`, footer, dock, local banner,
 * toast island and the app-level overlays (no portal, inside the group-less `LayoutGroup` of `MotionRoot`).
 * `PageSwitch.onTransitioning` drives `uiStore.transitioning` (detail opening is locked meanwhile).
 */
export default function App() {
  const page = useUi((s) => s.page);
  const setTransitioning = useUi((s) => s.setTransitioning);
  const toasts = useUi((s) => s.toasts);
  const dismissToast = useUi((s) => s.dismissToast);
  const bannerOpen = useLocalBannerOpen();
  const { price, provenance } = usePriceSnapshot();
  const detailCandles = useDetailCandles();
  const livePriceLabel = provenance && provenance.source !== "binance" && provenance.source !== "proxy" ? `Live-Preis (${SOURCE_NAME[provenance.source]}) übernehmen` : undefined;

  // scroll memory per tab after the page mounted (Plan 1.4)
  useEffect(() => {
    restoreScroll(page);
  }, [page]);

  const onTransitioning = useCallback((t: boolean) => setTransitioning(t), [setTransitioning]);

  return (
    <MorphDialogProvider>
      <ScenarioWatcher />
      <Header />
      <main className="mx-auto max-w-[1320px] px-4 pb-40 pt-6 sm:px-6">
        <LocalModeBanner />
        <motion.div layout="position" layoutDependency={bannerOpen} transition={{ layout: spring.layout }}>
          <PageSwitch index={PAGE_INDEX[page]} pageKey={PAGES.indexOf(page) >= 0 ? page : "o"} onTransitioning={onTransitioning}>
            <CurrentPage page={page} />
          </PageSwitch>
          <Footer />
        </motion.div>
      </main>
      <BottomFade />
      <Dock />
      <ToastIsland toasts={toasts.map(toIslandToast)} onDismiss={dismissToast} />
      {/* always mounted: the overlays own their AnimatePresence / open state (uiStore.detail | editor | setupEditor) */}
      <TradeDetail candles={detailCandles} />
      <TradeEditor livePrice={price} livePriceLabel={livePriceLabel} />
      <SetupEditor />
    </MorphDialogProvider>
  );
}
