/**
 * P08 psych domain: mood / stress / sleep against results (buckets, rank correlation, honest minimum sample), the
 * trackers from the coach events + check-in words, the diary, the pre-trade readiness with the P05 limits and the
 * psychology report data.
 */
import { describe, expect, it } from "vitest";
import type { BehaviorEvent } from "@/domain/coach/events";
import { DEFAULT_PRE_TRADE, diaryDays, diarySummary, feelOf, MIN_FACTOR_N, MOOD_LABELS, preTradeChecklist, psychFactors, psychReport, psychTrackers, readiness, spearman, strongestFactors, topTracker, trackerLine, type ReadinessInput } from "@/domain/psych";
import type { DayNote, DayNotes } from "@/domain/types";
import { localDateKey } from "@/lib/dates";
import { at, ct, enrichC } from "./coach.fixtures";

const dayKey = (d: number) => at(d).slice(0, 10);
const NOW = new Date(2026, 2, 2 + 40, 18, 0).getTime();
const ev = (key: BehaviorEvent["key"], ms: number, id = "x", severity: 1 | 2 | 3 = 2): BehaviorEvent => ({ key, tradeIds: [id], at: ms, severity });

describe("Spearman", () => {
  it("monoton = 1, gegenläufig = −1, zu wenig = null", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("Stimmung und Stress gegen Ergebnis", () => {
  // 12 days: calm days (stress 1–2) win +2 R, tense days (stress 4–5) lose −1 R
  const trades = Array.from({ length: 12 }, (_, d) => ct(at(d), { id: `t${d}`, p: d % 2 ? -100 : 200 }));
  const days: DayNotes = {};
  for (let d = 0; d < 12; d++) days[dayKey(d)] = { note: "", updatedAt: "", mood: d % 2 ? 2 : 4, checkin: { stress: d % 2 ? 4 + (d % 4 === 1 ? 1 : 0) : 1 + (d % 4 === 0 ? 1 : 0), sleep: d % 2 ? 5 : 8, emotions: [], habits: {} } } as DayNote;
  const closed = enrichC(trades);

  it("Buckets, R als Einheit, negative Korrelation für Stress", () => {
    const f = psychFactors({ days, closed, currency: "USDT" });
    const stress = f.find((x) => x.key === "stress")!;
    expect(stress.unit).toBe("R");
    expect(stress.n).toBe(12);
    expect(stress.enough).toBe(true);
    expect(stress.rho!).toBeLessThan(-0.5);
    expect(stress.best!.avg).toBeCloseTo(2);
    expect(stress.worst!.avg).toBeCloseTo(-1);
    expect(stress.verdict).toContain("Je entspannter, desto besser");
    const mood = f.find((x) => x.key === "mood")!;
    expect(mood.rho!).toBeGreaterThan(0.5);
    expect(mood.buckets.map((b) => b.label)).toEqual([MOOD_LABELS[1], MOOD_LABELS[3]]);
    const sleep = f.find((x) => x.key === "sleep")!;
    expect(sleep.buckets.map((b) => b.key)).toEqual(["lt6", "ge8"]);
    expect(strongestFactors(f).length).toBeGreaterThan(0);
  });

  it("unter der Mindeststichprobe: ehrlich zu wenig Daten", () => {
    const few: DayNotes = { [dayKey(0)]: days[dayKey(0)]!, [dayKey(1)]: days[dayKey(1)]! };
    const f = psychFactors({ days: few, closed, currency: "USDT" });
    const stress = f.find((x) => x.key === "stress")!;
    expect(stress.enough).toBe(false);
    expect(stress.rho).toBeNull();
    expect(stress.verdict).toBe(`Zu wenig Daten: 2 von ${MIN_FACTOR_N} Tagen mit Wert.`);
  });

  it("Trade-Faktoren aus der Psyche des Trades", () => {
    const ts = enrichC(Array.from({ length: 10 }, (_, i) => ct(at(i), { id: `p${i}`, p: i < 5 ? 150 : -100, psych: { stress: i < 5 ? 2 : 5, confidence: i < 5 ? 4 : 2 } })));
    const f = psychFactors({ days: {}, closed: ts });
    expect(f.find((x) => x.key === "tradeStress")!.n).toBe(10);
    expect(f.find((x) => x.key === "confidence")!.rho!).toBeGreaterThan(0.5);
  });
});

describe("Tracker", () => {
  const closed = enrichC([ct(at(30), { id: "a", p: -100 }), ct(at(35), { id: "b", p: -150 }), ct(at(36), { id: "c", p: 200 }), ct(at(5), { id: "d", p: -100 })]);
  const t = (d: number) => new Date(at(d)).getTime();
  const events = [ev("revenge", t(30), "a"), ev("tilt", t(35), "b"), ev("fomo", t(36), "c"), ev("revenge", t(5), "d"), ev("earlyProfit", t(38), "c", 1)];
  const days: DayNotes = { [dayKey(37)]: { note: "", updatedAt: "", checkin: { emotions: ["FOMO"], habits: {} } } as DayNote };

  it("zählt Fenster, Trend, Wochen, selbst benannte Gefühle; häufigster zuerst", () => {
    const list = psychTrackers({ events, closed, days, now: NOW });
    const rev = list.find((x) => x.key === "revenge")!;
    expect(rev.count).toBe(2);
    expect(rev.previous).toBe(1);
    expect(rev.trend).toBe("up");
    expect(rev.tradeIds).toEqual(["b", "a"]);
    // 8 weeks reach back past the 30-day window: the day-5 revenge counts there
    expect(rev.weekly.reduce((a, b) => a + b, 0)).toBe(3);
    expect(rev.weekly).toHaveLength(8);
    expect(list[0]!.key).toBe("revenge");
    const fomo = list.find((x) => x.key === "fomo")!;
    expect(fomo.selfReported).toBe(1);
    expect(list.find((x) => x.key === "overconfidence")!.level).toBe("ruhig");
    expect(topTracker(list)!.key).toBe("revenge");
    expect(trackerLine(rev)).toBe("2× in 30 Tagen · mehr als davor");
    expect(trackerLine({ count: 0, previous: 0, trend: "flat" })).toBe("Ruhig in 30 Tagen");
  });

  it("ohne Ereignisse: kein Top-Tracker", () => {
    expect(topTracker(psychTrackers({ events: [], closed, now: NOW }))).toBeNull();
  });
});

describe("Tagebuch", () => {
  it("ein Eintrag je Tag mit Inhalt, älteste zuerst", () => {
    const list = enrichC([ct(at(1, 600), { id: "x1", p: 100, psych: { preNote: "ruhig rein", flags: ["impulsive"], stress: 2 } }), ct(at(3), { id: "x2", p: -50 })]);
    const days: DayNotes = {
      [dayKey(1)]: { note: "guter Tag", updatedAt: "", mood: 4, checkin: { stress: 2, energy: 4, emotions: ["Fokussiert"], habits: {} } } as DayNote,
      [dayKey(2)]: { note: "", updatedAt: "" },
    };
    const events = [ev("revenge", new Date(at(3)).getTime(), "x2")];
    const d = diaryDays({ days, list, events, fromKey: dayKey(0), toKey: dayKey(5) });
    expect(d.map((x) => x.key)).toEqual([dayKey(1), dayKey(3)]);
    expect(d[0]!.trades[0]!.preNote).toBe("ruhig rein");
    expect(d[0]!.feel!).toBeGreaterThan(0);
    expect(d[1]!.patterns).toEqual(["Revenge-Trade"]);
    expect(d[0]!.label).toMatch(/^[A-Z][a-z] \d\d\.\d\d\.$/);
    expect(diarySummary(d[0]!, MOOD_LABELS)).toBe("Gut · Stress 2 · Fokussiert");
    expect(feelOf(null, null)).toBeNull();
  });
});

describe("Bereitschaft vor dem Trade", () => {
  const base: ReadinessInput = {
    checkin: { stress: 2, energy: 4, sleep: 7.5, emotions: ["Fokussiert"], habits: {} },
    mood: 4,
    checklist: DEFAULT_PRE_TRADE,
    ticked: Object.fromEntries(DEFAULT_PRE_TRADE.map((p) => [p.id, true])),
    limits: { rows: [{ key: "day", state: "ok", label: "Tagesverlust", detail: "" }], cooldown: null, worst: "ok" },
    events: [],
    now: NOW,
  };

  it("alles klar → Bereit", () => {
    const r = readiness(base);
    expect(r.state).toBe("ready");
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.every((x) => x.tone === "ok")).toBe(true);
  });

  it("Checkliste offen oder kein Check-in → noch nicht bereit", () => {
    const r = readiness({ ...base, ticked: {} });
    expect(r.state).toBe("caution");
    expect(r.reasons[0]!.text).toBe("4 von 4 Punkten offen.");
    expect(readiness({ ...base, checkin: null, mood: null }).reasons.some((x) => x.key === "checkin")).toBe(true);
  });

  it("P05-Pause, harte Limits, Tilt heute oder Stress 5 → Pause", () => {
    const cd = { reason: "losses" as const, since: NOW - 60_000, endsAt: NOW + 20 * 60_000, losses: 2 };
    const r = readiness({ ...base, limits: { rows: [], cooldown: cd, worst: "warn" } });
    expect(r.state).toBe("pause");
    expect(r.pauseUntil).toBe(cd.endsAt);
    expect(r.reasons[0]!.text).toMatch(/^2 Verluste in Folge – Pause bis \d\d:\d\d Uhr\.$/);
    // overridden pause = a warning only
    expect(readiness({ ...base, limits: { rows: [], cooldown: cd, worst: "warn" }, overrideUntil: NOW + 3_600_000 }).state).toBe("caution");
    expect(readiness({ ...base, limits: { rows: [{ key: "trades", state: "breach", label: "Trades heute", detail: "" }], cooldown: null, worst: "breach" } }).state).toBe("pause");
    expect(readiness({ ...base, events: [ev("tilt", NOW - 3_600_000)] }).state).toBe("pause");
    expect(readiness({ ...base, checkin: { ...base.checkin!, stress: 5 } }).state).toBe("pause");
  });

  it("Checkliste aus den eigenen Grundregeln, sonst Standard", () => {
    expect(preTradeChecklist([{ id: "g1", text: " Nur A-Setups " }])).toEqual([{ id: "g1", text: "Nur A-Setups" }]);
    expect(preTradeChecklist([])).toEqual([...DEFAULT_PRE_TRADE]);
  });
});

describe("Psychologie-Report", () => {
  it("Abdeckung, Mittelwerte, Gefühle, Tracker, Satz", () => {
    const list = enrichC([ct(at(1), { id: "r1", p: 100 }), ct(at(2), { id: "r2", p: -100 })]);
    const days: DayNotes = {
      [dayKey(1)]: { note: "", updatedAt: "", mood: 4, checkin: { stress: 2, sleep: 8, emotions: ["Ruhig", "Fokussiert"], habits: {} } } as DayNote,
      [dayKey(3)]: { note: "", updatedAt: "", mood: 2, checkin: { stress: 4, sleep: 6, emotions: ["Ruhig"], habits: {} } } as DayNote,
    };
    const from = new Date(at(0, 0)).getTime();
    const to = new Date(at(7, 0)).getTime();
    const r = psychReport({ days, list, events: [ev("fomo", new Date(at(2)).getTime(), "r2")], from, to });
    expect(r.checkins).toBe(2);
    expect(r.tradingDays).toBe(2);
    expect(r.coveredTradingDays).toBe(1);
    expect(r.avg.mood).toBe(3);
    expect(r.avg.sleep).toBe(7);
    expect(r.emotions[0]).toEqual({ word: "Ruhig", n: 2 });
    expect(r.trackers).toEqual([{ key: "fomo", label: "FOMO", count: 1 }]);
    expect(r.sentence).toBe("2 Check-ins in 7 Tagen · 1 von 2 Handelstagen mit Check-in · häufigstes Muster: FOMO (1×).");
    expect(r.fromKey).toBe(localDateKey(new Date(from)));
  });
});
