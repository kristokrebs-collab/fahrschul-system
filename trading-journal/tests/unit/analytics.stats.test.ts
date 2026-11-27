/**
 * P03 statistics core (`src/domain/analytics/stats.ts`): moments, type-7 quantiles, the normal / t distributions,
 * t-tests and intervals, proportions, the seeded bootstrap, Benjamini-Hochberg and the sample-size estimates –
 * against textbook / SciPy reference values.
 */
import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg,
  bootstrapCI,
  CI_LEVEL,
  downsideDeviation,
  kurtosis,
  mad,
  meanCI,
  normCdf,
  normQuantile,
  proportionDiff,
  quantile,
  rng,
  sd,
  significanceOf,
  skewness,
  tCdf,
  tQuantile,
  tradesForEdge,
  tradesForWinRate,
  tTest,
  welch,
  wilson,
  wilsonCI,
  Z80,
} from "@/domain/analytics";

describe("moments and percentiles", () => {
  it("sample sd, downside deviation, skew and excess kurtosis (Excel SKEW / KURT)", () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(sd([3])).toBeNull();
    expect(downsideDeviation([1, -1, 2, -3])).toBeCloseTo(Math.sqrt((1 + 9) / 4), 10);
    expect(downsideDeviation([])).toBeNull();
    expect(skewness([1, 2, 3, 10])).toBeCloseTo(1.7636, 3);
    expect(skewness([1, 2, 3])).toBeCloseTo(0, 10);
    expect(skewness([5, 5, 5])).toBeNull();
    expect(kurtosis([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(-1.2, 6);
    expect(kurtosis([1, 2, 3])).toBeNull();
  });

  it("type-7 quantiles (NumPy default) and MAD", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });
});

describe("distributions", () => {
  it("normal CDF / quantile", () => {
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normCdf(0)).toBeCloseTo(0.5, 10);
    expect(normQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normQuantile(0.9)).toBeCloseTo(Z80, 6);
    expect(normQuantile(0.001)).toBeCloseTo(-3.090232, 5);
  });

  it("Student t CDF / quantile (t tables)", () => {
    expect(tCdf(2.228, 10)).toBeCloseTo(0.975, 3);
    expect(tCdf(0, 7)).toBeCloseTo(0.5, 10);
    expect(tQuantile(0.9, 4)).toBeCloseTo(1.5332, 3);
    expect(tQuantile(0.975, 30)).toBeCloseTo(2.0423, 3);
    expect(tQuantile(0.1, 4)).toBeCloseTo(-1.5332, 3);
  });
});

describe("tests and intervals", () => {
  it("one-sample t-test (SciPy ttest_1samp([1..5], 0): t 4,243, p 0,0132)", () => {
    const t = tTest([1, 2, 3, 4, 5])!;
    expect(t.mean).toBe(3);
    expect(t.t).toBeCloseTo(4.2426, 3);
    expect(t.df).toBe(4);
    expect(t.p).toBeCloseTo(0.01324, 4);
    expect(t.pGreater).toBeCloseTo(0.00662, 4);
    // 80 % interval: 3 ± 1,5332 · 0,7071
    expect(t.ci.lo).toBeCloseTo(3 - 1.5332 * Math.SQRT1_2, 3);
    expect(t.ci.hi).toBeCloseTo(3 + 1.5332 * Math.SQRT1_2, 3);
    expect(meanCI([1, 2, 3, 4, 5])).toEqual(t.ci);
    expect(tTest([1])).toBeNull();
    // no spread: decided without division by zero
    expect(tTest([2, 2, 2])).toMatchObject({ p: 0, pGreater: 0 });
  });

  it("Welch's t-test", () => {
    const w = welch([1, 2, 3, 4, 5], [2, 3, 4, 5, 6, 7, 8])!;
    expect(w.diff).toBe(-2);
    expect(w.t).toBeCloseTo(-1.8516, 3);
    expect(w.df).toBeCloseTo(9.966, 2);
    expect(w.p).toBeGreaterThan(0.08);
    expect(w.p).toBeLessThan(0.11);
    expect(w.ci.hi).toBeLessThan(0);
    expect(welch([1], [2, 3])).toBeNull();
  });

  it("Wilson and the difference of two proportions", () => {
    expect(wilsonCI(5, 10)).toEqual(wilson(5, 10, Z80));
    expect(wilsonCI(5, 10, 0.95).lo).toBeCloseTo(wilson(5, 10, 1.959964).lo, 6);
    expect(CI_LEVEL).toBe(0.8);
    const d = proportionDiff(30, 50, 20, 50)!;
    expect(d.diff).toBeCloseTo(0.2, 10);
    expect(d.p).toBeCloseTo(0.0455, 3); // pooled z = 2,0
    expect(d.ci.lo).toBeGreaterThan(0);
    expect(d.ci.hi).toBeLessThan(0.4);
    expect(proportionDiff(1, 0, 1, 2)).toBeNull();
  });

  it("seeded bootstrap: deterministic, brackets the estimate, skips non-finite stats", () => {
    const xs = Array.from({ length: 40 }, (_, i) => Math.sin(i) * 2 + 0.5);
    const stat = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;
    const a = bootstrapCI(xs, stat, { seed: 3 })!;
    const b = bootstrapCI(xs, stat, { seed: 3 })!;
    expect(a).toEqual(b);
    const m = stat(xs);
    expect(a.lo).toBeLessThan(m);
    expect(a.hi).toBeGreaterThan(m);
    expect(bootstrapCI(xs, () => null)).toBeNull();
    expect(bootstrapCI([1], stat)).toBeNull();
  });

  it("rng is a deterministic mulberry32 in [0, 1)", () => {
    const r1 = rng(42);
    const r2 = rng(42);
    const seq = Array.from({ length: 5 }, () => r1());
    expect(seq).toEqual(Array.from({ length: 5 }, () => r2()));
    for (const v of seq) expect(v >= 0 && v < 1).toBe(true);
    expect(rng(43)()).not.toBe(seq[0]);
  });
});

describe("multiple testing and sample size", () => {
  it("Benjamini-Hochberg q-values (monotone step-up)", () => {
    const r = benjaminiHochberg([0.01, 0.04, 0.03, 0.2, null]);
    expect(r.q[0]).toBeCloseTo(0.04, 10);
    expect(r.q[1]).toBeCloseTo(0.16 / 3, 10);
    expect(r.q[2]).toBeCloseTo(0.16 / 3, 10);
    expect(r.q[3]).toBeCloseTo(0.2, 10);
    expect(r.q[4]).toBeNull();
    expect(r.significant).toEqual([true, true, true, false, false]);
  });

  it("verdicts: klar after FDR, Tendenz below 0,2, zu wenig below the minimum", () => {
    expect(significanceOf(0.01, 0.05, 20, 5)).toBe("klar");
    expect(significanceOf(0.04, 0.15, 20, 5)).toBe("tendenz");
    expect(significanceOf(0.5, 0.6, 20, 5)).toBe("offen");
    expect(significanceOf(0.001, 0.001, 3, 5)).toBe("wenig");
    expect(significanceOf(null, null, 30, 5)).toBe("wenig");
  });

  it("trades needed for a positive edge / a win-rate precision", () => {
    // ((z0.9 + z0.8) · sd / mean)² = ((1,2816 + 0,8416) · 2)² ≈ 18,03 → 19
    expect(tradesForEdge(0.5, 1)).toBe(19);
    expect(tradesForEdge(-0.1, 1)).toBeNull();
    expect(tradesForEdge(0.2, null)).toBeNull();
    // ±10 pp at 80 % around 50 %: 1,2816² · 0,25 / 0,01 ≈ 41,06 → 42
    expect(tradesForWinRate(0.1)).toBe(42);
  });
});
