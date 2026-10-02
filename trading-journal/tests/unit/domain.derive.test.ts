import { describe, expect, it } from "vitest";
import { deriveTrade, computePnlR, leverageOverRule } from "@/domain/derive";
import { enrichTrade, checklistItemsFor, pruneChecks } from "@/domain/enrich";
import { A, B, C, D, E, F, mkTrade, settings } from "./domain.fixtures";

describe("deriveTrade (bundle qw)", () => {
  it("long with fees, stop and target", () => {
    const d = deriveTrade(A);
    expect(d.pnl).toBeCloseTo(396, 10);
    expect(d.risk).toBeCloseTo(100, 10);
    expect(d.r).toBeCloseTo(3.96, 10);
    expect(d.rr).toBeCloseTo(6, 10);
    expect(d.move).toBeCloseTo(0.05, 12);
    expect(d.result).toBe("win");
  });
  it("short direction flips pnl and move", () => {
    const d = deriveTrade(B);
    expect(d.pnl).toBeCloseTo(-100, 10);
    expect(d.risk).toBeCloseTo(150, 10);
    expect(d.r).toBeCloseTo(-2 / 3, 10);
    expect(d.rr).toBeNull();
    expect(d.move).toBeCloseTo(-1000 / 85000, 12);
    expect(d.result).toBe("loss");
  });
  it("manual pnl wins over the formula, no fees subtracted, no stop → no risk/r", () => {
    const d = deriveTrade(C);
    expect(d.pnl).toBe(50);
    expect(d.risk).toBeNull();
    expect(d.r).toBeNull();
    expect(d.move).toBeNull();
    expect(d.result).toBe("win");
    expect(deriveTrade({ ...A, pnlManual: 10 }).pnl).toBe(10);
  });
  it("open trade: pnl null, risk computed, result open", () => {
    const d = deriveTrade(D);
    expect(d.pnl).toBeNull();
    expect(d.risk).toBeCloseTo(50, 10);
    expect(d.r).toBeNull();
    expect(d.move).toBeNull();
    expect(d.result).toBe("open");
  });
  it("break-even and loss", () => {
    expect(deriveTrade(E).result).toBe("be");
    expect(deriveTrade(E).pnl).toBe(0);
    expect(deriveTrade(E).move).toBe(0);
    const f = deriveTrade(F);
    expect(f.pnl).toBe(-100);
    expect(f.r).toBe(-2);
    expect(f.result).toBe("loss");
  });
  it("edge cases: entry === stop → rr null; closed without exit/size → pnl null → result open; risk 0 → r null", () => {
    const t = mkTrade({ id: "x", date: "2026-01-01T00:00", entry: 100, stop: 100, target: 120, size: 100, exit: 110 });
    expect(deriveTrade(t).rr).toBeNull();
    expect(deriveTrade(t).risk).toBe(0);
    expect(deriveTrade(t).r).toBeNull();
    const noExit = mkTrade({ id: "y", date: "2026-01-01T00:00", entry: 100, size: 100 });
    expect(deriveTrade(noExit).pnl).toBeNull();
    expect(deriveTrade(noExit).result).toBe("open");
    expect(computePnlR(A)).toEqual({ pnl: 396, r: 3.96 });
  });
  it("leverage rule", () => {
    expect(leverageOverRule(4, "scalp")).toBe(false);
    expect(leverageOverRule(4.5, "scalp")).toBe(true);
    expect(leverageOverRule(5, "makro")).toBe(false);
    expect(leverageOverRule(6, "makro")).toBe(true);
    expect(leverageOverRule(null, "makro")).toBe(false);
  });
});

describe("enrichTrade (bundle Uw/FG)", () => {
  const s = settings();
  it("checklist = rules (g:) + selected setups in settings order", () => {
    const items = checklistItemsFor(["s_bt", "s_p1"], s);
    expect(items.slice(0, 5).map((i) => i.id)).toEqual(["g:trigger", "g:topdown", "g:spx", "g:stop", "g:lev"]);
    // settings order: s_p1 comes before s_bt regardless of selection order
    expect(items.slice(5).map((i) => i.id)).toEqual(["s_p1:c1", "s_p1:c2", "s_p1:c3", "s_bt:c1", "s_bt:c2", "s_bt:c3"]);
    expect(items[5]!.text).toBe("Diagonale Downtrend-Linie gebrochen");
  });
  it("checked/complete", () => {
    const e = enrichTrade(A, s);
    expect(e.items.length).toBe(8);
    expect(e.checked).toBe(2);
    expect(e.complete).toBe(false);
    expect(e.pnl).toBeCloseTo(396, 10);
    const all = enrichTrade({ ...A, checks: Object.fromEntries(e.items.map((i) => [i.id, true])) }, s);
    expect(all.complete).toBe(true);
    expect(enrichTrade(C, { ...s, rules: [] }).complete).toBeNull();
  });
  it("derived pnl/r override persisted snapshot; unknown setup ids ignored", () => {
    const e = enrichTrade({ ...A, pnl: 1, r: 1, setups: ["nope", "s_bo"] }, s);
    expect(e.pnl).toBeCloseTo(396, 10);
    expect(e.items.length).toBe(8);
  });
  it("pruneChecks keeps only truthy known ids", () => {
    const items = checklistItemsFor(["s_bo"], s);
    expect(pruneChecks({ "g:trigger": true, "s_bo:c1": false, "zzz": true }, items)).toEqual({ "g:trigger": true });
  });
});
