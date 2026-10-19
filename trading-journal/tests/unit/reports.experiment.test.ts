/**
 * F37 Wochenexperiment + Wochenreview: the versioned settings key (round trip, one experiment per week, declining,
 * unknown keys kept, broken entries dropped), the proposal (one measurable hypothesis from the improvement plan, edges
 * without a natural target are skipped), the evaluation in the following week (läuft / zu wenig Daten / erfüllt /
 * nicht erfüllt with the trades that count against the target) and the four findings of the review.
 */
import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { detectBehaviors } from "@/domain/coach/events";
import { findEdges } from "@/domain/coach/edges";
import { improvementPlan, recommendations, type Recommendation } from "@/domain/coach/recommendations";
import { buildReport, currentExperiments, evaluateExperiment, experimentForWeek, experimentStateOf, factorsOfId, measureForRecommendation, periodFromKey, periodOf, proposeExperiment, weekReview, withExperiment, withExperimentDeclined, withoutExperiment, type Experiment } from "@/domain/reports";
import type { Settings } from "@/domain/types";
import { at, COACH_SETTINGS, coachJournal, ct, enrichC } from "./coach.fixtures";

/** Week A = Mar 2–8 (2026-W10), week B = Mar 9–15 (W11), week C = Mar 16–22 (W12). */
const WEEK_B = periodOf("week", new Date(2026, 2, 9));
const WEEK_C = periodOf("week", new Date(2026, 2, 16));
const AFTER_C = new Date(2026, 2, 24, 12).getTime();
const DURING_C = new Date(2026, 2, 18, 12).getTime();

function weekTrades(day0: number, { revenge = false, n = 6, reviewed = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ct(at(day0 + (i % 5), 600 + 30 * Math.floor(i / 5)), { id: `w${day0}_${i}`, p: i % 2 ? -50 : 120, notes: reviewed ? "ok" : undefined }));
  if (revenge) out.push(ct(at(day0 + 1, 700), { id: `w${day0}_rev`, p: -180, risk: 180, emotion: "Revenge", followedPlan: false, notes: "wütend" }));
  return out;
}

const rec = (over: Partial<Recommendation> & Pick<Recommendation, "id">): Recommendation => ({
  kind: "stop",
  title: "Revenge-Trades vermeiden",
  why: "Revenge-Trade: 4 Trades, 25 % Win-Rate, −300 USDT gegenüber deinen sauberen Trades.",
  impact: -300,
  unit: "money",
  confidence: 70,
  verdict: "Tendenz",
  evidence: ["a", "b"],
  whatIf: null,
  goal: { title: "Kein Revenge", kind: "process", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior: "revenge" }, source: { kind: "coach", ref: "x" } },
  ...over,
});

function exp(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "2026-W12|behavior:revenge",
    v: 1,
    recId: "behavior:revenge",
    title: "Revenge-Trades vermeiden",
    hypothesis: "x",
    why: "y",
    measure: { kind: "behavior", behavior: "revenge" },
    comparator: "atMost",
    target: 0,
    minTrades: 5,
    weekKey: "2026-W12",
    sourceWeek: "2026-W11",
    acc: "all",
    baseline: { n: 3, value: 1 },
    evidence: ["a"],
    acceptedAt: "2026-03-15T10:00:00.000Z",
    ...over,
  };
}

describe("Einstellungsschlüssel weekExperiment", () => {
  it("reads empty settings as empty and round-trips an experiment", () => {
    expect(experimentStateOf(COACH_SETTINGS)).toEqual({ experiments: [], declined: [] });
    const s = withExperiment(COACH_SETTINGS, exp());
    expect((s as unknown as { weekExperiment: { v: number } }).weekExperiment.v).toBe(1);
    expect(experimentStateOf(s).experiments).toEqual([exp()]);
    expect(experimentForWeek(s, "2026-W12")?.id).toBe("2026-W12|behavior:revenge");
    expect(experimentForWeek(s, "2026-W13")).toBeNull();
    // every other settings key is untouched
    expect(s.capital).toBe(COACH_SETTINGS.capital);
  });

  it("keeps one experiment per week, newest first, and unknown keys of the root", () => {
    const base = { ...COACH_SETTINGS, weekExperiment: { v: 1, experiments: [], declined: [], future: { x: 1 } } } as unknown as Settings;
    const a = withExperiment(base, exp());
    const b = withExperiment(a, exp({ id: "2026-W12|journal", recId: "journal", measure: { kind: "journalRate" }, comparator: "atLeast", target: 0.9 }));
    expect(experimentStateOf(b).experiments.map((e) => e.recId)).toEqual(["journal"]);
    const c = withExperiment(b, exp({ id: "2026-W13|behavior:revenge", weekKey: "2026-W13" }));
    expect(experimentStateOf(c).experiments.map((e) => e.weekKey)).toEqual(["2026-W13", "2026-W12"]);
    expect((c as unknown as { weekExperiment: { future: unknown } }).weekExperiment.future).toEqual({ x: 1 });
  });

  it("caps the history, declines and withdraws", () => {
    let s: Settings = COACH_SETTINGS;
    for (let i = 0; i < 15; i++) {
      const w = periodOf("week", new Date(2026, 0, 5 + 7 * i)).key;
      s = withExperiment(s, exp({ id: `${w}|journal`, weekKey: w }));
    }
    expect(experimentStateOf(s).experiments).toHaveLength(12);
    const d = withExperimentDeclined(s, "2026-W12|journal");
    expect(experimentStateOf(d).declined).toEqual(["2026-W12|journal"]);
    expect(withExperimentDeclined(d, "2026-W12|journal")).toBe(d);
    expect(experimentStateOf(withoutExperiment(d, "2026-W12|journal")).declined).toEqual([]);
    expect(withoutExperiment(s, "nope")).toBe(s);
  });

  it("drops broken entries instead of repairing them", () => {
    const s = { ...COACH_SETTINGS, weekExperiment: { v: 1, experiments: [exp(), { id: "x" }, { ...exp({ id: "q" }), measure: { kind: "magic" } }, { ...exp({ id: "r" }), v: 2 }, { ...exp({ id: "t" }), weekKey: "2026-10" }], declined: ["a", 5] } } as unknown as Settings;
    const st = experimentStateOf(s);
    expect(st.experiments.map((e) => e.id)).toEqual(["2026-W12|behavior:revenge"]);
    expect(st.declined).toEqual(["a"]);
    expect(experimentStateOf({ ...COACH_SETTINGS, weekExperiment: "kaputt" })).toEqual({ experiments: [], declined: [] });
  });

  it("lists what matters at now: running, planned, the last finished one", () => {
    let s = withExperiment(COACH_SETTINGS, exp());
    s = withExperiment(s, exp({ id: "2026-W13|journal", weekKey: "2026-W13", recId: "journal", measure: { kind: "journalRate" }, comparator: "atLeast", target: 0.9 }));
    expect(currentExperiments(s, DURING_C).map((c) => [c.experiment.weekKey, c.phase])).toEqual([["2026-W12", "läuft"], ["2026-W13", "geplant"]]);
    expect(currentExperiments(s, AFTER_C).map((c) => [c.experiment.weekKey, c.phase])).toEqual([["2026-W13", "läuft"], ["2026-W12", "beendet"]]);
    expect(currentExperiments(s, new Date(2026, 5, 1).getTime())).toEqual([]);
  });
});

describe("Messgröße einer Empfehlung", () => {
  it("maps behaviours, the journal habit and leaks; a focus edge has no natural target", () => {
    expect(measureForRecommendation(rec({ id: "behavior:revenge", behavior: "revenge" }), COACH_SETTINGS)).toMatchObject({ measure: { kind: "behavior", behavior: "revenge" }, comparator: "atMost", target: 0 });
    expect(measureForRecommendation(rec({ id: "behavior:ruleViolation", behavior: "ruleViolation" }), COACH_SETTINGS)?.measure).toEqual({ kind: "ruleBreaks" });
    expect(measureForRecommendation(rec({ id: "journal", goal: { ...rec({ id: "x" }).goal, metric: "journalRate", target: 0.9, comparator: "atLeast" } }), COACH_SETTINGS)).toMatchObject({ measure: { kind: "journalRate" }, comparator: "atLeast", target: 0.9 });
    const leak = measureForRecommendation(rec({ id: "leak:setup=s_bad&session=london" }), COACH_SETTINGS);
    expect(leak?.measure).toMatchObject({ kind: "avoid", factors: [{ dim: "setup", key: "s_bad", label: "Strategie: Fade" }, { dim: "session", key: "london" }] });
    expect(measureForRecommendation(rec({ id: "edge:setup=s_good", kind: "focus" }), COACH_SETTINGS)).toBeNull();
    expect(factorsOfId("nonsense", COACH_SETTINGS)).toBeNull();
    expect(factorsOfId("magic=1", COACH_SETTINGS)).toBeNull();
  });
});

describe("Vorschlag", () => {
  const list = enrichC([...weekTrades(7, { revenge: true }), ...weekTrades(0)]);
  const events = detectBehaviors({ trades: list, settings: COACH_SETTINGS });

  it("proposes ONE hypothesis for the week after the report week, with target, minimum and baseline", () => {
    const p = proposeExperiment({ recs: [rec({ id: "behavior:revenge", behavior: "revenge" })], settings: COACH_SETTINGS, events, list, acc: "all", sourceWeek: WEEK_B })!;
    expect(p.experiment).toMatchObject({ id: "2026-W12|behavior:revenge", weekKey: "2026-W12", sourceWeek: "2026-W11", comparator: "atMost", target: 0, minTrades: 5, acc: "all" });
    expect(p.experiment.baseline).toEqual({ n: 7, value: 1 });
    expect(p.experiment.hypothesis).toBe("Ich kann Revenge-Trade in einer Woche ganz vermeiden.");
    expect(p.target).toBe("Nächste Woche: Revenge-Trade: 0 – bei mindestens 5 Trades.");
    expect(p.declined).toBe(false);
    expect(p.experiment.evidence).toEqual(["a", "b"]);
    expect((p.experiment as { acceptedAt?: string }).acceptedAt).toBeUndefined();
  });

  it("skips a focus edge and takes the next measurable recommendation", () => {
    const recs = [rec({ id: "edge:setup=s_good", kind: "focus", verdict: "klar", goal: { ...rec({ id: "x" }).goal, title: "Mehr Breakout", metric: "expectancyR" } }), rec({ id: "behavior:revenge", behavior: "revenge" })];
    const p = proposeExperiment({ recs, settings: COACH_SETTINGS, events, list, acc: "all", sourceWeek: WEEK_B })!;
    expect(p.experiment.recId).toBe("behavior:revenge");
    expect(p.skipped).toBe(1);
  });

  it("proposes nothing when no recommendation is measurable or the plan is too thin", () => {
    expect(proposeExperiment({ recs: [rec({ id: "edge:setup=s_good", kind: "focus", goal: { ...rec({ id: "x" }).goal, title: "Mehr" } })], settings: COACH_SETTINGS, events, list, acc: "all", sourceWeek: WEEK_B })).toBeNull();
    expect(proposeExperiment({ recs: [rec({ id: "behavior:revenge", behavior: "revenge", verdict: "zu wenig Daten" })], settings: COACH_SETTINGS, events, list, acc: "all", sourceWeek: WEEK_B })).toBeNull();
    expect(proposeExperiment({ recs: [], settings: COACH_SETTINGS, events, list, acc: "all", sourceWeek: WEEK_B })).toBeNull();
  });

  it("remembers a declined proposal", () => {
    const s = withExperimentDeclined(COACH_SETTINGS, "2026-W12|behavior:revenge");
    const p = proposeExperiment({ recs: [rec({ id: "behavior:revenge", behavior: "revenge" })], settings: s, events, list, acc: "all", sourceWeek: WEEK_B })!;
    expect(p.declined).toBe(true);
  });

  it("works on a real recommendation list of a long journal", () => {
    const all = enrichC(coachJournal(90));
    const view = accountView(all, COACH_SETTINGS, "all", { now: () => AFTER_C });
    const ev = detectBehaviors({ trades: all, settings: COACH_SETTINGS });
    const edges = findEdges(view.closed, { settings: COACH_SETTINGS, events: ev });
    const recs = recommendations({ closed: view.closed, events: ev, edges, list: view.list, currency: "USDT" });
    expect(improvementPlan(recs, 5).length).toBeGreaterThan(0);
    const p = proposeExperiment({ recs, settings: COACH_SETTINGS, events: ev, list: view.list, acc: "all", sourceWeek: periodOf("week", new Date(2026, 4, 4)) });
    // either a measurable hypothesis or an honest nothing – never a half-built one
    if (p) {
      expect(p.experiment.weekKey).toBe(periodOf("week", new Date(2026, 4, 11)).key);
      expect(["behavior", "ruleBreaks", "journalRate", "avoid"]).toContain(p.experiment.measure.kind);
      expect(p.target.startsWith("Nächste Woche: ")).toBe(true);
    }
  });
});

describe("Auswertung in der Folgewoche", () => {
  const ctxFor = (ts: ReturnType<typeof weekTrades>, now: number) => {
    const list = enrichC(ts);
    return { list, settings: COACH_SETTINGS, events: detectBehaviors({ trades: list, settings: COACH_SETTINGS }), now };
  };

  it("is „läuft“ while the week is not over", () => {
    const r = evaluateExperiment(exp(), ctxFor(weekTrades(14), DURING_C));
    expect(r).toMatchObject({ status: "läuft", complete: false, n: 6 });
    expect(r.text).toContain("läuft noch");
  });

  it("says „zu wenig Daten“ under the minimum sample, even with zero violations", () => {
    const r = evaluateExperiment(exp(), ctxFor(weekTrades(14, { n: 3 }), AFTER_C));
    expect(r.status).toBe("zu wenig Daten");
    expect(r.actual).toBe(0);
    expect(r.text).toContain("mindestens 5");
    expect(r.text).toContain("Weder bestätigt noch widerlegt");
    expect(evaluateExperiment(exp(), ctxFor([], AFTER_C)).status).toBe("zu wenig Daten");
  });

  it("is „erfüllt“ with enough clean trades", () => {
    const r = evaluateExperiment(exp(), ctxFor(weekTrades(14), AFTER_C));
    expect(r.status).toBe("erfüllt");
    expect(r.actual).toBe(0);
    expect(r.flagged).toEqual([]);
    expect(r.text).toContain("nicht dass es sich auszahlt");
  });

  it("is „nicht erfüllt“ and names the trades that count against the target", () => {
    const r = evaluateExperiment(exp(), ctxFor(weekTrades(14, { revenge: true }), AFTER_C));
    expect(r.status).toBe("nicht erfüllt");
    expect(r.actual).toBeGreaterThanOrEqual(1);
    expect(r.flagged.map((t) => t.id)).toContain("w14_rev");
    expect(r.text).toContain("nicht erfüllt");
  });

  it("measures the journal habit and the avoided pattern", () => {
    const journal = exp({ id: "2026-W12|journal", measure: { kind: "journalRate" }, comparator: "atLeast", target: 0.9 });
    const bad = evaluateExperiment(journal, ctxFor(weekTrades(14, { reviewed: false }), AFTER_C));
    expect(bad.status).toBe("nicht erfüllt");
    expect(bad.actual).toBe(0);
    expect(bad.flagged).toHaveLength(6);
    expect(evaluateExperiment(journal, ctxFor(weekTrades(14), AFTER_C)).status).toBe("erfüllt");

    const avoid = exp({ id: "2026-W12|leak", measure: { kind: "avoid", factors: [{ dim: "side", key: "long", label: "Richtung: Long" }] } });
    const r = evaluateExperiment(avoid, ctxFor(weekTrades(14), AFTER_C));
    expect(r.status).toBe("nicht erfüllt");
    expect(r.actual).toBe(6);
  });

  it("uses the experiment's week and ignores other weeks", () => {
    const r = evaluateExperiment(exp(), ctxFor([...weekTrades(14), ...weekTrades(7, { revenge: true })], AFTER_C));
    expect(r.n).toBe(6);
    expect(r.status).toBe("erfüllt");
    expect(r.week.key).toBe(WEEK_C.key);
    expect(periodFromKey(r.week.key)).toEqual(r.week);
  });
});

describe("Wochenreview", () => {
  const settings = COACH_SETTINGS;
  const build = (ts: ReturnType<typeof weekTrades>, week = WEEK_B) => {
    const list = enrichC(ts);
    const events = detectBehaviors({ trades: list, settings });
    const report = buildReport({ list, settings, events, start: 20_000, currency: "USDT", period: week, now: AFTER_C });
    return { list, events, report, review: weekReview({ report, events, settings }) };
  };

  it("has the four findings with the numbers of the report", () => {
    const { report, review } = build(weekTrades(7, { revenge: true }));
    expect(review.n).toBe(7);
    expect(review.findings.map((f) => f.id)).toEqual(["result", "setups", "discipline", "uncertainty"]);
    const result = review.findings[0]!;
    expect(result.headline).toContain("nach Gebühren und Funding");
    expect(result.lines[0]).toContain(`${report.performance.g.n} Trade`);
    expect(result.evidence.map((e) => e.label)).toEqual(["Bester Trade", "Schwächster Trade"]);
    const discipline = review.findings[2]!;
    expect(discipline.evidence.flatMap((e) => e.ids)).toContain("w7_rev");
    expect(discipline.tone).toBe("loss");
  });

  it("names the uncertainty: sample level, interval that includes zero", () => {
    const thin = build(weekTrades(7, { n: 3 })).review;
    expect(thin.level).toBe("zu wenig");
    expect(thin.findings[3]!.lines[0]).toContain("Zufall");
    const mid = build(weekTrades(7, { n: 7 })).review;
    expect(mid.level).toBe("dünn");
    expect(mid.netCi).not.toBeNull();
    expect(mid.findings[3]!.lines.join(" ")).toContain("80 %-Intervall");
    const big = build([...weekTrades(7, { n: 5 }), ...weekTrades(8, { n: 5 })]).review;
    expect(big.level).toBe("tragfähig");
    expect(big.findings[3]!.headline).toBe("Tendenz, kein Beweis");
  });

  it("is empty for a week without trades and lists setups with their trades", () => {
    expect(build(weekTrades(0), WEEK_C).review).toMatchObject({ level: "leer", findings: [] });
    const { review } = build([...weekTrades(7, { n: 6 }), ct(at(9, 800), { id: "fade", p: -120, setups: ["s_bad"] })]);
    const setups = review.findings[1]!;
    expect(setups.evidence.find((e) => e.label === "Fade")?.ids).toEqual(["fade"]);
  });
});
