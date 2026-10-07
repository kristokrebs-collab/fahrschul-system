import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { aggregate } from "@/domain/agg";
import {
  bestDayShare,
  EDGE_WEIGHTS,
  edgeScore,
  edgeScoreUntil,
  edgeTimeline,
  equityDrawdown,
  recoveryFactor,
  scoreConsistency,
  scoreDrawdown,
  scorePayoff,
  scorePF,
  scoreRecovery,
  scoreWinRate,
} from "@/domain/insights";
import { closedOf, enrich, qt, settingsWith } from "./insights.fixtures";

describe("edge axes – continuous, no cliffs", () => {
  it("profit factor follows the anchors and has no jump at 1,8 or 2,6", () => {
    expect(scorePF(null)).toBe(0);
    expect(scorePF(0)).toBe(0);
    expect(scorePF(0.5)).toBe(10);
    expect(scorePF(1)).toBe(20);
    expect(scorePF(1.8)).toBeCloseTo(50, 10);
    expect(scorePF(2)).toBeCloseTo(70, 10);
    expect(scorePF(2.6)).toBe(100);
    expect(scorePF(Infinity)).toBe(100);
    expect(Math.abs(scorePF(1.8001) - scorePF(1.7999))).toBeLessThan(0.05);
    expect(Math.abs(scorePF(2.6001) - scorePF(2.5999))).toBeLessThan(0.1);
    // monotonic
    let prev = -1;
    for (let x = 0; x <= 3; x += 0.01) {
      const v = scorePF(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("payoff: only wins → 100, no wins → 0", () => {
    expect(scorePayoff({ payoff: 1.8, wins: 3, losses: 2 })).toBeCloseTo(50, 10);
    expect(scorePayoff({ payoff: null, wins: 3, losses: 0 })).toBe(100);
    expect(scorePayoff({ payoff: null, wins: 0, losses: 3 })).toBe(0);
  });
  it("drawdown relative to the peak balance", () => {
    expect(scoreDrawdown(0)).toBe(100);
    expect(scoreDrawdown(-0.1)).toBe(50);
    expect(scoreDrawdown(-0.2)).toBe(0);
    expect(scoreDrawdown(-0.5)).toBe(0);
  });
  it("win rate: 60 % = full points", () => {
    expect(scoreWinRate(0.6)).toBe(100);
    expect(scoreWinRate(0.3)).toBe(50);
    expect(scoreWinRate(0.9)).toBe(100);
    expect(scoreWinRate(null)).toBe(0);
  });
  it("recovery factor", () => {
    expect(recoveryFactor(300, { peak: 1100, trough: 1000 })).toBe(3);
    expect(recoveryFactor(300, { peak: 1000, trough: 1000 })).toBeNull();
    expect(scoreRecovery(-5, 2)).toBe(0);
    expect(scoreRecovery(10, null)).toBe(100);
    expect(scoreRecovery(10, 3.5)).toBe(100);
    expect(scoreRecovery(10, 3)).toBeCloseTo(70, 10);
    expect(Math.abs(scoreRecovery(10, 3.5001) - scoreRecovery(10, 3.4999))).toBeLessThan(0.1);
  });
  it("consistency = best-day share of the profit", () => {
    expect(bestDayShare([100, 100, 100])).toBeCloseTo(1 / 3, 10);
    expect(bestDayShare([-50, 40])).toBeNull();
    expect(scoreConsistency([100, 100, 100, 100])).toBe(100);
    expect(scoreConsistency([100, 100])).toBeCloseTo((0.5 / 0.7) * 100, 10);
    expect(scoreConsistency([100])).toBe(0);
    expect(scoreConsistency([500, -400])).toBe(0);
    expect(scoreConsistency([])).toBe(0);
  });
});

describe("edgeScore", () => {
  const s = settingsWith({ capital: { makro: 0, scalp: 1000 } });
  const list = enrich([
    qt("2026-01-05T10:00", { p: 120, risk: 40 }),
    qt("2026-01-06T10:00", { p: -40, risk: 40 }),
    qt("2026-01-07T10:00", { p: 80, risk: 40 }),
    qt("2026-01-08T10:00", { p: -60, risk: 40 }),
    qt("2026-01-09T10:00", { p: 100, risk: 40 }),
    qt("2026-02-02T10:00", { p: 20 }),
  ]);
  const view = accountView(list, s, "scalp");

  it("uses the account view's drawdown (same algorithm, same numbers)", () => {
    const eq = equityDrawdown(view.closed, view.start);
    expect(eq.maxDD).toBe(view.maxDD);
    expect(eq.dd).toEqual(view.dd);
    expect(eq.balance).toBe(view.balance);
  });
  it("score = Σ weight · axis, axes show the Hero's numbers", () => {
    const e = edgeScore(view);
    const sum = e.axes.reduce((acc, a) => acc + a.value * a.weight, 0);
    expect(e.exact).toBeCloseTo(sum, 10);
    expect(e.score).toBe(Math.round(sum));
    expect(Object.values(EDGE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const pfAxis = e.axes.find((a) => a.key === "pf")!;
    expect(pfAxis.rawValue).toBe(view.g.pf);
    expect(pfAxis.value).toBeCloseTo(scorePF(320 / 100), 10);
    expect(e.axes.find((a) => a.key === "winRate")!.value).toBeCloseTo(scoreWinRate(4 / 6), 10);
    expect(e.reliable).toBe(false);
    expect(e.n).toBe(6);
  });
  it("names the axis with the most weighted points missing", () => {
    const e = edgeScore(view);
    const gaps = e.axes.map((a) => (100 - a.value) * a.weight);
    const max = Math.max(...gaps);
    expect((100 - e.weakest!.value) * e.weakest!.weight).toBe(max);
  });
  it("empty → null score", () => {
    const e = edgeScore({ closed: [], g: aggregate([]), maxDD: 0, dd: { peak: 0, trough: 0 } });
    expect(e.score).toBeNull();
    expect(e.weakest).toBeNull();
  });
  it("score up to a date and the monthly timeline", () => {
    const jan = edgeScoreUntil(view.closed, view.start, +new Date(2026, 1, 1));
    expect(jan.n).toBe(5);
    const tl = edgeTimeline(closedOf(view.closed), view.start);
    expect(tl.map((p) => p.key)).toEqual(["2026-01", "2026-02"]);
    expect(tl[0]!.score).toBe(jan.score);
    expect(tl[1]!.score).toBe(edgeScore(view).score);
  });
});
