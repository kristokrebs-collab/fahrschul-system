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
  return {
    OverviewView: overview.OverviewView,
    TradesView: () => <div data-testid="page-trades">Alle Trades</div>,
    SetupsView: () => <div data-testid="page-setups">Entscheidungsgrundlagen</div>,
    SettingsView: () => <div data-testid="page-settings">Einstellungen</div>,
  };
});
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => <div>Hyblock-Formular</div>,
}));

import App from "@/App";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

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

  it("dock navigation changes the page and the hash", async () => {
    renderApp();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Trades" }));
    });
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    expect(await screen.findByTestId("page-trades")).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Trades" })).toHaveAttribute("aria-current", "page");
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Einstellungen" }));
    });
    expect(useUi.getState().page).toBe("settings");
    expect(location.hash).toBe("#settings");
  });

  it("shows the local-mode banner and hides it via the close button (pref persisted)", async () => {
    renderApp();
    expect(screen.getByText("Lokaler Modus.")).toBeInTheDocument();
    expect(screen.getByText("Lokaler Modus.").closest('[role="status"]')?.textContent).toContain("Nutze Backup (JSON) unter Einstellungen → Daten.");
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(useUi.getState().hideLocalBanner).toBe(true);
    expect(JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").hideLocalBanner).toBe(true);
  });

  it("keeps the overview mounted but hidden on other tabs and shows the same instance again", async () => {
    renderApp();
    const hero = screen.getByTestId("hero-net");
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "Trades" }));
    });
    expect(await screen.findByTestId("page-trades")).toBeInTheDocument();
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
    expect(header.querySelector('[data-pulse="ascii-cascade"]')).not.toBeNull();
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
});
