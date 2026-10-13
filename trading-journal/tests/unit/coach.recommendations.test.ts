/**
 * P04 advice (`recommendations.ts`), the trade review (`tradeReview.ts`) and the live watcher logic (`watch.ts`).
 */
import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { detectBehaviors } from "@/domain/coach/events";
import { findEdges } from "@/domain/coach/edges";
import { behaviorProfile, coachTips, improvementPlan, journalRate, recommendations, sessionPhrase, tradingScore, weeklyLesson, whatIf } from "@/domain/coach/recommendations";
import { tradeReview } from "@/domain/coach/tradeReview";
import { coachAlert, newEvents } from "@/domain/coach/watch";
import { behaviorReport } from "@/domain/coach/behaviors";
import { PRINCIPLES } from "@/domain/coach/copy";
import type { Trade } from "@/domain/types";
import { at, COACH_SETTINGS, coachJournal, ct, enrichC } from "./coach.fixtures";

const NOW = new Date(2026, 5, 1, 12).getTime();

function setup(days = 90) {
  const enriched = enrichC(coachJournal(days));
  const view = accountView(enriched, COACH_SETTINGS, "all", { now: () => NOW });
  const events = detectBehaviors({ trades: enriched, settings: COACH_SETTINGS });
  const edges = findEdges(view.closed, { settings: COACH_SETTINGS, events });
  return { enriched, view, events, edges };
}

describe("What-if", () => {
  it("skip removes the matching trades, only keeps them; the interval brackets the change", () => {
    const { view } = setup(60);
    const isBad = (t: (typeof view.closed)[number]) => t.setups.includes("s_bad");
    const skip = whatIf(view.closed, isBad, "skip", "R", "Ohne Fade");
    const badSum = view.closed.filter(isBad).reduce((s, t) => s + (t.r ?? 0), 0);
    expect(skip.delta).toBeCloseTo(-badSum, 6);
    expect(skip.nAfter).toBe(view.closed.filter((t) => !isBad(t)).length);
    expect(skip.ci!.lo).toBeLessThanOrEqual(skip.delta + 1e-9);
    expect(skip.ci!.hi).toBeGreaterThanOrEqual(skip.delta - 1e-9);
    const only = whatIf(view.closed, (t) => !isBad(t), "only", "R", "Nur Breakout");
    expect(only.meanAfter!).toBeGreaterThan(only.mean!);
    expect(whatIf(view.closed, isBad, "skip", "R", "Ohne Fade")).toEqual(skip);
  });
});

describe("Empfehlungen und Plan", () => {
  it("names the expensive behaviour with evidence and a goal draft", () => {
    const { view, events, edges } = setup();
    const recs = recommendations({ closed: view.closed, events, edges, list: view.list, currency: "USDT" });
    const rev = recs.find((r) => r.id === "behavior:revenge")!;
    expect(rev).toBeTruthy();
    expect(rev.kind).toBe("stop");
    expect(rev.impact).toBeLessThan(0);
    expect(rev.evidence.length).toBeGreaterThan(3);
    expect(rev.whatIf!.delta).toBeGreaterThan(0);
    expect(rev.goal).toMatchObject({ metric: "behavior", comparator: "atMost", target: 0, scope: { behavior: "revenge" }, source: { kind: "coach", ref: "behavior:revenge" } });
    expect(recs.some((r) => r.kind === "focus" && r.id.includes("s_good"))).toBe(true);
  });

  it("the plan is the top 3 with evidence, no duplicates", () => {
    const { view, events, edges } = setup();
    const plan = improvementPlan(recommendations({ closed: view.closed, events, edges, list: view.list, currency: "USDT" }));
    expect(plan.length).toBe(3);
    expect(new Set(plan.map((p) => p.goal.title)).size).toBe(3);
    for (const p of plan) expect(p.verdict).not.toBe("zu wenig Daten");
  });

  it("asks for reviews when the journal is thin", () => {
    const { view, events, edges } = setup(30);
    expect(journalRate(view.list)).toBe(0);
    const recs = recommendations({ closed: view.closed, events, edges, list: view.list, currency: "USDT" });
    expect(recs.find((r) => r.id === "journal")?.goal.metric).toBe("journalRate");
  });
});

describe("Trading-Score", () => {
  it("combines edge, discipline, risk and journaling", () => {
    const { view } = setup();
    const s = tradingScore({ view, settings: COACH_SETTINGS, now: NOW });
    expect(s.parts.map((p) => p.key)).toEqual(["edge", "discipline", "risk", "journal"]);
    expect(s.score).not.toBeNull();
    expect(s.score!).toBeGreaterThanOrEqual(0);
    expect(s.score!).toBeLessThanOrEqual(100);
    expect(s.parts.find((p) => p.key === "journal")!.value).toBe(0);
    expect(s.weakest?.key).toBeTruthy();
  });

  it("says 'Zu wenig Daten' without trades", () => {
    const view = accountView([], COACH_SETTINGS, "all", { now: () => NOW });
    expect(tradingScore({ view, settings: COACH_SETTINGS, now: NOW })).toMatchObject({ score: null, label: "Zu wenig Daten" });
  });
});

describe("Profil, Lektion, Tipps", () => {
  it("the profile headline puts the right preposition before the session (P1-09)", () => {
    expect(sessionPhrase("weekend", "Wochenende")).toBe("am Wochenende");
    expect(sessionPhrase("london", "London")).toBe("in London");
    expect(sessionPhrase("ny", "New York")).toBe("in New York");
    expect(sessionPhrase("late", "Spät")).toBe("in der Spät-Session");
    expect(sessionPhrase("other", "Irgendwo")).toBe("in Irgendwo");
  });

  it("builds a profile with a headline from 10 trades", () => {
    const { view, events, edges } = setup();
    const p = behaviorProfile({ closed: view.closed, list: view.list, settings: COACH_SETTINGS, events, edges, currency: "USDT" });
    expect(p.headline.length).toBeGreaterThan(3);
    expect(["Revenge-Trade", "Regelverstoß"]).toContain(p.traits.find((t) => t.id === "weakness")?.value);
    expect(p.traits.find((t) => t.id === "edge")).toBeTruthy();
    expect(behaviorProfile({ closed: view.closed.slice(0, 5), list: view.list.slice(0, 5), settings: COACH_SETTINGS, events, edges, currency: "USDT" }).traits).toEqual([]);
  });

  it("the lesson comes from the last 7 days, else from the edge, else a principle", () => {
    const { view, events, edges } = setup();
    const last = view.closed[view.closed.length - 1]!;
    const now = new Date(last.date).getTime() + 3600_000;
    const data = weeklyLesson({ closed: view.closed, events, edges, now, currency: "USDT" });
    expect(data.source).toBe("data");
    expect(data.lines.join(" ")).toContain(data.highlight);
    const principle = weeklyLesson({ closed: [], events: [], edges: { ...edges, edges: [], leaks: [] }, now: 0, currency: "USDT" });
    expect(principle.source).toBe("principle");
    expect(PRINCIPLES.map((p) => p.highlight)).toContain(principle.highlight);
  });

  it("tips are short", () => {
    const { view, events, edges } = setup();
    const recs = recommendations({ closed: view.closed, events, edges, list: view.list, currency: "USDT" });
    const profile = behaviorProfile({ closed: view.closed, list: view.list, settings: COACH_SETTINGS, events, edges, currency: "USDT" });
    const tips = coachTips({ recs, profile });
    expect(tips.length).toBeGreaterThanOrEqual(2);
    for (const t of tips) expect(t.length).toBeLessThanOrEqual(28);
  });
});

describe("Trade-Review", () => {
  it("compares plan and execution and finds similar trades", () => {
    const ts: Trade[] = Array.from({ length: 5 }, (_, i) => ct(at(i, 600), { p: 100, target: 103 }));
    ts.push(ct(at(6, 600), { id: "x", p: 50, target: 103, plannedEntry: 99.6, followedPlan: false, mfeR: 3, mae: 0.9, maeR: 0.9, mfe: 3 }));
    const all = enrichC(ts);
    const t = all.find((x) => x.id === "x")!;
    const events = detectBehaviors({ trades: all, settings: COACH_SETTINGS });
    const rv = tradeReview({ trade: t, all, settings: COACH_SETTINGS, events, currency: "USDT" });
    const labels = rv.lines.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(["Einstieg vs. Plan", "R vs. Plan", "Plan befolgt", "MAE", "MFE", "Regel"]));
    expect(rv.lines.find((l) => l.label === "Einstieg vs. Plan")!.value).toBe("0,4 R schlechter");
    expect(rv.behaviors.map((e) => e.key)).toEqual(expect.arrayContaining(["fomo", "earlyProfit"]));
    expect(rv.similar).toMatchObject({ n: 5, winRate: 1 });
    expect(rv.grade).not.toBeNull();
    expect(rv.verdict.tone).toBe("loss");
  });

  it("an open trade has no grade", () => {
    const all = enrichC([ct(at(0, 600), { id: "o", status: "open", exit: null, pnlManual: null })]);
    const rv = tradeReview({ trade: all[0]!, all, settings: COACH_SETTINGS, events: [], currency: "USDT" });
    expect(rv.grade).toBeNull();
    expect(rv.verdict.text).toContain("läuft noch");
  });
});

describe("Live-Wächter", () => {
  it("toasts the new revenge entry with advice and a 30-min pause", () => {
    const before = enrichC([ct(at(0, 600), { id: "L", p: -100 })]);
    const after = enrichC([ct(at(0, 600), { id: "L", p: -100 }), ct(at(0, 612), { id: "R", p: 0, status: "open", exit: null, pnlManual: null })]);
    const now = new Date(at(0, 612)).getTime();
    const a = coachAlert({ before, after, changedIds: new Set(["R"]), settings: COACH_SETTINGS, now })!;
    expect(a.key).toBe("revenge");
    expect(a.cooldownMin).toBe(30);
    expect(a.until).toBe(now + 30 * 60_000);
    // the pause is named once (the advice already says it)
    expect(a.detail).toContain("30 Minuten Pause");
    expect(a.detail.match(/Pause/g)).toHaveLength(1);
    expect(a.tradeId).toBe("R");
  });

  it("stays silent for a clean save and never repeats an event", () => {
    const before = enrichC([ct(at(0, 600), { id: "A", p: 100 })]);
    const after = enrichC([ct(at(0, 600), { id: "A", p: 100 }), ct(at(1, 600), { id: "B", p: 100 })]);
    expect(coachAlert({ before, after, changedIds: new Set(["B"]), settings: COACH_SETTINGS, now: 0 })).toBeNull();
    const ev = detectBehaviors({ trades: enrichC([ct(at(0, 600), { id: "L", p: -100 }), ct(at(0, 610), { id: "R", p: -10 })]), settings: COACH_SETTINGS });
    expect(newEvents(ev, ev, new Set(["R"]))).toEqual([]);
  });
});

describe("Verhaltens-Kosten", () => {
  it("counts only events whose triggering trade is in the set", () => {
    const { view, events } = setup(60);
    const rep = behaviorReport(events, view.closed);
    const rev = rep.stats.find((s) => s.key === "revenge")!;
    expect(rev.excess).toBeLessThan(0);
    expect(rep.worst).toBeTruthy();
    const none = behaviorReport(events, []);
    expect(none.stats).toEqual([]);
  });
});
