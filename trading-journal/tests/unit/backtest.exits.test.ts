/**
 * F65 – position management of the engine: break-even, trailing stop, partial take-profit. Hand-built 1h bars, zero costs
 * unless a test is about them. Every number is derived in the comment next to it (entry 100, stop 95 → 1 R = 5, risk 100
 * of 10 000 → 20 units).
 */
import { describe, expect, it } from "vitest";
import { runBacktest, type Bar, type BtStrategy, type EngineCfg, type EntrySignal, type PositionMgmt } from "@/domain/backtest/index";

const H = 3600;
type Row = [number, number, number, number];
function bars(rows: Row[]): Bar[] {
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  return rows.map(([o, h, l, c], i) => ({ t: t0 + i * H, o, h, l, c }));
}
const flat = (n: number, px = 100): Row[] => Array.from({ length: n }, () => [px, px + 1, px - 1, px]);

const cfg = (over: Partial<EngineCfg> = {}): EngineCfg => ({
  capital: 10_000,
  riskPct: 0.01,
  maxLeverage: 100,
  compounding: true,
  costs: { fees: { exchange: "x", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } },
  ...over,
});
const costed = cfg({ costs: { fees: { exchange: "x", makerBps: 2, takerBps: 5 }, slippage: { kind: "none" }, funding: { kind: "none" } } });

function once(at: number, s: Omit<EntrySignal, "tag">): BtStrategy {
  return { start: 0, signalAt: (i) => (i === at ? { ...s, tag: "T" } : null) };
}
const long = (manage: PositionMgmt, over: Partial<EntrySignal> = {}): Omit<EntrySignal, "tag"> => ({ side: "long", stop: 95, target: 120, maxBars: null, manage, ...over });
const short = (manage: PositionMgmt, over: Partial<EntrySignal> = {}): Omit<EntrySignal, "tag"> => ({ side: "short", stop: 105, target: 80, maxBars: null, manage, ...over });

/** bars 0-2 flat, 3 = signal bar, 4 = fill bar (opens 100), then the rows given */
const lead: Row[] = [...flat(3), [100, 100.5, 99.5, 100], [100, 102, 99.5, 101]];
const run = (rows: Row[], s: Omit<EntrySignal, "tag">, c: EngineCfg = cfg(), atr?: number) => {
  const b = bars([...lead, ...rows]);
  return runBacktest(b, once(3, s), c, { secLen: H, atr: atr ? b.map(() => atr) : undefined });
};

const BE_R1: PositionMgmt = { breakEven: { after: { kind: "r", value: 1 }, to: "entry" } };

describe("Break-even", () => {
  it("Long: nach +1 R rückt der Stop auf den Einstieg – ab der NÄCHSTEN Kerze", () => {
    // bar 5 reaches 106 ≥ 105 (+1 R) but also falls to 98 (below the future break-even): the new stop is not retroactive
    const r = run([[101, 106, 98, 105], [105, 107, 99.5, 100], ...flat(2)], long(BE_R1));
    const t = r.trades[0]!;
    expect(t.exitIndex).toBe(6); // bar 5 did not stop the trade out (original stop 95 untouched)
    expect(t.reason).toBe("breakeven");
    expect(t.exit).toBe(100);
    expect(t.stop).toBe(95); // the original stop stays on the trade
    expect(t.stopExit).toBe(100);
    expect(t.r).toBeCloseTo(0, 9);
    expect(t.pnl).toBeCloseTo(0, 9);
  });

  it("Short: gespiegelt", () => {
    // short from 100, stop 105; bar 5 low 94 ≤ 95 (+1 R); bar 6 high 100.5 ≥ 100 → break-even stop
    const r = run([[99, 99.5, 94, 95], [96, 100.5, 95.5, 99.5], ...flat(2)], short(BE_R1));
    const t = r.trades[0]!;
    expect(t.side).toBe("short");
    expect(t.reason).toBe("breakeven");
    expect(t.exit).toBe(100);
    expect(t.stop).toBe(105);
    expect(t.stopExit).toBe(100);
    expect(t.r).toBeCloseTo(0, 9);
  });

  it("Gap durch den Break-even-Stop füllt zur Eröffnung (Long −0,6 R)", () => {
    const r = run([[101, 106, 100.5, 105], [97, 98, 96, 97], ...flat(2, 97)], long(BE_R1));
    const t = r.trades[0]!;
    expect(t.reason).toBe("breakeven");
    expect(t.exit).toBe(97);
    expect(t.r).toBeCloseTo(-3 / 5, 9);
  });

  it("derselbe Balken: Auslöser und ursprünglicher Stop – der Stop gewinnt, kein Break-even rückwirkend", () => {
    // bar 5 touches +1 R (106) AND the original stop (94 ≤ 95): conservative = the stop
    const r = run([[101, 106, 94, 100], ...flat(3)], long(BE_R1));
    const t = r.trades[0]!;
    expect(t.reason).toBe("stop");
    expect(t.exit).toBe(95);
    expect(t.r).toBeCloseTo(-1, 9);
    expect(t.stopExit).toBeUndefined();
    expect(t.ambiguous).toBeUndefined(); // no take-profit involved
  });

  it("Auslöser in Prozent", () => {
    // +3 % = 103: bar 4 reaches only 102, bar 5 reaches 106
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 99.5, 100.2], ...flat(2)], long({ breakEven: { after: { kind: "pct", value: 3 }, to: "entry" } }));
    expect(r.trades[0]!.reason).toBe("breakeven");
    expect(r.trades[0]!.exitIndex).toBe(6);
  });

  it("liegt der Break-even-Stop nicht hinter dem Schlusskurs, wird er nicht gesetzt (und später erneut versucht)", () => {
    // bar 5 touches +1 R but closes at 99.5 < 100: a stop at 100 would sit above the price
    const r = run([[101, 106, 99, 99.5], [99.5, 100.5, 98, 99], [99, 99.5, 98, 99], ...flat(2)], long(BE_R1));
    const t = r.trades[0]!;
    expect(t.stopExit).toBeUndefined();
    expect(t.reason).toBe("end"); // never stopped: bars 6 / 7 stayed above the ORIGINAL stop 95
  });

  it("Netto-Break-even deckt Einstiegs- und Ausstiegsgebühr: ein Stop dort ergibt netto ≈ 0", () => {
    const r = run([[101, 106, 100.5, 105], [104, 104.5, 99, 100.5], ...flat(2)], long({ breakEven: { after: { kind: "r", value: 1 }, to: "net" } }), costed);
    const t = r.trades[0]!;
    expect(t.reason).toBe("breakeven");
    // level = (100 + entryFee/qty) / (1 − 5 bp) with entryFee = 20 × 100 × 5 bp = 1
    expect(t.exit).toBeCloseTo((100 + 1 / 20) / (1 - 0.0005), 9);
    expect(t.pnl).toBeCloseTo(0, 9);
    // and the same exit at the plain entry is a (small) loss
    const plain = run([[101, 106, 100.5, 105], [104, 104.5, 99, 100.5], ...flat(2)], long(BE_R1), costed).trades[0]!;
    expect(plain.pnl).toBeCloseTo(-(1 + 20 * 100 * 0.0005), 9);
  });
});

describe("Trailing-Stop", () => {
  const trailAtr: PositionMgmt = { trail: { kind: "atr", value: 1.5, activateR: 0 } };
  it("ATR-Trail zieht nach (Ratsche) und stoppt ab der nächsten Kerze; R bleibt am ursprünglichen Stop", () => {
    // ATR 2 × 1.5 = 3 behind the highest high: 102 → 99 | 106 → 103 | 110 → 107; bar 7 low 106 ≤ 107 → exit at 107
    const r = run([[101, 106, 100.5, 105], [105, 110, 104, 109], [108, 108.5, 106, 107], ...flat(2)], long(trailAtr), cfg(), 2);
    const t = r.trades[0]!;
    expect(t.reason).toBe("trail");
    expect(t.exitIndex).toBe(7);
    expect(t.exit).toBe(107);
    expect(t.stop).toBe(95);
    expect(t.stopExit).toBe(107);
    expect(t.r).toBeCloseTo(7 / 5, 9); // (107 − 100) / (100 − 95): the ORIGINAL stop is the risk
    expect(t.pnl).toBeCloseTo(140, 9);
  });

  it("der Trail lockert sich nie, wenn der Kurs zurückfällt", () => {
    // bar 6 pulls back (high 105): the stop stays at 103 (from bar 5's 106), it does not follow the lower high
    const r = run([[101, 106, 100.5, 105], [105, 105, 103.5, 104], [104, 104.2, 102.9, 103], ...flat(2)], long(trailAtr), cfg(), 2);
    const t = r.trades[0]!;
    expect(t.reason).toBe("trail");
    expect(t.exitIndex).toBe(7);
    expect(t.exit).toBe(103);
  });

  it("Trail erst ab +1 R aktiv (activateR)", () => {
    // bar 4 peaks at 102 (< +1 R): no trailing yet, the stop is still 95; bar 5 reaches 106 → armed, stop 103 from bar 6
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 102.5, 103], ...flat(2)], long({ trail: { kind: "atr", value: 1.5, activateR: 1 } }), cfg(), 2);
    const t = r.trades[0]!;
    expect(t.reason).toBe("trail");
    expect(t.exitIndex).toBe(6);
    expect(t.exit).toBe(103);
    expect(t.r).toBeCloseTo(0.6, 9);
  });

  it("Trail in Prozent, Short gespiegelt", () => {
    // short from 100: lowest low 94 → 2 % above = 95.88
    const r = run([[99, 99.5, 94, 95], [95, 96.5, 94.5, 96], ...flat(2)], short({ trail: { kind: "pct", value: 2, activateR: 0 } }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("trail");
    expect(t.exit).toBeCloseTo(94 * 1.02, 9);
    expect(t.r).toBeCloseTo((100 - 94 * 1.02) / 5, 9);
  });

  it("Break-even und Trail zusammen: das engere Niveau gilt, nie ein lockereres", () => {
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 102.9, 103], ...flat(2)], long({ ...BE_R1, ...trailAtr }), cfg(), 2);
    const t = r.trades[0]!;
    expect(t.stopExit).toBe(103); // BE (100) was tightened by the trail (103), never the other way round
    expect(t.reason).toBe("trail");
  });
});

describe("Teil-Gewinnmitnahme", () => {
  const P1: PositionMgmt = { partial: { atR: 1, frac: 0.5 } };
  it("Long: die Hälfte bei +1 R, der Rest läuft zum Ziel – P&L und R stimmen", () => {
    // 10 units at 105 (+50) and 10 at 115 (+150) = 200 → 2 R of the original 100 risk
    const r = run([[101, 106, 100.5, 105], [105, 116, 104, 115], ...flat(2)], long(P1, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("target");
    expect(t.partials).toHaveLength(1);
    expect(t.partials![0]).toMatchObject({ index: 5, price: 105, qty: 10 });
    expect(t.qty).toBeCloseTo(20, 9);
    expect(t.pnl).toBeCloseTo(200, 9);
    expect(t.r).toBeCloseTo(2, 9);
    expect(t.exit).toBe(115);
    expect(t.move).toBeCloseTo(0.1, 9); // average exit 110
  });

  it("Gebühren: Taker beim Einstieg, Maker bei Teil und Ziel", () => {
    const r = run([[101, 106, 100.5, 105], [105, 116, 104, 115], ...flat(2)], long(P1, { target: 115 }), costed);
    const t = r.trades[0]!;
    const fees = 20 * 100 * 0.0005 + 10 * 105 * 0.0002 + 10 * 115 * 0.0002;
    expect(t.fees).toBeCloseTo(fees, 9);
    expect(t.pnl).toBeCloseTo(200 - fees, 9);
    expect(t.partials![0]!.fee).toBeCloseTo(10 * 105 * 0.0002, 9);
  });

  it("danach Stop am ursprünglichen Niveau: Rest −50, Summe 0", () => {
    const r = run([[101, 106, 100.5, 105], [104, 105, 94, 95], ...flat(2)], long(P1, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("stop");
    expect(t.partials).toHaveLength(1);
    expect(t.pnl).toBeCloseTo(0, 9); // +50 − 50
    expect(t.r).toBeCloseTo(0, 9);
  });

  it("thenBreakEven: nach dem Teil rückt der Stop auf den Einstieg → Rest 0, Summe +50 (0,5 R)", () => {
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 99, 100], ...flat(2)], long({ partial: { atR: 1, frac: 0.5, thenBreakEven: true } }, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("breakeven");
    expect(t.exit).toBe(100);
    expect(t.pnl).toBeCloseTo(50, 9);
    expect(t.r).toBeCloseTo(0.5, 9);
  });

  it("derselbe Balken mit Stop: der Stop gewinnt, die Teilmitnahme zählt nicht (ambiguous)", () => {
    const r = run([[101, 106, 94, 98], ...flat(3)], long(P1, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("stop");
    expect(t.partials).toBeUndefined();
    expect(t.r).toBeCloseTo(-1, 9);
    expect(t.ambiguous).toBe(true);
  });

  it("Stop und Ziel im selben Balken: Stop gewinnt und der Trade ist als mehrdeutig markiert", () => {
    const r = run([[101, 118, 94, 100], ...flat(3)], { side: "long", stop: 95, target: 115, maxBars: null });
    const t = r.trades[0]!;
    expect(t.reason).toBe("stop");
    expect(t.ambiguous).toBe(true);
    // an open that gaps through the stop is NOT ambiguous: the order is known
    const g = run([[101, 102, 100.5, 101], [90, 118, 89, 100], ...flat(2)], { side: "long", stop: 95, target: 115, maxBars: null }).trades[0]!;
    expect(g.reason).toBe("stop");
    expect(g.exit).toBe(90);
    expect(g.ambiguous).toBeUndefined();
  });

  it("Teil und Ziel im selben Balken (ohne Stop): erst der Teil, dann das Ziel", () => {
    const r = run([[101, 116, 100.5, 115], ...flat(3)], long(P1, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("target");
    expect(t.partials).toHaveLength(1);
    expect(t.r).toBeCloseTo(2, 9);
  });

  it("Teil-Limit nicht näher als das Ziel: wird verworfen", () => {
    const r = run([[101, 116, 100.5, 115], ...flat(3)], long({ partial: { atR: 4, frac: 0.5 } }, { target: 115 }));
    const t = r.trades[0]!;
    expect(t.partials).toBeUndefined();
    expect(t.r).toBeCloseTo(3, 9);
  });

  it("Zeit-Stop schließt den Rest zum Schlusskurs", () => {
    // maxBars 3 = bars 4, 5, 6: partial at bar 5, the rest (10) exits at bar 6's close 104.5 → +45; total 95
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 104, 104.5], ...flat(2)], long(P1, { target: 120, maxBars: 3 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("time");
    expect(t.pnl).toBeCloseTo(95, 9);
    expect(t.r).toBeCloseTo(0.95, 9);
  });

  it("Short gespiegelt", () => {
    // short 100, stop 105, partial at 95 (half), target 85: 10 × 5 + 10 × 15 = 200
    const r = run([[99, 99.5, 94, 95], [95, 96, 84, 85], ...flat(2, 85)], short(P1, { target: 85 }));
    const t = r.trades[0]!;
    expect(t.reason).toBe("target");
    expect(t.partials![0]).toMatchObject({ price: 95, qty: 10 });
    expect(t.pnl).toBeCloseTo(200, 9);
    expect(t.r).toBeCloseTo(2, 9);
  });

  it("die Equity nach dem Teil: Realisiertes + Rest zum Schluss (ohne Einstiegsgebühr doppelt zu zählen)", () => {
    const r = run([[101, 106, 100.5, 105], [105, 105.5, 104, 104.5], ...flat(2)], long(P1, { target: 120 }), costed);
    const eq = r.equity;
    // bar 5 close 105: partial +50 − its fee, rest 10 × 5 = 50, minus the entry fee (1)
    expect(eq[5]!.equity).toBeCloseTo(10_000 + 50 - 10 * 105 * 0.0002 + 50 - 1, 9);
    // the last trade result equals the final equity
    const t = r.trades[0]!;
    expect(eq[eq.length - 1]!.equity).toBeCloseTo(10_000 + t.pnl, 9);
  });
});

describe("Rückwärtskompatibilität und Zähler", () => {
  it("eine leere Verwaltung ändert nichts an einem Lauf ohne Verwaltung", () => {
    const rows: Row[] = [[101, 106, 100.5, 105], [105, 121, 104, 120], ...flat(2)];
    const plain = run(rows, { side: "long", stop: 95, target: 120, maxBars: null }, costed);
    const empty = run(rows, { side: "long", stop: 95, target: 120, maxBars: null, manage: {} }, costed);
    expect(empty.trades).toEqual(plain.trades);
    expect(empty.equity).toEqual(plain.equity);
    expect(plain.trades[0]!.stopExit).toBeUndefined();
    expect(plain.trades[0]!.partials).toBeUndefined();
  });

  it("zählt Signale und Übersprungene getrennt (Gap / Risiko)", () => {
    // signal at 3 → the next open (94) gapped below the stop 95; signal at 6 → stop 99.99 is too close (MIN_RISK_FRAC)
    const b = bars([...flat(3), [100, 100, 100, 100], [94, 95, 93, 94], ...flat(2, 94), [94, 94, 94, 94], [94, 94, 94, 94], ...flat(2, 94)]);
    const strat: BtStrategy = {
      start: 0,
      signalAt: (i) => (i === 3 ? { side: "long", stop: 95, target: 110, maxBars: null, tag: "a" } : i === 7 ? { side: "long", stop: 93.99, target: 110, maxBars: null, tag: "b" } : null),
    };
    const r = runBacktest(b, strat, cfg(), { secLen: H });
    expect(r.signals).toBe(2);
    expect(r.skippedGap).toBe(1);
    expect(r.skippedRisk).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.trades).toHaveLength(0);
  });
});
