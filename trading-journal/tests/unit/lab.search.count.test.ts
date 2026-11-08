/**
 * (d) Der Zähler ist kein Anstrich: die Engine des Backtest-Labors läuft wirklich 3.000-mal im Training (1.000 Varianten × 3 Stop-Führungen)
 * und 1.002-mal im Endtest (der Sieger genau einmal und zuerst, danach seine zwei anderen Stop-Führungen zum Vergleich, dann die übrigen 999)
 * – gezählt am Aufruf von `runBacktest`, nicht am Ergebnis.
 */
import { describe, expect, it, vi } from "vitest";

const calls: { from: number | undefined; to: number | undefined; bars: number; manage: string }[] = [];
vi.mock("@/domain/backtest/engine", async (orig) => {
  const m = await orig<typeof import("@/domain/backtest/engine")>();
  return {
    ...m,
    runBacktest: (...a: Parameters<typeof m.runBacktest>) => {
      // welche Stop-Führung der Lauf trägt: am ersten Signal der Strategie abgelesen (fest = keine Führung)
      let manage = "?";
      for (let i = a[1].start; i < a[0].length && manage === "?"; i++) {
        const s = a[1].signalAt(i);
        if (s) manage = s.manage?.trail ? "trail" : s.manage?.breakEven ? "be" : "fixed";
      }
      calls.push({ from: a[3].from, to: a[3].to, bars: a[0].length, manage });
      return m.runBacktest(...a);
    },
  };
});

const { runSearchSync } = await import("@/domain/lab/search");
const { market, searchInput } = await import("./search.helpers");

describe("(d) alle 1.000 Varianten werden wirklich gerechnet – je mit drei Stop-Führungen", () => {
  it("4.002 Engine-Läufe: 3.000 auf den ersten 80 % (mit gekürzten Kerzen), 1.002 auf den letzten 20 %", () => {
    calls.length = 0;
    const bars = market(2400, 9, { edge: { lookback: 20, hold: 4, drift: 1 } });
    const r = runSearchSync(searchInput(bars, 7));
    expect(calls).toHaveLength(4002);
    const cut = bars.findIndex((b) => b.t * 1000 === r.datasets[0]!.cutT);
    const training = calls.filter((c) => c.to === cut - 1);
    const endtest = calls.filter((c) => c.from === cut);
    expect(training).toHaveLength(3000);
    expect(endtest).toHaveLength(1002);
    // jede Variante dreimal im Training: fest, Einstand, Nachziehen (je 1.000 – Varianten ohne ein einziges Signal zählen als „?“)
    const by = (m: string) => training.filter((c) => c.manage === m).length;
    expect(by("?") % 3).toBe(0);
    expect(by("fixed") + by("?") / 3).toBe(1000);
    expect(by("trail")).toBe(by("be"));
    expect(by("fixed")).toBe(by("be"));
    // das Training sieht die Kerzen des Endtests nicht einmal
    expect(training.every((c) => c.bars === cut)).toBe(true);
    expect(endtest.every((c) => c.bars === bars.length)).toBe(true);
    expect(r.counts).toMatchObject({ variants: 1000, stopRules: 3, candidates: 3000, isRuns: 3000, oosRuns: 1002, winnerOosRuns: 1, compareRuns: 2 });
    // der Endtest-Lauf des Siegers steht vor allen anderen: erst festlegen, dann prüfen – mit SEINER Stop-Führung
    const firstEnd = calls.findIndex((c) => c.from === cut);
    expect(calls.slice(0, firstEnd).every((c) => c.to === cut - 1)).toBe(true);
    expect(firstEnd).toBe(3000);
    expect(calls[3000]!.manage).toBe(r.winner!.stop);
    // danach die zwei anderen Stop-Führungen desselben Einstiegs (Vergleich), dann die übrigen 999
    expect(new Set([calls[3000]!.manage, calls[3001]!.manage, calls[3002]!.manage])).toEqual(new Set(["fixed", "be", "trail"]));
    // die Mehrfachtest-Korrektur zählt alle 3.000 Kandidaten
    expect(r.deflation!.trials).toBe(3000);
  });
});
