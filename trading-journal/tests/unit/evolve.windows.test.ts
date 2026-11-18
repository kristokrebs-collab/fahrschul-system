/**
 * Optimiser – walk-forward windows: consecutive, no overlap between training and test, hand-computed layout; and the robust
 * score formula, computed by hand.
 */
import { describe, expect, it } from "vitest";
import { capR, chronological, COMPLEXITY_W, DD_WEIGHT, evolveWindows, metricsOf, MIN_TEST_TRADES, R_CAP, robustScore, scoredR, WARN_TRADES } from "@/domain/evolve";

const OPTS = { folds: 4, trainFrac: 0.3, holdoutFrac: 0.2 };

describe("Walk-forward-Fenster", () => {
  it("von Hand: 1000 Kerzen ab Index 100 → Training 300, 4 × 125 Test, 200 Bestätigung", () => {
    const r = evolveWindows(100, 1099, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.windows;
    expect(w.train).toEqual({ from: 100, to: 399 });
    expect(w.tests).toEqual([
      { from: 400, to: 524 },
      { from: 525, to: 649 },
      { from: 650, to: 774 },
      { from: 775, to: 899 },
    ]);
    expect(w.holdout).toEqual({ from: 900, to: 1099 });
    // anchored: das Training eines Testfensters ist alles davor
    expect(w.folds.map((f) => f.train)).toEqual([
      { from: 100, to: 399 },
      { from: 100, to: 524 },
      { from: 100, to: 649 },
      { from: 100, to: 774 },
    ]);
  });

  it("Eigenschaft: für viele Längen keine Überlappung Training/Test, lückenlos, Test nur danach", () => {
    for (let span = 200; span <= 3000; span += 37) {
      const lo = 50 + (span % 11);
      const hi = lo + span - 1;
      const r = evolveWindows(lo, hi, OPTS);
      if (!r.ok) continue;
      const w = r.windows;
      // zusammen genau die Spanne
      const all = [w.train, ...w.tests, w.holdout];
      expect(all[0]!.from).toBe(lo);
      expect(all.at(-1)!.to).toBe(hi);
      for (let i = 1; i < all.length; i++) expect(all[i]!.from, `span ${span}: Lücke oder Überlappung bei ${i}`).toBe(all[i - 1]!.to + 1);
      // keine Überlappung: das Training eines Fensters endet vor ihm, die Testfenster überlappen sich nicht
      for (const f of w.folds) expect(f.train.to).toBeLessThan(f.test.from);
      for (let i = 1; i < w.tests.length; i++) expect(w.tests[i]!.from).toBeGreaterThan(w.tests[i - 1]!.to);
      // gleich lange Testfenster, das Bestätigungsfenster danach
      const lens = new Set(w.tests.map((t) => t.to - t.from + 1));
      expect(lens.size).toBe(1);
      expect(w.holdout.from).toBeGreaterThan(w.tests.at(-1)!.to);
    }
  });

  it("zu kurze Daten werden mit Grund abgelehnt, nichts wird gequetscht", () => {
    const r = evolveWindows(0, 199, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Zu wenige Kerzen.*mindestens 30/);
    expect(evolveWindows(10, 5, OPTS).ok).toBe(false);
  });
});

describe("Metriken und der robuste Score", () => {
  // one R = 100 money; funding 0 unless given (positive = paid, negative = received)
  const t = (r: number, exit: number, funding = 0, pnl = r * 100) => ({ r, pnl, funding, entry: 100, stop: 99, qty: 100, exitTime: exit, entryTime: exit - 1 });

  it("Rückgang in R auf der zeitlich geordneten Summenkurve (Eingabe unsortiert)", () => {
    // geordnet: +2, −1, −3, +1, +4 → Summenkurve 2, 1, −2, −1, 3 → Spitze 2, Tief −2 → Rückgang 4
    const ts = [t(1, 40), t(-1, 20), t(4, 50), t(2, 10), t(-3, 30)];
    expect(chronological(ts).map((x) => x.r)).toEqual([2, -1, -3, 1, 4]);
    const m = metricsOf(ts, 10_000);
    expect(m.n).toBe(5);
    expect(m.sumR).toBe(3);
    expect(m.avgR).toBeCloseTo(0.6, 12);
    expect(m.maxDdR).toBe(4);
    expect(m.winRate).toBeCloseTo(0.6, 12);
    expect(m.netPct).toBeCloseTo(300 / 10_000, 12);
    // Profitfaktor in Geld: Gewinne 700 (2+1+4 = 700), Verluste 400
    expect(m.pf).toBeCloseTo(700 / 400, 12);
  });

  it("ein einzelner Glückstreffer zählt höchstens ±5 R (Winsorisieren)", () => {
    expect(R_CAP).toBe(5);
    expect(capR(70)).toBe(5);
    expect(capR(-9)).toBe(-5);
    expect(capR(1.5)).toBe(1.5);
    const m = metricsOf([t(70, 10), t(-1, 20), t(-1, 30), t(-1, 40)], 10_000);
    expect(m.sumR).toBe(2); // 5 − 3, nicht 67
    expect(m.avgR).toBe(0.5);
  });

  it("Funding-Einnahmen zählen nicht, Funding-Kosten schon", () => {
    // +1,0 R, davon 0,4 R Funding-Einnahmen (−40 Geld) → gewertet +0,6 R
    expect(scoredR(t(1, 10, -40))).toBeCloseTo(0.6, 12);
    // +1,0 R nach 0,4 R Funding-Kosten (+40): bleibt +1,0 R, die Kosten stecken schon im R der Engine
    expect(scoredR(t(1, 10, 40))).toBe(1);
    const m = metricsOf([t(1, 10, -40), t(-0.5, 20, -10)], 10_000);
    // Trade 2: −0,5 R mit 0,1 R Einnahmen → −0,6 R gewertet
    expect(m.sumR).toBeCloseTo(0.6 - 0.6, 12);
    expect(m.incomeR).toBeCloseTo(0.5, 12);
    expect(m.netPct).toBeCloseTo((60 - 60) / 10_000, 12);
  });

  it("Score = Ø R × √n − 0,5 × Rückgang ÷ √n − 0,12 × zusätzliche Freiheitsgrade, von Hand", () => {
    // n = 25, Ø R = 0,2 → 0,2 × 5 = 1,0 · Rückgang 5 R → 0,5 × 5 ÷ 5 = 0,5 · 2 zusätzliche Freiheitsgrade → 0,24 → 0,26
    expect(DD_WEIGHT).toBe(0.5);
    expect(COMPLEXITY_W).toBe(0.12);
    expect(robustScore({ n: 25, avgR: 0.2, maxDdR: 5 }, 2)).toBeCloseTo(1.0 - 0.5 - 0.24, 12);
    // weniger Freiheitsgrade als die jetzige Version geben keinen Bonus
    expect(robustScore({ n: 25, avgR: 0.2, maxDdR: 5 }, -3)).toBeCloseTo(0.5, 12);
  });

  it("unter der Mindestzahl an Trades gibt es keinen Score – egal wie gut", () => {
    expect(MIN_TEST_TRADES).toBe(15);
    expect(robustScore({ n: 14, avgR: 3, maxDdR: 0 }, 0)).toBeNull();
    expect(robustScore({ n: 15, avgR: 0.1, maxDdR: 0 }, 0)).not.toBeNull();
    expect(WARN_TRADES).toBeGreaterThan(MIN_TEST_TRADES);
  });

  it("dieselbe Kante auf mehr Trades punktet höher; ein tieferer Rückgang kostet", () => {
    const small = robustScore({ n: 16, avgR: 0.2, maxDdR: 3 }, 0)!;
    const big = robustScore({ n: 64, avgR: 0.2, maxDdR: 3 }, 0)!;
    expect(big).toBeGreaterThan(small);
    expect(robustScore({ n: 36, avgR: 0.2, maxDdR: 9 }, 0)!).toBeLessThan(robustScore({ n: 36, avgR: 0.2, maxDdR: 3 }, 0)!);
  });
});
