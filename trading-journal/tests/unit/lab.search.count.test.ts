/**
 * (d) Der Zähler ist kein Anstrich: die Engine des Backtest-Labors läuft wirklich 1.000-mal im Training und 1.000-mal im Endtest
 * (der Sieger genau einmal) – gezählt am Aufruf von `runBacktest`, nicht am Ergebnis.
 */
import { describe, expect, it, vi } from "vitest";

const calls: { from: number | undefined; to: number | undefined; bars: number }[] = [];
vi.mock("@/domain/backtest/engine", async (orig) => {
  const m = await orig<typeof import("@/domain/backtest/engine")>();
  return {
    ...m,
    runBacktest: (...a: Parameters<typeof m.runBacktest>) => {
      calls.push({ from: a[3].from, to: a[3].to, bars: a[0].length });
      return m.runBacktest(...a);
    },
  };
});

const { runSearchSync } = await import("@/domain/lab/search");
const { market, searchInput } = await import("./search.helpers");

describe("(d) alle 1.000 Varianten werden wirklich gerechnet", () => {
  it("2.000 Engine-Läufe: 1.000 auf den ersten 80 % (mit gekürzten Kerzen), 1.000 auf den letzten 20 %", () => {
    calls.length = 0;
    const bars = market(2400, 9, { edge: { lookback: 20, hold: 4, drift: 1 } });
    const r = runSearchSync(searchInput(bars, 7));
    expect(calls).toHaveLength(2000);
    const cut = bars.findIndex((b) => b.t * 1000 === r.datasets[0]!.cutT);
    const training = calls.filter((c) => c.to === cut - 1);
    const endtest = calls.filter((c) => c.from === cut);
    expect(training).toHaveLength(1000);
    expect(endtest).toHaveLength(1000);
    // das Training sieht die Kerzen des Endtests nicht einmal
    expect(training.every((c) => c.bars === cut)).toBe(true);
    expect(endtest.every((c) => c.bars === bars.length)).toBe(true);
    expect(r.counts).toMatchObject({ variants: 1000, isRuns: 1000, oosRuns: 1000, winnerOosRuns: 1 });
    // der Endtest-Lauf der Siegervariante steht vor den Läufen der übrigen: erst festlegen, dann prüfen
    const firstEnd = calls.findIndex((c) => c.from === cut);
    expect(calls.slice(0, firstEnd).every((c) => c.to === cut - 1)).toBe(true);
    expect(firstEnd).toBe(1000);
  });
});
