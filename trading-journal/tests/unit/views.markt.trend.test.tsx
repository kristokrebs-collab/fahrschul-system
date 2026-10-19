/**
 * Preis- & RSI-Struktur card (F05) on a fake provider: a row per selected timeframe with the price and RSI lines, approach /
 * break / retest apart with distances, timeframes the feed cannot serve LOCKED with the reason (never replaced), the
 * timeframe chips and the chart switch written to settings.trendlines, honest empty states.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { trendlinesOfSettings } from "@/domain/trendlines";
import type { Candle } from "@/market/types";
import { candlesOf, DOWN_THEN_BREAK, H4, zigzag } from "./trendFixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ p: null as unknown }));
vi.mock("@/market/marketStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/marketStore")>();
  return { ...actual, getProvider: () => fake.p };
});

const { TrendStructureCard } = await import("@/views/markt/TrendStructureCard");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { __resetTrendlines } = await import("@/market/trendlines/store");

const T0 = Date.UTC(2026, 9, 1);
const H1 = 3_600_000;
const path = zigzag(DOWN_THEN_BREAK);
const candles = (ms: number, n: number): Candle[] => {
  const closes = Array.from({ length: n }, (_, i) => path[Math.min(i, path.length - 1)]!);
  return candlesOf(closes, ms, 0.3, T0).map((c) => ({ ...c, volume: 1 }));
};

function install(feeds: Record<string, Candle[]>, now: number): void {
  const stamped = (data: unknown) => ({ data, asOf: now, receivedAt: now, source: "binance", comparable: true });
  const sf = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, stamped(v)]));
  fake.p = { symbolInfo: { binance: "BTCUSDT" }, serverNow: () => now, get: (f: string) => sf[f], snapshot: () => ({}), getHealth: () => ({ feeds: {} }) };
}

function setTrend(trendlines: unknown): void {
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, trendlines } as typeof s });
}

const wrap = () =>
  render(
    <MotionRoot>
      <TrendStructureCard />
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  fake.p = null;
  localStorage.clear();
  await bootFixtureJournal();
  __resetTrendlines();
});
afterEach(() => __resetTrendlines());

describe("TrendStructureCard", () => {
  it("a row per selected timeframe; the retest of the broken price line is stated apart from the break", async () => {
    // the 4h fixture up to the retest (119 candles), now = just after the last one closed
    install({ kline_4h: candles(H4, 119) }, T0 + 119 * H4);
    setTrend({ v: 1, tfs: ["4h"], chart: true });
    wrap();
    const row = await screen.findByTestId("trend-row");
    expect(row).toHaveAttribute("data-tf", "4h");
    expect(row).toHaveAttribute("data-status", "ok");
    expect(within(row).getByText("119 geschlossene Kerzen", { exact: false })).toBeInTheDocument();
    const price = within(row).getAllByTestId("trend-series").find((s) => s.getAttribute("data-series") === "price")!;
    const down = within(price).getAllByTestId("trend-kind").find((k) => k.getAttribute("data-kind") === "down")!;
    const lines = within(down).getAllByTestId("trend-line");
    // the break (with its retest state) and the newer, still intact line are two separate statements
    expect(lines.map((l) => l.getAttribute("data-state"))).toEqual(["broken", "active"]);
    expect(lines[0]).toHaveAttribute("data-phase", "retest-held");
    expect(within(lines[0]!).getByText("Retest bestätigt")).toBeInTheDocument();
    expect(lines[1]!.getAttribute("data-phase")).toMatch(/intact|approach/);
    // distances in % and ATR for the intact price line
    expect(lines[1]!.textContent).toMatch(/\d+,\d{2} % \(\d+,\d ATR\)/);
    // Aufwärtstrendlinie: none in this picture – said so
    const up = within(price).getAllByTestId("trend-kind").find((k) => k.getAttribute("data-kind") === "up")!;
    expect(within(up).getByTestId("trend-empty")).toHaveTextContent("Keine diagonale Preislinie.");
  });

  it("an approach is named an approach, with the distance", async () => {
    install({ kline_4h: candles(H4, 100) }, T0 + 100 * H4);
    setTrend({ v: 1, tfs: ["4h"], chart: true });
    wrap();
    const lines = await screen.findAllByTestId("trend-line");
    const near = lines.find((l) => l.getAttribute("data-series") === "price" && l.getAttribute("data-kind") === "down")!;
    expect(near).toHaveAttribute("data-phase", "approach");
    expect(near).toHaveAttribute("data-tone", "warn");
    expect(near.textContent).toContain("Annäherung an die Abwärtstrendlinie");
    expect(near.textContent).toMatch(/Schluss \d+,\d{2} % \(\d+,\d ATR\) unter der Linie/);
  });

  it("a timeframe without candles is locked WITH the reason and is not replaced: chip disabled, row says why", async () => {
    install({ kline_4h: candles(H4, 119), kline_1h: candles(H1, 300) }, T0 + 119 * H4);
    wrap(); // default selection: 1h 4h 1D 1W
    await screen.findAllByTestId("trend-row");
    const rows = screen.getAllByTestId("trend-row");
    expect(rows.map((r) => r.getAttribute("data-tf"))).toEqual(["1h", "4h", "1D", "1W"]);
    expect(rows[2]).toHaveAttribute("data-status", "locked");
    expect(within(rows[2]!).getByTestId("trend-locked")).toHaveTextContent("1D-Kerzen werden geladen …");
    expect(within(rows[3]!).getByTestId("trend-locked")).toHaveTextContent("1W-Kerzen werden geladen …");
    // 30m has no 15m candles: not selectable, reason listed
    const chips = screen.getByTestId("trend-tfs");
    const m30 = within(chips).getByRole("button", { name: "30M" });
    expect(m30).toBeDisabled();
    expect(m30).toHaveAttribute("aria-pressed", "false");
    const blocked = screen.getByTestId("trend-blocked");
    expect(within(blocked).getByText("15m-Kerzen werden geladen …", { exact: false })).toBeInTheDocument();
    // 2h is served by the 1h feed: selectable
    expect(within(chips).getByRole("button", { name: "2H" })).toBeEnabled();
  });

  it("the chips write settings.trendlines: add 2h (a row appears), remove 1h (its row goes)", async () => {
    install({ kline_4h: candles(H4, 119), kline_1h: candles(H1, 300) }, T0 + 119 * H4);
    setTrend({ v: 1, tfs: ["1h", "4h"], chart: true });
    wrap();
    await screen.findAllByTestId("trend-row");
    const chips = screen.getByTestId("trend-tfs");
    fireEvent.click(within(chips).getByRole("button", { name: "2H" }));
    await waitFor(() => expect(trendlinesOfSettings(useJournal.getState().settings).tfs).toEqual(["1h", "2h", "4h"]));
    await waitFor(() => expect(screen.getAllByTestId("trend-row").map((r) => r.getAttribute("data-tf"))).toEqual(["1h", "2h", "4h"]));
    expect(within(chips).getByRole("button", { name: "2H" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(chips).getByRole("button", { name: "1H" }));
    await waitFor(() => expect(screen.getAllByTestId("trend-row").map((r) => r.getAttribute("data-tf"))).toEqual(["2h", "4h"]));
    expect(trendlinesOfSettings(useJournal.getState().settings).tfs).toEqual(["2h", "4h"]);
  });

  it("too few candles: the row says how many of how many, no line is guessed", async () => {
    install({ kline_4h: candles(H4, 30) }, T0 + 30 * H4);
    setTrend({ v: 1, tfs: ["4h"], chart: true });
    wrap();
    const row = await screen.findByTestId("trend-row");
    expect(row).toHaveAttribute("data-status", "few");
    expect(within(row).getByTestId("trend-few")).toHaveTextContent("Zu wenig Kerzen (30 von 44).");
    expect(within(row).queryAllByTestId("trend-line")).toHaveLength(0);
  });

  it("the chart switch is stored; no timeframe selected says so", async () => {
    install({ kline_4h: candles(H4, 119) }, T0 + 119 * H4);
    setTrend({ v: 1, tfs: ["4h"], chart: true });
    wrap();
    await screen.findByTestId("trend-row");
    const sw = screen.getByTestId("trend-chart-switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await waitFor(() => expect(trendlinesOfSettings(useJournal.getState().settings).chart).toBe(false));
    await waitFor(() => expect(screen.getByTestId("trend-chart-switch")).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(within(screen.getByTestId("trend-tfs")).getByRole("button", { name: "4H" }));
    expect(await screen.findByTestId("trend-none")).toHaveTextContent("Keine Zeiteinheit gewählt.");
  });

  it("without a running market the rows say so instead of showing an empty picture", async () => {
    setTrend({ v: 1, tfs: ["4h"], chart: true });
    wrap();
    const row = await screen.findByTestId("trend-row");
    expect(within(row).getByTestId("trend-locked")).toHaveTextContent("Der Live-Markt läuft nicht");
  });
});
