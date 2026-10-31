/**
 * Analytics contract (`src/domain/analytics`, Wave 0): streak statistics and the expected longest losing streak are
 * real; Monte Carlo / risk of ruin keep their result shapes.
 */
import { describe, expect, it } from "vitest";
import { expectedLongestLosingStreak, monteCarlo, riskOfRuin, streaks } from "@/domain/analytics";

describe("streaks", () => {
  it("longest runs, histograms, current run and conditional win rates", () => {
    const s = streaks(["win", "win", "loss", "open", "loss", "loss", "be", "win", "loss", "win", "win", "win"]);
    expect(s.n).toBe(11);
    expect(s.longestWin).toBe(3);
    expect(s.longestLoss).toBe(3);
    expect(s.current).toEqual({ kind: "win", length: 3 });
    expect(s.winRuns).toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(s.lossRuns).toEqual({ 1: 1, 3: 1 });
    // after a win: win, loss, loss, win, win → 3 / 5; after a loss: loss, loss, be, win → 1 / 4
    expect(s.pWinAfterWin).toBeCloseTo(3 / 5);
    expect(s.pWinAfterLoss).toBeCloseTo(1 / 4);
  });

  it("a break-even ends the current streak; empty input", () => {
    expect(streaks(["loss", "loss", "be"]).current).toEqual({ kind: null, length: 0 });
    expect(streaks([])).toEqual({ n: 0, longestWin: 0, longestLoss: 0, current: { kind: null, length: 0 }, winRuns: {}, lossRuns: {}, pWinAfterWin: null, pWinAfterLoss: null });
  });
});

describe("expectedLongestLosingStreak", () => {
  it("matches the known coin-flip value and behaves at the edges", () => {
    expect(expectedLongestLosingStreak(0.5, 100)).toBeCloseTo(5.97, 1);
    expect(expectedLongestLosingStreak(0.6, 200)).toBeLessThan(expectedLongestLosingStreak(0.4, 200));
    expect(expectedLongestLosingStreak(0.5, 1000)).toBeGreaterThan(expectedLongestLosingStreak(0.5, 100));
    expect(expectedLongestLosingStreak(1, 50)).toBe(0);
    expect(expectedLongestLosingStreak(0, 50)).toBe(50);
    expect(expectedLongestLosingStreak(0.5, 0)).toBe(0);
  });
});

describe("Monte Carlo / risk of ruin shapes", () => {
  it("return the documented fields", () => {
    const mc = monteCarlo([], { seed: 7, ddThresholds: [5] });
    expect(mc).toMatchObject({ seed: 7, method: "bootstrap", final: null, ruin: null });
    expect(mc.ddProb.map((d) => d.x)).toEqual([5]);
    const ror = riskOfRuin({ winRate: 0.5, payoff: 2, riskPerTrade: 0.01 });
    expect(ror.edgeR).toBeCloseTo(0.5);
    expect(ror).toHaveProperty("analytic");
    expect(ror).toHaveProperty("simulated");
  });
});
