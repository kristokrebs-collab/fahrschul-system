import { describe, expect, it } from "vitest";
import { bestTrial, combinations, deflatedSharpe, expectedMaxSharpe, oosSplit, paramHeat, pboOf, robustness, scoreOf, trialOf, wfLayout, summarizeWf, type BtTrade, type ParamSpec, type WfWindow } from "@/domain/backtest/index";
import { rng } from "@/domain/analytics/stats";

const trade = (r: number, exitIndex = 0): BtTrade => ({
  id: `t${exitIndex}-${r}`,
  side: "long",
  tag: "T",
  entryIndex: exitIndex,
  exitIndex,
  entryTime: 0,
  exitTime: 0,
  entry: 100,
  exit: 100 + r,
  stop: 99,
  target: null,
  qty: 1,
  notional: 100,
  pnl: r,
  fees: 0,
  funding: 0,
  slippage: 0,
  r,
  move: r / 100,
  bars: 1,
  reason: "time",
});

describe("Deflated Sharpe", () => {
  it("die Glücksschwelle wächst mit der Zahl der Versuche", () => {
    expect(expectedMaxSharpe(0.04, 1)).toBe(0);
    expect(expectedMaxSharpe(0.04, 10)).toBeGreaterThan(0);
    expect(expectedMaxSharpe(0.04, 100)).toBeGreaterThan(expectedMaxSharpe(0.04, 10));
  });
  it("ein klarer Vorteil bleibt, ein schwacher unter vielen Versuchen nicht", () => {
    const r = rng(7);
    const strong = Array.from({ length: 80 }, () => 0.6 + (r() - 0.5));
    const weak = Array.from({ length: 30 }, () => 0.05 + (r() - 0.5) * 2);
    const manyTrials = Array.from({ length: 40 }, () => (r() - 0.5) * 0.8);
    expect(deflatedSharpe(strong, [0.1, 0.2, 0.3])!.dsr).toBeGreaterThan(0.95);
    expect(deflatedSharpe(weak, manyTrials)!.dsr).toBeLessThan(0.5);
    expect(deflatedSharpe([1, 2], [])).toBeNull();
  });
});

describe("PBO (CSCV)", () => {
  it("C(8,4) = 70 Aufteilungen", () => {
    expect(combinations(8, 4)).toHaveLength(70);
    expect(combinations(4, 2)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
  it("ein durchgehend bester Parametersatz hat ein kleines PBO, reines Rauschen um 50 %", () => {
    const r = rng(11);
    const S = 8;
    const block = (t: BtTrade) => t.exitIndex % S;
    const good = { trades: Array.from({ length: 80 }, (_, i) => trade(0.8 + (r() - 0.5) * 0.2, i)) };
    const others = Array.from({ length: 9 }, () => ({ trades: Array.from({ length: 80 }, (_, i) => trade((r() - 0.5) * 2, i)) }));
    const p = pboOf([good, ...others], block)!;
    expect(p.splits).toBe(70);
    expect(p.pbo).toBeLessThan(0.1);
    const noise = Array.from({ length: 12 }, () => ({ trades: Array.from({ length: 80 }, (_, i) => trade((r() - 0.5) * 2, i)) }));
    const pn = pboOf(noise, block)!;
    expect(pn.pbo).toBeGreaterThan(0.2);
    expect(pn.pbo).toBeLessThan(0.85);
    expect(pboOf([good], block)).toBeNull();
    expect(pboOf([{ trades: [trade(1, 1)] }, { trades: [] }], block)).toBeNull();
  });
});

describe("Parameter-Heatmap und Urteil", () => {
  const specs: ParamSpec[] = [
    { key: "a", label: "A", options: [1, 2, 3], format: String, grid: true },
    { key: "b", label: "B", options: [1, 2], format: String, grid: true },
    { key: "c", label: "C", options: [1], format: String, grid: false },
  ];
  it("legt die Zellen über die ersten zwei Gitter-Parameter und misst die Stabilität", () => {
    const trials = [];
    for (const a of [1, 2, 3]) for (const b of [1, 2]) trials.push(trialOf({ a, b, c: 1 }, Array.from({ length: 6 }, (_, i) => trade(a === 2 && b === 2 ? 1 : 0.5 + i * 0.01, i))));
    const h = paramHeat(specs, trials, { a: 2, b: 2, c: 1 })!;
    expect(h.cells).toHaveLength(6);
    expect(h.best).toMatchObject({ rowValue: 2, colValue: 2, chosen: true });
    expect(h.stability).toBeGreaterThan(0.4);
    expect(h.stability).toBeLessThan(0.6);
  });
  it("urteilt robust / überangepasst / zu wenig", () => {
    expect(robustness({ trades: 10, dsr: 0.99, pbo: 0.1, isMeanR: 1, oosMeanR: 1, wfe: 1, wfMeanR: 1 }).verdict).toBe("wenig");
    expect(robustness({ trades: 60, dsr: 0.97, pbo: 0.1, isMeanR: 0.5, oosMeanR: 0.4, wfe: 0.8, wfMeanR: 0.3 }).verdict).toBe("robust");
    const bad = robustness({ trades: 60, dsr: 0.2, pbo: 0.7, isMeanR: 0.8, oosMeanR: -0.3, wfe: -1, wfMeanR: -0.2 });
    expect(bad.verdict).toBe("overfit");
    expect(bad.reasons[0]!.ok).toBe(false);
  });
});

describe("Optimierung, OOS und Walk-forward", () => {
  it("bewertet Parametersätze erst ab 5 Trades und bevorzugt stetige Ergebnisse", () => {
    expect(scoreOf([trade(5), trade(5)])).toBe(-Infinity);
    const steady = trialOf({ k: 1 }, Array.from({ length: 20 }, (_, i) => trade(0.5 + (i % 2) * 0.1, i)));
    const lucky = trialOf({ k: 2 }, [trade(10, 0), trade(-1, 1), trade(-1, 2), trade(-1, 3), trade(-1, 4)]);
    expect(bestTrial([lucky, steady])!.params).toEqual({ k: 1 });
    expect(bestTrial([trialOf({ k: 3 }, [])])).toBeNull();
  });
  it("teilt 70/30 und legt Walk-forward-Fenster ohne Überlappung an", () => {
    expect(oosSplit(0, 99)).toEqual({ is: { from: 0, to: 69 }, oos: { from: 70, to: 99 } });
    expect(oosSplit(0, 10)).toBeNull();
    const w = wfLayout(100, 799, 5, 2)!;
    expect(w).toHaveLength(5);
    for (let k = 0; k < 5; k++) {
      expect(w[k]!.train.to + 1).toBe(w[k]!.test.from);
      if (k) expect(w[k]!.test.from).toBe(w[k - 1]!.test.to + 1);
    }
    expect(w[4]!.test.to).toBe(799);
    expect(wfLayout(0, 40, 5)).toBeNull();
  });
  it("fasst die Testfenster zusammen (Effizienz = OOS ÷ In-Sample)", () => {
    const win = (trainMeanR: number, rs: number[]): WfWindow => ({ index: 0, train: { from: 0, to: 1 }, test: { from: 2, to: 3 }, trainFrom: 0, testFrom: 0, testTo: 0, best: { k: 1 }, trainMeanR, trainN: 10, testTrades: rs.map((r, i) => trade(r, i)), testMeanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, testSumR: rs.reduce((a, b) => a + b, 0) });
    const s = summarizeWf([win(1, [0.5, 0.5]), win(1, [-0.5, 1.5])]);
    expect(s.oos).toHaveLength(4);
    expect(s.oosMeanR).toBeCloseTo(0.5, 9);
    expect(s.efficiency).toBeCloseTo(0.5, 9);
    expect(s.positiveShare).toBe(1);
    expect(summarizeWf([win(-0.2, [0.1])]).efficiency).toBeNull();
  });
});
