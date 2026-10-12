/**
 * P08 growth tracking: streaks (journal, check-in with weekend pauses, green days in the limits – not in profit –,
 * discipline reused), habits (manual + automatic, grid, streak, best, rate), challenges (clean / count, never needing
 * a trade), personal bests + milestones (process only), skill levels and the weekly progress series.
 */
import { describe, expect, it } from "vitest";
import type { BehaviorEvent } from "@/domain/coach/events";
import { addDays, challengeProgress, CHALLENGES, checkinStreak, greenDayOk, habitBest, habitDone, habitGrid, habitRate, habitStreak, journalDayOk, levelOf, milestones, nextMilestones, personalBests, prepare, prepareAt, progressSeries, seriesTrend, skillProfile, streakBoard, suggestChallenges, templateOf, tradeRun, type Challenge, type GrowthPrefs, type Habit } from "@/domain/growth";
import type { DayNote, DayNotes, Trade } from "@/domain/types";
import { localDateKey } from "@/lib/dates";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";

const key = (d: number) => at(d).slice(0, 10);
const ms = (d: number, min = 600) => new Date(at(d, min)).getTime();
const NOW = ms(18, 1080); // Friday 2026-03-20 18:00 (day 0 = Monday 2026-03-02)
const ctx = (trades: Trade[], days: DayNotes = {}, events: BehaviorEvent[] = [], now = NOW) => prepare({ list: enrichC(trades), events, days, settings: COACH_SETTINGS, now });
const ev = (k: BehaviorEvent["key"], d: number, id = "x"): BehaviorEvent => ({ key: k, tradeIds: [id], at: ms(d), severity: 2 });
const checked = (...ds: number[]): DayNotes => Object.fromEntries(ds.map((d) => [key(d), { note: "", updatedAt: "", mood: 3 } as DayNote]));

describe("Serien", () => {
  it("Journal: Handelstage mit Review oder Tagesnotiz; heute offen bricht nicht", () => {
    const trades = [ct(at(14), { id: "a", notes: "gut" }), ct(at(15), { id: "b" }), ct(at(16), { id: "c", notes: "x" }), ct(at(17), { id: "d", notes: "y" }), ct(at(18), { id: "e" })];
    const p = ctx(trades, { [key(15)]: { note: "Tagesnotiz", updatedAt: "" } });
    expect(journalDayOk(p, key(15))).toBe(true);
    expect(journalDayOk(p, key(18))).toBe(false);
    const j = streakBoard(p).find((s) => s.key === "journal")!;
    expect(j.current).toBe(4);
    expect(j.pending).toBe(true);
    expect(j.best).toBe(4);
  });

  it("Check-in: Wochenende ohne Check-in pausiert, ein Werktag ohne bricht", () => {
    // day 12 Sat, 13 Sun skipped; 9 (Wed) missing breaks
    const p = ctx([], checked(10, 11, 14, 15, 16, 17, 18));
    const c = checkinStreak(p);
    expect(c.current).toBe(7);
    expect(c.pending).toBe(false);
    expect(c.best).toBe(7);
    const open = checkinStreak(ctx([], checked(16, 17)));
    expect(open).toMatchObject({ current: 2, pending: true });
  });

  it("Grüne Tage = im Limit, nicht im Plus; ein Bruch heute zählt sofort", () => {
    // a red day within the limits is green; 6 scalp trades (limit 5) is not; a revenge event is not
    const trades: Trade[] = [ct(at(14), { id: "loss", p: -150 })];
    for (let i = 0; i < 6; i++) trades.push(ct(at(15, 600 + i * 30), { id: `o${i}`, p: 10 }));
    trades.push(ct(at(16), { id: "r", p: 50 }), ct(at(17), { id: "g1", p: 20 }), ct(at(18), { id: "g2", p: -30 }));
    const p = ctx(trades, {}, [ev("revenge", 16, "r")]);
    expect(greenDayOk(p, key(14))).toBe(true);
    expect(greenDayOk(p, key(15))).toBe(false);
    expect(greenDayOk(p, key(16))).toBe(false);
    expect(streakBoard(p).find((s) => s.key === "green")!.current).toBe(2);
    const breach = ctx([...trades, ct(at(18, 700), { id: "big", p: -500 })]);
    expect(streakBoard(breach).find((s) => s.key === "green")!.current).toBe(0);
  });

  it("Disziplin: die Serie der Auswertung", () => {
    const p = ctx([ct(at(17), { id: "s1", setups: ["s_good"], notes: "x" }), ct(at(18), { id: "s2", setups: ["s_good"], notes: "y" })]);
    const d = streakBoard(p).find((s) => s.key === "discipline")!;
    expect(d.current).toBeGreaterThanOrEqual(1);
    expect(d.best).toBeGreaterThanOrEqual(d.current);
  });

  it("tradeRun: aktuelle und beste Serie", () => {
    const list = enrichC([ct(at(1), { id: "1", notes: "a" }), ct(at(2), { id: "2" }), ct(at(3), { id: "3", notes: "b" }), ct(at(4), { id: "4", notes: "c" })]);
    expect(tradeRun(list, (t) => !!t.notes)).toEqual({ current: 2, best: 2 });
  });
});

describe("Gewohnheiten", () => {
  const manual: Habit = { id: "h_move", title: "Bewegung", createdAt: "x" };
  const auto: Habit = { id: "auto:plan", title: "Plan", auto: "plan", createdAt: "x" };
  const days: DayNotes = {
    [key(16)]: { note: "", updatedAt: "", plan: "Long über 100", checkin: { habits: { h_move: true }, emotions: [] } } as DayNote,
    [key(17)]: { note: "", updatedAt: "", checkin: { habits: { h_move: true }, emotions: [] } } as DayNote,
    [key(18)]: { note: "", updatedAt: "", plan: "Plan", checkin: { habits: { h_move: true }, emotions: [] } } as DayNote,
    [key(10)]: { note: "", updatedAt: "", checkin: { habits: { h_move: true }, emotions: [] } } as DayNote,
  };

  it("manuell aus dem Check-in, automatisch aus dem Tagesjournal", () => {
    expect(habitDone(manual, key(17), days)).toBe(true);
    expect(habitDone(auto, key(17), days)).toBe(false);
    expect(habitDone(auto, key(18), days)).toBe(true);
    expect(habitDone({ id: "auto:review", auto: "review" }, key(18), { [key(18)]: { note: "Notiz", updatedAt: "" } })).toBe(true);
  });

  it("Serie, Bestwert, Quote, Raster", () => {
    expect(habitStreak(manual, days, key(18))).toBe(3);
    expect(habitStreak(manual, days, key(19))).toBe(3);
    expect(habitBest(manual, days)).toBe(3);
    expect(habitRate(manual, days, key(16), key(18))).toBe(1);
    expect(habitRate(manual, days, key(19), key(18))).toBeNull();
    const g = habitGrid([manual, auto], days, key(18), 2);
    expect(g.columns).toHaveLength(14);
    expect(g.columns[0]).toBe(key(7));
    expect(g.rows[0]!.cells.find((c) => c.key === key(18))).toMatchObject({ done: true, today: true });
    expect(g.rows[0]!.cells.filter((c) => c.future).map((c) => c.key)).toEqual([key(19), key(20)]);
    expect(g.rows[1]!.doneToday).toBe(true);
    expect(addDays(key(18), 2)).toBe(key(20));
  });
});

describe("Challenges", () => {
  const ch = (template: string, start: number, status: Challenge["status"] = "active"): Challenge => ({ id: `c_${template}`, template, title: templateOf(template)?.title ?? template, start: key(start), createdAt: "x", status });

  it("sauber: ohne Trade gewonnen, sobald die Tage vorbei sind", () => {
    const p = ctx([]);
    const done = challengeProgress(ch("calm14", 0), p)!;
    expect(done.state).toBe("done");
    expect(done.have).toBe(14);
    const running = challengeProgress(ch("calm14", 10), p)!;
    expect(running.state).toBe("active");
    expect(running.day).toBe(9);
    expect(running.cells.filter((c) => c.state === "future")).toHaveLength(5);
    expect(running.cells.find((c) => c.key === key(18))!.state).toBe("pending");
  });

  it("sauber: ein Verstoß beendet sie (Ereignis oder fehlender Stop)", () => {
    const p = ctx([ct(at(12), { id: "ns", stop: null })], {}, [ev("tilt", 13, "t")]);
    const calm = challengeProgress(ch("calm14", 10), p)!;
    expect(calm.state).toBe("failed");
    expect(calm.violations).toHaveLength(1);
    expect(calm.cells.find((c) => c.key === key(13))!.state).toBe("fail");
    const stop = challengeProgress(ch("stop14", 10), p)!;
    expect(stop.violations[0]).toMatchObject({ text: "BTC/USDT ohne Stop", tradeId: "ns" });
  });

  it("Review-Woche: ein Tag Zeit für das Review", () => {
    const p = ctx([ct(at(17), { id: "fresh" }), ct(at(14), { id: "old" })]);
    const r = challengeProgress(ch("review7", 13), p)!;
    expect(r.violations.map((v) => v.tradeId)).toEqual(["old"]);
    const ok = challengeProgress(ch("review7", 15), p)!;
    expect(ok.state).toBe("active");
    expect(ok.cells.find((c) => c.key === key(17))!.state).toBe("pending");
  });

  it("Zählen: 5 Check-ins in 7 Tagen, scheitert wenn unerreichbar", () => {
    expect(challengeProgress(ch("checkin7", 12), ctx([], checked(12, 13, 14, 15, 16)))!.state).toBe("done");
    const lost = challengeProgress(ch("checkin7", 13), ctx([], checked(13)))!;
    expect(lost.have).toBe(1);
    expect(lost.state).toBe("failed");
    const open = challengeProgress(ch("checkin7", 16), ctx([], checked(16, 17)))!;
    expect(open.state).toBe("active");
    expect(open.ratio).toBeCloseTo(2 / 5);
    expect(challengeProgress(ch("nope", 1), ctx([]))).toBeNull();
    expect(challengeProgress(ch("calm14", 15, "dropped"), ctx([]))!.state).toBe("active");
  });

  it("Vorschlag: passend zum häufigsten Muster, keine laufende", () => {
    const s = suggestChallenges([{ key: "revenge", count: 4 }], [], 5);
    expect(s[0]!.key).toBe("calm14");
    expect(suggestChallenges([{ key: "revenge", count: 4 }], ["calm14"], 0)[0]!.key).toBe("checkin7");
    expect(CHALLENGES.every((c) => c.days >= 7)).toBe(true);
  });
});

describe("Bestleistungen, Meilensteine, Skills, Fortschritt", () => {
  const trades: Trade[] = [];
  for (let d = 0; d < 19; d++) if (d % 7 < 5) trades.push(ct(at(d), { id: `t${d}`, p: d % 3 ? 100 : -100, notes: d === 9 ? "" : "Review", setups: ["s_good"], followedPlan: true }));
  const days = checked(...Array.from({ length: 19 }, (_, i) => i));
  const prefs: GrowthPrefs = { goals: [], challenges: [{ id: "c", template: "calm14", title: "x", start: key(0), createdAt: "x", status: "done" }], habits: [] };
  const p = ctx(trades, days, [ev("ruleViolation", 4, "t4")]);

  it("nur Prozess-Rekorde, live wenn die laufende Serie der Rekord ist", () => {
    const b = personalBests(p);
    const keys = b.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["checkin", "journal", "ruleRun", "reviewRun"]));
    expect(keys.some((k) => /pnl|win|profit/i.test(k))).toBe(false);
    expect(b.find((x) => x.key === "checkin")!).toMatchObject({ value: 19, live: true, valueText: "19 Tage" });
    // 15 weekday trades, the 5th broke a rule: 10 clean ones after it
    expect(b.find((x) => x.key === "ruleRun")!).toMatchObject({ value: 10, live: true });
  });

  it("Meilensteine: erreicht, nächste je Leiter", () => {
    const m = milestones(p, prefs);
    expect(m.find((x) => x.key === "checkins:10")!.reached).toBe(true);
    expect(m.find((x) => x.key === "checkins:30")!.progress).toBeCloseTo(19 / 30);
    expect(m.find((x) => x.key === "challenges:1")!.reached).toBe(true);
    const n = nextMilestones(m);
    expect(n.next).toHaveLength(3);
    expect(new Set(n.next.map((x) => x.key.split(":")[0])).size).toBe(3);
    expect(n.reached).toBeGreaterThan(0);
  });

  it("Skills: sechs Achsen 0–100, Stufen, zu wenig Daten", () => {
    const s = skillProfile(p);
    expect(s.axes.map((a) => a.key)).toEqual(["discipline", "risk", "journal", "patience", "emotions", "planning"]);
    for (const a of s.axes) if (a.value != null) expect(a.value).toBeGreaterThanOrEqual(0);
    expect(s.axes.find((a) => a.key === "journal")!.value).toBe(Math.round((13 / 14) * 100));
    expect(s.value).not.toBeNull();
    expect(levelOf(85)).toBe(5);
    expect(levelOf(null)).toBe(0);
    const empty = skillProfile(ctx([]));
    expect(empty.value).toBeNull();
    expect(empty.axes.every((a) => a.level === 0)).toBe(true);
    // the journal as it was 10 days earlier
    expect(prepareAt({ list: enrichC(trades), events: [], days, settings: COACH_SETTINGS, now: NOW }, ms(8)).sorted.length).toBeLessThan(p.sorted.length);
  });

  it("Fortschritt je Woche: Lücken statt falscher Nullen", () => {
    const s = progressSeries(p, [{ id: "auto:checkin", title: "Check-in", auto: "checkin", createdAt: "x" }], 6);
    expect(s).toHaveLength(6);
    expect(s.at(-1)!.toKey).toBe(localDateKey(new Date(NOW)));
    expect(s[0]!.journal).toBeNull();
    expect(s.at(-1)!.checkins).toBe(5);
    expect(s.at(-1)!.habitRate).toBe(1);
    expect(s.find((x) => x.ruleBreaks === 1)).toBeTruthy();
    expect(seriesTrend(s, (x) => x.checkins)).not.toBeNull();
  });
});
