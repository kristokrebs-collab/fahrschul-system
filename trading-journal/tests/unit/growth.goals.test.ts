/**
 * P08 goals: the Wave-0 contract `addGoalFromDraft` (sanitised, de-duplicated, serialised so a plan handing over three
 * goals at once loses none), the draft rules (a trade count is only ever an upper limit, rates 0–1), `settings.growth`
 * writers that keep unknown keys, and the goal progress per period (streak since creation, reached, limits, habit and
 * self-check goals).
 */
import { afterEach, describe, expect, it } from "vitest";
import { activeGoalsOf, addGoalFromDraft, GOALS_MAX, goalOf, goalProgress, growthOf, HOLD_DEFAULT, prepare, rankGoals, sanitizeGoalDraft, sameGoal, setGoalStore, weekSummary, withGoalAppended, withGrowthItem, withGrowthPatch, type Goal, type GoalDraft } from "@/domain/growth";
import type { DayNote, DayNotes, Settings } from "@/domain/types";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";

const draft = (p: Partial<GoalDraft> = {}): GoalDraft => ({ title: "Jeden Trade reviewen", kind: "process", metric: "journalRate", target: 0.9, comparator: "atLeast", period: "week", source: { kind: "coach", ref: "journal" }, ...p });

function fakeStore(initial: Settings) {
  let settings = initial;
  let writes = 0;
  setGoalStore({
    getSettings: () => settings,
    saveSettings: async (s) => {
      // an async backend: the write lands a tick later
      await new Promise((r) => setTimeout(r, 1));
      writes++;
      settings = s;
    },
  });
  return { get: () => settings, writes: () => writes };
}

afterEach(() => setGoalStore(null));

describe("Ziel-Entwürfe", () => {
  it("Trade-Anzahl nur als Obergrenze, Quoten 0–1, Ergebnis-Metriken als outcome", () => {
    expect(sanitizeGoalDraft(draft({ metric: "tradesPerDay", comparator: "atLeast", target: 10 }))).toMatchObject({ comparator: "atMost", target: 10 });
    expect(sanitizeGoalDraft(draft({ target: 1.7 }))!.target).toBe(1);
    expect(sanitizeGoalDraft(draft({ target: -3 }))!.target).toBe(0);
    expect(sanitizeGoalDraft(draft({ metric: "winRate", kind: "process" }))!.kind).toBe("outcome");
    expect(sanitizeGoalDraft(draft({ metric: "behavior" }))).toBeNull();
    expect(sanitizeGoalDraft(draft({ metric: "behavior", scope: { behavior: "revenge" } }))!.comparator).toBe("atMost");
    expect(sanitizeGoalDraft(draft({ title: "  " }))).toBeNull();
    expect(sanitizeGoalDraft(draft({ period: "decade" as never }))).toBeNull();
    expect(sanitizeGoalDraft(draft({ target: Number.NaN }))).toBeNull();
    expect(sanitizeGoalDraft(draft({ source: { kind: "hacker" as never } }))!.source).toEqual({ kind: "user" });
    expect(sanitizeGoalDraft(draft({ due: "morgen" }))!.due).toBeUndefined();
  });

  it("goalOf behält fremde Schlüssel, säubert Status, hold und log", () => {
    const g = goalOf({ ...draft(), id: "g1", createdAt: "2026-01-01T00:00:00.000Z", status: "weird", extra: 1, hold: 99, log: { "2026-W10": true, x: "nein" } })!;
    expect(g.status).toBe("active");
    expect((g as unknown as { extra: number }).extra).toBe(1);
    expect(g.hold).toBe(52);
    expect(g.log).toEqual({ "2026-W10": true });
    expect(goalOf({ ...draft() })).toBeNull();
  });

  it("sameGoal: gleicher Titel oder gleiche Messung", () => {
    expect(sameGoal(draft(), draft({ title: "jeden trade reviewen " }))).toBe(true);
    expect(sameGoal(draft(), draft({ title: "Anders" }))).toBe(true);
    expect(sameGoal(draft(), draft({ title: "Anders", period: "month" }))).toBe(false);
  });
});

describe("addGoalFromDraft (Wave-0-Vertrag)", () => {
  it("speichert in settings.growth.goals und gibt das Ziel zurück", async () => {
    const s = fakeStore({ ...COACH_SETTINGS, growth: { other: true } } as Settings);
    const g = await addGoalFromDraft(draft());
    expect(g).toMatchObject({ title: "Jeden Trade reviewen", status: "active" });
    expect(g!.id).toMatch(/^gl_/);
    expect((s.get() as Settings & { growth: { other: boolean } }).growth.other).toBe(true);
    expect(activeGoalsOf(s.get())).toHaveLength(1);
  });

  it("drei parallele Aufrufe verlieren kein Ziel; ein Duplikat wird nicht doppelt angelegt", async () => {
    const s = fakeStore(COACH_SETTINGS);
    const res = await Promise.all([addGoalFromDraft(draft({ title: "A", metric: "ruleBreaks", target: 0, comparator: "atMost" })), addGoalFromDraft(draft({ title: "B", metric: "planAdherence" })), addGoalFromDraft(draft({ title: "C", metric: "checklistRate" }))]);
    expect(res.every(Boolean)).toBe(true);
    expect(activeGoalsOf(s.get()).map((g) => g.title)).toEqual(["A", "B", "C"]);
    const again = await addGoalFromDraft(draft({ title: "B", metric: "planAdherence" }));
    expect(again!.id).toBe(res[1]!.id);
    expect(s.writes()).toBe(3);
  });

  it("ungültig oder Speichern scheitert → null", async () => {
    fakeStore(COACH_SETTINGS);
    expect(await addGoalFromDraft(draft({ metric: "nope" as never }))).toBeNull();
    setGoalStore({ getSettings: () => COACH_SETTINGS, saveSettings: () => Promise.reject(new Error("offline")) });
    expect(await addGoalFromDraft(draft())).toBeNull();
  });
});

describe("settings.growth schreiben", () => {
  it("withGrowthItem / withGrowthPatch halten fremde Schlüssel", () => {
    const base = { ...COACH_SETTINGS, growth: { goals: [{ ...draft(), id: "g1", createdAt: "x", status: "active", foreign: 7 }], future: 1 } } as Settings;
    const patched = withGrowthPatch(base, "goals", "g1", { status: "done", doneAt: "2026-03-01" });
    const g = (patched as unknown as { growth: { goals: Record<string, unknown>[]; future: number } }).growth;
    expect(g.goals[0]).toMatchObject({ status: "done", foreign: 7 });
    expect(g.future).toBe(1);
    expect(withGrowthPatch(base, "goals", "nope", {})).toBe(base);
    const withHabit = withGrowthItem(base, "habits", { id: "h1", title: "Bewegung", createdAt: "x" });
    expect(growthOf(withHabit).habits.map((h) => h.title)).toEqual(["Bewegung"]);
    expect(growthOf({ growth: "kaputt" })).toEqual({ goals: [], challenges: [], habits: [] });
    expect(activeGoalsOf(withGoalAppended(COACH_SETTINGS, { ...draft(), id: "x", createdAt: "y", status: "active" }))).toHaveLength(1);
  });

  it("über GOALS_MAX weichen nur entfernte Ziele – aktive und erreichte bleiben", () => {
    const status = (i: number) => (i === 0 ? "active" : i === 1 ? "done" : "dropped");
    const full = { ...COACH_SETTINGS, growth: { goals: Array.from({ length: GOALS_MAX }, (_, i) => ({ ...draft(), title: `G${i}`, id: `g${i}`, createdAt: "x", status: status(i) })) } } as Settings;
    const next = growthOf(withGoalAppended(full, { ...draft(), title: "Neu", id: "new", createdAt: "y", status: "active" })).goals.map((g) => g.id);
    expect(next).toHaveLength(GOALS_MAX);
    expect(next.slice(0, 3)).toEqual(["g0", "g1", "g3"]);
    expect(next.at(-1)).toBe("new");
    const allActive = { ...COACH_SETTINGS, growth: { goals: Array.from({ length: GOALS_MAX }, (_, i) => ({ ...draft(), title: `A${i}`, id: `a${i}`, createdAt: "x", status: "active" })) } } as Settings;
    expect(activeGoalsOf(withGoalAppended(allActive, { ...draft(), title: "Neu", id: "new", createdAt: "y", status: "active" }))).toHaveLength(GOALS_MAX + 1);
  });
});

describe("Zielfortschritt", () => {
  // Monday 2026-03-02 + days; NOW = Wednesday of the 6th week
  const NOW = new Date(2026, 2, 2 + 37, 12, 0).getTime();
  const created = new Date(2026, 2, 2, 8, 0).toISOString();
  const goal = (p: Partial<Goal> = {}): Goal => ({ ...draft(), id: "g", createdAt: created, status: "active", ...p });

  // weeks 0–4: every trade reviewed (notes); this week: one of two reviewed
  const trades = [
    ...[0, 7, 14, 21, 28].map((d) => ct(at(d), { id: `w${d}`, p: 100, notes: "Review" })),
    ct(at(35), { id: "now1", p: 100, notes: "ok" }),
    ct(at(36), { id: "now2", p: -100 }),
  ];
  const p = prepare({ list: enrichC(trades), events: [], days: {}, settings: COACH_SETTINGS, now: NOW });

  it("Quote je Woche, Serie seit Anlage, erreicht nach 4 Wochen", () => {
    const g = goalProgress(goal(), p);
    expect(g.period.kind).toBe("week");
    expect(g.actual).toBe(0.5);
    expect(g.state).toBe("atRisk");
    expect(g.ratio).toBeCloseTo(0.5 / 0.9);
    expect(g.streak).toBe(5);
    expect(g.hold).toBe(HOLD_DEFAULT.week);
    expect(g.achieved).toBe(true);
    expect(g.milestones.every((m) => m.reached)).toBe(true);
    expect(g.valueText).toBe("50 %");
    expect(g.targetText).toBe("≥ 90 %");
    expect(g.celebrate).toBe(true);
  });

  it("vor der Anlage zählt nicht", () => {
    const later = goalProgress(goal({ createdAt: new Date(2026, 2, 2 + 22, 8, 0).toISOString() }), p);
    expect(later.streak).toBe(2);
    expect(later.achieved).toBe(false);
    expect(later.milestones.map((m) => m.reached)).toEqual([true, true, false, false]);
  });

  it("Obergrenze: der Ring füllt sich mit der Woche, solange sie hält", () => {
    const lim = goalProgress(goal({ title: "Max 1 Trade am Tag", metric: "tradesPerDay", target: 1, comparator: "atMost" }), p);
    expect(lim.state).toBe("onTrack");
    expect(lim.ratio).toBeCloseTo(lim.elapsed);
    const broken = goalProgress(goal({ title: "Keine Trades", metric: "tradesPerDay", target: 0, comparator: "atMost" }), p);
    expect(broken.state).toBe("missed");
    expect(broken.ratio).toBe(0);
  });

  it("Gewohnheits-Ziel und Selbst-Check", () => {
    const days: DayNotes = {};
    for (let d = 28; d <= 37; d++) days[at(d).slice(0, 10)] = { note: "", updatedAt: "", mood: 3 } as DayNote;
    const ph = prepare({ list: [], events: [], days, settings: COACH_SETTINGS, now: NOW });
    const habit = goalProgress(goal({ title: "Check-in", metric: "habit", scope: { habit: "auto:checkin" }, target: 0.7 }), ph);
    expect(habit.actual).toBe(1);
    expect(habit.state).toBe("met");
    const custom = goalProgress(goal({ title: "Fade auslassen", metric: "custom", target: 0, comparator: "atMost", log: { [habit.history[habit.history.length - 1]!.key]: true } }), ph);
    expect(custom.measurable).toBe(false);
    expect(custom.valueText).toBe("offen");
    expect(custom.streak).toBe(1);
    expect(custom.history[custom.history.length - 1]!.met).toBe(true);
  });

  it("offene Trades zählen nicht gegen die Review-Quote; höchstens vier Meilensteine", () => {
    const open = prepare({ list: enrichC([...trades, ct(at(37, 700), { id: "open", status: "open", exit: null, pnlManual: null })]), events: [], days: {}, settings: COACH_SETTINGS, now: NOW });
    expect(goalProgress(goal(), open).actual).toBe(0.5);
    const long = goalProgress(goal({ hold: 12 }), p);
    expect(long.milestones.map((m) => m.n)).toEqual([3, 6, 9, 12]);
  });

  it("Rangfolge und Wochenübersicht", () => {
    const list = [goalProgress(goal({ title: "Outcome", metric: "winRate", kind: "outcome", target: 0.6 }), p), goalProgress(goal(), p), goalProgress(goal({ title: "L", metric: "tradesPerDay", target: 1, comparator: "atMost" }), p)];
    expect(rankGoals(list)[0]!.goal.title).toBe("Jeden Trade reviewen");
    expect(rankGoals(list).at(-1)!.goal.title).toBe("Outcome");
    expect(list[0]!.celebrate).toBe(false);
    const w = weekSummary(list, NOW);
    expect(w.total).toBe(3);
    expect(w.daysLeft).toBe(5);
  });
});
