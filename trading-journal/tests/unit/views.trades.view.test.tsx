import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, useUi } from "@/store/uiStore";
import { TradesCards, TradesView } from "@/views/trades";
import { SAMPLE, enriched, settings } from "./domain.fixtures";

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

/** Present rows only: a filtered-out row stays in the DOM for its exit animation, marked `data-exiting`. */
const rowIds = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr:not([data-exiting])")).map((tr) => tr.dataset.tradeId);
/** Waits until the crossfaded-out `Keine Treffer` body has finished its exit (keeps state updates inside RTL). */
const bodySettled = () => waitFor(() => expect(screen.queryByText("Keine Treffer")).toBeNull(), { timeout: 2000 });
const exitingIds = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-exiting]")).map((tr) => tr.dataset.tradeId);

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

  it("segmented filters write to uiStore and filter the rows", async () => {
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
    await bodySettled();
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

  it("filtered-out rows exit: leave the tab order and hit-testing at once, then unmount", async () => {
    mount();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Richtung" })).getByRole("radio", { name: "Short" }));
    expect(rowIds()).toEqual(["B"]);
    expect(exitingIds().sort()).toEqual(["A", "C", "D", "E", "F"]);
    for (const tr of document.querySelectorAll<HTMLElement>("tbody tr[data-exiting]")) {
      expect(tr).toHaveAttribute("tabindex", "-1");
      expect(tr).toHaveAttribute("inert");
    }
    // the e2e row selector counts present rows only
    expect(document.querySelectorAll("tbody tr[tabindex='0']")).toHaveLength(1);
    await waitFor(() => expect(exitingIds()).toEqual([]), { timeout: 2000 });
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("a row that comes back while exiting is reused, not duplicated", () => {
    mount();
    const radios = within(screen.getByRole("radiogroup", { name: "Richtung" }));
    fireEvent.click(radios.getByRole("radio", { name: "Short" }));
    fireEvent.click(radios.getByRole("radio", { name: "Beide" }));
    expect(rowIds()).toEqual(["F", "E", "D", "C", "B", "A"]);
    expect(exitingIds()).toEqual([]);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(6);
  });

  it("sort headers keep the arrow as screen-reader text next to an aria-hidden chevron", () => {
    mount();
    const date = screen.getByRole("button", { name: /^Datum/ });
    expect(date.querySelector(".sr-only")).toHaveTextContent("↓");
    expect(date.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // inactive sortable columns: no arrow text, only the decorative hint
    const r = screen.getByRole("button", { name: /^R/ });
    expect(r.textContent).toBe("R");
    expect(r.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("a hovered row gets the gliding highlight; leaving the rows hides it", async () => {
    mount();
    const row = document.querySelector<HTMLElement>('tr[data-trade-id="C"]')!;
    fireEvent.pointerEnter(row);
    await waitFor(() => expect(document.querySelector("[data-row-highlight]")).toHaveAttribute("data-row-highlight", "hover"));
    expect(document.querySelector("[data-row-highlight]")).toHaveAttribute("aria-hidden", "true");
    fireEvent.pointerLeave(document.querySelector("tbody")!);
    await waitFor(() => expect(document.querySelector("[data-row-highlight]")).toBeNull(), { timeout: 2000 });
  });

  it("header count keeps the `{n} Trades` label and follows deletions", () => {
    mount();
    expect(screen.getByText("6 Trades")).toBeInTheDocument();
    act(() => useJournal.setState({ trades: SAMPLE.filter((t) => t.id !== "A") }));
    expect(screen.getByText("5 Trades")).toBeInTheDocument();
    expect(screen.queryByText("6 Trades")).toBeNull();
    expect(screen.getByTestId("trade-count")).toHaveTextContent("5 Trades");
  });

  it("search shows its pending state only while the debounce runs", () => {
    vi.useFakeTimers();
    mount();
    const field = screen.getByRole("searchbox", { name: "Trades durchsuchen" });
    const label = field.closest("label")!;
    expect(label).not.toHaveAttribute("data-pending");
    fireEvent.change(field, { target: { value: "FOMO" } });
    expect(label).toHaveAttribute("data-pending");
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(label).not.toHaveAttribute("data-pending");
  });

  it("`Keine Treffer` replaces the table in the same commit and `Filter zurücksetzen` brings it back", async () => {
    mount();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Ergebnis" })).getByRole("radio", { name: "Break-even" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Richtung" })).getByRole("radio", { name: "Short" }));
    expect(screen.getByText("Keine Treffer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(rowIds()).toEqual(["F", "E", "D", "C", "B", "A"]);
    expect(document.querySelectorAll("table")).toHaveLength(1);
    await bodySettled();
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

describe("TradesCards (mobile)", () => {
  beforeEach(() => seed());

  it("a removed card leaves the flow at once (inert, `data-exiting`), the list keeps the first card a button", async () => {
    const rows = enriched();
    const s = settings();
    const view = render(
      <MotionRoot>
        <TradesCards rows={rows} setups={s.setups} listKey="a" />
      </MotionRoot>,
    );
    const list = screen.getByRole("list", { name: "Trades" });
    expect(list.querySelectorAll("li")).toHaveLength(6);
    view.rerender(
      <MotionRoot>
        <TradesCards rows={rows.slice(1)} setups={s.setups} listKey="b" />
      </MotionRoot>,
    );
    const leaving = list.querySelectorAll("li[data-exiting]");
    expect(leaving).toHaveLength(1);
    expect(leaving[0]).toHaveAttribute("inert");
    expect(list.querySelectorAll("li:not([data-exiting])")).toHaveLength(5);
    await waitFor(() => expect(list.querySelectorAll("li")).toHaveLength(5), { timeout: 2000 });
    expect(within(list.querySelector("li")!).getAllByRole("button")[0]).toBeInTheDocument();
  });

  it("a card opens the detail from the table source", () => {
    render(
      <MotionRoot>
        <TradesCards rows={enriched()} setups={settings().setups} listKey="a" />
      </MotionRoot>,
    );
    fireEvent.click(within(screen.getByRole("list", { name: "Trades" })).getAllByRole("button")[0]!);
    expect(useUi.getState().detail).toEqual({ id: "A", source: "table" });
  });
});
