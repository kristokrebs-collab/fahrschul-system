/**
 * F33 "Was wäre wenn" (`src/domain/whatif`): one recorded trade replayed on its own candles with another stop / break-even /
 * partial / exit. Hand-built candles, so every figure can be checked by eye.
 */
import { describe, expect, it } from "vitest";
import { BASELINE, candleAt, deltaR, PRESET_SCENARIOS, recordedOutcome, runScenarios, simulateScenario, tradeQty, whatIfBlocker, whatIfTradeOf, type Scenario, type WhatIfBar, type WhatIfTrade } from "@/domain/whatif";
import type { Trade } from "@/domain/types";

const STEP = 900_000;
const T0 = Date.UTC(2026, 9, 1, 8, 0);

/** Candles from `[open, high, low, close]` rows, 15 min apart, the first opening at `T0`. */
function candles(rows: readonly (readonly [number, number, number, number])[]): WhatIfBar[] {
  return rows.map(([open, high, low, close], i) => ({ time: T0 + i * STEP, open, high, low, close }));
}

/** Long from 100, stop 99 (risk 1), entry in candle 1, recorded exit in candle `exitIdx` at `exit`. */
function longTrade(over: Partial<WhatIfTrade> = {}): WhatIfTrade {
  return { side: "long", entry: 100, stop: 99, target: null, exit: 101.5, entryMs: T0 + STEP + 60_000, exitMs: T0 + 4 * STEP + 60_000, qty: 2, ...over };
}

// 0 signal candle, 1 entry candle, 2..4 the way up, 5.. after the recorded exit
const UP = candles([
  [99.8, 100.1, 99.7, 100],
  [100, 100.4, 99.6, 100.3],
  [100.3, 101.2, 100.2, 101.1],
  [101.1, 102.2, 100.9, 102],
  [102, 102.1, 101.2, 101.6],
  [101.6, 103.5, 101.5, 103.2],
  [103.2, 103.4, 98.5, 99],
]);

describe("candleAt", () => {
  it("finds the candle containing a time and −1 outside the series", () => {
    expect(candleAt(UP, T0 + STEP + 5, STEP)).toBe(1);
    expect(candleAt(UP, T0 - 1, STEP)).toBe(-1);
    expect(candleAt(UP, T0 + 7 * STEP, STEP)).toBe(-1);
    expect(candleAt([], T0, STEP)).toBe(-1);
  });
});

describe("simulateScenario", () => {
  it("replays the recorded rules to the recorded exit price (baseline) – R of the original stop, money = per unit × quantity", () => {
    const r = simulateScenario(longTrade(), UP, STEP, BASELINE);
    expect(r.status).toBe("ok");
    expect(r.exitReason).toBe("end");
    expect(r.exitLabel).toBe("Ist-Ausstieg (zum Ist-Kurs)");
    expect(r.exitPrice).toBeCloseTo(101.5, 10);
    expect(r.r).toBeCloseTo(1.5, 10);
    expect(r.money).toBeCloseTo(3, 10); // 1.5 per unit × 2 units, before fees
    expect(r.exitAt).toBe(T0 + 4 * STEP);
  });

  it("a tighter stop is hit by a candle low the original would have survived; the engine fills the stop at the stop", () => {
    const r = simulateScenario(longTrade(), UP, STEP, { id: "t", label: "enger", stop: { kind: "factor", value: 0.5 } });
    // stop 99.5; the ENTRY candle itself lows at 99.6 (above), candle 2..4 stay above → not hit; make a dip
    expect(r.status).toBe("ok");
    expect(r.stop).toBeCloseTo(99.5, 10);
    expect(r.exitReason).toBe("end");
    const dip = candles([
      [99.8, 100.1, 99.7, 100],
      [100, 100.4, 99.6, 100.3],
      [100.3, 100.5, 99.2, 100.2],
      [100.2, 101, 100.1, 101],
    ]);
    const hit = simulateScenario(longTrade({ exitMs: T0 + 3 * STEP + 1000, exit: 101 }), dip, STEP, { id: "t", label: "enger", stop: { kind: "factor", value: 0.5 } });
    expect(hit.exitReason).toBe("stop");
    expect(hit.exitPrice).toBeCloseTo(99.5, 10);
    expect(hit.r).toBeCloseTo(-0.5, 10); // −0.5 in R of the ORIGINAL distance (1.0)
    // the original stop 99 survives the dip (low 99.2) – the same trade, a different story
    expect(simulateScenario(longTrade({ exitMs: T0 + 3 * STEP + 1000, exit: 101 }), dip, STEP, BASELINE).exitReason).toBe("end");
  });

  it("a stop that gaps is filled at the open (worse than the stop)", () => {
    const gap = candles([
      [99.8, 100.1, 99.7, 100],
      [100, 100.4, 99.6, 100.3],
      [98.4, 98.9, 98.2, 98.5],
      [98.5, 99, 98, 98.8],
    ]);
    const r = simulateScenario(longTrade({ exitMs: T0 + 3 * STEP + 1000, exit: 98.8 }), gap, STEP, BASELINE);
    expect(r.exitReason).toBe("stop");
    expect(r.exitPrice).toBeCloseTo(98.4, 10);
    expect(r.r).toBeCloseTo(-1.6, 10);
  });

  it("break-even after +1 R moves the stop to the entry for the NEXT candle – and a later dip fills there", () => {
    const rows = candles([
      [99.8, 100.1, 99.7, 100],
      [100, 100.4, 99.6, 100.3],
      [100.3, 101.2, 100.2, 101.1], // best 101.2 ≥ +1 R at the close → BE in force from candle 3
      [101.1, 101.3, 99.9, 100.2], // dips through 100
      [100.2, 100.6, 100.0, 100.5],
    ]);
    const t = longTrade({ exitMs: T0 + 4 * STEP + 1000, exit: 100.5 });
    const be = simulateScenario(t, rows, STEP, { id: "be", label: "BE", breakEven: { afterR: 1, to: "entry" } });
    expect(be.exitReason).toBe("breakeven");
    expect(be.exitPrice).toBeCloseTo(100, 10);
    expect(be.r).toBeCloseTo(0, 10);
    // never retroactive: the same candle that reaches +1 R cannot fill the break-even stop
    const same = simulateScenario(longTrade({ exitMs: T0 + 2 * STEP + 1000, exit: 101.1 }), rows, STEP, { id: "be", label: "BE", breakEven: { afterR: 1, to: "entry" } });
    expect(same.exitReason).toBe("end");
  });

  it("a partial take-profit books half at +1 R, the rest runs to the recorded exit; R is the total over all parts", () => {
    const r = simulateScenario(longTrade(), UP, STEP, { id: "p", label: "Teil", partial: { atR: 1, frac: 0.5 } });
    expect(r.partials).toBe(1);
    // half at 101 (+1 R), half at the recorded exit 101.5 (+1.5 R) → 1.25 R on the full original quantity
    expect(r.r).toBeCloseTo(1.25, 10);
    expect(r.money).toBeCloseTo(2.5, 10);
  });

  it("stop and target in ONE candle: the stop is counted (conservative) and the trade is flagged ambiguous", () => {
    const rows = candles([
      [99.8, 100.1, 99.7, 100],
      [100, 100.4, 99.6, 100.3],
      [100.3, 102.2, 98.8, 101], // reaches 102 (target) and 99 (stop) – the order is unknowable
      [101, 101.5, 100.8, 101.2],
    ]);
    const r = simulateScenario(longTrade({ target: 102, exitMs: T0 + 3 * STEP + 1000, exit: 101.2 }), rows, STEP, BASELINE);
    expect(r.exitReason).toBe("stop");
    expect(r.ambiguous).toBe(true);
    expect(r.r).toBeCloseTo(-1, 10);
    const run = runScenarios(longTrade({ target: 102, exitMs: T0 + 3 * STEP + 1000, exit: 101.2 }), rows, STEP, []);
    expect(run.base.ambiguous).toBe(true);
  });

  it("a target in R of the variant's own distance, and 'keep' / 'none' for the recorded target", () => {
    const keep = simulateScenario(longTrade({ target: 101.1 }), UP, STEP, { id: "k", label: "k" });
    expect(keep.exitReason).toBe("target");
    expect(keep.r).toBeCloseTo(1.1, 10);
    const none = simulateScenario(longTrade({ target: 101.1 }), UP, STEP, { id: "n", label: "n", target: { kind: "none" } });
    expect(none.exitReason).toBe("end");
    const two = simulateScenario(longTrade(), UP, STEP, { id: "r2", label: "2R", target: { kind: "r", value: 2 }, horizon: { kind: "runOn" } });
    expect(two.exitReason).toBe("target");
    expect(two.target).toBeCloseTo(102, 10);
    expect(two.r).toBeCloseTo(2, 10);
  });

  it("run-on keeps the position after the recorded exit; a time exit closes after n candles", () => {
    const run = simulateScenario(longTrade(), UP, STEP, { id: "r", label: "weiter", horizon: { kind: "runOn" } });
    // after the exit: 103.5 high, then the last candle lows at 98.5 → the original stop 99 is hit there
    expect(run.exitReason).toBe("stop");
    expect(run.r).toBeCloseTo(-1, 10);
    const time = simulateScenario(longTrade(), UP, STEP, { id: "b", label: "3 Kerzen", horizon: { kind: "bars", n: 3 } });
    expect(time.exitReason).toBe("time");
    expect(time.bars).toBe(3);
    expect(time.exitPrice).toBeCloseTo(102, 10); // the close of the third candle in the trade (candle 3)
  });

  it("short trades mirror the long logic", () => {
    const rows = candles([
      [100.2, 100.3, 99.9, 100],
      [100, 100.2, 99.6, 99.7],
      [99.7, 99.8, 98.7, 98.9],
      [98.9, 99.1, 98.4, 98.6],
    ]);
    const t: WhatIfTrade = { side: "short", entry: 100, stop: 101, target: null, exit: 98.6, entryMs: T0 + STEP + 1000, exitMs: T0 + 3 * STEP + 1000, qty: 1 };
    const r = simulateScenario(t, rows, STEP, BASELINE);
    expect(r.r).toBeCloseTo(1.4, 10);
    const tgt = simulateScenario(t, rows, STEP, { id: "t", label: "t", target: { kind: "r", value: 1 } });
    expect(tgt.exitReason).toBe("target");
    expect(tgt.exitPrice).toBeCloseTo(99, 10);
  });

  it("refuses what cannot be simulated, with a reason: wrong-side stop, too small a stop, candles that miss the entry or exit", () => {
    expect(simulateScenario(longTrade(), UP, STEP, { id: "x", label: "x", stop: { kind: "price", value: 101 } })).toMatchObject({ status: "skipped", why: expect.stringContaining("unter dem Einstieg") });
    expect(simulateScenario(longTrade(), UP, STEP, { id: "x", label: "x", stop: { kind: "price", value: 99.99 } })).toMatchObject({ status: "skipped", why: expect.stringContaining("zu klein") });
    expect(simulateScenario(longTrade({ entryMs: T0 - 5 * STEP }), UP, STEP, BASELINE)).toMatchObject({ status: "skipped", why: expect.stringContaining("Einstieg") });
    expect(simulateScenario(longTrade({ exitMs: T0 + 40 * STEP }), UP, STEP, BASELINE)).toMatchObject({ status: "skipped", why: expect.stringContaining("Ausstieg") });
    expect(simulateScenario(longTrade(), [], STEP, BASELINE).status).toBe("skipped");
    // run-on does not need the recorded exit to be covered
    expect(simulateScenario(longTrade({ exitMs: T0 + 40 * STEP }), UP, STEP, { id: "r", label: "r", horizon: { kind: "runOn" } }).status).toBe("ok");
  });

  it("works when the entry is in the very first candle, and leaves its inputs untouched", () => {
    const bars = UP.map((b) => ({ ...b }));
    const snapshot = JSON.stringify(bars);
    const t = longTrade({ entryMs: T0 + 1000 });
    const frozen = JSON.stringify(t);
    const r = simulateScenario(t, bars, STEP, BASELINE);
    expect(r.status).toBe("ok");
    expect(JSON.stringify(bars)).toBe(snapshot);
    expect(JSON.stringify(t)).toBe(frozen);
  });

  it("money is null without a quantity, R stays", () => {
    const r = simulateScenario(longTrade({ qty: null }), UP, STEP, BASELINE);
    expect(r.money).toBeNull();
    expect(r.r).toBeCloseTo(1.5, 10);
  });
});

describe("presets and comparison", () => {
  it("every preset runs on a plain path, and the delta is measured against the baseline", () => {
    const run = runScenarios(longTrade(), UP, STEP, PRESET_SCENARIOS);
    expect(run.results).toHaveLength(PRESET_SCENARIOS.length);
    for (const r of run.results) expect(["ok", "skipped"]).toContain(r.status);
    const wide = run.results.find((r) => r.id === "wide")!;
    expect(wide.status).toBe("ok");
    expect(deltaR(wide, run.base)).toBeCloseTo((wide.r ?? 0) - (run.base.r ?? 0), 10);
    expect(deltaR({ ...wide, r: null }, run.base)).toBeNull();
  });

  it("recordedOutcome gives the journal's own figures next to the gross price move", () => {
    const o = recordedOutcome(longTrade(), { r: 1.2, pnl: 2.4 });
    expect(o).toEqual({ r: 1.2, pnl: 2.4, grossR: 1.5 });
  });
});

describe("whatIfBlocker / whatIfTradeOf", () => {
  const base = { entry: 100, stop: 99, side: "long", status: "closed", exitDate: "2026-10-01T10:00", exit: 101 };
  it("names the reason in German", () => {
    expect(whatIfBlocker(base)).toBeNull();
    expect(whatIfBlocker({ ...base, status: "open" })).toContain("läuft noch");
    expect(whatIfBlocker({ ...base, stop: null })).toContain("Ohne Stopp");
    expect(whatIfBlocker({ ...base, stop: 101 })).toContain("falschen Seite");
    expect(whatIfBlocker({ ...base, exitDate: undefined })).toContain("Ausstiegszeit");
    expect(whatIfBlocker({ ...base, entry: null })).toContain("Einstiegspreis");
    expect(whatIfBlocker({ ...base, exit: null })).toContain("Ausstiegspreis");
  });

  const trade = (over: Partial<Trade>): Trade => ({ id: "t", side: "long", status: "closed", date: "2026-10-01T08:00", exitDate: "2026-10-01T10:00", pair: "BTC/USDT", timeframe: "1h", entry: 100, stop: 99, target: 103, exit: 102, size: 200, leverage: 1, fees: 0, pnlManual: null, setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "", ...over }) as Trade;

  it("takes the quantity from qty, else from the notional ÷ entry", () => {
    expect(tradeQty({ qty: 3, size: 200, entry: 100, side: "long" })).toBe(3);
    expect(tradeQty({ qty: null, size: 200, entry: 100, side: "long" })).toBeCloseTo(2, 10);
    expect(tradeQty({ qty: null, size: null, entry: 100, side: "long" })).toBeNull();
  });

  it("builds the input of a closed trade or says why not", () => {
    const ok = whatIfTradeOf(trade({}));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.trade).toMatchObject({ side: "long", entry: 100, stop: 99, target: 103, exit: 102, qty: 2 });
    const bad = whatIfTradeOf(trade({ stop: null }));
    expect(bad.ok).toBe(false);
    const reversed = whatIfTradeOf(trade({ exitDate: "2026-10-01T07:00" }));
    expect(reversed).toMatchObject({ ok: false });
  });
});

describe("scenario shape", () => {
  it("scenarios are plain data (serialisable)", () => {
    const s: Scenario = { id: "a", label: "a", stop: { kind: "price", value: 98 }, breakEven: { afterR: 1, to: "net" }, horizon: { kind: "bars", n: 4 } };
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
