import { motion } from "motion/react";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, type ReactNode } from "react";
import { BottomFade } from "@/app/BottomFade";
import { CommandNav } from "@/app/CommandNav";
import { Dock } from "@/app/Dock";
import { EditorHost } from "@/app/EditorHost";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { Footer } from "@/app/Footer";
import { Header } from "@/app/Header";
import { HostSlot } from "@/app/HostSlot";
import { useLayerDiagOpen } from "@/app/layerDiag";
import { LocalModeBanner, useLocalBannerOpen } from "@/app/LocalModeBanner";
import { SetupEditor, TradeDetail } from "@/app/overlays";
import { PageHost } from "@/app/PageHost";
import { PageSkeleton } from "@/app/PageSkeleton";
import { isLazyPage, lazyView, OverviewView, PAGE_FEATURE, preloadPage, SettingsView, SetupsView, TradesView, type LazyPage } from "@/app/pages";
import { installViewportInset } from "@/app/pwa";
import { ScenarioWatcher } from "@/app/ScenarioWatcher";
import { ShortcutHost } from "@/app/ShortcutHost";
import { toIslandToast } from "@/app/toasts";
import { useDetailCandles } from "@/app/useDetailCandles";
import { useEntitlement } from "@/billing/entitlements";
import { billingActive } from "@/billing/store";
import type { Feature } from "@/billing/types";
import { CloudSyncHost } from "@/cloud/CloudSyncHost";
import { Celebrate } from "@/motion/Celebrate";
import { IntroHost } from "@/intro/IntroHost";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { spring } from "@/motion/tokens";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { ToastIsland } from "@/primitives/Toast";
import { GlobalSearchHost } from "@/search/GlobalSearchHost";
import { navigate, useShareRoute } from "@/store/router";
import { useUi, type Page } from "@/store/uiStore";

/** Layer diagnostics (decision 7): its own chunk, loaded only when `?debug=layers` or five logo taps open it. */
const LayerDiagnostics = lazy(() => import("@/app/LayerDiagnostics"));
/** The feature hosts (P02–P12 watchers and sheets): one lazy chunk, mounted after the first commit. */
const DeferredHosts = lazy(() => import("@/app/DeferredHosts"));
/** A page whose plan feature is locked (only with open payments): its header + the upgrade teaser. */
const LockedPage = lazy(() => import("@/app/LockedPage"));
/** The public view of a share link (`#share/<token>`, P12). */
const SharedView = lazy(() => import("@/views/community/SharedView").then((m) => ({ default: m.SharedView })));
/** P10 trial / payment banner – only in builds with billing (cloud configured, a web build). */
const BillingBanner = lazy(() => import("@/billing/ui/BillingBanner").then((m) => ({ default: m.BillingBanner })));

/** Leaf host of the layer diagnostics (renders nothing while closed – the app never pays for it). */
function LayerDiagHost() {
  const open = useLayerDiagOpen();
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <LayerDiagnostics />
    </Suspense>
  );
}

/** Pages that stay mounted (hidden) while another tab is shown: the overview keeps its state, DOM and chart data. */
const KEEP_ALIVE: readonly Page[] = ["overview"];
/**
 * Pages with their own layout cascade (`LayoutCascade`, see `src/motion/NoLayoutCascade.tsx`): only the settings page has
 * sync-mode exits that must FLIP `layout` siblings (the `Reorder` rules close the gap of a left "Regel entfernen?" strip).
 * The overview and the trades lists manage their own (popLayout exits dirty the shared group when they start; the trades
 * rows feed their `layoutDependency` from `onExitComplete`), so a finished exit there never re-renders a page.
 */
const CASCADE_PAGES: readonly Page[] = ["settings"];

/**
 * A page behind its plan feature (`PAGE_FEATURE`, `src/billing/plans.ts`): the page itself while the plan includes it
 * (always without payments), else the locked page with its `h1` and the upgrade teaser – the page chunk is then never
 * downloaded.
 */
function PageGate({ page, feature, children }: { page: Page; feature: Feature; children: ReactNode }) {
  const allowed = useEntitlement(feature);
  if (allowed) return children;
  return (
    <Suspense fallback={<PageSkeleton page={page} />}>
      <LockedPage page={page} feature={feature} />
    </Suspense>
  );
}

/**
 * A feature page's lazy chunk. The component is looked up while rendering: after a failed download the page's error
 * boundary re-mounts this leaf on "Erneut versuchen", which then gets a fresh lazy component – a new download.
 */
function LazyPageView({ page }: { page: LazyPage }) {
  const View = lazyView(page);
  // stable per page (created once in `pages.ts`); a new identity only after a failed download, where the fresh mount
  // – a new download attempt – is exactly the point
  // eslint-disable-next-line react-hooks/static-components
  return <View />;
}

function pageContent(page: Page): ReactNode {
  switch (page) {
    case "overview":
      return <OverviewView />;
    case "trades":
      return <TradesView />;
    case "setups":
      return <SetupsView />;
    case "settings":
      return <SettingsView />;
  }
  if (!isLazyPage(page)) return <OverviewView />;
  const body = (
    <Suspense fallback={<PageSkeleton page={page} />}>
      <LazyPageView page={page} />
    </Suspense>
  );
  const feature = PAGE_FEATURE[page];
  return feature ? (
    <PageGate page={page} feature={feature}>
      {body}
    </PageGate>
  ) : (
    body
  );
}

/**
 * Every page behind its own error boundary (P13 `page` variant): a page that throws – or a lazy chunk that cannot be
 * loaded (offline, a deploy replaced it) – shows the glitch "ERR" with "Erneut versuchen" / "Neu laden", while the
 * header, dock and every other page keep working. Module-level and therefore referentially stable (`PageHost` memo).
 */
function renderPage(page: Page): ReactNode {
  return (
    <ErrorBoundary variant="page" resetKeys={[page]}>
      {pageContent(page)}
    </ErrorBoundary>
  );
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
  return <PageHost page={shown} renderPage={renderPage} keepAlive={KEEP_ALIVE} cascade={CASCADE_PAGES} onTransitioning={setTransitioning} />;
}

/**
 * `#share/<token>` (P12): the public view of a shared trade / setup / figures instead of the pages – no login, nothing
 * of the visitor's journal is read or written unless they adopt a setup. "Zum eigenen Journal" leaves it for the overview.
 */
function Routed() {
  const token = useShareRoute((s) => s.token);
  if (!token) return <Pages />;
  return (
    <ErrorBoundary variant="page" resetKeys={[token]}>
      <Suspense fallback={<PageSkeleton page="community" />}>
        <SharedView token={token} onOpenApp={() => navigate("overview")} />
      </Suspense>
    </ErrorBoundary>
  );
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

/** P10 banner (trial ending, failed payment, paused) under the local-mode banner; inert without billing. */
function Banners() {
  if (!billingActive()) return null;
  return (
    <Suspense fallback={null}>
      <BillingBanner className="mb-5" />
    </Suspense>
  );
}

/** Idle work after the first paint: the dock's Markt chunk (the one lazy tab) – a tap on it then shows the page at once. */
function useIdlePreload(): void {
  useEffect(() => {
    const run = () => preloadPage("markt");
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 2500);
    return () => window.clearTimeout(t);
  }, []);
}

/** The feature hosts' chunk: requested by the first render, never waited for (no fallback – the shell paints at once). */
function FeatureHosts() {
  return (
    <Suspense fallback={null}>
      <DeferredHosts />
    </Suspense>
  );
}

/**
 * App shell (Plan 6.6): header, `main` container (page host with the keep-alive overview, local banner), the
 * visual-viewport bottom inset (`--vv-bottom`, `@/app/pwa`), the
 * in-flow footer with its staggered reveal, dock, command navigation (⌘K), toast island, the app-level overlays, the
 * hosts (P14: search, shortcuts, onboarding, cloud – each a leaf with `data-layer` and its own error boundary – plus
 * the lazy feature hosts) and the celebration layer (no portal, inside `MotionRoot`, which has no layout group). Every
 * store subscription lives in a leaf host, so the shell itself only re-renders when the local banner opens or closes;
 * the page, toasts, detail and editor each re-render on their own.
 */
function Shell() {
  const bannerOpen = useLocalBannerOpen();
  // grey-bar fix: `--vv-bottom` follows host UI laid over the bottom of the page (visualViewport, event driven)
  useEffect(() => installViewportInset(), []);
  useIdlePreload();
  return (
    <MorphDialogProvider>
      <ScenarioWatcher />
      <div className="relative min-h-dvh">
        <Header />
        <main className="mx-auto max-w-[1320px] px-4 pb-10 pt-6 sm:px-6">
          <LocalModeBanner />
          <Banners />
          {/* moves only when the banner enters / leaves (strict dependency: page switches never measure this subtree);
              scroll memory lives in the router, applied by the page host at the commit that shows a page */}
          <motion.div layout="position" layoutDependency={bannerOpen} transition={{ layout: spring.layout }} style={{ borderRadius: 0 }}>
            <Routed />
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
      <ErrorBoundary variant="widget" label="Trade-Detail" fallback={() => null}>
        <Detail />
      </ErrorBoundary>
      <ErrorBoundary variant="widget" label="Trade-Editor" fallback={() => null}>
        <EditorHost />
      </ErrorBoundary>
      <ErrorBoundary variant="widget" label="Grundlagen-Editor" fallback={() => null}>
        <SetupEditor />
      </ErrorBoundary>
      {/* hosts (P14): leaves after SetupEditor, before Celebrate */}
      <HostSlot name="Suche">
        <GlobalSearchHost />
      </HostSlot>
      <HostSlot name="Tastenkürzel">
        <ShortcutHost />
      </HostSlot>
      <HostSlot name="Einführung">
        <OnboardingHost />
      </HostSlot>
      <HostSlot name="Cloud">
        <CloudSyncHost onOpenAccount={() => navigate("konto")} />
      </HostSlot>
      <FeatureHosts />
      <Celebrate />
      <IntroHost />
      <LayerDiagHost />
    </MorphDialogProvider>
  );
}

/** The whole shell behind the app-level error boundary (P13 `app` variant: full-height stage, "Neu laden"). */
export default function App() {
  return (
    <ErrorBoundary variant="app">
      <Shell />
    </ErrorBoundary>
  );
}
