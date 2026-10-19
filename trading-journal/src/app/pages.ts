/**
 * Page components, gathered in one module so the shell (and its tests) has a single seam.
 *
 * - The four original tabs are imported statically (the overview is keep-alive and pre-rendered at idle).
 * - Every feature page (P02–P13) is a `React.lazy` chunk of its own: it is downloaded the first time it is shown (or
 *   when `preloadPage` is called on intent – a hover / focus of its link, the dock's Markt tab at idle), so the first
 *   load stays the journal. The lazy imports name the view MODULE, never a view barrel: a barrel imported statically
 *   anywhere in the shell would pull the whole page into the main chunk.
 * `renderPage` in `App.tsx` wraps each lazy page in `Suspense` (skeleton) and its plan gate (`PAGE_FEATURE`).
 */
import type { ComponentType, LazyExoticComponent } from "react";
import { retryableLazy } from "@/app/retryableLazy";
import type { Feature } from "@/billing/types";
import type { Page } from "@/store/uiStore";

export { OverviewView } from "@/views/overview";
export { TradesView } from "@/views/trades";
export { SetupsView } from "@/views/setups";
// `SettingsView` needs the market wiring (health, labels, refresh/reconnect/cache) → `SettingsPage` provides it.
export { SettingsPage as SettingsView } from "@/app/SettingsPage";

/** The pages that are lazy chunks (everything but the four original tabs). */
export type LazyPage = Exclude<Page, "overview" | "trades" | "setups" | "settings">;

type Loader = () => Promise<{ default: ComponentType }>;

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
};

export const LAZY_PAGES = Object.keys(LOADERS) as LazyPage[];

export function isLazyPage(page: Page): page is LazyPage {
  return page in LOADERS;
}

/** One promise per page: a preload and the render share the same download. */
const started = new Map<LazyPage, Promise<{ default: ComponentType }>>();
function load(page: LazyPage): Promise<{ default: ComponentType }> {
  let p = started.get(page);
  if (!p) {
    p = LOADERS[page]();
    // a failed download (offline, a deploy replaced the chunk) may be tried again – the page's error boundary offers it
    p.catch(() => started.delete(page));
    started.set(page, p);
  }
  return p;
}

const VIEWS = Object.fromEntries(LAZY_PAGES.map((p) => [p, retryableLazy(() => load(p))])) as Record<LazyPage, () => LazyExoticComponent<ComponentType>>;

/** The lazy component of a feature page – read it while rendering (`LazyPageView` in `App.tsx`), never cache it. */
export function lazyView(page: LazyPage): LazyExoticComponent<ComponentType> {
  return VIEWS[page]();
}

/** Starts the download of a page's chunk (intent: hover / focus / press of its link). No-op for static pages. */
export function preloadPage(page: Page): void {
  if (isLazyPage(page)) void load(page).catch(() => undefined);
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
  wachstum: "growth",
  cockpit: "customDashboards",
};
