/**
 * Paket P – the optional weekly-review reminder (OFF, in-app, once a week, quiet hours), the closed weeks in `settings.coach.reviews`
 * and the real progress of the setup wizard.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { LESSON_MAX, REVIEWS_MAX, weekClosed, weekClosesOf, withWeekClosed } from "@/domain/coach";
import { periodOf } from "@/domain/reports";
import type { Settings } from "@/domain/types";
import { WIZARD_COUNT, wizardProgress, wizardStatusText, type StoredWizard } from "@/onboarding/wizard/wizardStore";
import { inQuietHours, parseReminder, REMINDER_DEFAULT, REMINDER_KEY, reminderDecision, reminderTarget, useReminderPref, type ReminderPref } from "@/views/berichte/reviewReminder";

// Sun 8 Nov 2026 19:00 local (KW 45: Mon 2 – Sun 8 Nov)
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const on: ReminderPref = { ...REMINDER_DEFAULT, on: true };
const run = (pref: ReminderPref, now: number, o: { trades?: number; closed?: string[] } = {}) =>
  reminderDecision({ pref, now, tradesInWeek: () => o.trades ?? 4, closed: (k) => (o.closed ?? []).includes(k) });

describe("reminder decision", () => {
  it("is off until switched on – and a stored garbage value reads as off", () => {
    expect(run(REMINDER_DEFAULT, at(8, 19)).verdict).toBe("off");
    expect(parseReminder({ v: 1, on: "yes" }).on).toBe(false);
    expect(parseReminder({ v: 1, on: true, day: 3, hour: 99, quietFrom: -1 })).toMatchObject({ on: true, day: 0, hour: 18, quietFrom: 22 });
  });

  it("shows at or after the chosen weekday and hour, never before", () => {
    expect(run(on, at(8, 17, 59)).verdict).toBe("early");
    expect(run(on, at(8, 18, 0)).verdict).toBe("show");
    expect(run(on, at(8, 21, 30)).verdict).toBe("show");
    expect(run(on, at(7, 20)).verdict).toBe("early"); // Saturday, the reminder is for Sunday
  });

  it("names the right week: the running one, and for Monday the one that just ended", () => {
    expect(run(on, at(8, 19)).period.key).toBe("2026-W45");
    const mon = reminderTarget({ day: 1, hour: 9 }, at(9, 10));
    expect(mon.period.key).toBe("2026-W45");
    expect(new Date(mon.due).getDay()).toBe(1);
    expect(run({ ...on, day: 1, hour: 9 }, at(9, 10)).verdict).toBe("show");
    expect(run({ ...on, day: 1, hour: 9 }, at(9, 8)).verdict).toBe("early");
  });

  it("stays quiet in the quiet hours, also over midnight", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(21, 22, 8)).toBe(false);
    expect(inQuietHours(12, 13, 13)).toBe(false); // equal = no quiet hours
    expect(inQuietHours(10, 9, 11)).toBe(true);
    expect(run(on, at(8, 22, 30)).verdict).toBe("quiet");
    expect(run({ ...on, quietFrom: 20, quietTo: 8 }, at(8, 20, 5)).verdict).toBe("quiet");
  });

  it("at most once a week, never for a closed review or an empty week", () => {
    expect(run({ ...on, lastKey: "2026-W45" }, at(8, 19)).verdict).toBe("already");
    expect(run({ ...on, lastKey: "2026-W44" }, at(8, 19)).verdict).toBe("show"); // last week's reminder does not count
    expect(run(on, at(8, 19), { closed: ["2026-W45"] }).verdict).toBe("closed");
    expect(run(on, at(8, 19), { trades: 0 }).verdict).toBe("empty");
  });

  it("the text is a fact, no pressure", async () => {
    const { REMINDER_STRINGS } = await import("@/views/berichte/reviewReminder");
    const all = `${REMINDER_STRINGS.toast("KW 45")} ${REMINDER_STRINGS.toastDetail} ${REMINDER_STRINGS.lead} ${REMINDER_STRINGS.note}`;
    expect(REMINDER_STRINGS.toast("KW 45")).toBe("Dein Rückblick für KW 45 ist bereit");
    expect(all).not.toMatch(/nur noch|letzte|verpass|Serie|Streak|Kurs.*steig|Gewinn|jetzt sofort/i);
  });
});

describe("reminder preference store", () => {
  beforeEach(() => {
    localStorage.clear();
    useReminderPref.setState({ ...REMINDER_DEFAULT });
  });
  it("nothing is stored until a choice is made, then the choice is kept per device and sanitised", () => {
    expect(localStorage.getItem(REMINDER_KEY)).toBeNull();
    useReminderPref.getState().set({ on: true, day: 6, hour: 25 });
    expect(JSON.parse(localStorage.getItem(REMINDER_KEY) ?? "null")).toMatchObject({ v: 1, on: true, day: 6, hour: 18 });
    useReminderPref.getState().set({ lastKey: "2026-W45" });
    expect(useReminderPref.getState().lastKey).toBe("2026-W45");
  });
});

describe("closed weeks in settings.coach.reviews", () => {
  const base = { coach: { ai: { notes: true }, reports: { seen: ["2026-W44"] } }, other: 1 } as unknown as Settings;
  it("closing keeps everything else, stores the lesson clipped, and re-opening keeps the key (never deletes)", () => {
    const closed = withWeekClosed(base, "2026-W45", { closed: true, lesson: `  ${"x".repeat(400)}  ` }, at(9, 8));
    expect(weekClosed(closed, "2026-W45")).toBe(true);
    expect(weekClosesOf(closed)["2026-W45"]!.lesson).toHaveLength(LESSON_MAX);
    expect((closed as unknown as { coach: { ai: unknown; reports: unknown } }).coach).toMatchObject({ ai: { notes: true }, reports: { seen: ["2026-W44"] } });
    expect((closed as unknown as { other: number }).other).toBe(1);
    const reopened = withWeekClosed(closed, "2026-W45", { closed: false }, at(9, 9));
    expect(weekClosed(reopened, "2026-W45")).toBe(false);
    expect(weekClosesOf(reopened)["2026-W45"]).toMatchObject({ closed: false, lesson: "x".repeat(LESSON_MAX) });
  });
  it("only week keys count; the list is capped to the newest", () => {
    expect(withWeekClosed(base, "2026-11", { closed: true }, 0)).toBe(base);
    let s = base;
    for (let w = 1; w <= REVIEWS_MAX + 10; w++) s = withWeekClosed(s, `2025-W${String(w % 52 || 52).padStart(2, "0")}`, { closed: true }, 0);
    expect(Object.keys(weekClosesOf(s)).length).toBeLessThanOrEqual(REVIEWS_MAX);
    expect(weekClosesOf({ coach: { reviews: { "bad": { closed: true }, "2026-W01": { closed: true, lesson: 7 } } } } as unknown as Settings)).toEqual({ "2026-W01": { closed: true, at: "", lesson: "" } });
  });
  it("the week key of the reminder is the key of the report", () => {
    expect(periodOf("week", at(8, 12)).key).toBe("2026-W45");
  });
});

describe("wizard progress is real", () => {
  const s = (status: StoredWizard["status"], step = 0): StoredWizard => ({ v: 1, status, step, data: null, at: "" });
  it("counts the steps behind the person – a finished wizard is all four, a declined or unstarted one none", () => {
    expect(wizardProgress(null)).toEqual({ done: 0, total: 4 });
    expect(wizardProgress(s("pending"))).toEqual({ done: 0, total: 4 });
    expect(wizardProgress(s("skipped", 2))).toEqual({ done: 0, total: 4 });
    expect(wizardProgress(s("active", 0))).toEqual({ done: 0, total: 4 });
    expect(wizardProgress(s("active", 2))).toEqual({ done: 2, total: 4 });
    expect(wizardProgress(s("active", 3))).toEqual({ done: 3, total: 4 });
    expect(wizardProgress(s("done"))).toEqual({ done: WIZARD_COUNT, total: 4 });
  });
  it("says it honestly, without pressure", () => {
    expect(wizardStatusText(s("active", 3))).toBe("Begonnen – 3 von 4 Schritten durchgegangen, als Nächstes: Start.");
    expect(wizardStatusText(s("done"))).toBe("Alle 4 Schritte erledigt.");
    for (const x of [s("active", 1), s("done"), s("skipped"), s("pending"), null]) expect(wizardStatusText(x)).not.toMatch(/nur noch|schnell|verpass|\d+ ?%/i);
  });
});
