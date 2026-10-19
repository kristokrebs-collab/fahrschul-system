/**
 * F20 / F18 / F17 views: the three collapsible cards under the diagnosis of a run on REAL BTCUSDT 4h + 1D bars served
 * through the lab's own history loader – closed until opened, lazy bodies, the stress scenarios and the filter comparison
 * computed by the extra job on request, the Prüfbericht from the shown run, locked filters WITH their reasons.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, __setHistoryDeps, LaborView, useLabor } from "@/views/labor";
import { __resetExtras, useExtras } from "@/views/labor/extrasStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const NOW = H4_ROWS[H4_ROWS.length - 1]![0] * 1000 + 14_400_000 + 60_000;

function fixtureRest(): BinanceRest {
  return {
    klines: vi.fn(async (_s: string, interval: string, p: { startTime?: number; limit?: number } = {}) => {
      const src = interval === "4h" ? H4_ROWS : interval === "1d" ? D1_ROWS : [];
      const rows = src.filter((b) => b[0] * 1000 >= (p.startTime ?? 0)).slice(0, p.limit ?? 500);
      return { data: rows.map(([t, o, h, l, c]) => ({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 1, closed: true })), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
    }),
    fundingRate: vi.fn(async () => ({ data: [], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })),
  } as unknown as BinanceRest;
}

function renderLabor() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <LaborView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

async function finishedRun(): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
  const idea = sanitizeCustom({ ...defaultCustom(), name: "Test-Idee", long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } }, { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } }]) });
  useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "flat", custom: idea });
  renderLabor();
  await act(async () => {
    fireEvent.click(screen.getByTestId("labor-start"));
  });
  await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 45_000 });
}

describe("Labor · Belastung, Bericht, Filter", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    __resetLabor();
    __resetExtras();
    __setHistoryDeps(null);
  });
  afterEach(() => {
    __resetLabor();
    __resetExtras();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("vor einem Lauf gibt es die Karten nicht", () => {
    renderLabor();
    expect(screen.queryByTestId("labor-extras")).toBeNull();
  });

  it("Karten zugeklappt; Öffnen lädt den Inhalt; Prüfbericht nennt die Stichprobe und misst nichts, was er nicht misst", async () => {
    await finishedRun();
    const extras = await screen.findByTestId("labor-extras", {}, { timeout: 15_000 });
    for (const id of ["stress", "report", "filters"]) {
      expect(within(extras).getByTestId(`labor-extra-${id}`)).toHaveAttribute("data-open", "false");
      expect(within(extras).getByTestId(`labor-extra-toggle-${id}`)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByTestId("labor-report")).toBeNull();
    fireEvent.click(screen.getByTestId("labor-extra-toggle-report"));
    const report = await screen.findByTestId("labor-report", {}, { timeout: 15_000 });
    expect(screen.getByTestId("labor-extra-toggle-report")).toHaveAttribute("aria-expanded", "true");
    const n = useLabor.getState().result!.stats.n;
    expect(within(report).getByTestId("labor-outlier-text").textContent).toMatch(/\d/);
    expect(within(report).getByTestId("labor-outliers")).toHaveTextContent(`${n} Trades`);
    expect(within(report).getByTestId("labor-datagaps")).toHaveTextContent("Kerzen im Zeitraum");
    expect(within(report).getByTestId("labor-late-text")).toHaveTextContent("durch seinen Aufbau");
    expect(within(report).getByTestId("labor-signals")).toHaveTextContent("nicht gemessen");
    expect(within(report).getByTestId("labor-thirds").querySelectorAll("dt")).toHaveLength(3);
    expect(within(report).getByTestId("labor-report-robust")).toHaveTextContent(useLabor.getState().result!.robust.text);
    // closing again keeps the toggle honest
    fireEvent.click(screen.getByTestId("labor-extra-toggle-report"));
    expect(screen.getByTestId("labor-extra-toggle-report")).toHaveAttribute("aria-expanded", "false");
  }, 60_000);

  it("Belastungstest: Verlustserien sofort, die Szenarien erst auf Knopfdruck – gleiche Zahlen wie der Lauf oben", async () => {
    await finishedRun();
    fireEvent.click(await screen.findByTestId("labor-extra-toggle-stress", {}, { timeout: 15_000 }));
    const stress = await screen.findByTestId("labor-stress", {}, { timeout: 15_000 });
    // loss series from the real order come without a new run
    expect(within(stress).getByTestId("labor-streaks")).toBeInTheDocument();
    expect(within(stress).queryByTestId("labor-stress-table")).toBeNull();
    expect(within(stress).getByTestId("labor-stress-runbar")).toHaveTextContent("noch einmal berechnet");
    await act(async () => {
      fireEvent.click(within(stress).getByTestId("labor-stress-run"));
    });
    await waitFor(() => expect(within(stress).getByTestId("labor-stress-runbar")).toHaveAttribute("data-status", "done"), { timeout: 45_000 });
    const rows = within(stress).getAllByTestId("labor-stress-row");
    expect(rows.map((r) => r.getAttribute("data-scenario"))).toEqual(["base", "fees2", "slip2", "fundOff", "fundOn", "fund2", "delay1", "stopTight", "stopWide", "combined"]);
    const result = useLabor.getState().result!;
    expect(within(rows[0]!).getAllByRole("cell")[0]).toHaveTextContent(String(result.stats.n));
    // the run uses flat funding: "Mit Funding" is the base and the note says so
    expect(rows[4]).toHaveTextContent("schon mit pauschalem Funding");
    // no row is blank: every row shows numbers or its reason
    for (const r of rows) expect(r.getAttribute("data-status") === "unavailable" ? r.textContent : r.querySelectorAll("td")).toBeTruthy();
    expect(useExtras.getState().stress.status).toBe("done");
  }, 90_000);

  it("Filter: Top-Trader und Retest gesperrt mit Grund; ohne Auswahl kein Vergleich; mit Trend-Filter Tabelle, Beiträge und der Hinweis auf Überlappung", async () => {
    await finishedRun();
    fireEvent.click(await screen.findByTestId("labor-extra-toggle-filters", {}, { timeout: 15_000 }));
    const filters = await screen.findByTestId("labor-filters", {}, { timeout: 15_000 });
    const items = within(filters).getAllByTestId("labor-filter");
    expect(items.map((i) => i.getAttribute("data-filter"))).toEqual(["rsi", "trend", "retest", "topTrader"]);
    const top = items[3]!;
    expect(top).toHaveAttribute("data-available", "false");
    expect(within(top).getByTestId("labor-filter-reason")).toHaveTextContent("etwa die letzten 30 Tage");
    expect(within(top).getByRole("switch")).toBeDisabled();
    const retest = items[2]!;
    expect(within(retest).getByTestId("labor-filter-reason")).toHaveTextContent("Ausbruchsniveau");
    expect(within(retest).getByRole("switch")).toBeDisabled();
    // nothing chosen: the run is disabled and says why
    expect(within(filters).getByTestId("labor-filters-run")).toBeDisabled();
    expect(within(filters).getByText("Wähle mindestens einen Filter, um zu vergleichen.")).toBeInTheDocument();
    // choose two
    fireEvent.click(within(items[0]!).getByRole("switch"));
    fireEvent.click(within(items[1]!).getByRole("switch"));
    expect(useExtras.getState().selection.on).toEqual(["rsi", "trend"]);
    await waitFor(() => expect(within(filters).getByTestId("labor-filters-run")).toBeEnabled(), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(within(filters).getByTestId("labor-filters-run"));
    });
    await waitFor(() => expect(within(filters).getByTestId("labor-filters-runbar")).toHaveAttribute("data-status", "done"), { timeout: 45_000 });
    const rows = within(filters).getAllByTestId("labor-filter-row");
    expect(rows.map((r) => r.getAttribute("data-variant"))).toEqual(["base", "only:rsi", "only:trend", "all"]);
    expect(within(filters).getAllByTestId("labor-contrib-row").map((r) => r.getAttribute("data-filter"))).toEqual(["rsi", "trend"]);
    expect(within(filters).getByTestId("labor-filter-overlap")).toHaveTextContent(/addieren sich .*nicht/);
    // changing the choice drops the comparison that belonged to the old one
    fireEvent.click(within(items[1]!).getByRole("switch"));
    expect(within(filters).queryByTestId("labor-filter-table")).toBeNull();
  }, 90_000);

  it("ein neuer Lauf verwirft Szenarien und Vergleich des alten", async () => {
    await finishedRun();
    fireEvent.click(await screen.findByTestId("labor-extra-toggle-stress", {}, { timeout: 15_000 }));
    const stress = await screen.findByTestId("labor-stress", {}, { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(within(stress).getByTestId("labor-stress-run"));
    });
    await waitFor(() => expect(useExtras.getState().stress.status).toBe("done"), { timeout: 45_000 });
    act(() => {
      useLabor.setState((s) => ({ runSeq: s.runSeq + 1 }));
    });
    expect(useExtras.getState().stress.status).toBe("idle");
    expect(useExtras.getState().stress.result).toBeNull();
  }, 90_000);
});
