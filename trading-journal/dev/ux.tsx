import { StrictMode, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import "../src/styles/themes.css";
import App from "@/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { bootMarket } from "@/app/marketBoot";
import { SetupEditor, TradeDetail } from "@/app/overlays";
import { ShortcutHost } from "@/app/ShortcutHost";
import { ThemeCard } from "@/app/ThemeCard";
import { installThemeTransition } from "@/app/themeTransition";
import { toIslandToast } from "@/app/toasts";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { OnboardingCard, OnboardingHost } from "@/onboarding";
import { ToastIsland } from "@/primitives/Toast";
import { GlobalSearchHost } from "@/search/GlobalSearchHost";
import { bootJournal, useJournal } from "@/store/journalStore";
import { installRouter } from "@/store/router";
import { applyInitialTheme, useTheme } from "@/store/themeStore";
import { useUi } from "@/store/uiStore";
import { CockpitView } from "@/views/cockpit";

/*
 * Dev harness of the P13 UX shell until the integrator wires it (P14): `/dev/ux.html` under `npm run dev`.
 *   - default (`?view=app`): the real app (main.tsx boot: theme before the first render, journal, router, market)
 *     plus the three P13 hosts the integrator mounts in `App` – GlobalSearchHost, ShortcutHost, OnboardingHost – and
 *     the app-level ErrorBoundary around it.
 *   - `?view=cockpit`: the Cockpit page (its own route `cockpit` once registered) with the trade detail, toasts, confetti.
 *   - `?view=cards`: the two settings cards P13 adds (Darstellung, Einführung & Hilfe) in the settings grid.
 *   - `?view=crash` / `?view=crash-widget`: the error boundary (page / widget variant) around a component that throws.
 */
const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "app";

applyInitialTheme();
installThemeTransition();
void bootJournal({ autoBackup: false });
if (view === "app") installRouter();
bootMarket();
// e2e hooks (dev harness only)
Object.assign(window as unknown as Record<string, unknown>, { __tjJournal: useJournal, __tjTheme: useTheme, __tjUi: useUi });

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

function Hosts() {
  return (
    <>
      <GlobalSearchHost />
      <ShortcutHost />
      <OnboardingHost />
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <span className="grid size-9 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">₿</span>
          <span className="text-[15px] font-semibold tracking-tight">Trade Journal</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">{children}</main>
      <TradeDetail />
      <SetupEditor />
      <Toasts />
      <Celebrate />
      <Hosts />
    </MorphDialogProvider>
  );
}

function Boom(): ReactNode {
  throw new Error("Testfehler aus dem Dev-Harness");
}

function Harness() {
  switch (view) {
    case "cockpit":
      return (
        <Shell>
          <ErrorBoundary variant="page">
            <CockpitView />
          </ErrorBoundary>
        </Shell>
      );
    case "cards":
      return (
        <Shell>
          <h1 className="mb-5 text-[24px] font-semibold tracking-tight">Einstellungen (P13-Karten)</h1>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ThemeCard />
            <OnboardingCard />
          </div>
        </Shell>
      );
    case "crash":
      return (
        <Shell>
          <ErrorBoundary variant="page">
            <Boom />
          </ErrorBoundary>
        </Shell>
      );
    case "crash-widget":
      return (
        <Shell>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <ErrorBoundary variant="widget" label="Monte Carlo">
                <Boom />
              </ErrorBoundary>
            </div>
          </div>
        </Shell>
      );
    default:
      return (
        <>
          <ErrorBoundary variant="app">
            <App />
          </ErrorBoundary>
          <Hosts />
        </>
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Harness />
    </MotionRoot>
  </StrictMode>,
);
