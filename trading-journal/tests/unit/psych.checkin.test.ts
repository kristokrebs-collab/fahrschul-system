/**
 * P08 check-in in the day journal: a passthrough key on `DayNote` that survives `normalizeDayNote`, makes the entry
 * non-empty, is sanitised defensively and is written through `checkinInput` / `habitInput` (mood reused).
 */
import { describe, expect, it } from "vitest";
import { isEmptyDayNote, normalizeDayNote } from "@/domain/normalize";
import { checkinDays, checkinInput, checkinOf, cleanEmotions, dayIsEmptyWithout, EMPTY_CHECKIN, emotionTone, habitInput, hasCheckin, hasDayText, isEmptyCheckin, level5, moodOf, sleepHours } from "@/domain/psych";
import type { DayNote } from "@/domain/types";

const NOW = new Date(2026, 9, 12, 8, 0).getTime();

describe("Check-in im Tagesjournal", () => {
  it("normalizeDayNote behält den Check-in, isEmptyDayNote respektiert ihn", () => {
    const raw = { note: "", updatedAt: "x", checkin: { stress: 2, energy: 4, sleep: 7.5, emotions: ["Ruhig"], habits: { h1: true } } };
    const n = normalizeDayNote(raw);
    expect((n as DayNote & { checkin?: unknown }).checkin).toEqual(raw.checkin);
    expect(isEmptyDayNote(n)).toBe(false);
    expect(checkinOf(n)).toEqual({ stress: 2, energy: 4, sleep: 7.5, emotions: ["Ruhig"], habits: { h1: true } });
  });

  it("liest kaputte Werte als nicht gesetzt", () => {
    const n = { note: "", updatedAt: "", checkin: { stress: 9, energy: 2.5, sleep: -1, emotions: [" Ruhig ", "Ruhig", 3, ""], habits: { a: "ja", b: true } } } as unknown as DayNote;
    expect(checkinOf(n)).toEqual({ stress: null, energy: null, sleep: null, emotions: ["Ruhig"], habits: { b: true } });
    expect(checkinOf({ note: "", updatedAt: "", checkin: "kaputt" } as unknown as DayNote)).toBeNull();
    expect(checkinOf({ note: "", updatedAt: "", checkin: { stress: null, emotions: [], habits: {} } } as unknown as DayNote)).toBeNull();
    expect(checkinOf(undefined)).toBeNull();
  });

  it("Hilfsfunktionen: level5, sleepHours, cleanEmotions, Töne", () => {
    expect(level5(3)).toBe(3);
    expect(level5(0)).toBeNull();
    expect(level5("3")).toBeNull();
    expect(sleepHours(7.3)).toBe(7.5);
    expect(sleepHours(15)).toBeNull();
    expect(cleanEmotions(Array.from({ length: 12 }, (_, i) => `W${i}`))).toHaveLength(8);
    expect(emotionTone("FOMO")).toBe("neg");
    expect(emotionTone("Fokussiert")).toBe("pos");
    expect(emotionTone("eigenes Wort")).toBe("neutral");
    expect(isEmptyCheckin(EMPTY_CHECKIN)).toBe(true);
  });

  it("hasCheckin zählt Check-in oder Stimmung; hasDayText Notiz, Plan, Review", () => {
    expect(hasCheckin({ note: "", updatedAt: "", mood: 4 })).toBe(true);
    expect(hasCheckin({ note: "Text", updatedAt: "" })).toBe(false);
    expect(hasDayText({ note: "", plan: " Plan ", updatedAt: "" })).toBe(true);
    expect(hasDayText({ note: " ", updatedAt: "" })).toBe(false);
    expect(moodOf({ note: "", updatedAt: "", mood: 5 })).toBe(5);
  });

  it("checkinInput schreibt Check-in + Stimmung, ein leerer Check-in wird null", () => {
    const input = checkinInput({ stress: 3, energy: null, sleep: 6, emotions: ["Fokussiert"], habits: { h: true, x: false } }, 4, NOW);
    expect(input.mood).toBe(4);
    expect(input.checkin).toMatchObject({ stress: 3, energy: null, sleep: 6, emotions: ["Fokussiert"], habits: { h: true, x: false }, at: new Date(NOW).toISOString() });
    expect(checkinInput(EMPTY_CHECKIN, null, NOW)).toEqual({ mood: null, checkin: null });
  });

  it("habitInput setzt eine Gewohnheit und behält den Rest", () => {
    const note: DayNote & { checkin?: unknown } = { note: "", updatedAt: "", mood: 3, checkin: { stress: 2, emotions: ["Ruhig"], habits: { a: true } } };
    const on = habitInput(note, "b", true, NOW);
    expect(on.checkin).toMatchObject({ stress: 2, emotions: ["Ruhig"], habits: { a: true, b: true } });
    expect(on.mood).toBe(3);
    const off = habitInput(note, "a", false, NOW);
    expect((off.checkin as { habits: object }).habits).toEqual({});
    expect(habitInput(undefined, "z", true, NOW).checkin).toMatchObject({ habits: { z: true } });
  });

  it("dayIsEmptyWithout erkennt, wann der ganze Eintrag weg darf", () => {
    expect(dayIsEmptyWithout({ note: "", updatedAt: "", mood: 3, checkin: {} } as DayNote, ["checkin", "mood"])).toBe(true);
    expect(dayIsEmptyWithout({ note: "Text", updatedAt: "", mood: 3 }, ["checkin", "mood"])).toBe(false);
    expect(dayIsEmptyWithout({ note: "", updatedAt: "", fremd: 1 } as unknown as DayNote, ["checkin"])).toBe(false);
    expect(dayIsEmptyWithout(undefined, [])).toBe(true);
  });

  it("checkinDays listet Tage mit Check-in aufsteigend", () => {
    expect(checkinDays({ "2026-10-02": { note: "", updatedAt: "", mood: 2 }, "2026-10-01": { note: "x", updatedAt: "" }, "2026-09-30": { note: "", updatedAt: "", checkin: { stress: 1 } } as DayNote })).toEqual(["2026-09-30", "2026-10-02"]);
  });
});
