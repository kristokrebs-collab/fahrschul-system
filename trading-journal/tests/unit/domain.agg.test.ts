import { describe, expect, it } from "vitest";
import { aggregate, EMPTY_AGG } from "@/domain/agg";
import { accountView, compoundLabel, streakLabel } from "@/domain/account";
import { rankSetups, rankSetupStats, splitRanked, setupVisibleFor } from "@/domain/rank";
import { tradeTime } from "@/lib/dates";
import { pct } from "@/lib/format";
import { A, B, E, F, enriched, mkTrade, settings } from "./domain.fixtures";

describe("aggregate (bundle wn) – hand-computed", () => {
  const closed = enriched().filter((t) => t.result !== "open");
  const g = aggregate(closed);
  it("counts and sums", () => {
    expect(g.n).toBe(5);
    expect(g.wins).toBe(2);
    expect(g.losses).toBe(2);
    expect(g.be).toBe(1);
    expect(g.net).toBeCloseTo(246, 10);
    expect(g.gw).toBeCloseTo(446, 10);
    expect(g.gl).toBeCloseTo(-200, 10);
    expect(g.fees).toBe(4);
  });
  it("ratios", () => {
    expect(g.winRate).toBeCloseTo(0.4, 12);
    expect(g.pf).toBeCloseTo(2.23, 10);
    expect(g.avgWin).toBeCloseTo(223, 10);
    expect(g.avgLoss).toBeCloseTo(-100, 10);
    expect(g.beWinRate).toBeCloseTo(100 / 323, 10);
    expect(g.payoff).toBeCloseTo(2.23, 10);
    expect(g.exp).toBeCloseTo(49.2, 10);
  });
  it("R statistics only over trades with stop", () => {
    expect(g.rN).toBe(3);
    expect(g.avgR).toBeCloseTo((3.96 - 2 / 3 - 2) / 3, 10);
    expect(g.r2).toBe(1);
    expect(g.bestR).toBeCloseTo(3.96, 10);
    expect(g.worstR).toBe(-2);
  });
  it("best/worst with strict comparison (first wins ties)", () => {
    expect(g.best?.id).toBe("A");
    expect(g.worst?.id).toBe("B");
  });
  it("move statistics", () => {
    expect(g.moveN).toBe(4);
    expect(g.moveWin).toBeCloseTo(0.05, 12);
    expect(g.moveLoss).toBeCloseTo((-1000 / 85000 - 0.0125) / 2, 12);
    expect(g.moveExp).toBeCloseTo((0.05 - 1000 / 85000 + 0 - 0.0125) / 4, 12);
  });
  it("empty and edge aggregates", () => {
    expect(EMPTY_AGG.n).toBe(0);
    expect(EMPTY_AGG.winRate).toBeNull();
    expect(EMPTY_AGG.pf).toBeNull();
    expect(EMPTY_AGG.best).toBeNull();
    const onlyWins = aggregate(enriched([A]));
    expect(onlyWins.pf).toBe(Infinity);
    expect(onlyWins.beWinRate).toBeNull();
    const onlyBe = aggregate(enriched([E]));
    expect(onlyBe.pf).toBeNull();
    expect(onlyBe.winRate).toBe(0);
  });
});

describe("accountView (bundle Hw) – hand-computed", () => {
  const s = settings();
  const now = +new Date("2026-04-01T10:00");
  const v = accountView(enriched(), s, "all", { now: () => now });
  it("start, lists, sort order", () => {
    expect(v.start).toBe(25000);
    expect(v.closed.map((t) => t.id)).toEqual(["A", "B", "C", "E", "F"]);
    expect(v.open.map((t) => t.id)).toEqual(["D"]);
    expect(v.list.length).toBe(6);
  });
  it("equity curve, balance, drawdown", () => {
    expect(v.equity.map((p) => p.v)).toEqual([25000, 25396, 25296, 25346, 25346, 25246]);
    expect(v.equity[0]).toEqual({ i: 0, v: 25000, t: null });
    expect(v.equity[1]!.t?.id).toBe("A");
    expect(v.balance).toBeCloseTo(25246, 10);
    expect(v.peak).toBe(25396);
    expect(v.maxDD).toBeCloseTo(-150 / 25396, 12);
    expect(v.dd).toEqual({ peak: 25396, trough: 25246, peakI: 1, troughI: 5 });
    expect(v.curDD).toBeCloseTo(-150 / 25396, 12);
  });
  it("streak at the end of the closed list", () => {
    expect(v.streak).toBe(1);
    expect(v.streakType).toBe("loss");
    expect(streakLabel(v.streak, v.streakType)).toBe("1× Verlust");
    expect(streakLabel(0, null)).toBeNull();
    const three = accountView(enriched([A, F, { ...F, id: "F2", date: "2026-03-02T10:00" }, { ...B, id: "B2", date: "2026-03-03T10:00" }]), s);
    expect(three.streak).toBe(3);
    expect(three.streakType).toBe("loss");
  });
  it("months: key YYYY-MM local, label BG + YY, last 12", () => {
    expect(v.months.map((m) => m.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(v.months.map((m) => m.label)).toEqual(["Jan 26", "Feb 26", "Mär 26"]);
    expect(v.months[0]!.n).toBe(2);
    expect(v.months[0]!.net).toBeCloseTo(296, 10);
    expect(v.months[1]!.net).toBe(50);
    expect(v.months[2]!.net).toBe(-100);
  });
  it("projection with startDate empty (first trade) and injected now", () => {
    const p = v.proj!;
    const days = (now - +tradeTime(A)) / 864e5;
    expect(p.days).toBeCloseTo(days, 10);
    expect(p.r).toBeCloseTo(246 / 25000, 12);
    expect(p.linear).toBeCloseTo(((246 / 25000) * 365) / days, 12);
    expect(p.comp).toBeCloseTo(Math.pow(1 + 246 / 25000, 365 / days) - 1, 12);
    expect(p.monthly).toBeCloseTo(((246 / 25000) * 30.44) / days, 12);
    expect(p.perWeek).toBeCloseTo(5 / (days / 7), 12);
    expect(p.endLin).toBeCloseTo(25000 * (1 + p.linear), 8);
    expect(p.weak).toBe(true);
  });
  it("projection with explicit startDate and end = max(now, last trade)", () => {
    const v2 = accountView(enriched(), { ...s, startDate: "2026-01-01" }, "all", { now: () => +new Date("2026-01-02T00:00") });
    expect(v2.proj!.days).toBeCloseTo((+tradeTime(F) - +new Date("2026-01-01T00:00")) / 864e5, 10);
    const v3 = accountView(enriched(), { ...s, capital: { makro: 0, scalp: 0 } }, "all");
    expect(v3.proj).toBeNull();
    expect(accountView([], s, "all").proj).toBeNull();
  });
  it("per-setup stats and none", () => {
    const bo = v.setups.find((x) => x.setup.id === "s_bo")!;
    expect(bo.n).toBe(1);
    expect(bo.net).toBeCloseTo(396, 10);
    expect(v.setups.find((x) => x.setup.id === "s_bt")!.n).toBe(1);
    expect(v.none.n).toBe(2); // C and E have no setup
  });
  it("account scopes (missing account → scalp)", () => {
    const makro = accountView(enriched(), s, "makro");
    expect(makro.start).toBe(20000);
    expect(makro.list.map((t) => t.id)).toEqual(["D"]);
    expect(makro.closed.length).toBe(0);
    expect(makro.g.n).toBe(0);
    expect(makro.maxDD).toBe(0);
    expect(makro.streakType).toBeNull();
    const scalp = accountView(enriched(), s, "scalp");
    expect(scalp.start).toBe(5000);
    expect(scalp.closed.map((t) => t.id)).toEqual(["A", "B", "C", "E", "F"]);
  });
  it("compoundLabel", () => {
    expect(compoundLabel(150, pct)).toBe("> +9.900 %");
    expect(compoundLabel(-100, pct)).toBe("−100 %");
    expect(compoundLabel(0.5, pct)).toBe(pct(0.5));
  });
});

describe("rank (bundle rT/nT)", () => {
  it("sorts desc by key, null → −∞, ties by n", () => {
    const list = [
      { id: "a", n: 3, winRate: 0.5, net: 10, avgR: null },
      { id: "b", n: 5, winRate: 0.5, net: -5, avgR: 1 },
      { id: "c", n: 0, winRate: null, net: 0, avgR: null },
      { id: "d", n: 2, winRate: 1, net: 1, avgR: 0.2 },
    ];
    expect(rankSetups(list, "winRate").map((x) => x.id)).toEqual(["d", "b", "a", "c"]);
    expect(rankSetups(list, "net").map((x) => x.id)).toEqual(["a", "d", "c", "b"]);
    expect(rankSetups(list, "avgR").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(rankSetups(list, "n").map((x) => x.id)).toEqual(["b", "a", "d", "c"]);
    expect(list.map((x) => x.id)).toEqual(["a", "b", "c", "d"]); // input untouched
    const { used, unused } = splitRanked(rankSetups(list, "winRate"));
    expect(used.length).toBe(3);
    expect(unused.map((x) => x.id)).toEqual(["c"]);
  });
  it("rankSetupStats mirrors id and setupVisibleFor", () => {
    const v = accountView(enriched(), settings(), "all");
    const ranked = rankSetupStats(v.setups);
    expect(ranked[0]!.id).toBe(ranked[0]!.setup.id);
    expect(ranked[0]!.setup.id).toBe("s_bo"); // 100 % win rate, 1 trade
    expect(setupVisibleFor({ account: "both" }, "makro")).toBe(true);
    expect(setupVisibleFor({ account: "scalp" }, "makro")).toBe(false);
    expect(setupVisibleFor({ account: "scalp" }, "all")).toBe(true);
  });
  it("mkTrade sanity", () => {
    expect(mkTrade({ id: "z", date: "2026-01-01T00:00" }).account).toBe("scalp");
  });
});
