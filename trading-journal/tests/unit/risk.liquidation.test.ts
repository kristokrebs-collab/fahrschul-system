/** P05 liquidation approximation and the tier table / settings sanitiser. */
import { describe, expect, it } from "vitest";
import { DEFAULT_TIERS, liqBeforeStop, liquidationPrice, riskLimits, riskSettingsOf, sanitizeTiers, tierFor, tierTable, tiersToJson, withRiskSettings, DEFAULT_RISK } from "@/domain/risk";
import { ED } from "@/domain/edition";

describe("Maintenance-Tiers", () => {
  it("maintenance amounts follow from the floors (continuous maintenance margin)", () => {
    const t = tierTable(DEFAULT_TIERS);
    expect(t[0]).toMatchObject({ from: 0, cum: 0, mmr: 0.004 });
    expect(t[1]!.cum).toBeCloseTo(50, 8);
    expect(t[2]!.cum).toBeCloseTo(2550, 8);
    expect(t[3]!.cum).toBeCloseTo(122_550, 6);
    // continuity at a boundary: notional·mmr − cum is the same on both sides
    const at = 500_000;
    expect(at * t[1]!.mmr - t[1]!.cum).toBeCloseTo(at * t[2]!.mmr - t[2]!.cum, 6);
    expect(tierFor(10, t)).toBe(t[0]);
    expect(tierFor(1e12, t)).toBe(t[t.length - 1]);
  });

  it("sanitiser: sorted, ascending mmr, open-ended last tier, garbage → defaults", () => {
    expect(sanitizeTiers([{ upTo: 1000, mmr: 0.01 }, { upTo: 100, mmr: 0.005 }])).toEqual([
      { upTo: 100, mmr: 0.005 },
      { upTo: Infinity, mmr: 0.01 },
    ]);
    expect(sanitizeTiers([{ upTo: 100, mmr: 0.02 }, { upTo: 200, mmr: 0.01 }])).toEqual([...DEFAULT_TIERS]);
    expect(sanitizeTiers("x")).toEqual([...DEFAULT_TIERS]);
    expect(sanitizeTiers([{ upTo: null, mmr: 0.01 }])).toEqual([{ upTo: Infinity, mmr: 0.01 }]);
    expect(tiersToJson([{ upTo: Infinity, mmr: 0.01 }])).toEqual([{ upTo: null, mmr: 0.01 }]);
  });
});

describe("Liquidation (Näherung)", () => {
  const tiers = DEFAULT_TIERS;

  it("isolated long 10× ≈ 9,6 % below the entry; short ≈ 9,6 % above", () => {
    const l = liquidationPrice({ side: "long", entry: 100, qty: 1, leverage: 10, tiers });
    expect(l?.price).toBeCloseTo(90 / 0.996, 8);
    expect(l?.distPct).toBeCloseTo(1 - 90 / 0.996 / 100, 8);
    const s = liquidationPrice({ side: "short", entry: 100, qty: 1, leverage: 10, tiers });
    expect(s?.price).toBeCloseTo(110 / 1.004, 8);
  });

  it("solves exactly: at the liquidation price wallet + uPnL = maintenance margin", () => {
    const qty = 3;
    const entry = 60_000;
    const l = liquidationPrice({ side: "long", entry, qty, margin: 20_000, tiers });
    const p = l!.price!;
    const tier = tierFor(qty * p, tierTable(tiers))!;
    expect(20_000 + qty * (p - entry)).toBeCloseTo(qty * p * tier.mmr - tier.cum, 4);
  });

  it("1× long has no liquidation above 0; the reference price gives the distance in % and ATR", () => {
    const l = liquidationPrice({ side: "long", entry: 100, qty: 1, leverage: 1, tiers });
    expect(l?.price).toBeNull();
    const x = liquidationPrice({ side: "long", entry: 100, qty: 1, leverage: 5, tiers, mark: 95, atr: 2 });
    expect(x!.distPct).toBeCloseTo((95 - x!.price!) / 95, 10);
    expect(x!.distAtr).toBeCloseTo((95 - x!.price!) / 2, 10);
    expect(x!.breached).toBe(false);
    const gone = liquidationPrice({ side: "long", entry: 100, qty: 1, leverage: 10, tiers, mark: 80 });
    expect(gone?.breached).toBe(true);
  });

  it("cross uses the wallet; no wallet / margin → null", () => {
    const c = liquidationPrice({ side: "long", entry: 100, qty: 10, mode: "cross", wallet: 500, tiers });
    expect(c?.price).toBeCloseTo((10 * 100 - 500) / (10 - 10 * 0.004), 8);
    expect(liquidationPrice({ side: "long", entry: 100, qty: 1, tiers })).toBeNull();
    expect(liquidationPrice({ side: "long", entry: 100, qty: 0, leverage: 3, tiers })).toBeNull();
  });

  it("liquidation before the stop", () => {
    expect(liqBeforeStop("long", 90, 92)).toBe(true);
    expect(liqBeforeStop("long", 95, 92)).toBe(false);
    expect(liqBeforeStop("short", 110, 108)).toBe(true);
    expect(liqBeforeStop("short", 110, null)).toBe(false);
  });
});

describe("settings.risk", () => {
  it("defaults, range checks, merged with the discipline limits and the edition's leverage rule", () => {
    expect(riskSettingsOf(undefined)).toEqual({ ...DEFAULT_RISK, tiers: [...DEFAULT_TIERS] });
    expect(riskSettingsOf({ maxLossWeekPct: 5, warnAt: 0.9, cooldownMin: 12.4 })).toMatchObject({ maxLossWeekPct: DEFAULT_RISK.maxLossWeekPct, warnAt: 0.9, cooldownMin: 12 });
    const l = riskLimits({ risk: { maxDrawdownPct: 0.2 }, discipline: { maxLossDayPct: 0.03 } });
    expect(l.maxDrawdownPct).toBe(0.2);
    expect(l.maxLossDayPct).toBe(0.03);
    expect(l.maxTrades).toEqual({ makro: 2, scalp: 5 });
    expect(l.leverageRule).toBe(ED.LEVERAGE_RULE);
  });

  it("withRiskSettings keeps unknown keys, refuses invalid values and returns the same object when unchanged", () => {
    const prev = { other: 1, warnAt: 0.8 };
    const next = withRiskSettings(prev, { warnAt: 0.7, cooldownMin: 45 }) as Record<string, unknown>;
    expect(next).toEqual({ other: 1, warnAt: 0.7, cooldownMin: 45 });
    expect(withRiskSettings(prev, { warnAt: 0.8 })).toBe(prev);
    expect(withRiskSettings(prev, { warnAt: 3 })).toBe(prev);
    const t = withRiskSettings(undefined, { tiers: [{ upTo: 1000, mmr: 0.01 }, { upTo: Infinity, mmr: 0.02 }] }) as Record<string, unknown>;
    expect(t.tiers).toEqual([{ upTo: 1000, mmr: 0.01 }, { upTo: null, mmr: 0.02 }]);
    expect(riskSettingsOf(t).tiers).toEqual([{ upTo: 1000, mmr: 0.01 }, { upTo: Infinity, mmr: 0.02 }]);
  });
});
