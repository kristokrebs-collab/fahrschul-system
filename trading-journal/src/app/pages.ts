/**
 * Page components, gathered in one module so the shell (and its tests) has a single seam.
 *
 * - Only the overview is imported statically (it is keep-alive, pre-rendered at idle, and the first thing on screen).
 *   Budget-Schnitt (Runde 11): the other three original tabs – Trades, Entscheidungsgrundlagen, Einstellungen – are
 *   chunks of their own as well (`STATIC_LOADERS`), fetched at idle after the first paint and on intent, behind the
 *   same page skeleton as the feature pages. They keep their exports (`TradesView` …) and stay out of `LAZY_PAGES`
 *   (they are not feature pages: no plan gate, no registry entry of their own).
 * - Every feature page (P02–P13) is a `React.lazy` chunk of its own: it is downloaded the first time it is shown (or
 *   when `preloadPage` is called on intent – a hover / focus of its link, the dock's Markt tab at idle), so the first
 *   load stays the journal. The lazy imports name the view MODULE, never a view barrel: a barrel imported statically
 *   anywhere in the shell would pull the whole page into the main chunk.
 * `renderPage` in `App.tsx` wraps each lazy page in `Suspense` (skeleton) and its plan gate (`PAGE_FEATURE`).
 */
import { createElement, type ComponentType, type LazyExoticComponent } from "react";
import { retryableLazy } from "@/app/retryableLazy";
import { loadChunk } from "@/lib/chunkLoad";
import type { Feature } from "@/billing/types";
import type { Page } from "@/store/uiStore";

export { OverviewView } from "@/views/overview";

/** The pages that are lazy chunks and feature pages (everything but the four original tabs). */
export type LazyPage = Exclude<Page, "overview" | "trades" | "setups" | "settings">;
/** The original tabs that left the first load (Budget-Schnitt): same lazy mechanism, but not feature pages. */
export type DeferredTab = "trades" | "setups" | "settings";

type Loader = () => Promise<{ default: ComponentType }>;

const STATIC_LOADERS: Record<DeferredTab, Loader> = {
  trades: () => import("@/views/trades/TradesView").then((m) => ({ default: m.TradesView })),
  setups: () => import("@/views/setups/SetupsView").then((m) => ({ default: m.SetupsView })),
  // `SettingsView` needs the market wiring (health, labels, refresh/reconnect/cache) → `SettingsPage` provides it.
  settings: () => import("@/app/SettingsPage").then((m) => ({ default: m.SettingsPage })),
};

const LOADERS: Record<LazyPage, Loader> = {
  markt: () => import("@/views/markt/MarktView").then((m) => ({ default: m.MarktView })),
  analyse: () => import("@/views/analyse/AnalyseView").then((m) => ({ default: m.AnalyseView })),
  risiko: () => import("@/views/risiko/RisikoView").then((m) => ({ default: m.RisikoView })),
  coach: () => import("@/views/coach/CoachView").then((m) => ({ default: m.CoachView })),
  berichte: () => import("@/views/berichte/BerichteView").then((m) => ({ default: m.BerichteView })),
  labor: () => import("@/views/labor/LaborView").then((m) => ({ default: m.LaborView })),
  wachstum: () => import("@/views/wachstum/WachstumView").then((m) => ({ default: m.WachstumView })),
  community: () => import("@/views/community/CommunityView").then((m) => ({ default: m.CommunityView })),
  cockpit: () => import("@/views/cockpit/CockpitView").then((m) => ({ default: m.CockpitView })),
  konto: () => import("@/views/konto/KontoPage").then((m) => ({ default: m.KontoPage })),
  preise: () => import("@/views/preise/PreiseView").then((m) => ({ default: m.PreiseView })),
  funktionen: () => import("@/views/funktionen/FunktionenView").then((m) => ({ default: m.FunktionenView })),
  studio: () => import("@/views/studio/StudioView").then((m) => ({ default: m.StudioView })),
  plan: () => import("@/views/plan/PlanView").then((m) => ({ default: m.PlanView })),
  aktien: () => import("@/views/aktien/AktienView").then((m) => ({ default: m.AktienView })),
};

export const LAZY_PAGES = Object.keys(LOADERS) as LazyPage[];

export function isLazyPage(page: Page): page is LazyPage {
  return page in LOADERS;
}

/**
 * How long a failed download stays remembered (ms). `loadChunk` fails only after its own retry pause; React re-renders at once
 * after an error (its synchronous recovery pass, `retryableLazy` hands out a fresh lazy) – without this memory that pass would
 * start a second full download cycle (pause + retry) and the page would hang on its skeleton without ever reaching the error
 * boundary. The memory is far shorter than a human needs to press „Erneut versuchen“.
 */
const FAIL_MEMORY_MS = 600;

/** One promise per page: a preload and the render share the same download. */
const started = new Map<LazyPage, Promise<{ default: ComponentType }>>();
function load(page: LazyPage): Promise<{ default: ComponentType }> {
  let p = started.get(page);
  if (!p) {
    // waits for the network, retried once (`loadChunk`): offline the page stays on its skeleton – with the offline note – until `online`
    p = loadChunk(LOADERS[page]);
    // a failed download (offline, a deploy replaced the chunk) may be tried again – the page's error boundary offers it
    p.catch(() => setTimeout(() => started.delete(page), FAIL_MEMORY_MS));
    started.set(page, p);
  }
  return p;
}

const VIEWS = Object.fromEntries(LAZY_PAGES.map((p) => [p, retryableLazy(() => load(p))])) as Record<LazyPage, () => LazyExoticComponent<ComponentType>>;

/** The lazy component of a feature page – read it while rendering (`LazyPageView` in `App.tsx`), never cache it. */
export function lazyView(page: LazyPage): LazyExoticComponent<ComponentType> {
  return VIEWS[page]();
}

const startedTabs = new Map<DeferredTab, Promise<{ default: ComponentType }>>();
function loadTab(tab: DeferredTab): Promise<{ default: ComponentType }> {
  let p = startedTabs.get(tab);
  if (!p) {
    p = loadChunk(STATIC_LOADERS[tab]);
    p.catch(() => setTimeout(() => startedTabs.delete(tab), FAIL_MEMORY_MS));
    startedTabs.set(tab, p);
  }
  return p;
}
const TAB_VIEWS = Object.fromEntries((Object.keys(STATIC_LOADERS) as DeferredTab[]).map((t) => [t, retryableLazy(() => loadTab(t))])) as Record<DeferredTab, () => LazyExoticComponent<ComponentType>>;

/** One original tab as a component: its chunk is fetched on the first render (or earlier by `preloadPage`); wrap it in `Suspense`. */
function tabView(tab: DeferredTab): ComponentType {
  return function DeferredTabView() {
    // stable per tab (created once); a new identity only after a failed download, where the fresh mount is the retry
    return createElement(TAB_VIEWS[tab]());
  };
}
export const TradesView = tabView("trades");
export const SetupsView = tabView("setups");
export const SettingsView = tabView("settings");

/** The original tabs that are chunks of their own (Trades, Entscheidungsgrundlagen, Einstellungen). */
export const DEFERRED_TABS = Object.keys(STATIC_LOADERS) as DeferredTab[];

/** Starts the download of a page's chunk (intent: hover / focus / press of its link). No-op for the overview. */
export function preloadPage(page: Page): void {
  if (isLazyPage(page)) void load(page).catch(() => undefined);
  else if (page in STATIC_LOADERS) void loadTab(page as DeferredTab).catch(() => undefined);
}

/**
 * Plan gate of a whole page (`src/billing/plans.ts`): a page whose core is one paid feature. Pages that are free at
 * heart gate single cards instead (Markt: the scanner; Analyse: Monte Carlo inside the page; Konto / Preise / Community
 * never). Without payments (no cloud, Stripe not set up) every gate is open.
 */
export const PAGE_FEATURE: Partial<Record<Page, Feature>> = {
  analyse: "analyticsPro",
  risiko: "riskLive",
  coach: "coach",
  berichte: "reports",
  labor: "backtestLab",
  studio: "backtestLab",
  wachstum: "growth",
  cockpit: "customDashboards",
};
