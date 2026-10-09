import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SignalSnap } from "@/domain/signals";
import type { Trade } from "@/domain/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_EXTRA, DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, loadPrefs, useUi } from "@/store/uiStore";
import { TradesView } from "@/views/trades";
import { ANY_MISTAKE, NO_MISTAKE, filterExtra, listKey, mistakeFilterTags, mistakesOf, signalOf, strengthKey } from "@/views/trades/tradesModel";
import { SAMPLE, settings } from "./domain.fixtures";

const snap = (strength: number): SignalSnap => ({ at: "2026-01-05T09:00:00.000Z", side: "long", score: 20 * strength, strength, tiers: strength + 1, label: "x", valid: strength > 0, rsiOk: true, zoneOk: false, zone: null, tfs: [] });

/** A: 2 mistakes + strength 2 (ours), B: strength 0 (theirs), C: one mistake, others: nothing. */
const TRADES: Trade[] = SAMPLE.map((t) =>
  t.id === "A"
    ? ({ ...t, mistakes: ["Kein Stop", "Zu müde"], signal: { ...snap(2), v: 2, mode: "live" } } as Trade)
    : t.id === "B"
      ? ({ ...t, signal: snap(0) } as Trade)
      : t.id === "C"
        ? ({ ...t, mistakes: ["Kein Stop"] } as Trade)
        : t,
);

function seed(trades: Trade[] = TRADES) {
  sessionStorage.setItem("tj2-fill-trades", "1");
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local" });
  useUi.setState({ tradeFilter: DEFAULT_TRADE_FILTER, tradeExtra: DEFAULT_TRADE_EXTRA, tradeSort: DEFAULT_TRADE_SORT, detail: { id: null, source: null }, editor: { open: false, fromFab: false }, transitioning: false, toasts: [] });
}

const rowIds = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr:not([data-exiting])")).map((tr) => tr.dataset.tradeId);

describe("tradesModel – mistakes / signal strength", () => {
  it("reads tags and stored strength of either app's format; `none` without a check", () => {
    const [a, b, c, d] = ["A", "B", "C", "D"].map((id) => TRADES.find((t) => t.id === id)!);
    expect(mistakesOf(a!)).toEqual(["Kein Stop", "Zu müde"]);
    expect(mistakesOf({ mistakes: ["x", 3, " "] as unknown })).toEqual(["x"]);
    expect(strengthKey(a!)).toBe("2");
    expect(strengthKey(b!)).toBe("0");
    expect(strengthKey(d!)).toBe("none");
    expect(signalOf(a!)).toBe(signalOf(a!)); // parsed once per trade object
    expect(filterExtra(TRADES, { mistake: "Kein Stop", strength: "all" }).map((t) => t.id)).toEqual(["A", "C"]);
    expect(filterExtra(TRADES, { mistake: ANY_MISTAKE, strength: "all" }).map((t) => t.id)).toEqual(["A", "C"]);
    expect(filterExtra(TRADES, { mistake: NO_MISTAKE, strength: "all" }).map((t) => t.id)).toEqual(["B", "D", "E", "F"]);
    expect(filterExtra(TRADES, { mistake: "all", strength: "none" }).map((t) => t.id)).toEqual(["C", "D", "E", "F"]);
    expect(filterExtra(TRADES, { mistake: ANY_MISTAKE, strength: "2" }).map((t) => t.id)).toEqual(["A"]);
    expect(filterExtra(TRADES, DEFAULT_TRADE_EXTRA)).toBe(TRADES);
    expect(c).toBeTruthy();
  });

  it("filter tags: used ones (most used first), then the rest of the settings list", () => {
    expect(mistakeFilterTags(TRADES, ["Zu früh rein", "Kein Stop"])).toEqual(["Kein Stop", "Zu müde", "Zu früh rein"]);
  });

  it("listKey changes only when an additive filter is set (the bundle key stays as before otherwise)", () => {
    expect(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, DEFAULT_TRADE_EXTRA)).toBe(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT));
    expect(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, { mistake: "x", strength: "all" })).not.toBe(listKey(DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT));
  });
});

describe("TradesView – Fehler-Tag / Signal-Stärke filters", () => {
  beforeEach(() => seed());

  it("shows both selects when the journal has tags / checks, filters the rows, and `Filter zurücksetzen` clears them", async () => {
    render(
      <MotionRoot>
        <TradesView />
      </MotionRoot>,
    );
    const mistake = screen.getByRole("button", { name: "Fehler-Tag" });
    fireEvent.click(mistake);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Fehler-Tag" })).getByRole("option", { name: "Zu müde" }));
    expect(useUi.getState().tradeExtra.mistake).toBe("Zu müde");
    expect(rowIds()).toEqual(["A"]);
    fireEvent.click(mistake);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Fehler-Tag" })).getByRole("option", { name: "Alle Fehler-Tags" }));
    const strength = screen.getByRole("button", { name: "Signal-Stärke" });
    fireEvent.click(strength);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Signal-Stärke" })).getByRole("option", { name: "Stärke 0 · Kein Signal" }));
    await waitFor(() => expect(rowIds()).toEqual(["B"]));
    fireEvent.click(strength);
    fireEvent.click(within(screen.getByRole("listbox", { name: "Signal-Stärke" })).getByRole("option", { name: "Stärke 4 · Maximal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Filter zurücksetzen" }));
    expect(useUi.getState().tradeExtra).toEqual(DEFAULT_TRADE_EXTRA);
    await waitFor(() => expect(rowIds()).toHaveLength(6));
  });

  it("the `Check` cell carries the strength bars; the selects stay hidden for a journal without tags / checks", () => {
    seed(SAMPLE);
    const view = render(
      <MotionRoot>
        <TradesView />
      </MotionRoot>,
    );
    expect(screen.queryByRole("button", { name: "Fehler-Tag" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Signal-Stärke" })).toBeNull();
    view.unmount();
    seed();
    render(
      <MotionRoot>
        <TradesView />
      </MotionRoot>,
    );
    const rowA = document.querySelector('tbody tr[data-trade-id="A"]') as HTMLElement;
    expect(within(rowA).getByRole("img", { name: "Signal-Stärke 2 von 4 (Stark)" })).toBeInTheDocument();
    const rowD = document.querySelector('tbody tr[data-trade-id="D"]') as HTMLElement;
    expect(within(rowD).getByRole("img", { name: "Kein Einstiegs-Check gespeichert" })).toBeInTheDocument();
  });

  it("tablet portrait: the table has no 900 px minimum below `lg`; sort headers get a 44 px touch hit area", () => {
    render(
      <MotionRoot>
        <TradesView />
      </MotionRoot>,
    );
    const table = document.querySelector("table") as HTMLElement;
    expect(table.className).toContain("lg:min-w-[900px]");
    expect(table.className).not.toMatch(/(^|\s)min-w-\[900px\]/);
    expect(screen.getByRole("button", { name: /^Datum/ }).className).toContain("touch-hit");
  });
});

describe("uiStore additions", () => {
  it("chart interval 30m survives a reload; dismissDetail keeps the release tempo, open resets it", () => {
    localStorage.setItem("tj2-ui", JSON.stringify({ chart: { interval: "30m" } }));
    expect(loadPrefs().chart.interval).toBe("30m");
    localStorage.removeItem("tj2-ui");
    useUi.getState().openDetail("A", "table");
    useUi.getState().dismissDetail(0.7);
    expect(useUi.getState().detail).toEqual({ id: null, source: null });
    expect(useUi.getState().detailTempo).toBe(0.7);
    useUi.getState().openDetail("A", "insights");
    expect(useUi.getState().detailTempo).toBe(0);
    expect(useUi.getState().detail.source).toBe("insights");
  });
});
