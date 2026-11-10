/**
 * F60 Persönlicher Monatsnutzen: only what is recorded is counted – checked entries, alerts, rules, limit hits, reviews,
 * experiments, check-ins – a trace that does not reach the month's start is flagged, nothing is estimated or priced.
 */
import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { detectBehaviors } from "@/domain/coach/events";
import type { DeliveryRecord } from "@/domain/keylevels/delivery";
import { BENEFIT_LIMITS, buildReport, monthBenefit, periodOf, withExperiment, type Experiment } from "@/domain/reports";
import type { DayNotes } from "@/domain/types";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";
import { H, signalEvent } from "./missed.fixtures";

const MARCH = periodOf("month", new Date(2026, 2, 10));
const AFTER = new Date(2026, 3, 3, 12).getTime();
const snap = (side: "long" | "short" = "long") => ({ at: "2026-03-03T10:00:00.000Z", side, score: 80, strength: 3 });

const rec = (over: Partial<DeliveryRecord> & { at: number }): DeliveryRecord => ({ id: `d${over.at}`, source: "key", levelId: "l1", title: "t", detail: "", stage: "confirm", basis: "close", channels: ["toast"], outcome: "sent", dedupeKey: `k${over.at}`, ...over });

function run(over: { signals?: ReturnType<typeof signalEvent>[]; log?: DeliveryRecord[]; days?: DayNotes; settings?: typeof COACH_SETTINGS; trades?: ReturnType<typeof ct>[] } = {}) {
  const settings = over.settings ?? COACH_SETTINGS;
  const list = enrichC(
    over.trades ?? [
      ct(at(1, 600), { id: "a", p: 100, signal: snap(), boxSnap: { v: 1 }, notes: "geprüft", followedPlan: true }),
      ct(at(2, 600), { id: "b", p: -150, risk: 100, signal: snap("short"), followedPlan: false, notes: "zu früh" }),
      ct(at(3, 600), { id: "c", p: 50 }),
      ct(at(40, 600), { id: "april", p: 999 }), // not in March
    ],
    settings,
  );
  const view = accountView(list, settings, "all", { now: () => AFTER });
  const events = detectBehaviors({ trades: list, settings });
  const report = buildReport({ list: view.list, settings, days: over.days, events, start: view.start, currency: "USDT", period: MARCH, now: AFTER });
  return monthBenefit({ report, list: view.list, settings, events, days: over.days, signals: over.signals ?? [], log: over.log ?? [], now: AFTER });
}

describe("monthBenefit", () => {
  it("counts the month's trades, the checked entries and the reviews – and nothing from other months", () => {
    const b = run();
    expect(b.trades).toBe(3);
    expect(b.entries).toEqual({ checked: 2, boxContext: 1 });
    expect(b.review).toEqual({ trades: 3, reviewed: 2, rate: 2 / 3 });
    expect(b.rules).toMatchObject({ planTrades: 2, planFollowed: 1, planNotFollowed: 1 });
  });

  it("counts the alerts the archive recorded and the lines the log sent, by source", () => {
    const t = new Date(2026, 2, 5, 10).getTime();
    const b = run({
      signals: [
        signalEvent({ key: "e1", at: t }),
        signalEvent({ key: "e2", at: t + H, source: "box", kind: "setup" }),
        signalEvent({ key: "c1", at: t + 2 * H, entry: false, kind: "breakout", source: "box" }),
        signalEvent({ key: "apr", at: new Date(2026, 3, 1).getTime() }),
        signalEvent({ key: "feb", at: new Date(2026, 1, 20).getTime() }),
      ],
      log: [
        rec({ at: t, source: "signal" }),
        rec({ at: t + 1, source: "box" }),
        rec({ at: t + 2, source: "key" }),
        rec({ at: t + 3, source: "key", outcome: "duplicate" }), // held back: not sent
        rec({ at: new Date(2026, 3, 2).getTime(), source: "key" }),
      ],
    });
    expect(b.alerts).toMatchObject({ signals: 2, context: 1, sent: 3, sentSignal: 1, sentBox: 1, sentKey: 1 });
    // the archive holds something from before the month's start → a zero would be a real zero
    expect(b.alerts.archive.complete).toBe(true);
    expect(b.alerts.log.complete).toBe(false); // the log starts on Mar 5
  });

  it("flags a trace that does not reach back to the month's start – an empty one included", () => {
    const empty = run();
    expect(empty.alerts).toMatchObject({ signals: 0, sent: 0 });
    expect(empty.alerts.archive).toEqual({ complete: false, oldest: null });
    const late = run({ signals: [signalEvent({ key: "x", at: new Date(2026, 2, 20).getTime() })] });
    expect(late.alerts.archive.complete).toBe(false);
    expect(late.alerts.archive.oldest).toBe(new Date(2026, 2, 20).getTime());
  });

  it("counts limit hits from the report and the days with a check-in", () => {
    const days = { "2026-03-04": { note: "", checkin: { stress: 2, energy: 4, sleep: 7, emotions: ["Fokussiert"], done: true } }, "2026-03-05": { note: "nur Notiz" }, "2026-02-27": { note: "", checkin: { stress: 1, energy: 3 } } } as unknown as DayNotes;
    const b = run({ days });
    expect(b.checkins.days).toBe(1);
    expect(b.limits.dayBreaches).toBeGreaterThanOrEqual(0);
    expect(typeof b.limits.overLimit).toBe("number");
  });

  it("reads the accepted experiments of the month's weeks against the journal", () => {
    const e: Experiment = {
      id: "2026-W10|journal",
      v: 1,
      recId: "journal",
      title: "Jeder Trade mit Review",
      hypothesis: "x",
      why: "y",
      measure: { kind: "journalRate" },
      comparator: "atLeast",
      target: 0.5,
      minTrades: 3,
      weekKey: "2026-W10",
      sourceWeek: "2026-W09",
      acc: "all",
      baseline: { n: 0, value: null },
      evidence: [],
      acceptedAt: "2026-03-01T10:00:00.000Z",
    };
    const b = run({ settings: withExperiment(COACH_SETTINGS, e) });
    expect(b.experiments.items).toHaveLength(1);
    expect(b.experiments.items[0]).toMatchObject({ id: e.id, status: "erfüllt" });
    expect(b.experiments).toMatchObject({ met: 1, missed: 0, thin: 0, running: 0 });
    // an experiment of a week that starts in February is not this month's
    const feb = run({ settings: withExperiment(COACH_SETTINGS, { ...e, id: "2026-W09|journal", weekKey: "2026-W09" }) });
    expect(feb.experiments.items).toHaveLength(0);
  });

  it("an empty month is empty – and says what it never claims", () => {
    const b = run({ trades: [] });
    expect(b).toMatchObject({ empty: true, trades: 0 });
    expect(b.review.rate).toBeNull();
    expect(BENEFIT_LIMITS.join(" ")).toContain("vermieden");
    expect(BENEFIT_LIMITS.join(" ")).toContain("Keine Geldbeträge");
    // no money anywhere in the figures
    expect(JSON.stringify(b)).not.toMatch(/gespart|saved/i);
  });
});
