/**
 * Optimiser – the measure of overfitting (White's Reality Check, seeded): pure chance gives a HIGH probability for the best of
 * many variants, a real edge a LOW one; more variants raise it; earlier trials raise it; the same seed gives the same numbers.
 */
import { describe, expect, it } from "vitest";
import { rng } from "@/domain/analytics/stats";
import { inflateForPrior, naiveP, overfitLevel, realityCheck, RC_SD_FLOOR } from "@/domain/evolve";

const T = 24;

/** Block-differences of `n` worthless variants: pure noise around 0 (sum of R per block, sd ≈ 1). */
function noise(n: number, seed: number): Float64Array[] {
  const r = rng(seed);
  const gauss = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += r();
    return s - 6;
  };
  return Array.from({ length: n }, () => Float64Array.from({ length: T }, gauss));
}

/** A variant with a true edge of `drift` R per block on top of the same kind of noise. */
function edge(drift: number, seed: number): Float64Array {
  const r = rng(seed);
  const g = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += r();
    return s - 6;
  };
  return Float64Array.from({ length: T }, () => drift + g());
}

describe("Reality Check", () => {
  it("reiner Zufall: der Beste von 200 sieht einzeln „signifikant“ aus, die Korrektur sagt: wahrscheinlich Zufall", () => {
    const rows = noise(200, 11);
    const rc = realityCheck(rows, { seed: 5, boot: 400 });
    const best = rc.z.indexOf(Math.max(...rc.z));
    // einzeln betrachtet (ohne Mehrfachtest-Korrektur) wirkt der Beste hochsignifikant …
    expect(rc.z[best]!).toBeGreaterThan(2.5);
    expect(naiveP(rc.z[best]!)).toBeLessThan(0.01);
    // … nach allen 200 Varianten ist ein solches Maximum nichts Besonderes
    expect(rc.p[best]!).toBeGreaterThan(0.2);
  });

  it("über viele Zufalls-Läufe: der korrigierte p-Wert des Besten ist grob gleichverteilt, nie systematisch klein", () => {
    const ps: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const rc = realityCheck(noise(60, seed * 101), { seed, boot: 200 });
      ps.push(Math.min(...rc.p));
    }
    ps.sort((a, b) => a - b);
    const median = ps[Math.floor(ps.length / 2)]!;
    expect(median).toBeGreaterThan(0.3); // unter Zufall liegt die Mitte nahe 0,5
    expect(ps.filter((p) => p < 0.05).length).toBeLessThanOrEqual(5); // höchstens ~5 % Fehlalarme (hier bis 12 %)
  });

  it("echte Kante: eine Variante mit klarem Vorteil unter 199 Zufalls-Varianten bekommt einen kleinen p-Wert", () => {
    const rows = [...noise(199, 21), edge(1.6, 777)];
    const rc = realityCheck(rows, { seed: 5, boot: 400 });
    expect(rc.z[199]!).toBeGreaterThan(4);
    expect(rc.p[199]!).toBeLessThan(0.05);
    // und die Zufalls-Varianten daneben bleiben unauffällig
    expect(Math.min(...rc.p.slice(0, 199))).toBeGreaterThan(0.05);
  });

  it("mehr getestete Varianten machen denselben Treffer weniger wert", () => {
    const winner = edge(0.9, 31);
    const few = realityCheck([winner, ...noise(4, 3)], { seed: 9, boot: 600 });
    const many = realityCheck([winner, ...noise(400, 3)], { seed: 9, boot: 600 });
    expect(many.p[0]!).toBeGreaterThan(few.p[0]!);
  });

  it("deterministisch: gleicher Seed → gleiche Zahlen; anderer Seed → andere Bootstrap-Stichprobe", () => {
    const rows = noise(50, 4);
    const a = realityCheck(rows, { seed: 3, boot: 200 });
    const b = realityCheck(rows, { seed: 3, boot: 200 });
    const c = realityCheck(rows, { seed: 4, boot: 200 });
    expect(a.p).toEqual(b.p);
    expect(a.z).toEqual(b.z);
    expect(a.z).toEqual(c.z); // die Statistik selbst hängt nicht vom Seed ab …
    expect(a.p).not.toEqual(c.p); // … nur die Stichprobe des Bootstraps
  });

  it("Randfälle: nichts getestet, nur ein Block, eine Variante identisch mit der jetzigen (Differenz 0)", () => {
    expect(realityCheck([], { seed: 1 }).p).toEqual([]);
    expect(realityCheck([[1]], { seed: 1 }).p).toEqual([1]);
    const zero = realityCheck([new Float64Array(T)], { seed: 1, boot: 100 });
    expect(zero.z[0]).toBe(0);
    expect(zero.p[0]).toBeGreaterThan(0.5);
  });

  it("ein winziger Unterschied (ein Trade) erzeugt kein riesiges z: die Streuung hat eine Untergrenze", () => {
    const one = new Float64Array(T);
    one[3] = 0.05;
    const rc = realityCheck([one], { seed: 1, boot: 100 });
    expect(Math.abs(rc.z[0]!)).toBeLessThan(0.1 / (RC_SD_FLOOR / Math.sqrt(T)));
  });
});

describe("frühere Versuche heben die Hürde", () => {
  it("1 − (1 − p)^((N + N₀) ÷ N), von Hand", () => {
    // p = 0,05, 100 neue + 100 frühere Versuche: 1 − 0,95² = 0,0975
    expect(inflateForPrior(0.05, 100, 100)).toBeCloseTo(0.0975, 10);
    // keine früheren Versuche: unverändert
    expect(inflateForPrior(0.05, 100, 0)).toBe(0.05);
    expect(inflateForPrior(0.05, 0, 50)).toBe(0.05);
    // wächst mit den früheren Versuchen und bleibt ≤ 1
    expect(inflateForPrior(0.05, 100, 900)).toBeGreaterThan(inflateForPrior(0.05, 100, 100));
    expect(inflateForPrior(1, 10, 10)).toBe(1);
    expect(inflateForPrior(0, 10, 1000)).toBe(0);
  });
  it("Stufen für die Karten", () => {
    expect(overfitLevel(0.05)).toBe("low");
    expect(overfitLevel(0.2)).toBe("mid");
    expect(overfitLevel(0.49)).toBe("mid");
    expect(overfitLevel(0.5)).toBe("high");
  });
});
