import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { aggregate } from "@/domain/agg";
import {
  AUTO_MISTAKES,
  autoMistakes,
  bucketSummary,
  byHour,
  bySession,
  byWeekday,
  conditionEffects,
  DEFAULT_LIMITS,
  disciplineLimits,
  disciplineStreak,
  disciplineSummary,
  drawdownReport,
  findings,
  heatLevel,
  heatMap,
  mistakeReport,
  periodRange,
  rBinIndex,
  rDistribution,
  recap,
  scoreDay,
  sessionOf,
  snapOf,
  strengthRows,
  winnersVsLosers,
  type DisciplineDay,
} from "@/domain/insights";
import { closedOf, enrich, qt, settingsWith, theirSnap, utc } from "./insights.fixtures";

const s = settingsWith({ capital: { makro: 5000, scalp: 1000 } });
const known = new Set(s.setups.map((x) => x.id));

describe("Fehler-Kosten", () => {
  const list = enrich([
    qt("2026-03-01T10:00", { p: 100, risk: 50 }),
    qt("2026-03-02T10:00", { p: 60, risk: 30 }),
    qt("2026-03-03T10:00", { p: -90, risk: 30, mistakes: ["Zu früh rein"] }),
    qt("2026-03-04T10:00", { p: -50, risk: 50, mistakes: ["Zu früh rein", "FOMO-Einstieg"] }),
    qt("2026-03-05T10:00", { p: 20, stop: null, mistakes: ["Kein Stop"] }),
    qt("2026-03-06T10:00", { p: -30, stop: null }),
  ]);
  const closed = closedOf(list);

  it("recognises mistakes from the trade's own fields", () => {
    const t = enrich([qt("2026-03-07T10:00", { p: -500, risk: 100, stop: 99, leverage: 9, followedPlan: false, emotion: "FOMO", setups: [], signal: theirSnap("long", 0) })])[0]!;
    const tags = autoMistakes(t, known);
    expect(tags).toEqual(
      expect.arrayContaining([AUTO_MISTAKES.leverage, AUTO_MISTAKES.plan, AUTO_MISTAKES.fomo, AUTO_MISTAKES.noSetup, AUTO_MISTAKES.againstCheck, AUTO_MISTAKES.bigLoss]),
    );
    expect(tags).not.toContain(AUTO_MISTAKES.noStop);
  });
  it("manual tags only: excess = Σ P&L − n · Ø clean", () => {
    const rep = mistakeReport(closed, s.setups, false);
    // clean: +100, +60, −30 → exp 130/3
    expect(rep.clean.n).toBe(3);
    const early = rep.rows.find((r) => r.tag === "Zu früh rein")!;
    expect(early.n).toBe(2);
    expect(early.excess).toBeCloseTo(-140 - 2 * (130 / 3), 10);
    expect(early.excessR).toBeCloseTo(-4 - 2 * ((2 + 2) / 2), 10);
    expect(rep.rows[0]!.tag).toBe("Zu früh rein");
    expect(rep.leak!.tag).toBe("Zu früh rein");
    expect(rep.tagged).toBe(3);
    // a trade with two tags counts in both rows
    expect(rep.rows.find((r) => r.tag === "FOMO-Einstieg")!.n).toBe(1);
  });
  it("automatic tags merge with the manual label and count separately", () => {
    const rep = mistakeReport(closed, s.setups, true);
    const noStop = rep.rows.find((r) => r.tag === "Kein Stop")!;
    expect(noStop.n).toBe(2);
    expect(noStop.manual).toBe(1);
    expect(noStop.auto).toBe(1);
    expect(rep.clean.n + rep.tagged).toBe(closed.length);
  });
  it("no mistakes → no rows, no leak", () => {
    const rep = mistakeReport(closed.slice(0, 2), s.setups, false);
    expect(rep.rows).toHaveLength(0);
    expect(rep.leak).toBeNull();
  });
});

describe("Signal-Stärke", () => {
  const list = enrich([
    qt("2026-03-01T10:00", { p: 100, risk: 50, signal: theirSnap("long", 3, { rsiOk: true, zoneOk: true }) }),
    qt("2026-03-02T10:00", { p: -50, risk: 50, signal: theirSnap("long", 1) }),
    qt("2026-03-03T10:00", { p: 80, risk: 40, signal: { ...theirSnap("long", 3), v: 2, mode: "retro", extra: "kept" } }),
    qt("2026-03-04T10:00", { p: -20, risk: 20 }),
    qt("2026-03-05T10:00", { p: 10, signal: "garbage" }),
  ]);
  const closed = closedOf(list);

  it("parses the other journal's snapshot and ours", () => {
    expect(snapOf(closed[0]!)!.strength).toBe(3);
    expect(snapOf(closed[2]!)!.mode).toBe("retro");
    expect(snapOf(closed[4]!)).toBeNull();
  });
  it("groups by strength, strongest first, no-check last", () => {
    const r = strengthRows(closed);
    expect(r.rows.map((x) => x.key)).toEqual([3, 1, "none"]);
    expect(r.withCheck).toBe(3);
    expect(r.rows[0]!.g.net).toBe(180);
    expect(r.rows[0]!.label).toBe("Sehr stark");
    expect(r.rows[2]!.g.n).toBe(2);
  });
  it("condition effects: met vs missed among checked trades", () => {
    const fx = conditionEffects(closed);
    const rsi = fx.find((e) => e.key === "mtf_rsi")!;
    expect(rsi.met.n).toBe(1);
    expect(rsi.missed.n).toBe(2);
    expect(rsi.dWin).toBeCloseTo(1 - 0.5, 10);
    const third = fx.find((e) => e.key === "mtf_third")!;
    expect(third.met.n).toBe(2);
    expect(third.dR).toBeCloseTo(2 - -1, 10);
    expect(conditionEffects(closed.slice(3, 4))).toEqual([]);
  });
});

describe("Disziplin", () => {
  const ctx = { knownSetups: known, capital: s.capital, limits: DEFAULT_LIMITS };

  it("scores a day against the applicable rules", () => {
    const day = enrich([
      qt("2026-03-02T09:00", { p: 30, risk: 10, notes: "ok", followedPlan: true, leverage: 3 }),
      qt("2026-03-02T11:00", { p: -15, risk: 10, notes: "", followedPlan: true, leverage: 6 }),
    ]);
    const d = scoreDay("2026-03-02", day, ctx);
    const by = Object.fromEntries(d.rules.map((r) => [r.key, r.ok]));
    expect(by.stop).toBe(true);
    expect(by.setup).toBe(true);
    expect(by.leverage).toBe(false);
    expect(by.plan).toBe(true);
    expect(by.lossTrade).toBe(true);
    expect(by.lossDay).toBe(true);
    expect(by.maxTrades).toBe(true);
    expect(by.signal).toBeNull();
    expect(by.reflect).toBe(false);
    expect(d.score).toBeCloseTo((d.met / d.applicable) * 100, 10);
  });
  it("a day note counts as reflection; loss limits use the account capital", () => {
    const day = enrich([qt("2026-03-03T09:00", { p: -30, risk: 10 })]);
    const d = scoreDay("2026-03-03", day, { ...ctx, notes: { "2026-03-03": { note: "Review", updatedAt: "x" } } });
    const by = Object.fromEntries(d.rules.map((r) => [r.key, r.ok]));
    expect(by.reflect).toBe(true);
    // 30 > 2 % of 1000 (scalp)
    expect(by.lossTrade).toBe(false);
    expect(by.lossDay).toBe(true);
  });
  it("too many trades per account per day", () => {
    const six = enrich(Array.from({ length: 6 }, (_, i) => qt(`2026-03-04T${String(8 + i).padStart(2, "0")}:00`, { p: 1 })));
    const d = scoreDay("2026-03-04", six, ctx);
    expect(d.rules.find((r) => r.key === "maxTrades")!.ok).toBe(false);
  });
  it("limits come from settings.discipline when valid", () => {
    expect(disciplineLimits({})).toEqual(DEFAULT_LIMITS);
    expect(disciplineLimits({ discipline: { maxLossTradePct: 0.01, maxTrades: { scalp: 8, makro: "x" } } })).toEqual({ ...DEFAULT_LIMITS, maxLossTradePct: 0.01, maxTrades: { makro: 2, scalp: 8 } });
  });
  it("streak skips days without trades and stops at a weak day", () => {
    const mk = (key: string, score: number | null) => ({ key, score }) as DisciplineDay;
    expect(disciplineStreak([mk("a", 100), mk("b", 50), mk("c", 90), mk("d", null), mk("e", 80)])).toBe(2);
    expect(disciplineStreak([])).toBe(0);
  });
  it("heat map: 26 × 7 ending with this week, levels by score", () => {
    const list = enrich([qt("2026-10-05T10:00", { p: 10, notes: "x" })]);
    const sum = disciplineSummary({ list, settings: s }, new Date(2026, 9, 7, 12));
    const cols = heatMap(sum.days, new Date(2026, 9, 7, 12));
    expect(cols).toHaveLength(26);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    const last = cols[25]!;
    expect(last[0]!.key).toBe("2026-10-05");
    expect(last[0]!.day).not.toBeNull();
    expect(last[3]!.inFuture).toBe(true);
    expect([heatLevel(null), heatLevel(10), heatLevel(60), heatLevel(80), heatLevel(100)]).toEqual([0, 1, 2, 3, 4]);
    expect(sum.last!.key).toBe("2026-10-05");
    expect(sum.lastIsToday).toBe(false);
    expect(sum.rates.find((r) => r.key === "reflect")!.rate).toBe(1);
  });
});

describe("Zeit & Session", () => {
  it("sessions in UTC, weekend separate", () => {
    expect(sessionOf(new Date(Date.UTC(2026, 9, 7, 6, 59)))).toBe("asia");
    expect(sessionOf(new Date(Date.UTC(2026, 9, 7, 7, 0)))).toBe("london");
    expect(sessionOf(new Date(Date.UTC(2026, 9, 7, 13, 0)))).toBe("ny");
    expect(sessionOf(new Date(Date.UTC(2026, 9, 7, 21, 0)))).toBe("late");
    expect(sessionOf(new Date(Date.UTC(2026, 9, 10, 12, 0)))).toBe("weekend");
  });
  it("buckets add up and the summary needs 3 trades", () => {
    const closed = closedOf(
      enrich([
        qt(utc(2026, 10, 5, 8), { p: 50 }),
        qt(utc(2026, 10, 6, 9), { p: 40 }),
        qt(utc(2026, 10, 7, 10), { p: -10 }),
        qt(utc(2026, 10, 7, 15), { p: -80 }),
        qt(utc(2026, 10, 10, 15), { p: 5 }),
      ]),
    );
    const ses = bySession(closed);
    expect(ses.map((b) => b.key)).toEqual(["asia", "london", "ny", "late", "weekend"]);
    expect(ses.reduce((a, b) => a + b.g.net, 0)).toBe(aggregate(closed).net);
    const london = ses.find((b) => b.key === "london")!;
    expect(london.g.n).toBe(3);
    const sum = bucketSummary(ses);
    expect(sum.best!.key).toBe("london");
    expect(sum.worst).toBeNull();
    expect(sum.busiest!.key).toBe("london");
    expect(byWeekday(closed)).toHaveLength(7);
    expect(byWeekday(closed).reduce((a, b) => a + b.g.n, 0)).toBe(5);
    expect(byHour(closed)).toHaveLength(12);
    expect(byHour(closed).reduce((a, b) => a + b.g.n, 0)).toBe(5);
  });
});

describe("R-Verteilung + Drawdown", () => {
  it("bins have closed/open edges as documented", () => {
    expect([-3, -2, -1.5, -1, -0.2, 0, 0.9, 1, 2, 3, 7].map(rBinIndex)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 6, 6]);
  });
  it("planned vs realised R, big losses, efficiency", () => {
    const closed = closedOf(
      enrich([
        qt("2026-03-01T10:00", { p: 100, risk: 50, target: 103 }),
        qt("2026-03-02T10:00", { p: -60, risk: 50, target: 102 }),
        qt("2026-03-03T10:00", { p: 30 }),
      ]),
    );
    const d = rDistribution(closed);
    expect(d.rN).toBe(2);
    expect(d.avgR).toBe(aggregate(closed).avgR);
    expect(d.bins[4]!.n).toBe(0);
    expect(d.bins[5]!.n).toBe(1);
    expect(d.bins[1]!.n).toBe(1);
    expect(d.planned).toBeCloseTo(2.5, 10);
    expect(d.bigLosses).toHaveLength(1);
    expect(d.efficiency).toBeCloseTo(2 / 3, 10);
    expect(d.share2R).toBe(0.5);
  });
  it("drawdown report agrees with the account view", () => {
    const list = enrich([
      qt("2026-03-01T10:00", { p: 200 }),
      qt("2026-03-02T10:00", { p: -300 }),
      qt("2026-03-03T10:00", { p: 50 }),
      qt("2026-03-05T10:00", { p: 400 }),
      qt("2026-03-06T10:00", { p: -100 }),
    ]);
    const v = accountView(list, s, "scalp");
    const rep = drawdownReport({ ...v, net: v.g.net }, +new Date(2026, 2, 8, 10));
    expect(rep.maxDD).toBe(v.maxDD);
    expect(rep.maxDDAbs).toBe(300);
    expect(rep.current).toBe(v.curDD);
    expect(rep.points).toHaveLength(v.equity.length);
    expect(rep.points[2]!.dd).toBeCloseTo(-300 / 1200, 10);
    expect(rep.recovery).toBeCloseTo(250 / 300, 10);
    expect(rep.longest!.trades).toBe(3);
    expect(rep.longest!.to).toBe(4);
    expect(rep.longest!.days).toBeCloseTo(4, 10);
    expect(rep.needed).toBeCloseTo(1 / (1 + v.curDD) - 1, 10);
    expect(rep.avgDD).toBeCloseTo((-300 / 1200 + -250 / 1200 + -100 / 1350) / 3, 10);
  });
});

describe("Gewinner vs. Verlierer", () => {
  it("compares habits and highlights the three biggest differences", () => {
    const closed = closedOf(
      enrich([
        qt("2026-03-01T10:00", { p: 100, followedPlan: true, conviction: 5, emotion: "Ruhig", leverage: 2 }),
        qt("2026-03-02T10:00", { p: 50, followedPlan: true, conviction: 4, emotion: "Ruhig", leverage: 2 }),
        qt("2026-03-03T10:00", { p: -80, followedPlan: false, conviction: 2, emotion: "FOMO", leverage: 8, side: "short" }),
        qt("2026-03-04T10:00", { p: 0 }),
      ]),
    );
    const w = winnersVsLosers(closed, s.setups, "USDT");
    expect(w.winners.n).toBe(2);
    expect(w.losers.n).toBe(1);
    const plan = w.rows.find((r) => r.key === "plan")!;
    expect(plan.winV).toBe(1);
    expect(plan.lossV).toBe(0);
    expect(w.rows.filter((r) => r.highlight)).toHaveLength(3);
    expect(w.rows.find((r) => r.key === "n")!.highlight).toBe(false);
    expect(w.rows.find((r) => r.key === "emotion")!.win).toBe("Ruhig");
  });
});

describe("Erkenntnisse", () => {
  it("impact = Σ P&L(G) − n(G) · Ø P&L(rest); needs 5 per side and a real difference", () => {
    const weekend = Array.from({ length: 5 }, (_, i) => qt(utc(2026, 10, 3 + (i % 2), 10 + i), { p: -50 }));
    const weekday = Array.from({ length: 6 }, (_, i) => qt(utc(2026, 10, 5 + (i % 5), 10), { p: i % 3 === 0 ? -20 : 60 }));
    const closed = closedOf(enrich([...weekend, ...weekday]));
    const f = findings(closed, { capital: 1000, currency: "USDT", limit: 20 });
    const wk = f.find((x) => x.key === "weekend")!;
    const restExp = (60 * 4 - 40) / 6;
    expect(wk.impact).toBeCloseTo(-250 - 5 * restExp, 10);
    expect(wk.tone).toBe("loss");
    expect(wk.title).toContain("Traden am Wochenende kostet dich");
    expect(wk.confidence).toBe("klar");
    // ranked by |impact|
    for (let i = 1; i < f.length; i++) expect(Math.abs(f[i - 1]!.impact)).toBeGreaterThanOrEqual(Math.abs(f[i]!.impact));
    expect(findings(closed.slice(0, 6), { capital: 1000, currency: "USDT" }).find((x) => x.key === "weekend")).toBeUndefined();
  });
  it("tilt: trades after two losses in a row", () => {
    const seq = [-1, -1, -5, 10, -1, -1, -5, 10, -1, -1, -5, -1, -1, -5, -1, -1, -5, 12, 12, 12, 12, 12];
    const closed = closedOf(enrich(seq.map((p, i) => qt(`2026-04-${String(1 + i).padStart(2, "0")}T10:00`, { p }))));
    const f = findings(closed, { capital: 1000, currency: "USDT", limit: 20 });
    const tilt = f.find((x) => x.key === "tilt");
    expect(tilt).toBeDefined();
    expect(tilt!.group.n).toBeGreaterThanOrEqual(5);
  });
});

describe("Rückblick", () => {
  it("ISO week and month ranges", () => {
    const w = periodRange("week", new Date(2026, 9, 7, 12));
    expect(w.fromKey).toBe("2026-10-05");
    expect(w.toKey).toBe("2026-10-11");
    expect(w.label).toBe("KW 41");
    const m = periodRange("month", new Date(2026, 9, 7), -1);
    expect(m.fromKey).toBe("2026-09-01");
    expect(m.toKey).toBe("2026-09-30");
    expect(m.label).toBe("September 2026");
  });
  it("falls back to the previous period below 4 trades", () => {
    const closed = closedOf(
      enrich([
        qt("2026-09-28T10:00", { p: 50, mistakes: ["Zu früh rein"] }),
        qt("2026-09-29T10:00", { p: -20, mistakes: ["Zu früh rein"] }),
        qt("2026-09-30T10:00", { p: 70 }),
        qt("2026-10-01T10:00", { p: 30 }),
        qt("2026-10-06T10:00", { p: 10 }),
      ]),
    );
    const r = recap({ closed, start: 1000, setups: s.setups, currency: "USDT" }, "week", new Date(2026, 9, 7));
    expect(r.range.offset).toBe(-1);
    expect(r.g.n).toBe(4);
    expect(r.g.net).toBe(130);
    expect(r.enough).toBe(true);
    expect(r.bestDay!.key).toBe("2026-09-30");
    expect(r.sentence).toContain("Gute Woche: +130 USDT");
    expect(r.sentence).toContain("Mittwoch");
    const none = recap({ closed: [], start: 1000, setups: s.setups, currency: "USDT" }, "month", new Date(2026, 9, 7));
    expect(none.enough).toBe(false);
    expect(none.range.offset).toBe(0);
  });
});
