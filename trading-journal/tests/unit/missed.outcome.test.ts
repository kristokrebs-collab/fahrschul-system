/**
 * F32 Ausgang je Signal: the outcome read from the candles after a signal – target first / stop first / same candle (the stop
 * counts) / still open / not usable, the standard measure for missing marks, an own entry price that must be touched, the
 * candle the signal fell into not counting, the 14-day horizon.
 */
import { describe, expect, it } from "vitest";
import { evaluateSignal, isDecided, isFinalOutcome, needsAtr, OUTCOME_HORIZON_MS, outcomeBlocker, outcomeText, STANDARD_RR, STANDARD_STOP_ATR, type OutcomeBar } from "@/domain/missed";

const M15 = 900_000;
const T0 = new Date(2026, 2, 4, 10, 0).getTime();
const NOW = T0 + 3 * 86_400_000;
const ctx = { now: NOW, atrPct: 1, intervalMs: M15 };

/** Candle `i` (0 = the one that opens at T0 + 15 min): flat at `c`, with the given wicks. */
const bar = (i: number, o: number, h: number, l: number, c = o): OutcomeBar => ({ time: T0 + (i + 1) * M15, open: o, high: h, low: l, close: c });
const sig = (over: Partial<{ side: "long" | "short" | null; price: number | null; stop: number | null; target: number | null; symbol: string; at: number }> = {}) => ({ at: T0 + 60_000, side: "long" as "long" | "short" | null, symbol: "BTCUSDT", price: null as number | null, stop: 95 as number | null, target: 110 as number | null, ...over });

describe("evaluateSignal", () => {
  it("target first: +R of the marks, hit time of the deciding candle", () => {
    const o = evaluateSignal(sig(), [bar(0, 100, 102, 99), bar(1, 102, 111, 101)], ctx);
    expect(o).toMatchObject({ kind: "target", basis: "own", entry: 100, stop: 95, target: 110, rr: 2, r: 2, sameBar: false, hitAt: T0 + 2 * M15, bars: 2 });
    expect(isDecided(o)).toBe(true);
    expect(isFinalOutcome(o)).toBe(true);
  });

  it("stop first: −1 R", () => {
    const o = evaluateSignal(sig(), [bar(0, 100, 101, 94), bar(1, 100, 111, 99)], ctx);
    expect(o).toMatchObject({ kind: "stop", r: -1, sameBar: false, hitAt: T0 + M15 });
  });

  it("target and stop inside the SAME candle: the stop counts, and the result says so", () => {
    const o = evaluateSignal(sig(), [bar(0, 100, 111, 94)], ctx);
    expect(o).toMatchObject({ kind: "stop", sameBar: true, r: -1 });
    expect(outcomeText(o)).toContain("gleiche Kerze, Stopp zählt");
  });

  it("short: the marks mirror", () => {
    const o = evaluateSignal(sig({ side: "short", stop: 105, target: 90 }), [bar(0, 100, 103, 98), bar(1, 98, 99, 89)], ctx);
    expect(o).toMatchObject({ kind: "target", entry: 100, rr: 2, r: 2 });
    expect(evaluateSignal(sig({ side: "short", stop: 105, target: 90 }), [bar(0, 100, 106, 99)], ctx).kind).toBe("stop");
  });

  it("the candle the signal fell into does not count; the first candle that opens after it is the entry", () => {
    // a candle that opened BEFORE the signal (it would hit the stop) is ignored
    const before: OutcomeBar = { time: T0, open: 100, high: 101, low: 90, close: 100 };
    const o = evaluateSignal(sig(), [before, bar(0, 101, 102, 100), bar(1, 102, 111, 101)], ctx);
    expect(o).toMatchObject({ kind: "target", entry: 101, bars: 2 });
  });

  it("neither mark reached: open; after 14 days it is final with the horizon note", () => {
    const live = evaluateSignal(sig(), [bar(0, 100, 102, 99), bar(1, 100, 103, 98)], ctx);
    expect(live).toMatchObject({ kind: "open", horizon: false, bars: 2 });
    expect(isFinalOutcome(live)).toBe(false);
    const old = evaluateSignal(sig({ at: T0 - OUTCOME_HORIZON_MS - 86_400_000 }), [{ time: T0 - OUTCOME_HORIZON_MS - 86_400_000 + M15, open: 100, high: 102, low: 98, close: 100 }], ctx);
    expect(old).toMatchObject({ kind: "open", horizon: true });
    expect(old.reason).toContain("14 Tagen");
    expect(isFinalOutcome(old)).toBe(true);
  });

  it("candles after the horizon do not decide", () => {
    const at = T0 - OUTCOME_HORIZON_MS - 86_400_000;
    const o = evaluateSignal(sig({ at }), [{ time: at + M15, open: 100, high: 101, low: 99, close: 100 }, { time: at + OUTCOME_HORIZON_MS + M15, open: 100, high: 130, low: 99, close: 100 }], ctx);
    expect(o.kind).toBe("open");
  });

  it("missing marks are filled with the standard measure and labelled so", () => {
    // ATR 1 % of 100 → stop 1,5 × 1 = 1,5 below, target 2 R = 3 above
    const o = evaluateSignal(sig({ stop: null, target: null }), [bar(0, 100, 101, 99.5), bar(1, 100, 103.2, 99.6)], ctx);
    expect(o).toMatchObject({ kind: "target", basis: "standard", stop: 100 - STANDARD_STOP_ATR, target: 100 + STANDARD_STOP_ATR * STANDARD_RR, rr: STANDARD_RR });
    expect(outcomeText(o)).toContain("Standardmaß");
    // an own stop with no target: the target is the standard 2 R of THAT stop, still labelled standard
    const half = evaluateSignal(sig({ target: null }), [bar(0, 100, 111, 99)], ctx);
    expect(half).toMatchObject({ kind: "target", basis: "standard", target: 110, rr: 2 });
  });

  it("without an own stop and without an ATR there is no reading", () => {
    const o = evaluateSignal(sig({ stop: null }), [bar(0, 100, 101, 99)], { ...ctx, atrPct: null });
    expect(o).toMatchObject({ kind: "unusable" });
    expect(o.reason).toContain("ATR");
    expect(needsAtr({ stop: null })).toBe(true);
    expect(needsAtr({ stop: 5 })).toBe(false);
  });

  it("marks on the wrong side of the entry are not read", () => {
    expect(evaluateSignal(sig({ stop: 105 }), [bar(0, 100, 101, 99)], ctx)).toMatchObject({ kind: "unusable", reason: "Der Stopp liegt auf der falschen Seite des Einstiegs." });
    expect(evaluateSignal(sig({ target: 90 }), [bar(0, 100, 101, 99)], ctx).reason).toContain("Ziel liegt auf der falschen Seite");
  });

  it("no direction, no market, no candles: not usable, each with its reason", () => {
    expect(evaluateSignal(sig({ side: null }), [bar(0, 100, 101, 99)], ctx).reason).toBe("Das Signal hat keine Richtung.");
    expect(outcomeBlocker({ side: "long", symbol: "" })).toContain("Markt");
    const none = evaluateSignal(sig(), [], ctx);
    expect(none.kind).toBe("unusable");
    expect(none.reason).toContain("keine Kerzen");
    expect(isFinalOutcome(none)).toBe(false); // retried the next time
  });

  it("a signal younger than two candles is open, not an error", () => {
    const o = evaluateSignal(sig({ at: NOW - 60_000 }), [], ctx);
    expect(o).toMatchObject({ kind: "open" });
    expect(o.reason).toContain("noch keine volle Kerze");
  });

  it("an own entry price counts only once a candle touches it; a target reached before it is not a trade", () => {
    // limit entry at 98, price first runs away to the target
    const away = evaluateSignal(sig({ price: 98, stop: 94, target: 106 }), [bar(0, 100, 107, 99.5)], ctx);
    expect(away).toMatchObject({ kind: "unusable" });
    expect(away.reason).toContain("Einstiegskurs wurde nicht erreicht");
    // entry touched in the second candle, the target follows
    const filled = evaluateSignal(sig({ price: 98, stop: 94, target: 106 }), [bar(0, 100, 101, 99), bar(1, 99, 99.5, 97.5), bar(2, 99, 107, 98)], ctx);
    expect(filled).toMatchObject({ kind: "target", entry: 98, rr: 2, hitAt: T0 + 3 * M15 });
    // never touched, nothing reached: open with its note
    expect(evaluateSignal(sig({ price: 98, stop: 94, target: 106 }), [bar(0, 100, 101, 99)], ctx).reason).toContain("noch nicht erreicht");
  });

  it("is deterministic: the same input gives the same result", () => {
    const bars = [bar(0, 100, 102, 99), bar(1, 102, 111, 101)];
    expect(evaluateSignal(sig(), bars, ctx)).toEqual(evaluateSignal(sig(), [...bars], ctx));
  });
});

describe("outcomeText", () => {
  it("names the kind, the R and the basis", () => {
    expect(outcomeText(evaluateSignal(sig(), [bar(0, 100, 111, 99)], ctx))).toBe("Ziel zuerst · +2,0 R · Marken des Signals");
    expect(outcomeText(evaluateSignal(sig(), [bar(0, 100, 101, 99)], ctx))).toBe("Noch offen · Marken des Signals");
  });
});
