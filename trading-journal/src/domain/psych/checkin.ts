/**
 * Daily check-in (P08) – a passthrough key on the day journal entry (`tj2-days`, `DayNote.checkin`), next to the
 * existing `mood` (1–5, reused, never duplicated):
 *
 *   days["2026-10-12"] = { note, mood: 4, checkin: { stress: 2, energy: 4, sleep: 7.5, emotions: ["Fokussiert"],
 *                          habits: { h_abc: true }, at: "2026-10-12T07:41:00.000Z" }, updatedAt }
 *
 * `normalizeDayNote` keeps unknown keys and `isEmptyDayNote` treats any extra key as content, so the check-in survives
 * every adapter, the backup and the cloud sync without a schema change. Everything here is pure and defensive: a
 * broken stored value reads as "not set", never throws.
 */
import type { DayNote, DayNoteInput, DayNotes } from "../types";

export type Level5 = 1 | 2 | 3 | 4 | 5;

export interface CheckIn {
  /** 1 (entspannt) … 5 (unter Strom); `null` = not set. */
  stress: Level5 | null;
  /** 1 (leer) … 5 (voller Energie). */
  energy: Level5 | null;
  /** Hours of sleep last night (0–14, half-hour steps). */
  sleep: number | null;
  /** Words of the moment (`CHECKIN_EMOTIONS` or own words), unique, ≤ `EMOTIONS_MAX`. */
  emotions: string[];
  /** Habit id → done that day. */
  habits: Record<string, boolean>;
  /** ISO time of the last check-in save. */
  at?: string;
}

export const EMOTIONS_MAX = 8;
export const SLEEP_MAX = 14;

export const MOOD_LABELS = ["Sehr schlecht", "Schlecht", "Neutral", "Gut", "Sehr gut"] as const;
/** Same words as the trade editor's "Psyche" meter, so a day and a trade speak one language. */
export const STRESS_LABELS = ["Entspannt", "Locker", "Angespannt", "Gestresst", "Unter Strom"] as const;
export const ENERGY_LABELS = ["Leer", "Müde", "Okay", "Wach", "Voller Energie"] as const;

export type EmotionTone = "pos" | "neutral" | "neg";
/** Words offered in the check-in (no clinical terms – states, not diagnoses). */
export const CHECKIN_EMOTIONS: readonly { word: string; tone: EmotionTone }[] = [
  { word: "Ruhig", tone: "pos" },
  { word: "Fokussiert", tone: "pos" },
  { word: "Zuversichtlich", tone: "pos" },
  { word: "Motiviert", tone: "pos" },
  { word: "Müde", tone: "neutral" },
  { word: "Abgelenkt", tone: "neutral" },
  { word: "Gelangweilt", tone: "neutral" },
  { word: "Ungeduldig", tone: "neg" },
  { word: "Nervös", tone: "neg" },
  { word: "Gereizt", tone: "neg" },
  { word: "FOMO", tone: "neg" },
  { word: "Euphorisch", tone: "neg" },
];

const TONE_OF = new Map(CHECKIN_EMOTIONS.map((e) => [e.word, e.tone]));
/** Tone of an emotion word (own words are neutral). */
export const emotionTone = (word: string): EmotionTone => TONE_OF.get(word) ?? "neutral";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 1–5 integer or null. */
export function level5(v: unknown): Level5 | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Level5) : null;
}

/** Sleep hours, rounded to half hours, 0–14, or null. */
export function sleepHours(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > SLEEP_MAX) return null;
  return Math.round(v * 2) / 2;
}

/** Trimmed, unique, non-empty words (≤ 24 chars each, ≤ `EMOTIONS_MAX`). */
export function cleanEmotions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const w = x.trim().slice(0, 24);
    if (w && !out.includes(w)) out.push(w);
    if (out.length >= EMOTIONS_MAX) break;
  }
  return out;
}

function cleanHabits(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === "boolean" && k.length <= 64) out[k] = x;
  return out;
}

/** The sanitised check-in of a day entry; `null` when the entry has none (or nothing in it is set). */
export function checkinOf(note: DayNote | undefined | null): CheckIn | null {
  const raw = (note as { checkin?: unknown } | undefined | null)?.checkin;
  if (!isObj(raw)) return null;
  const c: CheckIn = { stress: level5(raw.stress), energy: level5(raw.energy), sleep: sleepHours(raw.sleep), emotions: cleanEmotions(raw.emotions), habits: cleanHabits(raw.habits) };
  if (typeof raw.at === "string") c.at = raw.at;
  return isEmptyCheckin(c) ? null : c;
}

/** Nothing measured, felt or ticked. */
export function isEmptyCheckin(c: Pick<CheckIn, "stress" | "energy" | "sleep" | "emotions" | "habits">): boolean {
  return c.stress == null && c.energy == null && c.sleep == null && c.emotions.length === 0 && !Object.values(c.habits).some(Boolean);
}

/** A day counts as "checked in" when it has a check-in or a mood. */
export function hasCheckin(note: DayNote | undefined | null): boolean {
  return !!note && (checkinOf(note) !== null || level5(note.mood) !== null);
}

/** The day's mood (existing `DayNote.mood`). */
export const moodOf = (note: DayNote | undefined | null): Level5 | null => level5(note?.mood);

/** The day has written journal text (note, plan or review). */
export function hasDayText(note: DayNote | undefined | null): boolean {
  return !!note && [note.note, note.plan, note.review].some((s) => typeof s === "string" && s.trim() !== "");
}

export const EMPTY_CHECKIN: Readonly<CheckIn> = Object.freeze({ stress: null, energy: null, sleep: null, emotions: [], habits: {} });

/**
 * `saveDay` input for a check-in + mood. Other keys of the day entry are untouched (the adapters merge the input over
 * the stored entry). An empty check-in is written as `checkin: null` – `normalizeDayNote` keeps the key, so callers
 * that want the entry gone use `deleteDay` when nothing else is left (`dayIsEmptyWithout`).
 */
export function checkinInput(c: CheckIn, mood: Level5 | null, now: number): DayNoteInput {
  const clean: CheckIn = { stress: level5(c.stress), energy: level5(c.energy), sleep: sleepHours(c.sleep), emotions: cleanEmotions(c.emotions), habits: cleanHabits(c.habits) };
  return { mood, checkin: isEmptyCheckin(clean) ? null : { ...clean, at: new Date(now).toISOString() } };
}

/** `saveDay` input that sets one habit of the day, keeping the rest of the check-in. */
export function habitInput(note: DayNote | undefined | null, habitId: string, done: boolean, now: number): DayNoteInput {
  const cur = checkinOf(note) ?? { ...EMPTY_CHECKIN, emotions: [], habits: {} };
  const habits = { ...cur.habits };
  if (done) habits[habitId] = true;
  else delete habits[habitId];
  return checkinInput({ ...cur, habits }, moodOf(note), now);
}

/**
 * True when the entry carries nothing but the given keys (and `updatedAt`) – then removing them can delete the whole
 * entry instead of leaving `{ note: "" }` behind.
 */
export function dayIsEmptyWithout(note: DayNote | undefined | null, keys: readonly string[]): boolean {
  if (!note) return true;
  for (const [k, v] of Object.entries(note)) {
    if (k === "updatedAt" || keys.includes(k)) continue;
    if (k === "note" || k === "plan" || k === "review") {
      if (typeof v === "string" && v.trim()) return false;
      continue;
    }
    if (v != null) return false;
  }
  return true;
}

/** Day keys with a check-in or mood, ascending. */
export function checkinDays(days: DayNotes): string[] {
  return Object.keys(days)
    .filter((k) => hasCheckin(days[k]))
    .sort();
}
