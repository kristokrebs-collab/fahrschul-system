import { describe, expect, it } from "vitest";
import { runBacktest, runStats, type Bar, type BtStrategy, type EngineCfg, type EntrySignal } from "@/domain/backtest/index";

const H = 3600;
/** Bars from [o, h, l, c] rows, 1h apart starting at 2026-01-01 00:00 UTC. */
function bars(rows: [number, number, number, number][]): Bar[] {
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  return rows.map(([o, h, l, c], i) => ({ t: t0 + i * H, o, h, l, c }));
}
const flat = (n: number, px = 100): [number, number, number, number][] => Array.from({ length: n }, () => [px, px + 1, px - 1, px]);

const cfg = (over: Partial<EngineCfg> = {}): EngineCfg => ({
  capital: 10_000,
  riskPct: 0.01,
  maxLeverage: 100,
  compounding: true,
  costs: { fees: { exchange: "x", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } },
  ...over,
});

/** Signals once at bar `at` (and records every index it was asked about). */
function once(at: number, s: Omit<EntrySignal, "tag">, seen: number[] = []): BtStrategy {
  return {
    start: 0,
    signalAt(i) {
      seen.push(i);
      return i === at ? { ...s, tag: "T" } : null;
    },
  };
}

describe("Backtest-Engine", () => {
  it("füllt ein Signal erst zur Eröffnung der nächsten Kerze (kein Blick in die Zukunft)", () => {
    const b = bars([...flat(5), [101, 103, 100.5, 102], ...flat(5, 102)]);
    const seen: number[] = [];
    const run = runBacktest(b, once(4, { side: "long", stop: 95, target: 110, maxBars: 3 }, seen), cfg(), { secLen: H });
    expect(run.trades).toHaveLength(1);
    const t = run.trades[0]!;
    expect(t.entryIndex).toBe(5);
    expect(t.entry).toBe(101); // open of bar 5, not the close of the signal bar
    expect(t.entryTime).toBe(b[5]!.t * 1000);
    // the strategy was asked in time order and never about the last bar of the window
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(Math.max(...seen)).toBeLessThan(b.length - 1);
  });

  it("nimmt im selben Bar zuerst den Stop, wenn Stop und Ziel getroffen wurden", () => {
    const b = bars([...flat(3), [100, 100.5, 99.5, 100], [100, 112, 90, 100], ...flat(3)]);
    const run = runBacktest(b, once(3, { side: "long", stop: 95, target: 110, maxBars: null }), cfg(), { secLen: H });
    expect(run.trades[0]!.reason).toBe("stop");
    expect(run.trades[0]!.exit).toBe(95);
    expect(run.trades[0]!.r).toBeCloseTo(-1, 6);
  });

  it("füllt einen über den Stop gegappten Bar zur Eröffnung", () => {
    const b = bars([...flat(3), [100, 100.5, 99.5, 100], [100, 101, 99, 100], [92, 93, 91, 92], ...flat(2, 92)]);
    const run = runBacktest(b, once(3, { side: "long", stop: 95, target: 110, maxBars: null }), cfg(), { secLen: H });
    const t = run.trades[0]!;
    expect(t.reason).toBe("stop");
    expect(t.exit).toBe(92);
    expect(t.r).toBeCloseTo(-8 / 5, 6);
  });

  it("überspringt ein Signal, wenn die Eröffnung schon hinter dem Stop liegt", () => {
    const b = bars([...flat(3), [100, 100, 100, 100], [94, 95, 93, 94], ...flat(3, 94)]);
    const run = runBacktest(b, once(3, { side: "long", stop: 95, target: 110, maxBars: null }), cfg(), { secLen: H });
    expect(run.trades).toHaveLength(0);
    expect(run.skipped).toBe(1);
  });

  it("Ziel als Limit: kein Slippage, Maker-Gebühr; Einstieg mit Taker-Gebühr und Slippage", () => {
    const b = bars([...flat(3), [100, 100, 100, 100], [100, 101, 99, 100], [100, 111, 99, 110], ...flat(2, 110)]);
    const c = cfg({ costs: { fees: { exchange: "x", makerBps: 2, takerBps: 5 }, slippage: { kind: "fixed", bps: 10 }, funding: { kind: "none" } } });
    const run = runBacktest(b, once(3, { side: "long", stop: 95, target: 110, maxBars: null }), c, { secLen: H });
    const t = run.trades[0]!;
    expect(t.entry).toBeCloseTo(100.1, 9); // 10 bp against the buyer
    expect(t.exit).toBe(110);
    expect(t.reason).toBe("target");
    const fees = t.qty * 100.1 * 0.0005 + t.qty * 110 * 0.0002;
    expect(t.fees).toBeCloseTo(fees, 6);
    expect(t.pnl).toBeCloseTo(t.qty * (110 - 100.1) - fees, 6);
    expect(t.slippage).toBeCloseTo(t.qty * 0.1, 6);
  });

  it("riskiert den Anteil des Kapitals und deckelt den Hebel", () => {
    const b = bars([...flat(3), [100, 100, 100, 100], [100, 101, 99, 100], ...flat(3)]);
    const r1 = runBacktest(b, once(3, { side: "long", stop: 99, target: null, maxBars: 1 }), cfg(), { secLen: H });
    expect(r1.trades[0]!.qty).toBeCloseTo(100, 6); // 1 % of 10 000 over a 1-point stop
    // a 0,1-point stop would size 1 000 units (100 000 notional): the 2× cap allows 20 000 / 100 = 200
    const r2 = runBacktest(b, once(3, { side: "long", stop: 99.9, target: null, maxBars: 1 }), cfg({ maxLeverage: 2 }), { secLen: H });
    expect(r2.trades[0]!.qty).toBeCloseTo(200, 6);
    expect(r2.trades[0]!.notional).toBeLessThanOrEqual(20_000 + 1e-6);
  });

  it("Zeit-Stop schließt zum Schluss der n-ten Kerze, Fensterende zum letzten Schluss", () => {
    const b = bars([...flat(3), [100, 100, 100, 100], [100, 101, 99, 100.5], [100.5, 101, 100, 100.8], [100.8, 101, 100, 100.9]]);
    const run = runBacktest(b, once(3, { side: "long", stop: 90, target: 120, maxBars: 2 }), cfg(), { secLen: H });
    expect(run.trades[0]!.reason).toBe("time");
    expect(run.trades[0]!.exit).toBe(100.8);
    expect(run.trades[0]!.exitTime).toBe((b[5]!.t + H) * 1000);
    const end = runBacktest(b, once(3, { side: "long", stop: 90, target: 120, maxBars: null }), cfg(), { secLen: H, to: 5 });
    expect(end.trades[0]!.reason).toBe("end");
    expect(end.trades[0]!.exit).toBe(100.8);
  });

  it("Funding: Long zahlt einen positiven Satz pro 8-h-Abrechnung, Short bekommt ihn", () => {
    // 24 bars of 1h from 00:00: a trade from 01:00 to the close of 17:00 holds the 08:00 and 16:00 settlements
    const b = bars(flat(24));
    const c = cfg({ costs: { fees: { exchange: "x", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "flat", ratePer8h: 0.001 } } });
    const long = runBacktest(b, once(0, { side: "long", stop: 90, target: null, maxBars: 17 }), c, { secLen: H });
    expect(long.trades[0]!.funding).toBeCloseTo(2 * 0.001 * long.trades[0]!.qty * 100, 6);
    const short = runBacktest(b, once(0, { side: "short", stop: 110, target: null, maxBars: 17 }), c, { secLen: H });
    expect(short.trades[0]!.funding).toBeCloseTo(-2 * 0.001 * short.trades[0]!.qty * 100, 6);
  });

  it("Kennzahlen: Win-Rate mit Intervall, Ø R, Bewegung ohne Hebel für die Backtest-Referenz", () => {
    const rows: [number, number, number, number][] = [];
    for (let k = 0; k < 6; k++) rows.push([100, 100, 100, 100], [100, 100.5, 99.5, 100], k % 3 === 2 ? [100, 100.2, 94, 95] : [100, 111, 99.5, 110], [100, 100, 100, 100]);
    const b = bars(rows);
    const s: BtStrategy = { start: 0, signalAt: (i) => (i % 4 === 0 ? { side: "long", stop: 95, target: 110, maxBars: null, tag: "T" } : null) };
    const run = runBacktest(b, s, cfg(), { secLen: H });
    const st = runStats(run);
    expect(st.n).toBe(6);
    expect(st.wins).toBe(4);
    expect(st.winRate).toBeCloseTo(4 / 6, 9);
    expect(st.winRateCI!.lo).toBeLessThan(st.winRate!);
    expect(st.winRateCI!.hi).toBeGreaterThan(st.winRate!);
    expect(st.moveWin).toBeCloseTo(0.1, 9);
    expect(st.moveLoss).toBeCloseTo(-0.05, 9);
    expect(st.avgR).toBeCloseTo((4 * 2 - 2) / 6, 6);
    expect(st.maxDD).toBeGreaterThan(0);
  });
});
