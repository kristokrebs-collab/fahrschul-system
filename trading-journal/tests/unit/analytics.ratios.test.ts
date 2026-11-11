/**
 * P03 ratios (`ratios.ts`): trade / daily returns, Sharpe & Sortino (per trade and annualised per day), Calmar from
 * the account view, SQN with the n cap, Kelly from aggregate(), gain-to-pain, Omega, Ulcer, tail ratio and the edge
 * test – hand-computed on small inputs and consistent with `aggregate()` / `accountView()` on the fixture journal.
 */
import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { aggregate } from "@/domain/agg";
import {
  cagrOf,
  calmarOf,
  dailyReturns,
  gainToPainOf,
  kellyOf,
  maxDDOf,
  monthlyNets,
  omegaOf,
  RATIO_MIN,
  ratioReport,
  sharpeOf,
  sortinoOf,
  SQN_CAP,
  tailRatioOf,
  tradeReturns,
  ulcerOf,
} from "@/domain/analytics";
import { enrich, qt, settingsWith, utc } from "./insights.fixtures";
import { fixtureView, NOW } from "./analytics.fixtures";

const S = settingsWith({ capital: { makro: 500, scalp: 500 } });

describe("returns", () => {
  it("trade returns are P&L ÷ balance before the trade", () => {
    const closed = enrich([qt(utc(2026, 1, 1), { p: 100 }), qt(utc(2026, 1, 2), { p: -110 }), qt(utc(2026, 1, 3), { p: 50 })], S);
    const r = tradeReturns(closed, 1000);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
    expect(r[2]).toBeCloseTo(50 / 990, 10);
  });

  it("daily returns cover every calendar day between the first and last trade (empty days = 0)", () => {
    const closed = enrich([qt(utc(2026, 3, 1, 10), { p: 100 }), qt(utc(2026, 3, 1, 14), { p: 100 }), qt(utc(2026, 3, 4, 10), { p: -60 })], S);
    const d = dailyReturns(closed, 1000);
    expect(d.map((x) => x.net)).toEqual([200, 0, 0, -60]);
    expect(d[0]!.ret).toBeCloseTo(0.2, 10);
    expect(d[3]!.ret).toBeCloseTo(-60 / 1200, 10);
    expect(dailyReturns([], 1000)).toEqual([]);
    expect(monthlyNets(closed)).toEqual([{ key: "2026-03", net: 140 }]);
  });
});

describe("single ratios", () => {
  it("Sharpe / Sortino / Omega / gain-to-pain / tail / Kelly on small inputs", () => {
    expect(sharpeOf([1, 2, 3])).toBeCloseTo(2, 10);
    expect(sharpeOf([1, 1])).toBeNull();
    expect(sortinoOf([2, -1, 1, -2])).toBeCloseTo(0 / Math.sqrt(5 / 4), 10);
    expect(sortinoOf([1, 2])).toBeNull();
    expect(omegaOf([2, -1, 1])).toBe(3);
    expect(omegaOf([1, 2])).toBe(Infinity);
    expect(omegaOf([])).toBeNull();
    expect(gainToPainOf([300, -100, -50, 200])).toBeCloseTo(350 / 150, 10);
    expect(gainToPainOf([100, 50])).toBe(Infinity);
    expect(tailRatioOf([-1, -1, 0, 2, 2])).toBeCloseTo(2, 10);
    expect(tailRatioOf([1, 2, 3])).toBeNull();
    // W = 0,5, payoff 2 → 0,5 − 0,5 / 2 = 0,25
    expect(kellyOf([200, -100, 200, -100])).toBeCloseTo(0.25, 10);
    expect(kellyOf([1, 2])).toBeNull();
  });

  it("drawdown, CAGR, Calmar and Ulcer", () => {
    expect(maxDDOf([100, -330, 50], 1000)).toBeCloseTo(-0.3, 10);
    expect(cagrOf(100, 1000, 365)).toBeCloseTo(0.1, 10);
    expect(cagrOf(-1000, 1000, 100)).toBe(-1);
    expect(calmarOf(0.2, -0.1)).toBeCloseTo(2, 10);
    expect(calmarOf(0.2, 0)).toBeNull();
    // peak 110 then 99 (−10 %), back to 110 → √((0 + 0 + 100 + 0) / 4) = 5
    expect(ulcerOf([100, 110, 99, 110])).toBeCloseTo(5, 10);
    expect(ulcerOf([100])).toBeNull();
  });
});

describe("ratioReport on the fixture journal", () => {
  const view = fixtureView();
  const rep = ratioReport(view.closed, view);
  const g = aggregate(view.closed);

  it("agrees with aggregate() and accountView()", () => {
    expect(rep.metrics.kelly.value).toBeCloseTo(g.winRate! - (1 - g.winRate!) / g.payoff!, 10);
    expect(rep.metrics.halfKelly.value).toBeCloseTo(rep.metrics.kelly.value! / 2, 10);
    expect(rep.edgeUnit).toBe("R");
    expect(rep.metrics.edge.value).toBeCloseTo(g.avgR!, 10);
    expect(rep.metrics.calmar.value).toBeCloseTo(view.proj!.comp / -view.maxDD, 10);
    expect(rep.cagr).toBe(view.proj!.comp);
    expect(rep.metrics.ulcer.value).toBeCloseTo(ulcerOf(view.equity.map((p) => p.v))!, 10);
    // SQN: √min(n, 100) · Ø R / sd(R)
    expect(rep.metrics.sqn.value).toBeCloseTo(Math.sqrt(Math.min(rep.rs.length, SQN_CAP)) * sharpeOf(rep.rs)!, 10);
    expect(rep.metrics.sharpe.value).toBeCloseTo(sharpeOf(rep.days.map((d) => d.ret))! * Math.sqrt(365), 10);
  });

  it("every value carries n and an interval that brackets it; the edge is tested one-sided", () => {
    for (const m of Object.values(rep.metrics)) {
      expect(m.n).toBeGreaterThan(0);
      if (m.value != null && Number.isFinite(m.value) && m.ci) {
        expect(m.ci.lo).toBeLessThanOrEqual(m.value + 1e-9);
        expect(m.ci.hi).toBeGreaterThanOrEqual(m.value - 1e-9);
      }
    }
    expect(rep.metrics.edge.p).toBeGreaterThan(0);
    expect(rep.metrics.edge.p).toBeLessThan(0.5);
    expect(rep.tradesNeeded).toBeGreaterThan(1);
  });

  it("is deterministic (seeded bootstrap)", () => {
    expect(ratioReport(view.closed, view)).toEqual(rep);
  });

  it("small samples: values below the per-metric minimum are null, never guessed", () => {
    const few = enrich([qt(utc(2026, 1, 1), { p: 100, risk: 50 }), qt(utc(2026, 1, 2), { p: -50, risk: 50 })], S);
    const v = accountView(few, S, "all", { now: () => NOW });
    const r = ratioReport(v.closed, v);
    expect(r.metrics.sharpe.value).toBeNull();
    expect(r.metrics.sqn.value).toBeNull();
    expect(r.metrics.tailRatio.value).toBeNull();
    expect(r.metrics.sharpe.n).toBeLessThan(RATIO_MIN.sharpe);
    expect(r.edgeUnit).toBe("money");
    const empty = ratioReport([], accountView([], S, "all", { now: () => NOW }));
    expect(Object.values(empty.metrics).every((m) => m.value == null)).toBe(true);
  });
});
