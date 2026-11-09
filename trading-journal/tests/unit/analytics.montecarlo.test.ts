/**
 * P03 Monte Carlo + risk of ruin (`montecarlo.ts`) and the runner (`mcRunner.ts`): seeded determinism, band order
 * and length, reshuffle invariants, drawdown / ruin / streak statistics, the analytic ruin formula against the
 * simulation, and the idle-chunk runner producing the very same result as the synchronous engine.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  BAND_PS,
  createMonteCarlo,
  ddProbability,
  ddQuantile,
  monteCarlo,
  riskOfRuin,
  ruinAnalytic,
  ruinSimulated,
  runMonteCarlo,
  runRiskOfRuin,
} from "@/domain/analytics";
import { __resetMcRunner } from "@/domain/analytics/mcRunner";

const SAMPLE = [2.1, -1, -1, 1.5, -1, 3.2, -0.5, -1, 0.8, 2.4, -1, -1.2, 1.1, -1, 2.9];

describe("monteCarlo", () => {
  it("is deterministic for a seed and differs for another", () => {
    const a = monteCarlo(SAMPLE, { runs: 300, horizon: 40, seed: 5, keepPaths: 3 });
    const b = monteCarlo(SAMPLE, { runs: 300, horizon: 40, seed: 5, keepPaths: 3 });
    expect(a).toEqual(b);
    const c = monteCarlo(SAMPLE, { runs: 300, horizon: 40, seed: 6 });
    expect(c.final!.p50).not.toBe(a.final!.p50);
  });

  it("bands: p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every step, horizon + 1 values, start at `start`", () => {
    const r = monteCarlo(SAMPLE, { runs: 500, horizon: 60, seed: 1, start: 100 });
    expect(r.bands.map((b) => b.p)).toEqual([...BAND_PS]);
    for (const b of r.bands) {
      expect(b.values).toHaveLength(61);
      expect(b.values[0]).toBe(100);
    }
    for (let s = 0; s <= 60; s++) {
      for (let k = 1; k < r.bands.length; k++) expect(r.bands[k]!.values[s]!).toBeGreaterThanOrEqual(r.bands[k - 1]!.values[s]!);
    }
    const f = r.final!;
    expect(f.p5).toBeLessThanOrEqual(f.p25);
    expect(f.p75).toBeLessThanOrEqual(f.p95);
    // drift: the mean of the sample × horizon
    const mean = SAMPLE.reduce((a, b) => a + b, 0) / SAMPLE.length;
    expect(f.mean - 100).toBeCloseTo(mean * 60, -1);
    expect(r.maxDD).toHaveLength(500);
    expect([...r.maxDD].sort((x, y) => x - y)).toEqual(r.maxDD);
  });

  it("reshuffle: every path ends at the sample's sum; only the order (and so the drawdown) differs", () => {
    const sum = SAMPLE.reduce((a, b) => a + b, 0);
    const r = monteCarlo(SAMPLE, { runs: 200, method: "reshuffle", seed: 9 });
    expect(r.horizon).toBe(SAMPLE.length);
    expect(r.final!.p5).toBeCloseTo(sum, 10);
    expect(r.final!.p95).toBeCloseTo(sum, 10);
    expect(r.maxDD[0]).toBeLessThan(r.maxDD[r.maxDD.length - 1]!);
  });

  it("drawdown probabilities, ruin share and longest losing run", () => {
    const all = monteCarlo([1, 2, 3], { runs: 50, horizon: 20, ddThresholds: [0.5], ruinAt: 1 });
    expect(all.maxDD.every((d) => d === 0)).toBe(true);
    expect(all.ddProb).toEqual([{ x: 0.5, p: 0 }]);
    expect(all.ruin).toBe(0);
    expect(all.longestLoss).toEqual({ p50: 0, p95: 0 });
    const losing = monteCarlo([-1], { runs: 10, horizon: 8, ruinAt: 5, ddThresholds: [8, 9] });
    expect(losing.ruin).toBe(1);
    expect(losing.longestLoss).toEqual({ p50: 8, p95: 8 });
    expect(losing.ddProb).toEqual([
      { x: 8, p: 1 },
      { x: 9, p: 0 },
    ]);
    const r = monteCarlo(SAMPLE, { runs: 400, horizon: 50, seed: 2 });
    expect(ddProbability(r, 0)).toBe(1);
    expect(ddProbability(r, ddQuantile(r, 0.5)!)).toBeGreaterThanOrEqual(0.5);
    expect(ddProbability(r, 1e9)).toBe(0);
  });

  it("keeps the first `keepPaths` paths and returns the empty contract shape for an empty sample", () => {
    const r = monteCarlo(SAMPLE, { runs: 30, horizon: 10, keepPaths: 120 });
    expect(r.paths).toHaveLength(30);
    expect(r.paths[0]).toHaveLength(11);
    const empty = monteCarlo([], { seed: 7, ddThresholds: [5] });
    expect(empty).toMatchObject({ runs: 0, seed: 7, method: "bootstrap", final: null, ruin: null, bands: [], paths: [] });
  });

  it("the stepped engine equals the one-shot run", () => {
    const e = createMonteCarlo(SAMPLE, { runs: 250, horizon: 30, seed: 4 });
    let guard = 0;
    while (!e.step(17) && guard++ < 100);
    expect(e.done).toBe(250);
    expect(e.result()).toEqual(monteCarlo(SAMPLE, { runs: 250, horizon: 30, seed: 4 }));
  });

  it("caps the stored band paths for huge horizons but keeps every path for finals / drawdowns", () => {
    const r = monteCarlo(SAMPLE, { runs: 400, horizon: 12_000, seed: 3 });
    expect(r.runs).toBe(400);
    expect(r.maxDD).toHaveLength(400);
    expect(r.bands[0]!.values).toHaveLength(12_001);
  });
});

describe("risk of ruin", () => {
  it("analytic: certain without positive log drift, small with a real edge, rising with the risk per trade", () => {
    // 50 % / 1:1 has a negative log drift (volatility drag) → ruin in the long run
    expect(ruinAnalytic(0.5, 1, 0.02)).toBe(1);
    const small = ruinAnalytic(0.5, 2, 0.01)!;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.001);
    const big = ruinAnalytic(0.5, 2, 0.1)!;
    expect(big).toBeGreaterThan(small);
    expect(ruinAnalytic(0.5, 2, 0.1, 0.3)!).toBeGreaterThan(big);
    expect(ruinAnalytic(1, 2, 0.1)).toBe(0);
    expect(ruinAnalytic(0.5, 0, 0.1)).toBeNull();
    expect(ruinAnalytic(0.5, 2, 1)).toBeNull();
  });

  it("analytic ≈ long simulation (Cramér-Lundberg bound)", () => {
    const input = { winRate: 0.45, payoff: 1.6, riskPerTrade: 0.05, ruinAt: 0.5 };
    const a = ruinAnalytic(input.winRate, input.payoff, input.riskPerTrade, input.ruinAt)!;
    const s = ruinSimulated(input, { runs: 3000, trades: 3000, seed: 11 })!;
    expect(a).toBeGreaterThan(0.05);
    expect(Math.abs(a - s)).toBeLessThan(0.08);
    // the bound is an upper bound (overshoot of the up-steps)
    expect(s).toBeLessThanOrEqual(a + 0.03);
  });

  it("simulates from the trader's own R multiples when a sample is given; keeps the contract's edgeR", () => {
    const r = riskOfRuin({ winRate: 0.5, payoff: 2, riskPerTrade: 0.01 });
    expect(r.edgeR).toBeCloseTo(0.5);
    expect(r.analytic).not.toBeNull();
    expect(r.simulated).toBe(0);
    const losing = riskOfRuin({ winRate: 0.3, payoff: 1, riskPerTrade: 0.05, sample: [-1, -1, -1, 0.5] }, { runs: 200, trades: 200 });
    expect(losing.simulated).toBe(1);
    expect(riskOfRuin({ winRate: 0.5, payoff: 2, riskPerTrade: 0.01 }, { runs: 0 }).simulated).toBeNull();
  });
});

describe("runner (idle chunks – jsdom has no Worker)", () => {
  afterEach(() => __resetMcRunner());

  it("returns exactly the synchronous result", async () => {
    const opts = { runs: 300, horizon: 25, seed: 8, keepPaths: 5 };
    const res = await runMonteCarlo(SAMPLE, opts);
    expect(res).toEqual(monteCarlo(SAMPLE, opts));
    const ror = await runRiskOfRuin({ winRate: 0.5, payoff: 2, riskPerTrade: 0.02 }, { runs: 300, trades: 200 });
    expect(ror).toEqual(riskOfRuin({ winRate: 0.5, payoff: 2, riskPerTrade: 0.02 }, { runs: 300, trades: 200 }));
  });

  it("aborts", async () => {
    const ctl = new AbortController();
    const p = runMonteCarlo(SAMPLE, { runs: 5000, horizon: 400 }, { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const pre = new AbortController();
    pre.abort();
    await expect(runMonteCarlo(SAMPLE, {}, { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
