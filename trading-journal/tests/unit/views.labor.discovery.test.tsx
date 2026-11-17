/**
 * Muster-Entdecker in the Labor: the section at the end of the page, its source switch (letzter Backtest | Journal-Trades), the
 * hand-over of a confirmed pattern to the Labor's filter comparison ("Mit diesem Filter testen") and that nothing else changes.
 * The shown run is a stub with synthetic trades on synthetic candles (the card reads trades, candles, symbol and interval).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LabResult } from "@/domain/backtest/job";
import type { BtTrade } from "@/domain/backtest/index";
import { MotionRoot } from "@/motion/MotionRoot";
import { randomBars, tradesOnBars } from "./discovery.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const { default: DiscoverySection } = await import("@/views/labor/DiscoverySection");
const { useLabor, __resetLabor } = await import("@/views/labor");
const { useExtras, __resetExtras } = await import("@/views/labor/extrasStore");

const bars = randomBars(2600, 99);
const dtrades = tradesOnBars(bars, 5, { gap: 5, effect: { where: (r) => (r.rsi as number) > 55 && (r.volRegime as number) < 1, pWin: 0.85, pBase: 0.35 } });

function stubRun(): void {
  const trades = dtrades.map((t) => ({ id: t.id, side: t.side, tag: "Test", entryTime: t.entryTime, exitTime: t.exitTime, r: t.r })) as unknown as BtTrade[];
  const result = { strategy: "custom", name: "Test-Idee", symbol: "BTCUSDT", interval: "1h", trades } as unknown as LabResult;
  useLabor.setState({ result, bars, status: "done" });
}

const wrap = () =>
  render(
    <MotionRoot>
      <DiscoverySection />
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  localStorage.clear();
  await bootFixtureJournal();
  __resetLabor();
  __resetExtras();
});
afterEach(() => {
  __resetLabor();
  __resetExtras();
});

describe("Muster-Entdecker im Labor", () => {
  it("ohne Lauf: Journal-Trades sind die Quelle, „Letzter Backtest“ ist gesperrt und sagt warum", () => {
    wrap();
    expect(screen.getByTestId("labor-discovery")).toHaveAttribute("data-source", "journal");
    expect(screen.getByText("Für „Letzter Backtest“ oben einen Lauf starten.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Letzter Backtest" })).toBeDisabled();
    // the fixture journal is small: the card names the minimum instead of computing noise
    expect(screen.getByTestId("discovery-empty")).toHaveTextContent("mindestens 80 Trades");
    expect(screen.getByTestId("discovery-start")).toBeDisabled();
  });

  it("mit einem Lauf: die Trades und Kerzen des gezeigten Laufs, mit Namen im Kopf; das Muster lässt sich als Filter testen – ohne etwas zu übernehmen", async () => {
    stubRun();
    const before = JSON.stringify(useLabor.getState().cfg);
    wrap();
    expect(screen.getByTestId("labor-discovery")).toHaveAttribute("data-source", "backtest");
    expect(screen.getByTestId("discovery-source")).toHaveTextContent("BTCUSDT 1h · Test-Idee");
    expect(screen.getByTestId("discovery-source")).toHaveTextContent(`${dtrades.length} Trades mit bekanntem R`);
    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-start"));
    });
    const result = await screen.findByTestId("discovery-result", {}, { timeout: 60_000 });
    const confirmed = within(result).getAllByTestId("discovery-finding").filter((x) => x.getAttribute("data-tier") === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    // the hand-over: the filter selection of the Labor gets the pattern and switches it on; the run itself is not started here (no shown input in
    // this stub), the card says so instead of showing a result
    const withButton = confirmed.find((x) => within(x).queryByTestId("discovery-filter-test"))!;
    expect(withButton).toBeDefined();
    await act(async () => {
      fireEvent.click(within(withButton).getByTestId("discovery-filter-test"));
    });
    const sel = useExtras.getState().selection;
    expect(sel.on).toContain("pattern");
    expect(sel.pattern?.conds.length).toBeGreaterThan(0);
    expect(sel.pattern?.label).toBeTruthy();
    await waitFor(() => expect(within(withButton).getByTestId("discovery-filter-result")).toHaveAttribute("data-status", "error"));
    expect(within(withButton).getByTestId("discovery-filter-result")).toHaveTextContent("Die Daten dieses Laufs liegen nicht mehr vor");
    // nothing of the set-up changed
    expect(JSON.stringify(useLabor.getState().cfg)).toBe(before);
    expect(useLabor.getState().result?.name).toBe("Test-Idee");
  }, 120_000);

  it("auf Journal-Trades umgeschaltet gibt es keinen Filter-Knopf (kein Backtest dahinter)", async () => {
    stubRun();
    wrap();
    fireEvent.click(screen.getByRole("radio", { name: "Journal-Trades" }));
    await waitFor(() => expect(screen.getByTestId("labor-discovery")).toHaveAttribute("data-source", "journal"));
    expect(screen.queryByTestId("discovery-filter-test")).toBeNull();
  });
});
