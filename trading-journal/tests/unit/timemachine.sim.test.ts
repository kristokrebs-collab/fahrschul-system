/**
 * Zeitmaschine · part (a): the simulated sessions. The odds are checked against hand solutions: on a lattice market (every
 * candle ×1,01 or ÷1,01) a plan with the stop `a` steps down and the target `b` steps up is a gambler's ruin, so
 * P(target first) = a ÷ (a + b) for a fair market and (1 − r^a) ÷ (1 − r^(a+b)), r = q ÷ p, for a market that rises with
 * probability p. Costs move the expectancy by exactly the fees of the exits that happened. The engine is the backtest's.
 */
import { describe, expect, it } from "vitest";
import { runBacktest } from "@/domain/backtest/engine";
import { createTmJob, runTimeMachineSync, SimJob, buildPool, relativeOf, riskOf, targetROf, NO_MANAGE, MIN_POOL_BARS } from "@/domain/timemachine";
import { engineCfg, onceAtStart, signalOf } from "@/domain/timemachine/play";
import { FEE_COSTS, input, latticeBars, latticePlan, ZERO_COSTS } from "./timemachine.helpers";

/** P(reach +b before −a) for a ±1 walk that steps up with probability p. */
const ruin = (a: number, b: number, p: number): number => (p === 0.5 ? a / (a + b) : (1 - ((1 - p) / p) ** a) / (1 - ((1 - p) / p) ** (a + b)));

describe("Simulation: Wahrscheinlichkeiten gegen die Handrechnung", { timeout: 120_000 }, () => {
  it("fairer Markt: P(Ziel zuerst) = a ÷ (a + b), Erwartungswert aus Ziel-R und Stop", () => {
    const plan = latticePlan(5, 10);
    const res = runTimeMachineSync(input({ plan, runs: 6000 }));
    const s = res.sim;
    expect(s.runs).toBe(6000);
    // fast alle Läufe enden an einer Seite (Breite 15 Schritte, 300 Kerzen)
    expect(s.neither.p).toBeLessThan(0.01);
    const decided = s.target.k / (s.target.k + s.stop.k);
    expect(decided).toBeGreaterThan(ruin(5, 10, 0.5) - 0.02);
    expect(decided).toBeLessThan(ruin(5, 10, 0.5) + 0.02);
    // das Konfidenzband der Simulation (Wilson) enthält die exakte Lösung
    expect(s.target.lo).toBeLessThan(1 / 3 + 0.004);
    expect(s.target.hi).toBeGreaterThan(1 / 3 - 0.004);
    // E[R] = P·R_Ziel − (1 − P) mit R_Ziel aus der Geometrie des Plans (ohne Kosten: Stop = −1 R, Ziel = +R_Ziel)
    const rT = targetROf(plan);
    expect(res.targetR).toBeCloseTo(rT, 12);
    const expected = s.target.p * rT - s.stop.p * 1;
    expect(s.expectancy.mean).toBeCloseTo(expected, 1);
    expect(Math.abs(s.expectancy.mean - (ruin(5, 10, 0.5) * rT - (1 - ruin(5, 10, 0.5))))).toBeLessThan(0.08);
    // der Stop füllt genau auf dem Stop-Preis: −1,000 R
    expect(s.cases.worst).toBeCloseTo(-1, 9);
    expect(s.cases.best).toBeCloseTo(rT, 9);
  });

  it("steigender Markt (p = 0,6): P(Ziel zuerst) folgt der Ruin-Formel mit r = q ÷ p", () => {
    const res = runTimeMachineSync(input({ bars: latticeBars(600, 0.6), plan: latticePlan(5, 10), runs: 6000, drift: "keep" }));
    const s = res.sim;
    const decided = s.target.k / (s.target.k + s.stop.k);
    expect(Math.abs(decided - ruin(5, 10, 0.6))).toBeLessThan(0.02);
    expect(ruin(5, 10, 0.6)).toBeCloseTo(0.8703, 3);
    // der Trend der Historie fließt ein – und wird benannt
    expect(res.pool.driftPerBar).toBeGreaterThan(0);
    expect(res.notes.some((n) => n.id === "drift")).toBe(true);
  });

  it("„Trend entfernen“ macht aus dem steigenden Markt den fairen: Quote wieder a ÷ (a + b)", () => {
    const res = runTimeMachineSync(input({ bars: latticeBars(600, 0.6), plan: latticePlan(5, 10), runs: 6000, drift: "zero" }));
    const decided = res.sim.target.k / (res.sim.target.k + res.sim.stop.k);
    // die Schritte bleiben ×1,01 / ÷1,01 mal exp(−μ): die Barrieren liegen nicht mehr auf dem Gitter, die Quote bleibt nahe an a ÷ (a + b)
    expect(Math.abs(decided - 1 / 3)).toBeLessThan(0.07);
    expect(res.notes.some((n) => n.id === "drift0")).toBe(true);
  });

  it("Short spiegelt Long: dieselbe Quote bei gespiegeltem Plan", () => {
    const res = runTimeMachineSync(input({ plan: latticePlan(5, 10, "short"), runs: 6000 }));
    const decided = res.sim.target.k / (res.sim.target.k + res.sim.stop.k);
    expect(Math.abs(decided - 1 / 3)).toBeLessThan(0.02);
    expect(res.sim.cases.worst).toBeCloseTo(-1, 9);
  });

  it("Blöcke aus echten Kerzen ändern bei unabhängigen Schritten nichts an der Quote", () => {
    const res = runTimeMachineSync(input({ method: "block", blockLen: 6, runs: 6000 }));
    const decided = res.sim.target.k / (res.sim.target.k + res.sim.stop.k);
    expect(Math.abs(decided - 1 / 3)).toBeLessThan(0.025);
  });

  it("Gebühren verschieben den Erwartungswert um genau die Kosten der Ausstiege – die Quoten bleiben", () => {
    const plan = latticePlan(5, 10);
    const free = runTimeMachineSync(input({ plan, runs: 3000, costs: ZERO_COSTS }));
    const fee = runTimeMachineSync(input({ plan, runs: 3000, costs: FEE_COSTS }));
    // dieselben Pfade (gleicher Seed): dieselben Treffer
    expect(fee.sim.target.k).toBe(free.sim.target.k);
    expect(fee.sim.stop.k).toBe(free.sim.stop.k);
    // Handrechnung: Einstieg 5 bp Taker auf 100; Stop 5 bp Taker auf den Stop-Preis; Ziel 2 bp Maker auf den Ziel-Preis; Risiko = 100 − Stop
    const risk = riskOf(plan);
    const cStop = (0.0005 * 100 + 0.0005 * plan.stop) / risk;
    const cTarget = (0.0005 * 100 + 0.0002 * plan.target) / risk;
    const s = free.sim;
    const handCost = (s.target.k * cTarget + s.stop.k * cStop) / (s.target.k + s.stop.k);
    const shift = free.sim.expectancy.mean - fee.sim.expectancy.mean;
    // die wenigen Zeitstopp-Läufe zahlen etwas anderes; bei < 1 % der Läufe bleibt die Abweichung winzig
    expect(Math.abs(shift - handCost)).toBeLessThan(0.002);
    expect(fee.sim.costR).toBeGreaterThan(0.015);
    expect(fee.sim.costR).toBeLessThan(0.022);
    expect(free.sim.costR).toBe(0);
    // schlechter als ohne
    expect(fee.sim.cases.best).toBeLessThan(free.sim.cases.best);
  });

  it("Slippage verteuert den Einstieg: das Ziel-R sinkt, der Stop kostet mehr als −1 R", () => {
    const plan = latticePlan(5, 10);
    const slip = runTimeMachineSync(input({ plan, runs: 1500, costs: { ...ZERO_COSTS, slippage: { kind: "fixed", bps: 20 } } }));
    expect(slip.sim.cases.worst).toBeLessThan(-1);
    expect(slip.sim.cases.best).toBeLessThan(targetROf(plan));
  });
});

describe("Simulation: Determinismus, Seed, Aufteilung in Scheiben", { timeout: 120_000 }, () => {
  it("gleicher Seed, gleiche Zahlen; anderer Seed, andere Läufe; der Seed steht im Ergebnis", () => {
    const a = runTimeMachineSync(input({ runs: 800, seed: 19 }));
    const b = runTimeMachineSync(input({ runs: 800, seed: 19 }));
    const c = runTimeMachineSync(input({ runs: 800, seed: 20 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).toBe(19);
    expect(c.seed).toBe(20);
    expect(JSON.stringify(c.sim.fan.paths)).not.toBe(JSON.stringify(a.sim.fan.paths));
  });

  it("die Aufteilung in Zeitscheiben ändert das Ergebnis nicht", () => {
    const one = runTimeMachineSync(input({ runs: 700, horizon: 120 }));
    const job = createTmJob(input({ runs: 700, horizon: 120 }));
    let slices = 0;
    // winzige Frist: jede Scheibe macht höchstens 16 Läufe (Prüfung alle 16 Läufe) bzw. einen Schritt der anderen Phasen
    while (!job.step(performance.now() - 1)) {
      slices++;
      expect(job.progress()).toBeGreaterThanOrEqual(0);
      expect(job.progress()).toBeLessThanOrEqual(1);
      if (slices > 100_000) throw new Error("läuft nicht zu Ende");
    }
    expect(slices).toBeGreaterThan(5);
    expect(JSON.stringify(job.result())).toBe(JSON.stringify(one));
  });

  it("Lauf k ist allein wiederholbar (eigener Seed je Lauf)", () => {
    const inp = input({ runs: 300, horizon: 80, method: "block" });
    const pool = buildPool(inp.bars, inp.interval, inp.drift);
    const rel = relativeOf(inp.plan, pool.bars, inp.trigger);
    if ("ok" in rel) throw new Error(rel.why);
    const a = new SimJob(inp, pool, rel.atr);
    const b = new SimJob(inp, pool, rel.atr);
    expect(a.candlesOf(41)).toEqual(b.candlesOf(41));
    expect(a.candlesOf(41)).not.toEqual(a.candlesOf(42));
  });
});

describe("Simulation: dieselbe Engine, dieselben Regeln", { timeout: 60_000 }, () => {
  it("jeder simulierte Lauf ergibt genau das, was runBacktest auf denselben Kerzen ergibt", () => {
    const inp = input({ runs: 200, horizon: 60, costs: { fees: { exchange: "x", makerBps: 2, takerBps: 6 }, slippage: { kind: "fixed", bps: 3 }, funding: { kind: "flat", ratePer8h: 0.0001 } }, interval: "1h", bars: latticeBars(500, 0.5, 3600) });
    const pool = buildPool(inp.bars, inp.interval, inp.drift);
    const rel = relativeOf(inp.plan, pool.bars, inp.trigger);
    if ("ok" in rel) throw new Error(rel.why);
    const sim = new SimJob(inp, pool, rel.atr);
    while (!sim.step(performance.now() + 1000)) {
      /* all runs */
    }
    const cfg = engineCfg(inp.costs);
    const strategy = onceAtStart(signalOf(inp.plan, inp.plan.stop, inp.plan.target, inp.horizon, NO_MANAGE));
    for (const k of [0, 1, 2, 17, 99, 150, 199]) {
      const candles = sim.candlesOf(k);
      const res = runBacktest(candles, strategy, cfg, { equity: false, atr: new Array<number>(candles.length).fill(rel.atr), secLen: 3600 });
      const t = res.trades[0]!;
      expect(sim.out.r[k]).toBeCloseTo(t.r, 12);
      expect(sim.out.bars[k]).toBe(t.bars);
    }
  });

  it("Stop und Ziel in einer Kerze: der Stop zählt (konservativ), die Engine markiert es", () => {
    // ein Markt, dessen Kerzen immer so groß sind, dass Stop (−1 %) UND Ziel (+1 %) in derselben Kerze liegen
    const t0 = 1_700_000_000 - (1_700_000_000 % 86_400);
    const wide = Array.from({ length: 300 }, (_, i) => ({ t: t0 + i * 86_400, o: 100, h: 103, l: 97, c: 100 }));
    const res = runTimeMachineSync(input({ bars: wide, plan: { side: "long", entry: 100, stop: 99, target: 101 }, runs: 300, horizon: 10 }));
    expect(res.sim.stop.p).toBe(1);
    expect(res.sim.target.k).toBe(0);
    expect(res.sim.ambiguous).toBe(300);
    expect(res.notes.some((n) => n.id === "ambiguous")).toBe(true);
  });

  it("weit entfernte Barrieren: alle Läufe enden am Zeitstopp (weder noch) nach genau `horizon` Kerzen", () => {
    const res = runTimeMachineSync(input({ plan: { side: "long", entry: 100, stop: 40, target: 200 }, runs: 500, horizon: 25 }));
    expect(res.sim.neither.p).toBe(1);
    expect(res.sim.timeTarget).toBeNull();
    expect(res.sim.timeStop).toBeNull();
    expect(res.verdict.id).toBe("none");
    // die Fenster-Mitte der Verteilung liegt nahe null R
    expect(Math.abs(res.sim.cases.median)).toBeLessThan(0.3);
  });

  it("Break-even nach +1 R: es gibt nachgezogene Stopps, die Anteile ergeben zusammen 1", () => {
    const res = runTimeMachineSync(input({ plan: latticePlan(5, 10), runs: 2000, manage: { breakEvenR: 1, trailAtr: null, trailFromR: 1 } }));
    const s = res.sim;
    expect(s.moved.k).toBeGreaterThan(100);
    expect(s.target.k + s.stop.k + s.neither.k + s.moved.k).toBe(s.runs);
    const plain = runTimeMachineSync(input({ plan: latticePlan(5, 10), runs: 2000 }));
    expect(s.stop.k).toBeLessThan(plain.sim.stop.k);
  });
});

describe("Simulation: Volatilität nach Tageszeit", () => {
  it("laute Tageszeiten bleiben laut, ruhige ruhig (Kerzen aus den Fenstern der Tageszeit)", () => {
    // 1h-Kerzen: nur von 12 bis 17 Uhr UTC bewegt sich der Kurs stark (±1 %), sonst ±0,05 %
    const secLen = 3600;
    const t0 = 1_700_000_000 - (1_700_000_000 % 86_400);
    const bars = [];
    let p = 100;
    for (let i = 0; i < 24 * 40; i++) {
      const hour = i % 24;
      const step = hour >= 12 && hour <= 17 ? 0.01 : 0.0005;
      const c = p * (1 + (i % 2 ? -step : step));
      bars.push({ t: t0 + i * secLen, o: p, h: Math.max(p, c), l: Math.min(p, c), c });
      p = c;
    }
    const inp = input({ interval: "1h", bars, runs: 200, horizon: 24, method: "single", plan: { side: "long", entry: 100, stop: 90, target: 110 } });
    const pool = buildPool(inp.bars, "1h", "keep");
    const rel = relativeOf(inp.plan, pool.bars, inp.trigger);
    if ("ok" in rel) throw new Error(rel.why);
    const sim = new SimJob(inp, pool, rel.atr);
    const startSlot = ((pool.bars[pool.bars.length - 1]!.t + secLen) % 86_400) / secLen;
    const moves: number[] = new Array<number>(24).fill(0);
    const seen: number[] = new Array<number>(24).fill(0);
    for (let k = 0; k < 120; k++) {
      const c = sim.candlesOf(k);
      for (let s = 2; s <= 24; s++) {
        const slot = (startSlot + s - 1) % 24;
        moves[slot]! += Math.abs(c[s]!.c / c[s - 1]!.c - 1);
        seen[slot]!++;
      }
    }
    const avg = (slots: number[]): number => slots.reduce((a, s) => a + moves[s]! / Math.max(1, seen[s]!), 0) / slots.length;
    const loud = avg([14, 15]);
    const quiet = avg([2, 3, 4]);
    expect(loud).toBeGreaterThan(8 * quiet);
  });

  it("zu wenige Kerzen: die Simulation startet nicht und sagt warum", () => {
    expect(() => createTmJob(input({ bars: latticeBars(MIN_POOL_BARS - 1, 0.5) }))).toThrow(/mindestens 200/);
  });
});
