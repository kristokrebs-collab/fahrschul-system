/**
 * F61 daily check-in rules (`src/domain/checkin`, the F61 keys of `src/domain/psych/checkin`): the day in the configured
 * time zone (midnight, 23 h / 25 h days), when the prompt asks (once per day, deduplicated through the synced day entry,
 * the next day again, never before sync / intro / over a dialog), the bookkeeping that keeps the evaluation honest
 * (`firstAt`, `editedAt`, `late`), the versioned config and the join with the day's trades (no look-ahead, sample size,
 * missing check-in never read as a good state).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKIN_CONFIG_VERSION,
  CUSTOM_MAX,
  DEFAULT_CHECKIN_FIELDS,
  MIN_CHECKIN_N,
  SNOOZE_MS,
  activeQuestions,
  checkinConfigOf,
  correlationMatrix,
  dayKeyIn,
  decidePrompt,
  effectiveTimeZone,
  isLateFill,
  isValidTimeZone,
  joinCheckins,
  minutesOfDayIn,
  nextWallTime,
  notableLines,
  parseClock,
  setQuestionOn,
  shiftDayKey,
  snoozeFor,
  withCheckinConfig,
  withQuestion,
  withoutQuestion,
  type PromptEnv,
} from "@/domain/checkin";
import { checkinInput, checkinOf, checkinRawOf, checkinStatusOf, dailyCheckinInput, EMPTY_CHECKIN, habitInput, hasCheckin, isEmptyCheckin, type CheckIn } from "@/domain/psych";
import { enrichTrades } from "@/domain/enrich";
import { isEmptyDayNote, normalizeDayNote } from "@/domain/normalize";
import { defaultSettings } from "@/domain/defaults";
import type { DayNote, DayNotes, Settings } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { merge3 } from "@/store/merge3";
import { mkTrade } from "./domain.fixtures";

const BERLIN = "Europe/Berlin";
const utc = (iso: string): number => Date.parse(iso);
const ci = (p: Partial<CheckIn> = {}): CheckIn => ({ ...EMPTY_CHECKIN, emotions: [], habits: {}, ...p });

describe("Tag in der eingestellten Zeitzone", () => {
  it("Mitternacht: eine Minute vorher noch gestern, danach der nächste Tag", () => {
    expect(dayKeyIn(utc("2026-10-12T21:59:00Z"), BERLIN)).toBe("2026-10-12"); // 23:59 CEST
    expect(dayKeyIn(utc("2026-10-12T22:00:00Z"), BERLIN)).toBe("2026-10-13"); // 00:00 CEST
    expect(dayKeyIn(utc("2026-10-12T22:00:00Z"), "UTC")).toBe("2026-10-12");
    expect(dayKeyIn(utc("2026-10-12T22:00:00Z"), "Asia/Tokyo")).toBe("2026-10-13"); // 07:00 JST
    expect(minutesOfDayIn(utc("2026-10-12T22:30:00Z"), BERLIN)).toBe(30);
  });

  it("Sommerzeitwechsel: der 29.03.2026 (23 h) und der 25.10.2026 (25 h) sind je genau ein Tag, der nächste Tag beginnt pünktlich", () => {
    // spring forward: 02:00 CET → 03:00 CEST
    expect(dayKeyIn(utc("2026-03-28T22:59:00Z"), BERLIN)).toBe("2026-03-28"); // 23:59 CET
    expect(dayKeyIn(utc("2026-03-28T23:00:00Z"), BERLIN)).toBe("2026-03-29"); // 00:00 CET
    expect(dayKeyIn(utc("2026-03-29T00:59:00Z"), BERLIN)).toBe("2026-03-29"); // 01:59 CET
    expect(dayKeyIn(utc("2026-03-29T01:00:00Z"), BERLIN)).toBe("2026-03-29"); // 03:00 CEST
    expect(dayKeyIn(utc("2026-03-29T21:59:00Z"), BERLIN)).toBe("2026-03-29"); // 23:59 CEST
    expect(dayKeyIn(utc("2026-03-29T22:00:00Z"), BERLIN)).toBe("2026-03-30");
    // fall back: 03:00 CEST → 02:00 CET (the 02:xx hour exists twice)
    expect(dayKeyIn(utc("2026-10-24T21:59:00Z"), BERLIN)).toBe("2026-10-24");
    expect(dayKeyIn(utc("2026-10-24T22:00:00Z"), BERLIN)).toBe("2026-10-25");
    expect(dayKeyIn(utc("2026-10-25T00:30:00Z"), BERLIN)).toBe("2026-10-25"); // 02:30 CEST
    expect(dayKeyIn(utc("2026-10-25T01:30:00Z"), BERLIN)).toBe("2026-10-25"); // 02:30 CET (again)
    expect(dayKeyIn(utc("2026-10-25T22:59:00Z"), BERLIN)).toBe("2026-10-25"); // 23:59 CET
    expect(dayKeyIn(utc("2026-10-25T23:00:00Z"), BERLIN)).toBe("2026-10-26");
  });

  it("Zeitzonen prüfen, Uhrzeit lesen, Kalendertage verschieben", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(5)).toBe(false);
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("7:30")).toBeNull();
    expect(shiftDayKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDayKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("nextWallTime: die nächste Wanduhrzeit, auch über einen Zeitwechsel hinweg", () => {
    // 21:00 CET the evening before the spring-forward night: 07:00 the next morning is 05:00Z (CEST)
    expect(nextWallTime(utc("2026-03-28T20:00:00Z"), BERLIN, 7 * 60)).toBe(utc("2026-03-29T05:00:00Z"));
    // across the fall-back night: 07:00 CET = 06:00Z
    expect(nextWallTime(utc("2026-10-24T20:00:00Z"), BERLIN, 7 * 60)).toBe(utc("2026-10-25T06:00:00Z"));
    // already past today → tomorrow
    expect(nextWallTime(utc("2026-10-12T06:00:00Z"), BERLIN, 7 * 60)).toBe(utc("2026-10-13T05:00:00Z"));
    expect(nextWallTime(utc("2026-10-12T04:00:00Z"), BERLIN, 7 * 60)).toBe(utc("2026-10-12T05:00:00Z"));
  });

  it("nachgetragen: ein Tag vor dem heutigen Tag der Zone", () => {
    const now = utc("2026-10-12T22:30:00Z"); // 00:30 on the 13th in Berlin
    expect(isLateFill("2026-10-12", now, { timeZone: BERLIN }, "UTC")).toBe(true);
    expect(isLateFill("2026-10-13", now, { timeZone: BERLIN }, "UTC")).toBe(false);
    // the device is on UTC, the trader configured Berlin: the configured zone wins
    expect(effectiveTimeZone({ timeZone: BERLIN }, "UTC")).toBe(BERLIN);
    expect(effectiveTimeZone({ timeZone: null }, "UTC")).toBe("UTC");
  });
});

describe("Config in settings.checkin", () => {
  const base = defaultSettings();

  it("ein Journal ohne den Schlüssel: Standard (Dialog an, Konzentration an, der Rest aus), Gerätezone", () => {
    const c = checkinConfigOf(base);
    expect(c).toMatchObject({ prompt: true, timeZone: null, reminder: null, custom: [] });
    expect(c.fields).toEqual(DEFAULT_CHECKIN_FIELDS);
    expect(c.fields.focus).toBe(true);
    expect(c.fields.availableTime).toBe(false);
    expect(checkinConfigOf({ checkin: "kaputt" }).fields).toEqual(DEFAULT_CHECKIN_FIELDS);
    expect(checkinConfigOf({ checkin: { timeZone: "Nowhere/Land", reminder: "25:99" } })).toMatchObject({ timeZone: null, reminder: null });
  });

  it("withCheckinConfig schreibt nur das Gegebene, versioniert, und behält alles andere", () => {
    const s0 = { ...base, growth: { goals: [] }, checkin: { v: 1, extra: "keep", fields: { comment: true } } } as unknown as Settings;
    const s1 = withCheckinConfig(s0, { reminder: "07:30", fields: { dayRisk: true } });
    const raw = (s1 as unknown as { checkin: Record<string, unknown> }).checkin;
    expect(raw.v).toBe(CHECKIN_CONFIG_VERSION);
    expect(raw.extra).toBe("keep");
    expect(raw.fields).toEqual({ comment: true, dayRisk: true });
    expect(raw.reminder).toBe("07:30");
    expect((s1 as unknown as { growth: unknown }).growth).toEqual({ goals: [] });
    expect(checkinConfigOf(s1)).toMatchObject({ reminder: "07:30" });
    // the input is untouched
    expect((s0 as unknown as { checkin: Record<string, unknown> }).checkin.reminder).toBeUndefined();
  });

  it("eigene Fragen: Skala 3–10, höchstens fünf, ausblenden statt löschen", () => {
    let list = withQuestion([], { id: "q1", label: "  Habe ich meinen Plan gelesen?  ", max: 5, minLabel: "nein", maxLabel: "ja" });
    expect(list).toEqual([{ id: "q1", label: "Habe ich meinen Plan gelesen?", max: 5, minLabel: "nein", maxLabel: "ja", on: true }]);
    expect(withQuestion(list, { id: "q2", label: " " })).toEqual(list);
    expect(withQuestion(list, { id: "q1", label: "doppelt" })).toEqual(list);
    for (let i = 2; i <= CUSTOM_MAX + 2; i++) list = withQuestion(list, { id: `q${i}`, label: `Frage ${i}` });
    expect(list).toHaveLength(CUSTOM_MAX);
    const off = setQuestionOn(list, "q1", false);
    expect(activeQuestions({ custom: off })).toHaveLength(CUSTOM_MAX - 1);
    expect(withoutQuestion(off, "q1")).toHaveLength(CUSTOM_MAX - 1);
    expect(checkinConfigOf(withCheckinConfig(base, { custom: [{ id: "x", label: "Q", max: 99, on: true }] })).custom[0]?.max).toBe(5);
  });

  it("zwei Geräte ändern Verschiedenes: Felder pro Schlüssel, Fragen pro Id, nichts geht verloren", () => {
    const b = withCheckinConfig(base, { fields: { comment: false }, custom: [] });
    const mine = withCheckinConfig(b, { fields: { comment: true }, custom: withQuestion([], { id: "q1", label: "A" }) });
    const theirs = withCheckinConfig(b, { fields: { dayRisk: true }, custom: withQuestion([], { id: "q2", label: "B" }), reminder: "08:00" });
    const m = checkinConfigOf(merge3(b, mine, theirs) as Settings);
    expect(m.fields.comment).toBe(true);
    expect(m.fields.dayRisk).toBe(true);
    expect(m.reminder).toBe("08:00");
    expect(m.custom.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });
});

describe("Check-in im Tagesjournal (F61-Felder)", () => {
  const NOW = utc("2026-10-12T06:00:00Z");
  const today = "2026-10-12";

  it("alte Datensätze lesen sich unverändert, die neuen Schlüssel fehlen, wenn sie nicht gesetzt sind", () => {
    const old = { note: "", updatedAt: "", checkin: { stress: 2, energy: 4, sleep: 7.5, emotions: ["Ruhig"], habits: {} } } as DayNote;
    expect(checkinOf(old)).toEqual({ stress: 2, energy: 4, sleep: 7.5, emotions: ["Ruhig"], habits: {} });
    expect(Object.keys(checkinOf(old)!)).not.toContain("focus");
  });

  it("neue Felder werden bereinigt gelesen; ein kaputter Wert gilt als nicht gesetzt", () => {
    const n = {
      note: "",
      updatedAt: "",
      checkin: { focus: 4, sleepQuality: 9, availableMin: 90, session: " London ", dayRisk: 1.3, comment: "  gut  ", custom: { q1: 4, bad: "x", q2: 500 }, status: "done", firstAt: "kein Datum", late: "ja" },
    } as unknown as DayNote;
    expect(checkinOf(n)).toMatchObject({ focus: 4, availableMin: 90, session: "London", dayRisk: 1.25, comment: "gut", custom: { q1: 4 }, status: "done" });
    const c = checkinOf(n)!;
    expect(c.sleepQuality).toBeUndefined();
    expect(c.firstAt).toBeUndefined();
    expect(c.late).toBeUndefined();
  });

  it("normalizeDayNote behält den Check-in mit allen neuen Schlüsseln, der Tag zählt als nicht leer", () => {
    const raw = { note: "", updatedAt: "x", checkin: { focus: 3, comment: "x", status: "done" } };
    const n = normalizeDayNote(raw);
    expect((n as DayNote & { checkin?: unknown }).checkin).toEqual(raw.checkin);
    expect(isEmptyDayNote(n)).toBe(false);
  });

  it("Status: übersprungen lässt sich lesen, ist aber nie ein Check-in und nie ein guter Zustand", () => {
    const skipped = { note: "", updatedAt: "", checkin: { stress: null, emotions: [], habits: {}, status: "skipped" } } as unknown as DayNote;
    expect(checkinStatusOf(skipped)).toBe("skipped");
    expect(checkinOf(skipped)).toBeNull();
    expect(hasCheckin(skipped)).toBe(false);
    expect(checkinRawOf(skipped)?.status).toBe("skipped");
    expect(checkinStatusOf(undefined)).toBeNull();
    // a check-in from before the daily prompt (answers, no status) is an answered day
    expect(checkinStatusOf({ note: "", updatedAt: "", checkin: { stress: 2 } } as unknown as DayNote)).toBe("done");
    expect(checkinStatusOf({ note: "", updatedAt: "", mood: 4 })).toBe("done");
    expect(isEmptyCheckin({ ...EMPTY_CHECKIN, emotions: [], habits: {}, comment: "x" })).toBe(false);
  });

  it("dailyCheckinInput: firstAt bleibt, editedAt wandert nur mit den Antworten, Gewohnheiten zählen nicht", () => {
    const first = dailyCheckinInput(undefined, ci({ stress: 2, focus: 4 }), 4, { now: NOW, day: today, todayKey: today, status: "done" });
    const c1 = first.checkin as CheckIn;
    expect(c1).toMatchObject({ status: "done", stress: 2, focus: 4 });
    expect(c1.firstAt).toBe(new Date(NOW).toISOString());
    expect(c1.editedAt).toBe(c1.firstAt);
    expect(c1.late).toBeUndefined();
    const note1 = { note: "", updatedAt: "", ...first } as DayNote;

    // a habit ticked three hours later: answers unchanged → editedAt stays, `at` moves
    const later = NOW + 3 * 3_600_000;
    const tick = habitInput(note1, "h1", true, later);
    const c2 = tick.checkin as CheckIn;
    expect(c2.habits).toEqual({ h1: true });
    expect(c2.firstAt).toBe(c1.firstAt);
    expect(c2.editedAt).toBe(c1.editedAt);
    expect(c2.status).toBe("done");
    expect(c2.focus).toBe(4);
    expect(c2.at).toBe(new Date(later).toISOString());

    // an answer changed later: editedAt moves, firstAt does not
    const note2 = { note: "", updatedAt: "", ...tick } as DayNote;
    const edit = dailyCheckinInput(note2, ci({ stress: 4, focus: 4, habits: { h1: true } }), 4, { now: later, day: today, todayKey: today, status: "done" });
    const c3 = edit.checkin as CheckIn;
    expect(c3.firstAt).toBe(c1.firstAt);
    expect(c3.editedAt).toBe(new Date(later).toISOString());
    // saving the very same answers again does not move editedAt
    const same = dailyCheckinInput({ note: "", updatedAt: "", ...edit } as DayNote, ci({ stress: 4, focus: 4, habits: { h1: true } }), 4, { now: later + 1000, day: today, todayKey: today, status: "done" });
    expect((same.checkin as CheckIn).editedAt).toBe(c3.editedAt);
  });

  it("nachgetragen: ein Tag vor heute wird als late markiert, und das bleibt so", () => {
    const filled = dailyCheckinInput(undefined, ci({ stress: 2 }), null, { now: NOW, day: "2026-10-10", todayKey: today, status: "done" });
    expect((filled.checkin as CheckIn).late).toBe(true);
    const again = dailyCheckinInput({ note: "", updatedAt: "", ...filled } as DayNote, ci({ stress: 3 }), null, { now: NOW + 1000, day: "2026-10-10", todayKey: "2026-10-10", status: "done" });
    expect((again.checkin as CheckIn).late).toBe(true);
  });

  it("ein Check-in ohne Antworten mit Status ist ein Datensatz; ohne Status wird er null", () => {
    const skip = checkinInput({ ...ci(), status: "skipped" }, null, NOW);
    expect(skip.checkin).toMatchObject({ status: "skipped" });
    expect(checkinInput(ci(), null, NOW).checkin).toBeNull();
  });
});

describe("Wann der Dialog fragt", () => {
  const cfg = checkinConfigOf({});
  const NOW = utc("2026-10-12T05:30:00Z"); // 07:30 CEST
  const env = (p: Partial<PromptEnv> = {}): PromptEnv => ({ now: NOW, config: { ...cfg, timeZone: BERLIN }, deviceTz: "UTC", days: {}, synced: true, introDone: true, blocked: false, snooze: null, ...p });
  const answered: DayNotes = { "2026-10-12": { note: "", updatedAt: "", checkin: { stress: 2, emotions: [], habits: {}, status: "done" } } as unknown as DayNote };
  const skipped: DayNotes = { "2026-10-12": { note: "", updatedAt: "", checkin: { emotions: [], habits: {}, status: "skipped" } } as unknown as DayNote };

  it("beim ersten Öffnen des Tages: ja – mit dem Tag der eingestellten Zone", () => {
    expect(decidePrompt(env())).toEqual({ show: true, day: "2026-10-12" });
    // the device is on UTC, the zone Berlin: 00:30 Berlin is still the day before on the device, but the 13th for the check-in
    expect(decidePrompt(env({ now: utc("2026-10-12T22:30:00Z") }))).toEqual({ show: true, day: "2026-10-13" });
  });

  it("Abnahme: das zweite Gerät fragt am selben Tag nicht noch einmal (der Datensatz kam per Sync), der nächste Tag fragt", () => {
    const device2 = decidePrompt(env({ days: answered }));
    expect(device2).toEqual({ show: false, day: "2026-10-12", why: "answered" });
    // later the same day, 23:59 Berlin: still no prompt
    expect(decidePrompt(env({ days: answered, now: utc("2026-10-12T21:59:00Z") })).show).toBe(false);
    // one minute later it is the next local day: it asks again
    expect(decidePrompt(env({ days: answered, now: utc("2026-10-12T22:00:00Z") }))).toEqual({ show: true, day: "2026-10-13" });
  });

  it("der nächste Tag fragt auch über den Zeitwechsel hinweg", () => {
    const d = (iso: string, days: DayNotes) => decidePrompt(env({ now: utc(iso), days }));
    const day = (k: string): DayNotes => ({ [k]: { note: "", updatedAt: "", checkin: { emotions: [], habits: {}, status: "done" } } as unknown as DayNote });
    expect(d("2026-03-29T10:00:00Z", day("2026-03-29")).show).toBe(false);
    expect(d("2026-03-29T22:00:00Z", day("2026-03-29"))).toEqual({ show: true, day: "2026-03-30" });
    expect(d("2026-10-25T20:00:00Z", day("2026-10-25")).show).toBe(false);
    expect(d("2026-10-25T23:00:00Z", day("2026-10-25"))).toEqual({ show: true, day: "2026-10-26" });
  });

  it("Heute überspringen gilt auf jedem Gerät; ein übersprungener Tag ist kein Check-in", () => {
    expect(decidePrompt(env({ days: skipped }))).toEqual({ show: false, day: "2026-10-12", why: "skipped" });
    expect(hasCheckin(skipped["2026-10-12"])).toBe(false);
  });

  it("ein Check-in von vor dem Dialog (nur Stimmung) zählt als beantwortet", () => {
    expect(decidePrompt(env({ days: { "2026-10-12": { note: "", updatedAt: "", mood: 3 } } })).show).toBe(false);
  });

  it("wartet auf Sync, Intro/Einführung und offene Dialoge – und fragt nicht, wenn der Nutzer es abgeschaltet hat", () => {
    expect(decidePrompt(env({ synced: false }))).toMatchObject({ show: false, why: "not-ready" });
    expect(decidePrompt(env({ introDone: false }))).toMatchObject({ show: false, why: "not-ready" });
    expect(decidePrompt(env({ blocked: true }))).toMatchObject({ show: false, why: "blocked" });
    expect(decidePrompt(env({ config: { ...cfg, prompt: false } }))).toMatchObject({ show: false, why: "disabled" });
    // …but an outcome from another device wins over "not ready": it is already answered
    expect(decidePrompt(env({ days: answered, synced: false }))).toMatchObject({ show: false, why: "answered" });
  });

  it("Später: bis zur Erinnerungszeit, sonst zwei Stunden; der nächste Tag ignoriert es", () => {
    const withReminder = { timeZone: BERLIN, reminder: "12:00" };
    const s = snoozeFor(NOW, withReminder, "UTC");
    expect(s).toEqual({ day: "2026-10-12", until: utc("2026-10-12T10:00:00Z") }); // 12:00 CEST
    expect(decidePrompt(env({ snooze: s })).show).toBe(false);
    expect(decidePrompt(env({ snooze: s, now: utc("2026-10-12T10:00:00Z") })).show).toBe(true);
    // reminder already past (or none): two hours
    expect(snoozeFor(NOW, { timeZone: BERLIN, reminder: "06:00" }, "UTC").until).toBe(NOW + SNOOZE_MS);
    expect(snoozeFor(NOW, { timeZone: BERLIN, reminder: null }, "UTC").until).toBe(NOW + SNOOZE_MS);
    // a snooze from yesterday does not hold today
    expect(decidePrompt(env({ snooze: { day: "2026-10-11", until: NOW + 99_999_999 } })).show).toBe(true);
  });
});

// ------------------------------------------------------------------ evaluation

const TZ = "UTC";
const DAY0 = utc("2026-09-01T00:00:00Z");
/** Local-input string of an instant in the test runner's zone – the same way the journal stores trade times. */
const at = (ms: number): string => nowLocalInput(new Date(ms));

function seedDays(n: number, opts: { lateFrom?: number; editedAfterTrades?: boolean } = {}) {
  const days: DayNotes = {};
  const trades = [];
  for (let i = 0; i < n; i++) {
    const dayMs = DAY0 + i * 86_400_000;
    const key = dayKeyIn(dayMs, TZ);
    // stress rises with i (1…5, repeating) and the plan adherence falls with it: a built-in relation to find
    const stress = ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5;
    const checkAt = dayMs + 7 * 3_600_000;
    const checkin: Record<string, unknown> = { stress, energy: (6 - stress) as number, emotions: [], habits: {}, status: "done", firstAt: new Date(checkAt).toISOString(), editedAt: new Date(checkAt).toISOString(), at: new Date(checkAt).toISOString() };
    if (opts.lateFrom != null && i >= opts.lateFrom) checkin.late = true;
    if (opts.editedAfterTrades && i === 0) checkin.editedAt = new Date(dayMs + 20 * 3_600_000).toISOString();
    days[key] = { note: "", updatedAt: "", mood: 3, checkin } as unknown as DayNote;
    // trades: one BEFORE the check-in (06:00), then 2–3 after it
    trades.push(mkTrade({ id: `b${i}`, date: at(dayMs + 6 * 3_600_000), exitDate: at(dayMs + 6.5 * 3_600_000), entry: 100, stop: 99, exit: 101, size: 1000, followedPlan: true, status: "closed", r: 5 }));
    const after = 2 + (stress > 3 ? 1 : 0);
    for (let k = 0; k < after; k++) {
      const start = dayMs + (9 + k * 0.5) * 3_600_000;
      trades.push(
        mkTrade({
          id: `t${i}_${k}`,
          date: at(start),
          exitDate: at(start + 10 * 60_000),
          entry: 100,
          stop: 99,
          exit: 101,
          size: 1000,
          // adherence falls with stress
          followedPlan: stress <= 2 ? true : stress === 3 ? k === 0 : false,
          status: "closed",
          r: stress <= 2 ? 1 : -1,
        }),
      );
    }
  }
  return { days, trades: enrichTrades(trades, defaultSettings()) };
}

describe("Check-in × Handelstag", () => {
  it("nimmt nur Trades NACH dem Check-in und zählt die Tage ehrlich", () => {
    const { days, trades } = seedDays(10);
    const j = joinCheckins({ days, trades, tz: TZ });
    expect(j.rows).toHaveLength(10);
    expect(j.stats.used).toBe(10);
    // the 06:00 trade of every day is before the 07:00 check-in: not part of any day's count
    const day0 = j.rows[0]!;
    expect(day0.count).toBe(2); // stress 1 → two trades after the check-in
    expect(j.stats.trades).toBe(j.rows.reduce((a, r) => a + r.count, 0));
    // quick re-entries: trades 30 min apart with a 10 min duration are not quick re-entries
    expect(day0.reentries).toBe(0);
    expect(day0.adherence).toBe(1);
    expect(day0.result).toBe(2);
  });

  it("schnelle Wiedereinstiege: Einstieg höchstens 15 Minuten nach dem Ende des Vorgängers", () => {
    const dayMs = DAY0;
    const key = dayKeyIn(dayMs, TZ);
    const days = { [key]: { note: "", updatedAt: "", checkin: { stress: 4, emotions: [], habits: {}, status: "done", firstAt: new Date(dayMs).toISOString(), at: new Date(dayMs).toISOString() } } as unknown as DayNote };
    const mk = (id: string, startMin: number, endMin: number | undefined) => mkTrade({ id, date: at(dayMs + startMin * 60_000), ...(endMin != null ? { exitDate: at(dayMs + endMin * 60_000) } : {}), entry: 100, stop: 99, exit: 99, status: "closed" });
    const trades = enrichTrades([mk("a", 60, 70), mk("b", 80, 100), mk("c", 130, 140), mk("d", 141, undefined), mk("e", 200, 210)], defaultSettings());
    const j = joinCheckins({ days, trades, tz: TZ });
    // b: 10 min after a ended → quick; c: 30 min after b → no; d: 1 min after c → quick; e: predecessor d has no exit time → unknown, not counted
    expect(j.rows[0]!.reentries).toBe(2);
  });

  it("nachgetragene Tage, spätere Änderungen, Trades vor dem Check-in, übersprungene Tage und Tage ohne Check-in gehen nicht in die Stichprobe", () => {
    const { days, trades } = seedDays(10, { lateFrom: 8, editedAfterTrades: true });
    // one skipped day and one day with trades but no check-in at all
    const skippedKey = dayKeyIn(DAY0 + 10 * 86_400_000, TZ);
    days[skippedKey] = { note: "", updatedAt: "", checkin: { emotions: [], habits: {}, status: "skipped" } } as unknown as DayNote;
    const noneMs = DAY0 + 11 * 86_400_000 + 9 * 3_600_000;
    const withNone = enrichTrades([...trades, mkTrade({ id: "x", date: at(noneMs), entry: 100, stop: 99, exit: 101, status: "closed" })], defaultSettings());
    const j = joinCheckins({ days, trades: withNone, tz: TZ });
    expect(j.stats.late).toBe(2);
    // day 0's answers were last edited at 20:00, after all of its trades
    expect(j.stats.tradesFirst).toBe(1);
    expect(j.stats.used).toBe(7);
    expect(j.stats.skipped).toBe(1);
    expect(j.stats.withoutCheckin).toBe(1);
    expect(j.rows.map((r) => r.day)).not.toContain(dayKeyIn(DAY0, TZ));
  });

  it("zu wenig Tage → keine Korrelation; genug Tage → ρ mit Stichprobe", () => {
    const few = seedDays(MIN_CHECKIN_N - 1);
    const jFew = joinCheckins({ days: few.days, trades: few.trades, tz: TZ });
    const cellsFew = correlationMatrix(jFew.rows, ["stress", "energy"]);
    expect(cellsFew.every((c) => c.rho === null)).toBe(true);
    expect(cellsFew.find((c) => c.predictor === "stress" && c.outcome === "adherence")?.n).toBe(MIN_CHECKIN_N - 1);

    const many = seedDays(20);
    const j = joinCheckins({ days: many.days, trades: many.trades, tz: TZ });
    const cells = correlationMatrix(j.rows, ["stress", "energy"]);
    const stressAdherence = cells.find((c) => c.predictor === "stress" && c.outcome === "adherence")!;
    expect(stressAdherence.n).toBe(20);
    expect(stressAdherence.rho).toBeLessThan(-0.5); // built in: more stress, less plan adherence
    expect(cells.find((c) => c.predictor === "energy" && c.outcome === "adherence")!.rho).toBeGreaterThan(0.5);
    const lines = notableLines(cells, (p) => (p === "stress" ? "Stress" : "Energie"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/\(ρ [−-]?\d,\d\d, 20 Tage\)/);
    // wording: a relation, never a cause
    expect(lines.join(" ")).not.toMatch(/verursacht|führt zu|weil/i);
  });

  it("eigene Fragen werden mit ausgewertet, nur solange sie in der Liste stehen", () => {
    const { days, trades } = seedDays(10);
    for (const [k, v] of Object.entries(days)) (v as DayNote & { checkin: { custom?: Record<string, number> } }).checkin.custom = { q1: Number(k.slice(-2)) % 5 };
    const withQ = joinCheckins({ days, trades, tz: TZ, customIds: ["q1"] });
    expect(withQ.rows[0]!.values["custom:q1"]).toBeDefined();
    const without = joinCheckins({ days, trades, tz: TZ });
    expect(without.rows[0]!.values["custom:q1"]).toBeUndefined();
  });
});

describe("Privat standardmäßig", () => {
  /** every source file under `dir` */
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("weder Mentor-/Community-Code noch die Social-Funktionen lesen Tagesjournal oder Check-in", () => {
    const roots = ["src/social", "src/views/community", "netlify/functions/_lib/social"];
    for (const root of roots) {
      for (const f of walk(root)) {
        const src = readFileSync(f, "utf8");
        expect(src, f).not.toMatch(/\bcheckin|DayNote|growthOf\(|(state|s|journal)\.days\b|getState\(\)\.days/);
      }
    }
  });
});
