import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@/market/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeDetail } from "@/overlays/TradeDetail";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";

const miniChart = vi.fn((_props: { candles: Candle[] }) => <div data-testid="mini-chart" />);
vi.mock("@/chart/MiniTradeChart", () => ({ MiniTradeChart: (p: { candles: Candle[] }) => miniChart(p) }));

const deleteTrade = vi.fn(async () => {});

function seed(id: string | null, source: "table" | "recent" | "marker" = "table") {
  deleteTrade.mockClear();
  miniChart.mockClear();
  useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", deleteTrade });
  useUi.setState({ detail: { id, source: id ? source : null }, editor: { open: false, fromFab: false }, toasts: [], transitioning: false });
}

function mount(props: Partial<Parameters<typeof TradeDetail>[0]> = {}) {
  return render(
    <MotionRoot>
      <button type="button">outside</button>
      <TradeDetail {...props} />
    </MotionRoot>,
  );
}

describe("TradeDetail", () => {
  beforeEach(() => seed("A"));

  it("renders nothing while no detail is open", () => {
    seed(null);
    mount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog with header, P&L, facts, setups, checklist, review and chart link", () => {
    mount();
    const dialog = screen.getByRole("dialog", { name: "Trade-Details" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("▲ Long · Scalp")).toBeInTheDocument();
    expect(within(dialog).getByText(/05\.01\.26 10:00 · 4h · BTC\/USDT/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("detail-pnl").className).toContain("dot-num text-[30px]");
    expect(within(within(dialog).getByTestId("detail-pnl")).getByLabelText("+396,00")).toBeInTheDocument();
    const fact = (label: string) => within(dialog).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
    expect(fact("Einstieg")).toBe("80.000");
    expect(fact("Ausstieg")).toBe("84.000");
    expect(fact("R")).toBe("+3,96 R");
    expect(fact("Bewegung")).toBe("+5,0 %");
    expect(fact("Stop")).toBe("79.000");
    expect(fact("Ziel")).toBe("86.000");
    expect(fact("Größe")).toBe("8.000 USDT");
    expect(fact("Hebel")).toBe("–");
    expect(fact("Gebühren")).toBe("4,00 USDT");
    expect(fact("CRV")).toBe("1 : 6,00");
    expect(within(dialog).getByText("Checkliste")).toBeInTheDocument();
    expect(within(dialog).getByText("2/8")).toBeInTheDocument(); // 5 rules + 3 `s_bo` items, 2 checked
    expect(within(dialog).getAllByText("erfüllt", { selector: ".sr-only" })).toHaveLength(2);
    expect(within(dialog).getAllByText("nicht erfüllt", { selector: ".sr-only" })).toHaveLength(6);
    expect(fact("Überzeugung")).toBe("4 · Hoch");
    expect(fact("Plan befolgt")).toBe("Ja");
    expect(fact("Gefühl")).toBe("Ruhig");
    expect(within(dialog).getByText("Warum")).toBeInTheDocument();
    expect(within(dialog).getByText('Breakout; "sauber"')).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: "Chart öffnen ↗" });
    expect(link).toHaveAttribute("href", "https://www.tradingview.com/x/abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByTestId("mini-chart")).not.toBeInTheDocument();
    // sibling content is inert while open
    expect(screen.getByRole("button", { name: "outside", hidden: true })).toBeInTheDocument();
  });

  it("open trade: `offen` instead of a P&L, `–` exit, `·` discs", () => {
    seed("D");
    mount();
    const dialog = screen.getByRole("dialog", { name: "Trade-Details" });
    expect(within(dialog).getByTestId("detail-pnl")).toHaveTextContent("offen");
    expect(within(dialog).getByText("Ausstieg", { selector: "dt" }).nextElementSibling?.textContent).toBe("–");
    expect(within(dialog).getAllByText("offen", { selector: ".sr-only" }).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("link", { name: "Chart öffnen ↗" })).not.toBeInTheDocument();
  });

  it("renders the MiniTradeChart slot only with candles (lazy chunk → resolves asynchronously)", async () => {
    const candles: Candle[] = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1, closed: true }];
    mount({ candles });
    expect(await screen.findByTestId("mini-chart")).toBeInTheDocument();
    expect(miniChart.mock.calls[0]?.[0].candles).toBe(candles);
  });

  it("`Schließen`, Escape and the backdrop close the detail", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(useUi.getState().detail.id).toBeNull();
    act(() => useUi.getState().openDetail("A", "recent"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useUi.getState().detail.id).toBeNull();
  });

  it("`Löschen` asks inline, then deletes and toasts `Trade gelöscht`", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    await waitFor(() => expect(deleteTrade).toHaveBeenCalledWith("A"));
    await waitFor(() => expect(useUi.getState().detail.id).toBeNull());
    expect(useUi.getState().toasts.map((t) => [t.kind, t.title])).toEqual([["info", "Trade gelöscht"]]);
  });

  it("`Bearbeiten` closes the detail and opens the editor for the trade", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(useUi.getState().detail.id).toBeNull();
    await waitFor(() => expect(useUi.getState().editor).toEqual({ open: true, tradeId: "A", fromFab: false }));
  });

  it("`onEdit` override wins", () => {
    const onEdit = vi.fn();
    mount({ onEdit });
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(onEdit).toHaveBeenCalledWith("A");
    expect(useUi.getState().detail.id).toBe("A");
  });
});
