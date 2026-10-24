/**
 * „Muster-Entdecker“ card: honest empty states (with the minimum), the search as a button with progress and cancel, the
 * count of tests and the three stages in plain German (the rejected ones count), winning and losing patterns apart, the
 * disclaimer, and "Mit diesem Filter testen" only where a backtest can evaluate the pattern. The search runs on the main thread
 * here (`mode="idle"`, jsdom has no worker) – the same job the worker runs.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { rng } from "@/domain/analytics/stats";
import type { PatternFilterSpec } from "@/domain/discovery/spec";
import type { DiscoveryTrade, Finding } from "@/domain/discovery/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { installDomPolyfills } from "./views.overview.harness";
import { randomBars, tradesOnBars } from "./discovery.fixtures";

const { DiscoveryPanel } = await import("@/views/discovery/DiscoveryPanel");
type Props = Parameters<typeof DiscoveryPanel>[0];

const wrap = (p: Props) =>
  render(
    <MotionRoot>
      <DiscoveryPanel mode="idle" {...p} />
    </MotionRoot>,
  );

/** Journal-like trades without candles: the clock, the loss history and two journal fields. FOMO + "Ausbruch" loses, the rest is a coin flip. */
function journalTrades(n: number, seed: number, effect: boolean): DiscoveryTrade[] {
  const r = rng(seed);
  const emo = ["Ruhig", "FOMO", "Unsicher"];
  const setups = ["Ausbruch", "Retest", "Range"];
  return Array.from({ length: n }, (_, i) => {
    const emotion = emo[Math.floor(r() * 3)]!;
    const setup = setups[Math.floor(r() * 3)]!;
    const bad = effect && emotion === "FOMO" && setup === "Ausbruch";
    const win = r() < (bad ? 0.04 : 0.5);
    return { id: `j${i}`, entryTime: 1_700_000_000_000 + i * 3 * 3_600_000, exitTime: 1_700_000_000_000 + i * 3 * 3_600_000 + 3_000_000, side: r() < 0.5 ? ("long" as const) : ("short" as const), r: win ? 1.2 : -1, emotion, setup };
  });
}

beforeAll(() => installDomPolyfills());

describe("empty states", () => {
  it("no trades: says so, the start button is off, the disclaimer stays", () => {
    wrap({ trades: [] });
    expect(screen.getByTestId("discovery-panel")).toHaveAttribute("data-status", "idle");
    expect(screen.getByTestId("discovery-source")).toHaveTextContent("Noch nichts zu prüfen");
    expect(screen.getByTestId("discovery-start")).toBeDisabled();
    expect(screen.getByTestId("discovery-disclaimer")).toHaveTextContent("Beobachtung, keine Ursache; kein Versprechen für die Zukunft. Keine professionelle Finanzberatung.");
  });

  it("too few trades: names the minimum and the actual number, nothing is computed", () => {
    wrap({ trades: journalTrades(50, 1, false) });
    expect(screen.getByTestId("discovery-empty")).toHaveTextContent("mindestens 80 Trades mit bekanntem R – hier sind es 50");
    expect(screen.getByTestId("discovery-start")).toBeDisabled();
    expect(screen.queryByTestId("discovery-result")).toBeNull();
  });

  it("trades without a known R do not count towards the minimum", () => {
    const trades = [...journalTrades(60, 2, false), ...journalTrades(40, 3, false).map((t, i) => ({ ...t, id: `n${i}`, r: null }))];
    wrap({ trades });
    expect(screen.getByTestId("discovery-source")).toHaveTextContent("60 von 100 Trades haben ein bekanntes R");
    expect(screen.getByTestId("discovery-empty")).toHaveTextContent("hier sind es 60");
  });
});

describe("the search", () => {
  const trades = journalTrades(420, 7, true);

  it("runs on request with progress, then names the number of tests, the stages and the seed; winning and losing patterns are apart", async () => {
    wrap({ trades, source: "journal", label: "Journal" });
    expect(screen.getByTestId("discovery-seed")).toHaveTextContent("Seed): 20260424");
    fireEvent.click(screen.getByTestId("discovery-start"));
    expect(screen.getByTestId("discovery-panel")).toHaveAttribute("data-status", "running");
    const bar = screen.getByRole("progressbar", { name: "Fortschritt der Suche" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(screen.getByTestId("discovery-cancel")).toBeInTheDocument();
    const result = await screen.findByTestId("discovery-result", {}, { timeout: 30_000 });
    expect(screen.getByTestId("discovery-panel")).toHaveAttribute("data-status", "done");
    // the count line: how many were checked, how many held
    expect(screen.getByTestId("discovery-counts").textContent).toMatch(/^Ich habe [\d.]+ Zusammenhänge geprüft, (keiner hält stand|1 hält stand|\d+ halten stand)\.$/);
    const breakdown = screen.getByTestId("discovery-breakdown").textContent!;
    expect(breakdown).toMatch(/\d+ bestätigt · \d+ Hinweise? · [\d.]+ verworfen \(Zufall\)/);
    // the planted losing pattern is confirmed and sits under "Verlust-Muster", not under "Gewinn-Muster"
    const loss = within(result).getByTestId("discovery-group-loss");
    const confirmedLoss = within(loss).getAllByTestId("discovery-finding").filter((x) => x.getAttribute("data-tier") === "confirmed");
    expect(confirmedLoss.length).toBeGreaterThan(0);
    expect(confirmedLoss.some((x) => /Emotion FOMO/.test(x.textContent!) && /Setup „Ausbruch“/.test(x.textContent!))).toBe(true);
    const f = confirmedLoss.find((x) => /Emotion FOMO/.test(x.textContent!) && /Setup „Ausbruch“/.test(x.textContent!))!;
    expect(within(f).getByTestId("discovery-finding-text").textContent).toMatch(/^Wenn Setup „Ausbruch“ UND Emotion FOMO: nur \d+ % Treffer statt \d+ % \(n=\d+, bestätigt\)$/);
    expect(within(f).getByText("bestätigt")).toBeInTheDocument();
    expect(within(f).getByTestId("discovery-blocks")).toHaveAccessibleName(/Zeitabschnitt 1: gleiche Richtung/);
    // the method line shows the split and the permutations
    expect(screen.getByTestId("discovery-method-line").textContent).toMatch(/Suche an den älteren 252 Trades, Bestätigung an den neueren 168\./);
    expect(screen.getByTestId("discovery-stand").textContent).toMatch(/^Stand: gerechnet am \d\d\.\d\d\.\d{4} \d\d:\d\d · Trades von \d\d\.\d\d\.\d{4} bis \d\d\.\d\d\.\d{4} · Quelle: dein Journal\. Zahlen aus einer deterministischen Rechnung, kein Sprachmodell\.$/);
    expect(screen.getByTestId("discovery-disclaimer")).toBeVisible();
  }, 60_000);

  it("a journal pattern cannot become a backtest filter: no button, the reason is written", async () => {
    const onTest = vi.fn();
    wrap({ trades, source: "journal", onTestFilter: onTest });
    fireEvent.click(screen.getByTestId("discovery-start"));
    const loss = await within(await screen.findByTestId("discovery-result", {}, { timeout: 30_000 })).findByTestId("discovery-group-loss");
    expect(within(loss).queryByTestId("discovery-filter-test")).toBeNull();
    expect(within(loss).getAllByTestId("discovery-filter-why")[0]).toHaveTextContent(/Journal/);
    expect(onTest).not.toHaveBeenCalled();
  }, 60_000);

  it("pure noise: 'nichts hält stand' is said plainly, the rejected ones are counted and can be opened", async () => {
    wrap({ trades: journalTrades(300, 11, false) });
    fireEvent.click(screen.getByTestId("discovery-start"));
    await screen.findByTestId("discovery-result", {}, { timeout: 30_000 });
    expect(screen.getByTestId("discovery-none")).toHaveTextContent(/Nichts hält gegen den Zufall stand|nur Hinweise/);
    const toggle = screen.getByTestId("discovery-rejected-toggle");
    expect(toggle.textContent).toMatch(/Verworfen \(Zufall\) · [\d.]+/);
    fireEvent.click(toggle);
    const list = await screen.findAllByTestId("discovery-finding");
    expect(list.some((x) => x.getAttribute("data-tier") === "rejected")).toBe(true);
    expect(within(list.find((x) => x.getAttribute("data-tier") === "rejected")!).getByTestId("discovery-reasons")).toHaveTextContent(/Zufall|Gegenrichtung/);
  }, 60_000);

  it("stops on request and changes nothing", async () => {
    wrap({ trades });
    fireEvent.click(screen.getByTestId("discovery-start"));
    fireEvent.click(screen.getByTestId("discovery-cancel"));
    await waitFor(() => expect(screen.getByTestId("discovery-panel")).toHaveAttribute("data-status", "cancelled"));
    expect(screen.getByTestId("discovery-error")).toHaveTextContent("Abgebrochen. Es wurde nichts verändert.");
    expect(screen.queryByTestId("discovery-result")).toBeNull();
    expect(screen.getByTestId("discovery-start")).toBeEnabled();
  }, 60_000);

  it("when the data change, the old result is not shown as if it described the new data", async () => {
    function Host() {
      const [t, setT] = useState(trades);
      return (
        <>
          <button onClick={() => setT(journalTrades(420, 99, false))}>swap</button>
          <DiscoveryPanel mode="idle" trades={t} />
        </>
      );
    }
    render(
      <MotionRoot>
        <Host />
      </MotionRoot>,
    );
    fireEvent.click(screen.getByTestId("discovery-start"));
    await screen.findByTestId("discovery-result", {}, { timeout: 30_000 });
    act(() => fireEvent.click(screen.getByText("swap")));
    expect(screen.queryByTestId("discovery-result")).toBeNull();
    expect(screen.getByTestId("discovery-outdated")).toBeInTheDocument();
  }, 60_000);
});

describe("Mit diesem Filter testen", () => {
  // trades on candles: the outcome follows RSI and the volatility regime of the signal candle
  const bars = randomBars(2600, 99);
  const trades = tradesOnBars(bars, 5, { gap: 5, effect: { where: (r) => (r.rsi as number) > 55 && (r.volRegime as number) < 1, pWin: 0.85, pBase: 0.35 } });

  it("a confirmed candle pattern offers the test; the click hands a plain description to the host, which shows its result under the finding", async () => {
    const onTest = vi.fn<(spec: PatternFilterSpec, f: Finding) => void>();
    const view = wrap({ trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest", label: "Test", seed: 5, onTestFilter: onTest });
    fireEvent.click(screen.getByTestId("discovery-start"));
    const result = await screen.findByTestId("discovery-result", {}, { timeout: 30_000 });
    const buttons = within(result).getAllByTestId("discovery-filter-test");
    expect(buttons.length).toBeGreaterThan(0);
    const card = buttons[0]!.closest("[data-testid='discovery-finding']") as HTMLElement;
    expect(card.getAttribute("data-tier")).toBe("confirmed");
    fireEvent.click(buttons[0]!);
    expect(onTest).toHaveBeenCalledTimes(1);
    const [spec, finding] = onTest.mock.calls[0]!;
    expect(spec.v).toBe(1);
    expect(spec.conds.length).toBeGreaterThan(0);
    expect(spec.label).toBe(card.querySelector("[data-testid='discovery-finding-text']")!.textContent!.replace(/^Wenn /, "").replace(/: .*$/, ""));
    expect(finding.id).toBe(card.getAttribute("data-id"));
    // the host reports back: the text appears under exactly that finding
    view.rerender(
      <MotionRoot>
        <DiscoveryPanel mode="idle" trades={trades} markets={{ "": { intervalSec: 3600, bars } }} source="backtest" label="Test" seed={5} onTestFilter={onTest} filterTest={{ id: finding.id, status: "done", text: "Ohne Filter: 10 Trades. Mit dem Muster: 4 Trades." }} />
      </MotionRoot>,
    );
    expect(within(card).getByTestId("discovery-filter-result")).toHaveTextContent("Mit dem Muster: 4 Trades.");
  }, 60_000);

  it("without a host hook there is no button at all", async () => {
    wrap({ trades, markets: { "": { intervalSec: 3600, bars } }, source: "backtest", seed: 5 });
    fireEvent.click(screen.getByTestId("discovery-start"));
    await screen.findByTestId("discovery-result", {}, { timeout: 30_000 });
    expect(screen.queryByTestId("discovery-filter-test")).toBeNull();
  }, 60_000);
});
