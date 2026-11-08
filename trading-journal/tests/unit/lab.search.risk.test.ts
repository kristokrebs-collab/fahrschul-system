/**
 * Strategiesuche – was aus dem Endtest des Siegers folgt (`src/domain/lab/search/risk.ts`), gegen Handrechnung und mit festem Seed:
 * größter Rückgang in R und % (Zinseszins), die Neuziehung der Endtest-Trades (Spanne, Band, Anteil Verlust), der Vergleich der
 * Stop-Führungen (gepaart über dieselben Einstiege, sonst ungepaart) – und dass nichts davon ohne „bestanden“ als besser ausgewiesen wird.
 */
import { describe, expect, it } from "vitest";
import { BOOTSTRAP_N, bootstrapDiff, bootstrapPaired, compareStops, drawdownOf, riskOf, type StopRun } from "@/domain/lab/search";

describe("größter Rückgang (Handrechnung)", () => {
  it("in R: Summe vom Hoch; in %: Zinseszins mit dem Risiko je Trade", () => {
    // Summe: 1, 3, 2, 0, 1 → Hoch 3, tiefster Punkt danach 0 → 3 R
    const d = drawdownOf([1, 2, -1, -2, 1], 0.01);
    expect(d.r).toBe(3);
    // Konto: 1,01 · 1,02 = 1,0302 (Hoch); · 0,99 · 0,98 = 0,99950… → 1 − 0,9995 / 1,0302 = 2,98 %
    expect(d.pct).toBeCloseTo(1 - (1.0302 * 0.99 * 0.98) / 1.0302, 10);
    expect(d.pct).toBeCloseTo(0.0298, 4);
    expect(drawdownOf([1, 1, 1], 0.01)).toEqual({ r: 0, pct: 0 });
  });
});

describe("Neuziehung der Endtest-Trades (fester Seed)", () => {
  const input = { rs: [1, -1], fs: [0.85, 0.95], grid: [0.9, 1], riskPct: 0.01, seed: 20261108 };

  it("gleicher Seed → dasselbe Ergebnis; anderer Seed → andere Ziehung; die Zahl der Ziehungen steht dabei", () => {
    const a = riskOf(input)!;
    expect(riskOf(input)).toEqual(a);
    expect(a.n).toBe(BOOTSTRAP_N);
    expect(a.n).toBe(2000);
    expect(a.trades).toBe(2);
    const big = { rs: [0.5, -1, 2, -1, 0.3, 1.1, -0.4, -1, 3, -1], fs: [0.81, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98], grid: [0.85, 0.9, 0.95, 1], riskPct: 0.01, seed: 1 };
    expect(JSON.stringify(riskOf(big))).toBe(JSON.stringify(riskOf(big)));
    expect(JSON.stringify(riskOf({ ...big, seed: 2 }))).not.toBe(JSON.stringify(riskOf(big)));
  });

  it("zwei Trades +1 / −1: die vier Folgen (je ¼) – Spanne, Band und Anteil Verlust stimmen mit der Handrechnung", () => {
    const r = riskOf(input)!;
    // tatsächlich: +1, dann −1 → Rückgang 1 R; in %: 1,01 → 1,01 · 0,99 = 0,9999 → 1 − 0,9999 / 1,01 = 1 %
    expect(r.ddR).toBe(1);
    expect(r.ddPct).toBeCloseTo(0.01, 6);
    // Folgen: (+1,+1) Summe 2 / Rückgang 0; (+1,−1) 0 / 1; (−1,+1) 0 / 1; (−1,−1) −2 / 2
    expect(r.sumRq).toEqual({ p5: -2, p50: 0, p95: 2 });
    expect(r.ddRq).toEqual({ p5: 0, p50: 1, p95: 2 });
    // Summe ≤ 0 in ¾ der Folgen (2.000 Ziehungen: Streuung ≈ 1 %)
    expect(r.pLoss).toBeGreaterThan(0.72);
    expect(r.pLoss).toBeLessThan(0.78);
    // Band: bei 0,9 ist eine Trade gezogen (±1), bei 1,0 beide (−2 … 2)
    expect(r.band.lo).toEqual([-1, -2]);
    expect(r.band.hi).toEqual([1, 2]);
    expect(r.band.mid[1]).toBe(0);
    // % mit Zinseszins: (−1,−1) → 1 − 0,99 · 0,99 = 1,99 %
    expect(r.ddPctQ.p95).toBeCloseTo(1 - 0.99 * 0.99, 6);
  });

  it("Ordnung: 5 % ≤ 50 % ≤ 95 %, das Band umschließt seine Mitte, unter 2 Trades gibt es nichts zu ziehen", () => {
    const rs = [0.5, -1, 2, -1, 0.3, 1.1, -0.4, -1, 3, -1, 0.8, -1, 1.5];
    const fs = rs.map((_, i) => 0.8 + (0.2 * (i + 0.5)) / rs.length);
    const grid = Array.from({ length: 24 }, (_, k) => 0.8 + (0.2 * (k + 1)) / 24);
    const r = riskOf({ rs, fs, grid, riskPct: 0.01, seed: 7 })!;
    for (const q of [r.ddRq, r.ddPctQ, r.sumRq]) {
      expect(q.p5).toBeLessThanOrEqual(q.p50);
      expect(q.p50).toBeLessThanOrEqual(q.p95);
    }
    for (let g = 0; g < grid.length; g++) {
      expect(r.band.lo[g]!).toBeLessThanOrEqual(r.band.mid[g]!);
      expect(r.band.mid[g]!).toBeLessThanOrEqual(r.band.hi[g]!);
    }
    // am Ende stehen alle Trades: das Band ist dort die Spanne der Summe
    expect(r.band.lo[grid.length - 1]).toBe(r.sumRq.p5);
    expect(r.band.hi[grid.length - 1]).toBe(r.sumRq.p95);
    expect(riskOf({ rs: [1], fs: [0.9], grid, riskPct: 0.01, seed: 7 })).toBeNull();
  });
});

describe("Vergleich der Stop-Führungen", () => {
  const ones = (n: number, x: number): number[] => Array.from({ length: n }, () => x);
  const es = (n: number): number[] => Array.from({ length: n }, (_, i) => 100 + i * 7);

  it("gepaart über dieselben Einstiege: Nachziehen +1 R je Trade besser → Differenz 1, p minimal, ausgewiesen nur mit „bestanden“", () => {
    const noise = [0.3, -0.2, 0.1, -0.4, 0.5, 0, -0.1, 0.2, 0.4, -0.3, 0.1, -0.2];
    const fixed = noise.map((x) => x - 0.5);
    const trail = noise.map((x) => x + 0.5);
    const runs: StopRun[] = [
      { rule: "fixed", isRs: ones(30, 0.1), isScore: 1, oosRs: fixed, oosEs: es(12) },
      { rule: "be", isRs: ones(30, 0.2), isScore: 2, oosRs: noise, oosEs: es(12) },
      { rule: "trail", isRs: ones(30, 0.4), isScore: 3, oosRs: trail, oosEs: es(12) },
    ];
    const a = compareStops(runs, "trail", true, 5);
    expect(a.vs).toBe("fixed");
    expect(a.pairs).toBe(12);
    expect(a.diffAvgR).toBeCloseTo(1, 10);
    expect(a.lo).toBeCloseTo(1, 10);
    expect(a.hi).toBeCloseTo(1, 10);
    expect(a.p).toBeCloseTo(1 / (BOOTSTRAP_N + 1), 4);
    expect(a.edge).toBe(true);
    expect(a.declared).toBe(true);
    // derselbe Befund ohne bestandenen Endtest: gemessen, aber nicht ausgewiesen
    expect(compareStops(runs, "trail", false, 5)).toMatchObject({ edge: true, declared: false });
    // das Training zeigt in die andere Richtung → kein Befund
    const flipped = runs.map((r) => (r.rule === "trail" ? { ...r, isRs: ones(30, 0.05) } : r));
    expect(compareStops(flipped, "trail", true, 5)).toMatchObject({ edge: false, declared: false });
    // Zeilen in der Reihenfolge fest / Einstand / Nachziehen, mit den Endtest-Summen
    expect(a.lines.map((l) => [l.rule, l.oosN])).toEqual([["fixed", 12], ["be", 12], ["trail", 12]]);
    expect(a.lines[2]!.oosSumR).toBeCloseTo(12 * 0.5 + noise.reduce((x, y) => x + y, 0), 4);
  });

  it("fester Stop als Sieger: verglichen mit der im Endtest besseren der beiden anderen", () => {
    const runs: StopRun[] = [
      { rule: "fixed", isRs: ones(30, 0.3), isScore: 3, oosRs: [0.2, 0.1, 0.3, -0.1, 0.2, 0.1, 0.2, 0, 0.1, 0.2], oosEs: es(10) },
      { rule: "be", isRs: ones(30, 0.1), isScore: 1, oosRs: ones(10, -0.3), oosEs: es(10) },
      { rule: "trail", isRs: ones(30, 0.2), isScore: 2, oosRs: ones(10, 0), oosEs: es(10) },
    ];
    const a = compareStops(runs, "fixed", true, 9);
    expect(a.vs).toBe("trail");
    expect(a.diffAvgR).toBeCloseTo(0.13, 10);
  });

  it("zu wenige gleiche Einstiege → ungepaart (beide Listen neu gezogen); deterministisch; reines Rauschen trennt nicht", () => {
    const rnd = (seed: number) => {
      let a = seed;
      return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    };
    const g = rnd(42);
    const x = Array.from({ length: 30 }, g);
    const y = Array.from({ length: 30 }, g);
    const runs: StopRun[] = [
      { rule: "fixed", isRs: x, isScore: 1, oosRs: y, oosEs: es(30).map((e) => e + 1) },
      { rule: "be", isRs: x, isScore: 1, oosRs: y },
      { rule: "trail", isRs: y, isScore: 2, oosRs: x, oosEs: es(30) },
    ];
    const a = compareStops(runs, "trail", true, 3);
    expect(a.pairs).toBe(0);
    expect(compareStops(runs, "trail", true, 3)).toEqual(a);
    const d = bootstrapDiff(x, y, 3)!;
    expect(a.lo).toBeCloseTo(d.lo, 4);
    expect(a.p).toBeCloseTo(d.p, 4);
    expect(a.declared).toBe(a.edge);
    // gepaart: Mittel und Spanne aus der Neuziehung der Differenzen
    const p = bootstrapPaired([1, 2, 3, 4], 1)!;
    expect(p.diff).toBe(2.5);
    expect(p.lo).toBeGreaterThanOrEqual(1);
    expect(p.hi).toBeLessThanOrEqual(4);
    expect(bootstrapPaired([1], 1)).toBeNull();
  });
});
