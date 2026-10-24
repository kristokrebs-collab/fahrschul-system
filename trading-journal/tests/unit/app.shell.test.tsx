import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  return { ...actual, ...fakeMarket(actual).overrides };
});
vi.mock("@/chart/NothingCandleChart", () => ({ NothingCandleChart: () => <div data-testid="candle-chart" /> }));
vi.mock("@/chart/MiniTradeChart", () => ({ MiniTradeChart: () => null }));
vi.mock("@/app/pages", async () => {
  const overview = await import("@/views/overview");
  // the feature pages (P14: lazy chunks in the app) as plain stubs with their h1
  const stub = (name: string) => () => (
    <div data-testid={`page-${name}`}>
      <h1>{name}</h1>
    </div>
  );
  const LAZY_VIEWS = Object.fromEntries(["markt", "analyse", "risiko", "coach", "berichte", "labor", "wachstum", "community", "cockpit", "konto", "preise", "funktionen", "studio"].map((p) => [p, stub(p)]));
  return {
    OverviewView: overview.OverviewView,
    TradesView: () => <div data-testid="page-trades">Alle Trades</div>,
    SetupsView: () => <div data-testid="page-setups">Entscheidungsgrundlagen</div>,
    SettingsView: () => <div data-testid="page-settings">Einstellungen</div>,
    lazyView: (p: string) => LAZY_VIEWS[p],
    LAZY_PAGES: Object.keys(LAZY_VIEWS),
    isLazyPage: (p: string) => p in LAZY_VIEWS,
    PAGE_FEATURE: { coach: "coach" },
    preloadPage: () => undefined,
  };
});
vi.mock("@/app/DeferredHosts", () => ({ default: () => <div data-testid="feature-hosts" /> }));
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => <div>Hyblock-Formular</div>,
}));

import App from "@/App";
import { MotionRoot } from "@/motion/MotionRoot";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

/**
 * How long a page switch may take to reach the DOM here. `PageHost` takes a new page one painted frame later
 * (`afterNextPaint`: a frame, then a task) and renders it in a transition, while the shell's leaving page still runs its
 * exit; in jsdom that is 0.8–2 s on an idle machine (measured: Übersicht → Markt ≈ 0.9 s, Markt → Coach ≈ 1.0–2.0 s),
 * beyond Testing Library's 1-s `findBy` default – and 3–4 s with the full suite's workers in parallel. Only the wait is
 * longer: each find still requires the page itself.
 */
const SWITCH = { timeout: 8_000 };

function renderApp() {
  return render(
    <MotionRoot>
      <App />
    </MotionRoot>,
  );
}

describe("App shell", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("renders header, dock and hero", async () => {
    renderApp();
    expect(screen.getByText("Makro & Scalp · Entscheidungen, Win-Rate, Backtest")).toBeInTheDocument();
    expect(screen.getByText("Trade Journal")).toBeInTheDocument(); // SplitText: sr-only text, letters aria-hidden
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    for (const label of ["Übersicht", "Trades", "Entscheidungsgrundlagen", "Einstellungen", "Trade eintragen"]) {
      expect(within(dock).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(dock).getByRole("button", { name: "Übersicht" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Netto-P&L · Gesamt")).toBeInTheDocument();
    expect(screen.getByText("BTC/USDT · Binance")).toBeInTheDocument();
    expect(screen.getByText("Nur dieser Browser")).toBeInTheDocument();
    // first (cold) mount of the whole app: transforms + overview render exceed 5 s when the workers run in parallel
  }, 20_000);

  it("dock navigation changes the page and the hash", { timeout: 20_000 }, async () => {
    renderApp();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Trades" }));
    });
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    expect(await screen.findByTestId("page-trades", {}, SWITCH)).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Trades" })).toHaveAttribute("aria-current", "page");
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Einstellungen" }));
    });
    expect(useUi.getState().page).toBe("settings");
    expect(location.hash).toBe("#settings");
  });

  // two page switches after a cold mount (see `SWITCH`): beyond vitest's 5-s default test timeout under the parallel run
  it("feature pages: the dock's Markt tab and the router reach the lazy pages; the feature hosts mount (P14)", { timeout: 30_000 }, async () => {
    renderApp();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Markt" }));
    });
    expect(useUi.getState().page).toBe("markt");
    expect(location.hash).toBe("#markt");
    expect(await screen.findByTestId("page-markt", {}, SWITCH)).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Markt" })).toHaveAttribute("aria-current", "page");
    // a page outside the dock (no payments in tests → the coach gate is open)
    await act(async () => {
      navigate("coach");
    });
    expect(await screen.findByTestId("page-coach", {}, SWITCH)).toBeInTheDocument();
    expect(within(dock).queryByRole("button", { current: "page" })).toBeNull();
    expect(await screen.findByTestId("feature-hosts")).toBeInTheDocument();
    for (const layer of ["Suche", "Tastenkürzel", "Einführung", "Cloud"]) expect(document.querySelector(`[data-layer="${layer}"]`)).not.toBeNull();
  });

  it("shows the local-mode banner and hides it via the close button (pref persisted)", async () => {
    renderApp();
    expect(screen.getByText("Lokaler Modus.")).toBeInTheDocument();
    expect(screen.getByText("Lokaler Modus.").closest('[role="status"]')?.textContent).toContain("Nutze Backup (JSON) unter Einstellungen → Daten.");
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(useUi.getState().hideLocalBanner).toBe(true);
    expect(JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").hideLocalBanner).toBe(true);
  });

  it("keeps the overview mounted but hidden on other tabs and shows the same instance again", { timeout: 20_000 }, async () => {
    renderApp();
    const hero = screen.getByTestId("hero-net");
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Trades" }));
    });
    expect(await screen.findByTestId("page-trades", {}, SWITCH)).toBeInTheDocument();
    // same DOM node, parked behind React Activity (display:none) once its exit played, instead of unmounted
    await waitFor(() => expect(hero).not.toBeVisible(), { timeout: 1500 });
    expect(screen.getByTestId("hero-net")).toBe(hero);
    expect(screen.queryByText("Netto-P&L · Gesamt")).not.toBeVisible();
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Übersicht" }));
    });
    expect(screen.getByTestId("hero-net")).toBe(hero);
    await waitFor(() => expect(hero).toBeVisible(), { timeout: 1500 });
  });

  it("mounts the celebration layer and a decorative live ticker in the header", () => {
    renderApp();
    expect(document.querySelector("[data-celebrate]")).toBeNull();
    act(() => {
      useUi.getState().celebrate({ x: 40, y: 40 });
    });
    const layer = document.querySelector("[data-celebrate]");
    expect(layer).toHaveAttribute("aria-hidden", "true");
    const ticker = within(screen.getByRole("banner")).getByText("BTC").closest("[data-header-ticker]");
    expect(ticker).toHaveAttribute("aria-hidden", "true");
  });

  it("logo click decodes the wordmark (the real text stays single) and the menu button opens the command navigation", async () => {
    renderApp();
    const header = screen.getByRole("banner");
    expect(header.querySelector('[data-pulse="dancing-letters"]')).not.toBeNull();
    fireEvent.click(within(header).getByRole("button", { name: "Übersicht" }));
    // the replay + decode wait for the multi-tap window (five quick taps open the layer diagnostics instead)
    await waitFor(() => expect(header.querySelector('[data-pulse="ascii-cascade"]')).not.toBeNull());
    expect(screen.getAllByText("Trade Journal")).toHaveLength(1);
    // no new focusables in the dock; the menu button lives in the header
    const menu = within(header).getByRole("button", { name: "Navigation öffnen" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
  });

  // the lazy LayerDiagnostics chunk is transformed on its first import inside this test (the find below allows 8 s for
  // it): under a loaded parallel run that alone outlasted vitest's 5-s default test timeout
  it("five quick taps on the logo open the layer diagnostics (no intro replay), five more close them", { timeout: 20_000 }, async () => {
    const { isLayerDiagOpen } = await import("@/app/layerDiag");
    renderApp();
    const logo = within(screen.getByRole("banner")).getByRole("button", { name: "Übersicht" });
    for (let i = 0; i < 5; i++) fireEvent.click(logo);
    expect(isLayerDiagOpen()).toBe(true);
    // lazy chunk: the first import is transformed on demand in the test run
    expect(await screen.findByTestId("layer-diag", {}, { timeout: 8000 })).toBeInTheDocument();
    for (let i = 0; i < 5; i++) fireEvent.click(logo);
    expect(isLayerDiagOpen()).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("layer-diag")).toBeNull());
  });

  it("FAB and header CTA open the trade editor", () => {
    renderApp();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    fireEvent.click(within(dock).getByRole("button", { name: "Trade eintragen" }));
    expect(useUi.getState().editor).toEqual({ open: true, tradeId: undefined, fromFab: true });
    act(() => useUi.getState().closeEditor());
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: /Trade eintragen/ }));
    expect(useUi.getState().editor.open).toBe(true);
    expect(useUi.getState().editor.fromFab).toBe(false);
  });

  it("signed in to the cloud: one sync status in the header – the account pill, no second mode pill (P1-04)", async () => {
    const { Header } = await import("@/app/Header");
    const { setCloudEnabledForTests } = await import("@/cloud/env");
    const { resetCloudSession, useCloudSession } = await import("@/cloud/session");
    const { useJournal } = await import("@/store/journalStore");
    setCloudEnabledForTests(true);
    try {
      act(() => useJournal.setState({ mode: "cloud", storage: "ok" }));
      act(() => useCloudSession.setState({ phase: "signedOut" }));
      const { unmount } = render(
        <MotionRoot>
          <Header />
        </MotionRoot>,
      );
      expect(screen.getByText("Synchronisiert")).toBeInTheDocument();
      act(() => useCloudSession.setState({ phase: "signedIn", user: { id: "u1", email: "t@example.com", aal: "aal1", mfaEnrolled: false } }));
      await waitFor(() => expect(screen.queryByText("Synchronisiert")).toBeNull());
      expect(screen.getByRole("button", { name: "Konto: t@example.com" })).toBeInTheDocument();
      unmount();
    } finally {
      act(() => resetCloudSession());
      setCloudEnabledForTests(null);
    }
  });
});
