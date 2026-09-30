import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("text", { name: "Trade Journal" })).toBeInTheDocument();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    for (const label of ["Übersicht", "Trades", "Entscheidungsgrundlagen", "Einstellungen", "Trade eintragen"]) {
      expect(within(dock).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(dock).getByRole("button", { name: "Übersicht" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Netto-P&L · Gesamt")).toBeInTheDocument();
    expect(screen.getByText("BTC/USDT · Binance")).toBeInTheDocument();
    expect(screen.getByText("Nur dieser Browser")).toBeInTheDocument();
  });

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

  it("FAB and header CTA open the trade editor", () => {
    renderApp();
    const dock = screen.getByRole("toolbar", { name: "Navigation" });
    fireEvent.click(within(dock).getByRole("button", { name: "Trade eintragen" }));
    expect(useUi.getState().editor).toEqual({ open: true, tradeId: undefined, fromFab: true });
    useUi.getState().closeEditor();
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: /Trade eintragen/ }));
    expect(useUi.getState().editor.open).toBe(true);
    expect(useUi.getState().editor.fromFab).toBe(false);
  });
});
