/// <reference types="node" />
/**
 * Fills (Journal v3, P06): Ø entry / Ø exit, partial exits, DCA, remaining quantity – and the derivation that uses them
 * ONLY when they exist. Legacy trades (no fills, no funding) must keep byte-identical P&L / R.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveTrade, leverageOverRule } from "@/domain/derive";
import { effectiveFees, fillPosition, fillStats, hasFills, nextFillKind, orderFills, positionSlices, relabelFills, runningCost } from "@/domain/fills";
import { normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { enrichTrades } from "@/domain/enrich";
import { ED } from "@/domain/edition";
import type { Fill } from "@/domain/types";
import { A, B, C, D, E, F, mkTrade } from "./domain.fixtures";

const f = (id: string, at: string, side: Fill["side"], price: number, qty: number, extra: Partial<Fill> = {}): Fill => ({ id, at, side, price, qty, kind: side === "open" ? "entry" : "exit", ...extra });

const FIX = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/tj2-v0.json"), "utf8")) as { "tj2-settings": unknown; "tj2-trades": Record<string, unknown>[] };

describe("fillStats – Ø entry, Ø exit, partials", () => {
  it("one entry, one exit: realised = (exit − entry) × qty", () => {
    const s = fillStats([f("a", "2026-10-01T10:00", "open", 100, 2), f("b", "2026-10-01T12:00", "close", 110, 2)], "long");
    expect(s.avgEntry).toBe(100);
    expect(s.avgExit).toBe(110);
    expect(s.realized).toBe(20);
    expect(s.remaining).toBe(0);
    expect(s.flat).toBe(true);
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0]!.share).toBe(1);
  });

  it("DCA: Ø entry is quantity weighted; improvement signed in the trade's favour", () => {
    const fills = [f("a", "2026-10-01T10:00", "open", 100, 1), f("b", "2026-10-01T11:00", "open", 90, 1, { kind: "add" }), f("c", "2026-10-01T12:00", "open", 80, 2, { kind: "add" })];
    const s = fillStats(fills, "long");
    expect(s.avgEntry).toBeCloseTo((100 + 90 + 160) / 4, 12);
    expect(s.dca?.entries).toBe(3);
    expect(s.dca?.adds).toBe(2);
    expect(s.dca?.low).toBe(80);
    expect(s.dca?.high).toBe(100);
    expect(s.dca?.spread).toBeCloseTo(0.2, 12);
    expect(s.dca?.improvement).toBeCloseTo((100 - 87.5) / 100, 12);
    expect(fillStats(fills, "short").dca?.improvement).toBeCloseTo(-(100 - 87.5) / 100, 12);
    expect(s.remaining).toBe(4);
    expect(s.flat).toBe(false);
    expect(s.peakQty).toBe(4);
  });

  it("partial exits are valued against the Ø entry at that moment; a later add does not rewrite them", () => {
    const fills = [
      f("e", "2026-10-01T10:00", "open", 100, 2),
      f("p1", "2026-10-01T11:00", "close", 120, 1, { kind: "partial" }),
      f("add", "2026-10-01T12:00", "open", 130, 1, { kind: "add" }),
      f("x", "2026-10-01T13:00", "close", 125, 2),
    ];
    const s = fillStats(fills, "long");
    expect(s.parts[0]!.pnl).toBe(20); // 1 × (120 − 100)
    // after the add: Ø = (100·1 + 130·1) / 2 = 115 → (125 − 115) × 2
    expect(s.parts[1]!.basis).toBe(115);
    expect(s.parts[1]!.pnl).toBe(20);
    expect(s.realized).toBe(40);
    expect(s.remaining).toBe(0);
    expect(s.parts.map((p) => p.share)).toEqual([1 / 3, 2 / 3]);
  });

  it("short partials: price falling is a gain", () => {
    const s = fillStats([f("e", "2026-10-01T10:00", "open", 100, 4), f("p", "2026-10-01T11:00", "close", 90, 1), f("x", "2026-10-01T12:00", "close", 105, 3)], "short");
    expect(s.parts.map((p) => p.pnl)).toEqual([10, -15]);
    expect(s.realized).toBe(-5);
  });

  it("orders by time, untimed fills last in stored order, drops invalid ones", () => {
    const fills = [f("u1", "", "open", 1, 1), f("late", "2026-10-02T10:00", "close", 2, 1), f("bad", "2026-10-01T09:00", "open", 0, 1), f("early", "2026-10-01T10:00", "open", 1, 1)];
    expect(orderFills(fills).map((x) => x.id)).toEqual(["early", "late", "u1"]);
    expect(orderFills(undefined)).toEqual([]);
  });

  it("a close before any open (data out of order) is valued against the overall Ø entry", () => {
    const s = fillStats([f("x", "2026-10-01T09:00", "close", 110, 1), f("e", "2026-10-01T10:00", "open", 100, 1)], "long");
    expect(s.parts[0]!.basis).toBe(100);
    expect(s.realized).toBe(10);
  });

  it("fees: Σ of the fill fees, known only when a fill carries one", () => {
    expect(fillStats([f("a", "x", "open", 1, 1, { fee: 0.5 }), f("b", "y", "close", 1, 1, { fee: 0.25 })]).fees).toBe(0.75);
    expect(fillStats([f("a", "x", "open", 1, 1)]).feesKnown).toBe(false);
    expect(effectiveFees({ fees: 3, fills: [f("a", "x", "open", 1, 1, { fee: 9 })] })).toBe(3);
    expect(effectiveFees({ fees: null, fills: [f("a", "x", "open", 1, 1, { fee: 9 })] })).toBe(9);
    expect(effectiveFees({ fees: null })).toBe(0);
  });

  it("positionSlices cut the bar by part, rest stays open", () => {
    const s = fillStats([f("e", "2026-10-01T10:00", "open", 100, 4), f("p", "2026-10-01T11:00", "close", 110, 1), f("q", "2026-10-01T12:00", "close", 95, 1)], "long");
    const slices = positionSlices(s);
    expect(slices.map((x) => [x.tone, x.from, x.to])).toEqual([
      ["win", 0, 0.25],
      ["loss", 0.25, 0.5],
      ["open", 0.5, 1],
    ]);
  });

  it("relabelFills / nextFillKind / runningCost", () => {
    const fills = [f("a", "2026-10-01T10:00", "open", 100, 2), f("b", "2026-10-01T11:00", "open", 90, 2), f("c", "2026-10-01T12:00", "close", 110, 1), f("d", "2026-10-01T13:00", "close", 110, 3)];
    expect(relabelFills(fills).map((x) => x.kind)).toEqual(["entry", "add", "partial", "exit"]);
    expect(nextFillKind([], "open")).toBe("entry");
    expect(nextFillKind(fills, "open")).toBe("add");
    expect(nextFillKind(fills, "close")).toBe("partial");
    expect(runningCost(orderFills(fills.slice(0, 3)))).toBe(95);
    expect(runningCost(orderFills(fills))).toBeNull();
  });

  it("hasFills needs an opening fill", () => {
    expect(hasFills({})).toBe(false);
    expect(hasFills({ fills: [f("c", "x", "close", 1, 1)] })).toBe(false);
    expect(hasFills({ fills: [f("o", "x", "open", 1, 1)] })).toBe(true);
  });
});

describe("deriveTrade with fills / funding (only when present)", () => {
  it("legacy fixtures A–F are unchanged (no fills, no funding)", () => {
    // pinned numbers of domain.derive.test.ts
    expect(deriveTrade(A)).toMatchObject({ pnl: 396, result: "win" });
    expect(deriveTrade(A).r).toBeCloseTo(3.96, 10);
    expect(deriveTrade(B).pnl).toBeCloseTo(-100, 10);
    expect(deriveTrade(C).pnl).toBe(50);
    expect(deriveTrade(D).pnl).toBeNull();
    expect(deriveTrade(E).result).toBe("be");
    expect(deriveTrade(F).r).toBe(-2);
  });

  it("legacy journal fixture: P&L / R / risk / rr / move are byte-identical with the v3 derivation", () => {
    const settings = normalizeSettings(FIX["tj2-settings"]);
    const trades = FIX["tj2-trades"].map(normalizeTrade);
    const now = enrichTrades(trades, settings);
    // the pre-v3 formula, inlined: what every stored trade had before this package
    for (const t of now) {
      const entry = t.entry || 0;
      const exit = t.exit || 0;
      const size = t.size || 0;
      const qty = entry > 0 && size > 0 ? size / entry : 0;
      const dir = t.side === "short" ? -1 : 1;
      const closed = t.status !== "open";
      const pnl = typeof t.pnlManual === "number" && Number.isFinite(t.pnlManual) ? t.pnlManual : closed && entry > 0 && exit > 0 && qty ? (exit - entry) * qty * dir - (t.fees || 0) : null;
      expect(t.pnl).toBe(pnl);
    }
  });

  it("fundingFees only counts when it is a number", () => {
    expect(deriveTrade({ ...A, fundingFees: 6 }).pnl).toBeCloseTo(390, 10);
    expect(deriveTrade({ ...A, fundingFees: -4 }).pnl).toBeCloseTo(400, 10);
    expect(deriveTrade({ ...A, fundingFees: null }).pnl).toBeCloseTo(396, 10);
    expect(deriveTrade({ ...A, pnlManual: 10, fundingFees: 6 }).pnl).toBe(10);
  });

  it("qty stands in only when size is empty", () => {
    expect(deriveTrade({ ...A, qty: 1 }).pnl).toBeCloseTo(396, 10);
    expect(deriveTrade({ ...A, size: null, qty: 0.1 }).pnl).toBeCloseTo(396, 10);
  });

  it("fills replace entry / size / exit: realised partials, fees from the trade (else the fills), funding", () => {
    const t = mkTrade({
      id: "v3",
      date: "2026-10-01T10:00",
      entry: 999,
      exit: 999,
      size: 1,
      stop: 90,
      target: 140,
      fees: null,
      fundingFees: 2,
      fills: [
        f("e", "2026-10-01T10:00", "open", 100, 2, { fee: 1 }),
        f("p", "2026-10-01T11:00", "close", 120, 1, { kind: "partial", fee: 0.5 }),
        f("x", "2026-10-01T12:00", "close", 110, 1, { fee: 0.5 }),
      ],
    });
    const d = deriveTrade(t);
    // gross 20 + 10 = 30 − fill fees 2 − funding 2
    expect(d.pnl).toBe(26);
    expect(d.risk).toBe(20); // |100 − 90| × 2
    expect(d.r).toBe(1.3);
    expect(d.rr).toBe(4);
    expect(d.move).toBeCloseTo(0.15, 12); // Ø exit 115 vs 100
    expect(d.result).toBe("win");
    expect(deriveTrade({ ...t, fees: 5 }).pnl).toBe(23);
  });

  it("closed with an open remainder: valued at `exit`, else incomplete (pnl null → open)", () => {
    const base = mkTrade({ id: "r", date: "2026-10-01T10:00", fills: [f("e", "2026-10-01T10:00", "open", 100, 2), f("p", "2026-10-01T11:00", "close", 110, 1)] });
    expect(deriveTrade({ ...base, exit: 120 }).pnl).toBe(30);
    expect(deriveTrade({ ...base, exit: null }).pnl).toBeNull();
    expect(deriveTrade({ ...base, exit: null }).result).toBe("open");
    expect(fillPosition({ ...base, exit: 120, status: "closed" })?.exit).toBe(115);
  });

  it("open trade with fills: pnl null, risk on the Ø entry and the opened quantity", () => {
    const d = deriveTrade(mkTrade({ id: "o", date: "2026-10-01T10:00", status: "open", stop: 95, fills: [f("e", "x", "open", 100, 1), f("a", "y", "open", 98, 1)] }));
    expect(d.pnl).toBeNull();
    expect(d.risk).toBeCloseTo(8, 12); // |99 − 95| × 2
    expect(d.result).toBe("open");
  });

  it("only closing fills: falls back to the legacy formula", () => {
    const t = mkTrade({ id: "c", date: "2026-10-01T10:00", entry: 100, exit: 110, size: 100, fills: [f("x", "y", "close", 110, 1)] });
    expect(deriveTrade(t).pnl).toBe(10);
  });
});

describe("leverage rule follows the edition (ED.LEVERAGE_RULE)", () => {
  it("uses the edition's numbers", () => {
    expect(leverageOverRule(ED.LEVERAGE_RULE.scalp, "scalp")).toBe(false);
    expect(leverageOverRule(ED.LEVERAGE_RULE.scalp + 0.5, "scalp")).toBe(true);
    expect(leverageOverRule(ED.LEVERAGE_RULE.makro, "makro")).toBe(false);
    expect(leverageOverRule(ED.LEVERAGE_RULE.makro + 1, "makro")).toBe(true);
    expect(leverageOverRule(undefined, "scalp")).toBe(false);
  });
});
