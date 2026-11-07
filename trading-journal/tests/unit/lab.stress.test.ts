/**
 * F20 – Kosten- und Belastungstest: the loss-series stress test from the real trade order (every number derived by hand
 * below), the wrappers (one candle later, scaled stop), the scenario table (what is exact, what is approximated, what is
 * unavailable and why) and one pass on a real BTCUSDT run through the extra job and the runner.
 */
import { describe, expect, it } from "vitest";
import { createLabJob, runBacktest, runExtra, type Bar, type BtStrategy, type EngineCfg, type EntrySignal } from "@/domain/backtest/index";
import { createExtraJob } from "@/domain/lab/extras/job";
import { delayed, drawdownOfR, lossStreakStress, longestLosing, MC_MIN_TRADES, scenarioDefs, stopScaled, worstWindow, type ScenarioRow } from "@/domain/lab/stress";
import { chain, ENGINE, realInput } from "./lab.extras.helpers";

describe("Verlustserien aus der echten Reihenfolge", () => {
  // R: +1 −1 −1 −1 +2 −1 −1 +3
  const t = chain([1, -1, -1, -1, 2, -1, -1, 3]);

  it("längste Verlustserie: drei Trades hintereinander, Σ −3 R", () => {
    const s = longestLosing(t)!;
    expect([s.from, s.to, s.trades, s.sumR]).toEqual([1, 3, 3, -3]);
    expect(s.fromTime).toBe(t[1]!.entryTime);
    expect(s.toTime).toBe(t[3]!.exitTime);
    expect(longestLosing(chain([1, 2]))).toBeNull();
  });

  it("schlechteste k Trades am Stück (Σ R, früheste bei Gleichstand)", () => {
    expect(worstWindow(t, 3)).toMatchObject({ from: 1, to: 3, sumR: -3 });
    expect(worstWindow(t, 2)).toMatchObject({ from: 1, to: 2, sumR: -2 });
    // −1 −1 +3 = +1 against 2 −1 −1 = 0: the worst five is  −1 −1 −1 +2 −1 = −2 (index 1…5)
    expect(worstWindow(t, 5)).toMatchObject({ from: 1, to: 5, sumR: -2 });
    expect(worstWindow(t, 9)).toBeNull();
  });

  it("tiefster Drawdown der kumulierten R: Spitze +1, Tal −2 → 3 R", () => {
    // cumulative: 1 0 −1 −2 0 −1 −2 1 → peak 1 (after trade 0), trough −2 after trade 3
    const dd = drawdownOfR(t)!;
    expect(dd.depth).toBe(3);
    expect([dd.span.from, dd.span.to, dd.span.sumR]).toEqual([1, 3, -3]);
    expect(drawdownOfR(chain([1, 1, 1]))).toBeNull();
    // the start counts as the first peak
    expect(drawdownOfR(chain([-1, -1]))!.depth).toBe(2);
  });

  it("Stresstest: unter 10 Trades ohne Simulation, mit Grund; darüber fester Seed, gleiche Zahlen", () => {
    const few = lossStreakStress(t, 1);
    expect(t.length).toBeLessThan(MC_MIN_TRADES);
    expect(few.mc).toBeNull();
    expect(few.mcNote).toMatch(/zu grob/);
    expect(few.drawdownShare).toBeCloseTo(0.03, 12); // 3 R at 1 % risk per trade

    const many = chain([1, -1, -1, 2, -1, -1, -1, 3, -1, 1, -1, 2, -1, 1, -1]);
    const a = lossStreakStress(many, 1);
    const b = lossStreakStress(many, 1);
    expect(a.mc).not.toBeNull();
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(b).toEqual(a);
    const mc = a.mc!;
    expect(mc.runs).toBe(2000);
    expect(mc.ddP50).toBeLessThanOrEqual(mc.ddP95);
    expect(mc.ddP95).toBeLessThanOrEqual(mc.ddP99);
    expect(mc.streakP50).toBeLessThanOrEqual(mc.streakP95);
    expect(mc.shareAtLeastReal).toBeGreaterThan(0);
    expect(mc.shareAtLeastReal).toBeLessThanOrEqual(1);
    // a reshuffle keeps every trade: the sum is the real one
    expect(a.sumR).toBe(many.reduce((s, x) => s + x.r, 0));
  });

  it("nur Gewinner: kein Drawdown, jede Reihenfolge gleich", () => {
    const s = lossStreakStress(chain(Array<number>(12).fill(1)), 1);
    expect(s.drawdownR).toBeNull();
    expect(s.drawdownShare).toBeNull();
    expect(s.longestLosing).toBeNull();
    expect(s.mc).toMatchObject({ ddP50: 0, ddP95: 0, ddP99: 0, shareAtLeastReal: 1, streakP95: 0 });
  });

  it("ohne Trades: leer, nichts bricht", () => {
    const s = lossStreakStress([], 1);
    expect(s).toMatchObject({ n: 0, sumR: 0, longestLosing: null, drawdownR: null, mc: null });
    expect(s.worstWindows).toEqual([]);
  });
});

// ── wrappers on the engine ────────────────────────────────────────────────────────────────────────────────────────

const flat = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 3600, o: 100, h: 101, l: 99, c: 100 }));
const FREE: EngineCfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 5, compounding: false, costs: { fees: { exchange: "x", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } } };
const long = (stop = 95): EntrySignal => ({ side: "long", stop, target: 110, maxBars: 3, tag: "T" });
const at = (...idx: number[]): BtStrategy => ({ start: 5, signalAt: (i) => (idx.includes(i) ? long() : null) });
const run = (s: BtStrategy) => runBacktest(flat(60), s, FREE, { secLen: 3600 });

describe("eine Kerze später", () => {
  it("dasselbe Signal füllt eine Kerze später", () => {
    expect(run(at(10)).trades.map((x) => x.entryIndex)).toEqual([11]);
    expect(run(delayed(at(10))).trades.map((x) => x.entryIndex)).toEqual([12]);
  });

  it("ein Signal, das auftauchte, während die Engine schon in einer Position war, bleibt ungenutzt", () => {
    // base: signal at 10 fills at 11 (3 bars → exit at 13); a signal at 12 comes while in position and is never asked
    expect(run(at(10, 12)).trades.map((x) => x.entryIndex)).toEqual([11]);
    // delayed: the signal of 10 is placed at 11 and fills at 12 (exit 14); the one of 12 would be placed at 13 – in position
    expect(run(delayed(at(10, 12))).trades.map((x) => x.entryIndex)).toEqual([12]);
  });

  it("die Verzögerung betrifft nie die erste Kerze der Strategie und sieht nichts aus der Zukunft", () => {
    const seen: number[] = [];
    const spy: BtStrategy = { start: 5, signalAt: (i) => (seen.push(i), null) };
    run(delayed(spy));
    // the inner strategy is only ever asked about a bar the engine had already closed
    expect(Math.min(...seen)).toBe(5);
    expect(seen.every((i, k) => k === 0 || i === seen[k - 1]! + 1)).toBe(true);
  });
});

describe("Stopp-Abstand", () => {
  const bars = flat(30);
  it("skaliert um den Schlusskurs der Signalkerze, das Ziel bleibt", () => {
    const s = stopScaled({ start: 0, signalAt: () => long(95) }, bars, 0.5)!.signalAt(10)!;
    expect(s.stop).toBeCloseTo(97.5, 12);
    expect(s.target).toBe(110);
    const wide = stopScaled({ start: 0, signalAt: () => long(95) }, bars, 1.5)!.signalAt(10)!;
    expect(wide.stop).toBeCloseTo(92.5, 12);
    const short = stopScaled({ start: 0, signalAt: () => ({ side: "short", stop: 104, target: 90, maxBars: 3, tag: "T" }) }, bars, 0.5)!.signalAt(10)!;
    expect(short.stop).toBeCloseTo(102, 12);
  });
  it("kein Signal bleibt kein Signal", () => {
    expect(stopScaled({ start: 0, signalAt: () => null }, bars, 0.5).signalAt(3)).toBeNull();
  });
});

// ── scenario table ────────────────────────────────────────────────────────────────────────────────────────────────

describe("Szenarien", () => {
  const byId = (e: EngineCfg) => Object.fromEntries(scenarioDefs(e).map((d) => [d.id, d]));

  it("Gebühren ×2, Slippage ×2, Funding aus / an / doppelt – aus den Kosten des Laufs", () => {
    const d = byId({ ...ENGINE, costs: { ...ENGINE.costs, funding: { kind: "history", points: [{ t: 1, rate: 0.0001 }, { t: 2, rate: -0.0002 }], fallbackRate: 0.0001 } } });
    expect(d.base!.engine).not.toBeNull();
    expect(d.fees2!.engine!.costs.fees).toMatchObject({ makerBps: 4, takerBps: 10 });
    expect(d.slip2!.engine!.costs.slippage).toEqual({ kind: "fixed", bps: 4 });
    expect(d.slip2!.status).toBe("ok");
    expect(d.fundOff!.engine!.costs.funding).toEqual({ kind: "none" });
    expect(d.fund2!.engine!.costs.funding).toEqual({ kind: "history", points: [{ t: 1, rate: 0.0002 }, { t: 2, rate: -0.0004 }], fallbackRate: 0.0002 });
    // the run already has funding: "mit Funding" is the base, and the note says so
    expect(d.fundOn!.note).toMatch(/Historie/);
  });

  it("fehlende Daten: nicht blockiert, sondern mit genanntem Ersatz – oder mit Grund nicht gerechnet", () => {
    const none = byId({ ...ENGINE, costs: { fees: { exchange: "x", makerBps: 2, takerBps: 5 }, slippage: { kind: "none" }, funding: { kind: "none" } } });
    expect(none.slip2).toMatchObject({ status: "approx", label: "Slippage 2 bp" });
    expect(none.slip2!.note).toMatch(/ohne Slippage/);
    expect(none.fundOn).toMatchObject({ status: "approx" });
    expect(none.fundOn!.note).toMatch(/Annahme, nicht gemessen/);
    expect(none.fund2!.status).toBe("approx");
    expect(none.combined!.status).toBe("approx");
    const free = byId(FREE);
    expect(free.fees2).toMatchObject({ status: "unavailable", engine: null });
    expect(free.fees2!.note).toMatch(/ohne Gebühren/);
  });

  it("Kombination = Gebühren ×2 + Slippage ×2 + 1 Kerze später", () => {
    const c = byId(ENGINE).combined!;
    expect(c.delay).toBe(true);
    expect(c.engine!.costs.fees).toMatchObject({ makerBps: 4, takerBps: 10 });
    expect(c.engine!.costs.slippage).toEqual({ kind: "fixed", bps: 4 });
  });
});

// ── a real run ────────────────────────────────────────────────────────────────────────────────────────────────────

describe("Belastungstest auf echten BTCUSDT-Kerzen", () => {
  const input = realInput();
  const main = createLabJob(input).result();
  const out = createExtraJob({ base: input, what: "stress" }).result();
  const rows = (out.what === "stress" ? out.rows.rows : []) as ScenarioRow[];
  const row = (id: string): ScenarioRow => rows.find((r) => r.id === id)!;

  it("der Basislauf ist der Lauf oben, Zahl für Zahl", () => {
    expect(main.stats.n).toBeGreaterThan(5);
    const b = row("base").stats!;
    expect(b.n).toBe(main.stats.n);
    expect(b.sumR).toBeCloseTo(main.stats.sumR, 9);
    expect(b.net).toBeCloseTo(main.stats.net, 6);
    expect(b.maxDD).toBeCloseTo(main.stats.maxDD, 12);
    expect(row("base").dSumR).toBeNull();
  });

  it("alle Zeilen da, jede mit Zahlen oder mit Grund; Veränderungen sind Differenzen zum Basislauf", () => {
    expect(rows.map((r) => r.id)).toEqual(["base", "fees2", "slip2", "fundOff", "fundOn", "fund2", "delay1", "stopTight", "stopWide", "combined"]);
    for (const r of rows) {
      if (r.status === "unavailable") expect(r.note).toBeTruthy();
      else expect(r.stats).not.toBeNull();
    }
    const base = row("base").stats!;
    const f = row("fees2");
    expect(f.dSumR).toBeCloseTo(f.stats!.sumR - base.sumR, 12);
    expect(f.dMaxDD).toBeCloseTo(f.stats!.maxDD - base.maxDD, 12);
    expect(f.dN).toBe(f.stats!.n - base.n);
  });

  it("teurere Kosten machen das Ergebnis nicht besser (gleiche Trades, höhere Kosten je Trade)", () => {
    const base = row("base").stats!;
    expect(row("fees2").stats!.n).toBe(base.n);
    expect(row("fees2").stats!.sumR).toBeLessThan(base.sumR);
    expect(row("slip2").stats!.sumR).toBeLessThan(base.sumR);
    // funding is flat 0,01 % per 8 h in this run: a long pays it, so "ohne Funding" is better and "doppelt" worse
    expect(row("fundOff").stats!.sumR).toBeGreaterThan(base.sumR);
    expect(row("fund2").stats!.sumR).toBeLessThan(base.sumR);
    // "mit Funding" of a run that has it is the base
    expect(row("fundOn").stats!.sumR).toBeCloseTo(base.sumR, 12);
    expect(row("combined").status).toBe("ok");
    expect(row("combined").stats).not.toBeNull();
  });

  it("Verzögerung und Stopp-Abstände laufen wirklich anders", () => {
    const base = row("base").stats!;
    for (const id of ["delay1", "stopTight", "stopWide"]) expect(row(id).stats!.sumR !== base.sumR || row(id).stats!.n !== base.n).toBe(true);
  });

  it("deterministisch und JSON-sicher; der Runner im Leerlauf gibt dasselbe", async () => {
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(createExtraJob({ base: input, what: "stress" }).result()).toEqual(out);
    const idle = await runExtra({ base: input, what: "stress" }, { mode: "idle" });
    expect(idle).toEqual(out);
  }, 60_000);

  it("Fortschritt läuft von 0 bis 1 und der Job meldet die Diagnose-Phase", () => {
    const job = createExtraJob({ base: input, what: "stress" });
    expect(job.phase()).toBe("diagnose");
    expect(job.progress()).toBe(0);
    let last = 0;
    while (!job.step(performance.now() + 5)) {
      const p = job.progress();
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThan(1);
      last = p;
    }
    expect(job.progress()).toBe(1);
  }, 60_000);

  it("ein Zeitraum ohne genug Kerzen: jede Zeile sagt es", () => {
    const tiny = realInput({ fromMs: input.toMs, toMs: input.toMs });
    const r = createExtraJob({ base: tiny, what: "stress" }).result();
    const rs = r.what === "stress" ? r.rows.rows : [];
    expect(rs.every((x) => x.status === "unavailable" && x.stats === null && x.note)).toBe(true);
  }, 60_000);
});
