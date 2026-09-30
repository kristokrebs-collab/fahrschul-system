import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, useUi } from "@/store/uiStore";
import { TradesView } from "@/views/trades";
import { SAMPLE, settings } from "./domain.fixtures";

function seed(trades = SAMPLE) {
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local" });
  useUi.setState({
    tradeFilter: DEFAULT_TRADE_FILTER,
    tradeSort: DEFAULT_TRADE_SORT,
    detail: { id: null, source: null },
    editor: { open: false, fromFab: false },
    transitioning: false,
    toasts: [],
  });
}

const rowIds = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr")).map((tr) => tr.dataset.tradeId);

function mount() {
  return render(
    <MotionRoot>
      <TradesView />
    </MotionRoot>,
  );
}

describe("TradesView", () => {
  beforeEach(() => seed());
  afterEach(() => vi.useRealTimers());

  it("renders header, lead, count pill and all rows sorted by date desc", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: /Alle Trades/ })).toBeInTheDocument();
    expect(screen.getByText(/Filtere nach Konto, Entscheidungsgrundlage/)).toBeInTheDocument();
    expect(screen.getByTestId("trade-count")).toHaveTextContent("6 Trades");
    expect(rowIds()).toEqual(["F", "E", "D", "C", "B", "A"]);
    // header strings verbatim
    const heads = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent?.replace(/ [↑↓]$/, ""));
    expect(heads).toEqual(["Datum", "Richtung", "Grundlage", "Einstieg → Ausstieg", "Check", "P&L", "R", "Ergebnis"]);
    expect(screen.getByRole("button", { name: /^Datum/ })).toHaveTextContent("Datum ↓");
    expect(screen.getAllByText("▼ Short")).toHaveLength(1);
    expect(screen.getAllByText("offen").length).toBeGreaterThan(0);
  });

  it("segmented filters write to uiStore and filter the rows", () => {
    mount();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Richtung" })).getByRole("radio", { name: "Long" }));
    expect(useUi.getState().tradeFilter.side).toBe("long");
    expect(rowIds()).toEqual(["F", "E", "D", "C", "A"]);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Konto" })).getByRole("radio", { name: "Makro" }));
    expect(useUi.getState().tradeFilter.acc).toBe("makro");
    expect(rowIds()).toEqual(["D"]);
    expect(screen.getByTestId("trade-count")).toHaveTextContent("1 Trade");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Ergebnis" })).getByRole("radio", { name: "Break-even" }));
    expect(useUi.getState().tradeFilter.result).toBe("be");
    expect(screen.getByText("Keine Treffer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(useUi.getState().tradeFilter).toEqual(DEFAULT_TRADE_FILTER);
    expect(rowIds()).toHaveLength(6);
  });

  it("setup select incl. `Ohne Grundlage`", () => {
    mount();
    const select = screen.getByRole("combobox", { name: "Entscheidungsgrundlage" });
    expect(within(select).getByRole("option", { name: "Alle Grundlagen" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "__none" } });
    expect(useUi.getState().tradeFilter.setup).toBe("__none");
    expect(rowIds()).toEqual(["E", "C"]);
  });

  it("search is debounced 150 ms and matches emotion", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Trades durchsuchen" }), { target: { value: "FOMO" } });
    expect(useUi.getState().tradeFilter.q).toBe("");
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(useUi.getState().tradeFilter.q).toBe("FOMO");
    expect(rowIds()).toEqual(["B"]);
  });

  it("sortable headers toggle uiStore.tradeSort and mark the active column", () => {
    mount();
    const pnl = screen.getByRole("button", { name: /^P&L/ });
    fireEvent.click(pnl);
    expect(useUi.getState().tradeSort).toEqual({ k: "pnl", dir: -1 });
    expect(pnl.className).toContain("text-signal");
    expect(pnl).toHaveTextContent("P&L ↓");
    expect(rowIds()[0]).toBe("A");
    fireEvent.click(pnl);
    expect(useUi.getState().tradeSort).toEqual({ k: "pnl", dir: 1 });
    expect(pnl).toHaveTextContent("P&L ↑");
    expect(rowIds()[0]).toBe("D");
    const setup = screen.getByRole("button", { name: /^Grundlage/ });
    fireEvent.click(setup);
    expect(useUi.getState().tradeSort).toEqual({ k: "setup", dir: 1 });
    expect(screen.getByRole("button", { name: /^P&L/ }).className).not.toContain("text-signal");
  });

  it("row click opens the detail from the table (ghost first) and Enter works too", async () => {
    mount();
    const row = document.querySelector<HTMLElement>('tr[data-trade-id="A"]')!;
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.click(row);
    await waitFor(() => expect(useUi.getState().detail).toEqual({ id: "A", source: "table" }));
    expect(screen.getByTestId("trade-ghost")).toBeInTheDocument();
    act(() => useUi.getState().closeDetail());
    fireEvent.keyDown(document.querySelector<HTMLElement>('tr[data-trade-id="B"]')!, { key: "Enter" });
    await waitFor(() => expect(useUi.getState().detail).toEqual({ id: "B", source: "table" }));
  });

  it("shows the KPI strip of the filtered set", () => {
    mount();
    const strip = screen.getByRole("group", { name: "Kennzahlen der Auswahl" });
    expect(within(strip).getByText("Netto")).toBeInTheDocument();
    expect(within(strip).getByText("Win-Rate")).toBeInTheDocument();
    expect(within(strip).getByText("+1 offen")).toBeInTheDocument();
  });

  it("empty journal → `Noch keine Trades` with the `Trade eintragen` CTA opening the editor", () => {
    seed([]);
    mount();
    expect(screen.getByText("Noch keine Trades")).toBeInTheDocument();
    expect(screen.getByText("Klick auf „Trade eintragen“, um loszulegen.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trade eintragen" }));
    expect(useUi.getState().editor.open).toBe(true);
  });
});
