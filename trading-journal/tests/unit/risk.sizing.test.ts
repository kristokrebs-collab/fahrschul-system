/** P05 calculator: position size, stop candidates, take profits, R:R with the fee breakeven. */
import { describe, expect, it } from "vitest";
import { boxTargetsFor, positionSize, rrCalc, rTargets, sideOf, stopCandidates, stopFromAtr, stopFromBox, stopFromPct, stopFromStructure } from "@/domain/risk";
import type { BoxState } from "@/domain/boxes";
import type { Structure } from "@/domain/signals/structure";

describe("Positionsgröße", () => {
  it("risk amount / stop distance → qty, notional = journal size, needed leverage, margin", () => {
    const s = positionSize({ capital: 10_000, riskPct: 0.01, entry: 100, stop: 95 });
    if (!s.ok) throw new Error("expected ok");
    expect(s.side).toBe("long");
    expect(s.riskAmount).toBe(100);
    expect(s.qty).toBeCloseTo(20, 10);
    expect(s.notional).toBeCloseTo(2000, 10);
    expect(s.neededLeverage).toBeCloseTo(0.2, 10);
    expect(s.leverage).toBe(1);
    expect(s.margin).toBeCloseTo(2000, 10);
    expect(s.overRule).toBe(false);
    expect(s.stopPct).toBeCloseTo(0.05, 10);
  });

  it("fees and slippage shrink the size so the loss at the stop is exactly the risk", () => {
    const s = positionSize({ capital: 10_000, riskPct: 0.01, entry: 100, stop: 99, feePct: 0.0005, slippagePct: 0.001 });
    if (!s.ok) throw new Error("expected ok");
    const lossAtStop = s.qty * (1 + 0.0005 * (100 + 99) + 0.001 * 99);
    expect(lossAtStop).toBeCloseTo(100, 8);
    expect(s.fees + s.slippage + s.qty * 1).toBeCloseTo(100, 8);
    expect(s.qty).toBeLessThan(100);
  });

  it("tight stop → leverage above the rule: flagged, with the size the rule allows", () => {
    const s = positionSize({ capital: 1000, riskPct: 0.02, entry: 100, stop: 99.5, maxLeverage: 4 });
    if (!s.ok) throw new Error("expected ok");
    expect(s.notional).toBeCloseTo(4000, 6);
    expect(s.neededLeverage).toBeCloseTo(4, 6);
    expect(s.overRule).toBe(false);
    const t = positionSize({ capital: 1000, riskPct: 0.03, entry: 100, stop: 99.5, maxLeverage: 4 });
    if (!t.ok) throw new Error("expected ok");
    expect(t.overRule).toBe(true);
    expect(t.leverage).toBe(6);
    expect(t.capped?.notional).toBe(4000);
    expect(t.capped?.riskPct).toBeCloseTo(0.02, 6);
  });

  it("a chosen leverage sets the margin; margin above the capital is flagged", () => {
    const s = positionSize({ capital: 1000, riskPct: 0.05, entry: 100, stop: 99, leverage: 2 });
    if (!s.ok) throw new Error("expected ok");
    expect(s.margin).toBeCloseTo(2500, 6);
    expect(s.marginOver).toBe(true);
  });

  it("short: stop above the entry", () => {
    const s = positionSize({ capital: 5000, riskPct: 0.01, entry: 200, stop: 210 });
    expect(s.ok && s.side).toBe("short");
    expect(s.ok && s.qty).toBeCloseTo(5, 10);
  });

  it("invalid input is named", () => {
    expect(positionSize({ capital: 0, riskPct: 0.01, entry: 1, stop: 0.9 })).toEqual({ ok: false, error: "capital" });
    expect(positionSize({ capital: 1, riskPct: 0, entry: 1, stop: 0.9 })).toEqual({ ok: false, error: "risk" });
    expect(positionSize({ capital: 1, riskPct: 0.01, entry: 0, stop: 0.9 })).toEqual({ ok: false, error: "entry" });
    expect(positionSize({ capital: 1, riskPct: 0.01, entry: 1, stop: 1 })).toEqual({ ok: false, error: "stop" });
    expect(positionSize({ capital: 1, riskPct: 0.01, entry: 1, stop: 0.9, side: "short" })).toEqual({ ok: false, error: "side" });
    expect(sideOf(10, 9)).toBe("long");
  });
});

describe("Stop-Rechner", () => {
  const box = { atr: 2, box: { top: 110, bottom: 100, atr: 2 } } as unknown as BoxState;
  const structure = {
    atr: 2,
    supports: [{ price: 102, top: 102, btm: 101, dir: 1 }, { price: 96, top: 96, btm: 95, dir: 1 }],
    resistances: [{ price: 108, top: 109, btm: 108, dir: -1 }],
  } as unknown as Structure;

  it("% and ATR", () => {
    expect(stopFromPct(100, "long", 0.02)).toBeCloseTo(98, 10);
    expect(stopFromPct(100, "short", 0.02)).toBeCloseTo(102, 10);
    expect(stopFromAtr(100, "long", 2, 1.5)).toBeCloseTo(97, 10);
    expect(stopFromAtr(100, "short", 2, 1.5)).toBeCloseTo(103, 10);
    expect(stopFromPct(100, "long", 0)).toBeNull();
  });

  it("box edge: below the support for a long, above the resistance for a short (+ 0.25 ATR buffer)", () => {
    expect(stopFromBox("long", 104, box)).toBeCloseTo(99.5, 10);
    expect(stopFromBox("short", 104, box)).toBeCloseTo(110.5, 10);
    // entry below the box: the bottom is not a stop for a long
    expect(stopFromBox("long", 98, box)).toBeNull();
    expect(stopFromBox("long", 104, null)).toBeNull();
  });

  it("structure: nearest support below the entry (btm − 0.1 ATR) / resistance above (top + 0.1 ATR)", () => {
    expect(stopFromStructure("long", 104, structure)).toBeCloseTo(100.8, 10);
    expect(stopFromStructure("long", 100, structure)).toBeCloseTo(94.8, 10);
    expect(stopFromStructure("short", 104, structure)).toBeCloseTo(109.2, 10);
    expect(stopFromStructure("short", 120, structure)).toBeNull();
  });

  it("candidates carry the distance in % and ATR; missing inputs are left out", () => {
    const c = stopCandidates({ entry: 104, side: "long", pct: 0.02, atr: 2, atrMult: 1.5, box, structure });
    expect(c.map((x) => x.kind)).toEqual(["pct", "atr", "box", "structure"]);
    expect(c[1]!.distAtr).toBeCloseTo(1.5, 10);
    expect(c[0]!.label).toBe("2,0 %");
    const bare = stopCandidates({ entry: 104, side: "long", pct: 0.02, atrMult: 1.5 });
    expect(bare.map((x) => x.kind)).toEqual(["pct"]);
    expect(bare[0]!.distAtr).toBeNull();
  });
});

describe("TP- und R:R-Rechner", () => {
  it("R multiples long and short", () => {
    expect(rTargets(100, 95).map((t) => t.price)).toEqual([105, 110, 115]);
    expect(rTargets(100, 105).map((t) => t.price)).toEqual([95, 90, 85]);
    expect(rTargets(100, 100)).toEqual([]);
  });

  it("box targets beyond the entry in the trade direction, sorted by R", () => {
    const targets = [
      { price: 120, kind: "box", label: "Box 2", zone: null, i: null },
      { price: 112, kind: "level", label: "Level", zone: null, i: null },
      { price: 90, kind: "box", label: "unten", zone: null, i: null },
    ] as const;
    const t = boxTargetsFor("long", 104, 100, targets);
    expect(t.map((x) => x.price)).toEqual([112, 120]);
    expect(t[0]!.r).toBeCloseTo(2, 10);
    expect(boxTargetsFor("short", 104, 108, targets).map((x) => x.price)).toEqual([90]);
  });

  it("R:R gross vs. after fees, the breakeven and the win rate it needs", () => {
    const r = rrCalc({ entry: 100, stop: 95, target: 110, feePct: 0.001 });
    expect(r?.rr).toBeCloseTo(2, 10);
    // reward 10 − 0.21 fees, risk 5 + 0.195 fees
    expect(r?.rrNet).toBeCloseTo((10 - 0.21) / (5 + 0.195), 10);
    expect(r?.breakeven).toBeCloseTo((100 * 1.001) / 0.999, 10);
    expect(r?.beWinRate).toBeCloseTo(1 / (1 + r!.rrNet), 10);
    const s = rrCalc({ entry: 100, stop: 105, target: 90, feePct: 0.001 });
    expect(s?.side).toBe("short");
    expect(s!.breakeven).toBeLessThan(100);
    expect(rrCalc({ entry: 100, stop: 95, target: 99 })).toBeNull();
  });
});
