/**
 * P03 pattern modules: MAE / MFE efficiency (`excursion.ts`), the result distribution (`distribution.ts`), rolling
 * windows (`rolling.ts`), the streak report (`streaks.ts`), benchmarks (`benchmark.ts`), comparisons (`compare.ts`)
 * and custom stats (`customStats.ts`, stored in `settings.analytics.custom`).
 */
import { describe, expect, it } from "vitest";
import { aggregate } from "@/domain/agg";
import {
  accountSplit,
  adaptiveBenchmark,
  ADAPTIVE_MIN_WINDOWS,
  applyCustomFilter,
  benchmark,
  compareSets,
  customStatsOf,
  customStatTitle,
  distributionReport,
  evalCustomStat,
  excursionR,
  excursionReport,
  hampelOutliers,
  histogram,
  niceStep,
  periodSplit,
  rollingStats,
  setupSplit,
  streakReport,
  withCustomStats,
  type CustomStat,
  type DailyClose,
} from "@/domain/analytics";
import { enrich, qt, settingsWith, utc } from "./insights.fixtures";
import { CTX, fixtureView, NOW, SETTINGS } from "./analytics.fixtures";

const view = fixtureView();

describe("excursion", () => {
  it("R from stored R or distance ÷ stop distance; efficiencies, money left, given back, hints", () => {
    const rep = excursionReport(view.closed);
    expect(rep.total).toBe(60);
    expect(rep.n).toBe(20);
    const sample = view.closed.find((t) => t.id === "a0")!;
    expect(excursionR(sample)).toEqual({ maeR: 0.4, mfeR: 3 });
    // winners exited at 102 with an MFE of 3 → 2 / 3 kept, (3 − 2) × qty 100 = 100 left each
    expect(rep.exitEfficiency.mean).toBeCloseTo(2 / 3, 10);
    expect(rep.leftOnTable.money).toBeCloseTo(100 * rep.leftOnTable.n, 6);
    expect(rep.entryEfficiency.mean).toBeCloseTo(0.4, 10);
    expect(rep.givenBack.every((t) => t.result === "loss")).toBe(true);
    expect(rep.givenBack.length).toBeGreaterThan(0);
    expect(rep.winnerMaeP80).toBeCloseTo(0.4, 10);
    expect(excursionReport([]).n).toBe(0);
  });
});

describe("distribution", () => {
  it("nice zero-aligned histogram bins", () => {
    expect(niceStep(100, 10)).toBe(10);
    expect(niceStep(7, 12)).toBe(1);
    const bins = histogram([-150, -40, 0, 30, 220]);
    expect(bins.some((b) => b.lo === 0)).toBe(true);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(5);
    expect(bins[0]!.lo).toBeLessThanOrEqual(-150);
    expect(bins[bins.length - 1]!.hi).toBeGreaterThan(220);
    expect(histogram([])).toEqual([]);
    expect(histogram([5, 5]).reduce((s, b) => s + b.n, 0)).toBe(2);
  });

  it("moments, Hampel outliers, numbers without the top trades, profit concentration", () => {
    const S = settingsWith();
    const list = enrich(
      [10, -10, 12, -9, 11, -11, 9, -10, 10, 900].map((p, i) => qt(utc(2026, 2, 1 + i), { p })),
      S,
    );
    const rep = distributionReport(list, "money");
    expect(rep.n).toBe(10);
    expect(rep.skew!).toBeGreaterThan(2);
    expect(rep.outliers.map((o) => o.value)).toEqual([900]);
    expect(rep.withoutTop[0]).toEqual({ k: 1, g: aggregate(list.filter((t) => t.pnl !== 900)) });
    expect(rep.withoutOutliers!.net).toBeCloseTo(rep.withoutTop[0]!.g.net, 10);
    expect(rep.concentration.top1).toBeCloseTo(900 / (900 + 10 + 12 + 11 + 9 + 10), 10);
    expect(rep.concentration.top10pct).toBeCloseTo(rep.concentration.top1!, 10);
    expect(hampelOutliers([])).toEqual([]);
    const r = distributionReport(view.closed, "R");
    expect(r.unit).toBe("R");
    expect(r.n).toBe(60);
  });
});

describe("rolling", () => {
  it("windows through aggregate(), equity in R, form against the Wilson interval", () => {
    const rep = rollingStats(view.closed, view.start, 20);
    expect(rep.points).toHaveLength(41);
    const p0 = rep.points[0]!;
    const g = aggregate(view.closed.slice(0, 20));
    expect(p0.i).toBe(20);
    expect(p0.winRate).toBe(g.winRate);
    expect(p0.pf).toBe(g.pf);
    expect(p0.expR).toBeCloseTo(g.avgR!, 10);
    expect(rep.equityR).toHaveLength(61);
    expect(rep.equityR[60]).toBeCloseTo(view.closed.reduce((s, t) => s + (t.r ?? 0), 0), 6);
    expect(["heiss", "kalt", "normal"]).toContain(rep.form!.verdict);
    expect(rollingStats(view.closed.slice(0, 5), view.start, 20).form).toBeNull();
  });
});

describe("streak report", () => {
  it("expectation, distribution bars, dependence after losses", () => {
    const rep = streakReport(view.closed);
    expect(rep.n).toBe(60);
    expect(rep.bars).toHaveLength(Math.max(rep.longestWin, rep.longestLoss));
    expect(rep.bars.reduce((s, b) => s + b.wins * b.length, 0)).toBe(view.g.wins);
    expect(rep.expectedLoss).toBeGreaterThan(1);
    expect(rep.lossVsExpected).not.toBeNull();
    expect(rep.dependence).not.toBeNull();
    expect(rep.dependence!.diff).toBeCloseTo(rep.pWinAfterLoss! - rep.pWinAfterWin!, 10);
    expect(streakReport([]).lossVsExpected).toBeNull();
  });
});

describe("benchmark", () => {
  const S = settingsWith({ capital: { makro: 500, scalp: 500 } });
  const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

  it("own equity vs. buy & hold, day by day from the first trade", () => {
    const closed = enrich([qt(utc(2026, 1, 2, 10), { p: 100 }), qt(utc(2026, 1, 4, 10), { p: -50 })], S);
    const candles: DailyClose[] = [1, 2, 3, 4, 5].map((d, i) => ({ time: day(2026, 1, d), open: 100 + i * 10, close: 110 + i * 10 }));
    const rep = benchmark(closed, 1000, candles)!;
    expect(rep.from).toBe(day(2026, 1, 2));
    expect(rep.to).toBe(day(2026, 1, 5));
    expect(rep.points).toHaveLength(4);
    // bought at the open of 2 Jan (110), last close 150
    expect(rep.bh).toBeCloseTo(150 / 110 - 1, 10);
    expect(rep.own).toBeCloseTo(0.05, 10);
    expect(rep.alpha).toBeCloseTo(rep.own - rep.bh, 10);
    expect(rep.clipped).toBe(false);
    expect(benchmark(closed, 1000, [])).toBeNull();
    expect(benchmark([], 1000, candles)).toBeNull();
  });

  it("clips to the first candle when the cache starts later", () => {
    const closed = enrich([qt(utc(2025, 12, 1, 10), { p: 100 }), qt(utc(2026, 1, 3, 10), { p: 50 })], S);
    const candles: DailyClose[] = [2, 3].map((d) => ({ time: day(2026, 1, d), open: 100, close: 100 }));
    const rep = benchmark(closed, 1000, candles)!;
    expect(rep.clipped).toBe(true);
    expect(rep.from).toBe(day(2026, 1, 2));
    // the balance at the comparison start (1100) is the base
    expect(rep.own).toBeCloseTo(50 / 1100, 10);
  });

  it("adaptive: the last 90 days as a percentile of the own history", () => {
    const trades = Array.from({ length: 200 }, (_, i) => qt(utc(2025, 6, 1 + i, 12), { p: i < 150 ? 5 : 20 }));
    const closed = enrich(trades, S);
    const now = Date.UTC(2025, 5, 1 + 199, 18);
    const a = adaptiveBenchmark(closed, 1000, now)!;
    expect(a.windows).toBeGreaterThanOrEqual(ADAPTIVE_MIN_WINDOWS);
    expect(a.percentile).toBe(1);
    expect(a.current).toBeGreaterThan(a.worst);
    expect(adaptiveBenchmark(closed.slice(0, 50), 1000, Date.UTC(2025, 5, 51))).toBeNull();
  });
});

describe("compare", () => {
  it("A vs. B with intervals and tests", () => {
    const { a, b, labels } = setupSplit(view.closed, "s_good", "s_bad", ["Breakout", "Fade"]);
    const c = compareSets(a, b, labels);
    expect(c.a.g).toEqual(aggregate(a));
    const wr = c.rows.find((r) => r.key === "winRate")!;
    expect(wr.delta).toBeCloseTo(c.a.g.winRate! - c.b.g.winRate!, 10);
    expect(wr.ci!.lo).toBeLessThan(wr.delta!);
    expect(wr.better).toBe("a");
    const r = c.rows.find((x) => x.key === "avgR")!;
    expect(r.verdict).toBe("klar");
    expect(c.rows.map((x) => x.key)).toEqual(["n", "winRate", "exp", "avgR", "pf", "net"]);
  });

  it("splits: periods, accounts", () => {
    const p = periodSplit(view.closed, "month", NOW);
    expect(p.labels).toEqual(["Dieser Monat", "Letzter Monat"]);
    expect(p.a.every((t) => new Date(t.date).getMonth() === new Date(NOW).getMonth())).toBe(true);
    const d30 = periodSplit(view.closed, "30d", NOW);
    expect(d30.ranges[0][0] - d30.ranges[1][0]).toBe(30 * 86_400_000);
    const acc = accountSplit(view.closed);
    expect(acc.a.length + acc.b.length).toBe(60);
    const empty = compareSets([], [], ["A", "B"]);
    expect(empty.rows.find((r) => r.key === "winRate")!.verdict).toBe("wenig");
  });
});

describe("custom stats", () => {
  const stat: CustomStat = { id: "c1", metric: "winRate", filter: { side: "long", since: "all" }, groupBy: "session", createdAt: "2026-06-01T00:00:00.000Z" };

  it("round-trips through settings.analytics.custom, dropping broken entries and keeping other keys", () => {
    const s = withCustomStats({ ...SETTINGS, analytics: { other: 1 } } as typeof SETTINGS, [stat]);
    expect((s as unknown as { analytics: { other: number } }).analytics.other).toBe(1);
    expect(customStatsOf(s)).toEqual([stat]);
    const broken = { ...SETTINGS, analytics: { custom: [{ id: "x", metric: "nope" }, null, { id: "y", metric: "pf", groupBy: "bogus", filter: { side: "up", dim: "setup", key: "s_good" } }] } } as unknown as typeof SETTINGS;
    expect(customStatsOf(broken)).toEqual([{ id: "y", metric: "pf", filter: { dim: "setup", key: "s_good" }, groupBy: null, createdAt: "" }]);
    expect(customStatsOf(SETTINGS)).toEqual([]);
  });

  it("filters, evaluates and groups", () => {
    const longs = applyCustomFilter(view.closed, stat.filter, CTX, NOW);
    expect(longs.every((t) => t.side === "long")).toBe(true);
    const res = evalCustomStat(view.closed, stat, CTX, view.start, NOW);
    expect(res.value).toBe(aggregate(longs).winRate);
    expect(res.n).toBe(longs.length);
    expect(res.ci).not.toBeNull();
    expect(res.groups!.reduce((s, g) => s + g.n, 0)).toBe(longs.length);
    const inBucket = applyCustomFilter(view.closed, { dim: "setup", key: "s_good", since: "30d" }, CTX, NOW);
    expect(inBucket.every((t) => t.setups.includes("s_good") && +new Date(t.date) >= NOW - 30 * 86_400_000)).toBe(true);
    expect(customStatTitle(stat, CTX)).toBe("Win-Rate · Long · nach Session");
  });
});
