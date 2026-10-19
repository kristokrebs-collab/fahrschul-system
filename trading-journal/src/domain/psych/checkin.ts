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

  // ── F61 daily check-in. ALL optional and ABSENT when unset (a record without them reads exactly as before).
  /** 1 (zerstreut) … 5 (messerscharf): Konzentration. */
  focus?: Level5;
  /** 1 (schlecht) … 5 (erholsam): quality of last night's sleep. */
  sleepQuality?: Level5;
  /** Minutes available for trading today (0–1440). */
  availableMin?: number;
  /** Planned session (`CHECKIN_SESSIONS` or an own word). */
  session?: string;
  /** Planned maximum risk of the day in percent of the account (0–10). */
  dayRisk?: number;
  /** Free comment. */
  comment?: string;
  /** Answers to the trader's own questions (question id → scale value). Kept when a question is removed. */
  custom?: Record<string, number>;
  /** How the daily prompt ended; absent = saved from the Wachstum page without the prompt. */
  status?: CheckinStatus;
  /** ISO time of the first save of this check-in (never moves). */
  firstAt?: string;
  /** ISO time the ANSWERS (not the habits) last changed – only trades after it can be said to follow this state. */
  editedAt?: string;
  /** Filled in on a later day than it describes ("nachgetragen"): never counted as known at entry. */
  late?: true;
}

/** How the day's check-in prompt ended: answered ("Erledigt") or "Heute überspringen". */
export type CheckinStatus = "done" | "skipped";

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

export const SESSION_MAX = 40;
export const COMMENT_MAX = 500;
/** Planned sessions offered in the check-in. */
export const CHECKIN_SESSIONS: readonly string[] = ["Asien", "London", "New York", "Keine Session"];
/** Choices of "verfügbare Zeit" in minutes. */
export const AVAILABLE_CHOICES: readonly number[] = [30, 60, 120, 240, 480];
export const FOCUS_LABELS = ["Zerstreut", "Unruhig", "Okay", "Konzentriert", "Messerscharf"] as const;
export const SLEEP_QUALITY_LABELS = ["Schlecht", "Unruhig", "Okay", "Gut", "Erholsam"] as const;

/** Number in `[0, max]` rounded to `step`, else `undefined`. */
function stepped(v: unknown, max: number, step: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return undefined;
  return Math.round((Math.round(v / step) * step) * 1e6) / 1e6;
}

function cleanCustom(v: unknown): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) if (k.length > 0 && k.length <= 40 && typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100) out[k] = x;
  return Object.keys(out).length ? out : undefined;
}

const isoOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** The sanitised check-in of a raw value (empty answers included); the F61 keys only when set. */
function cleanCheckin(raw: Record<string, unknown>): CheckIn {
  const c: CheckIn = { stress: level5(raw.stress), energy: level5(raw.energy), sleep: sleepHours(raw.sleep), emotions: cleanEmotions(raw.emotions), habits: cleanHabits(raw.habits) };
  if (typeof raw.at === "string") c.at = raw.at;
  const focus = level5(raw.focus);
  if (focus) c.focus = focus;
  const sleepQuality = level5(raw.sleepQuality);
  if (sleepQuality) c.sleepQuality = sleepQuality;
  const availableMin = stepped(raw.availableMin, 1440, 5);
  if (availableMin !== undefined) c.availableMin = availableMin;
  if (typeof raw.session === "string" && raw.session.trim()) c.session = raw.session.trim().slice(0, SESSION_MAX);
  const dayRisk = stepped(raw.dayRisk, 10, 0.25);
  if (dayRisk !== undefined) c.dayRisk = dayRisk;
  if (typeof raw.comment === "string" && raw.comment.trim()) c.comment = raw.comment.trim().slice(0, COMMENT_MAX);
  const custom = cleanCustom(raw.custom);
  if (custom) c.custom = custom;
  if (raw.status === "done" || raw.status === "skipped") c.status = raw.status;
  const firstAt = isoOrUndef(raw.firstAt);
  if (firstAt) c.firstAt = firstAt;
  const editedAt = isoOrUndef(raw.editedAt);
  if (editedAt) c.editedAt = editedAt;
  if (raw.late === true) c.late = true;
  return c;
}

/** The sanitised check-in of a day entry; `null` when the entry has none (or nothing in it is set). */
export function checkinOf(note: DayNote | undefined | null): CheckIn | null {
  const c = checkinRawOf(note);
  return c && !isEmptyCheckin(c) ? c : null;
}

/** Like `checkinOf`, but also an entry that holds only how the prompt ended (skipped / done without answers). */
export function checkinRawOf(note: DayNote | undefined | null): CheckIn | null {
  const raw = (note as { checkin?: unknown } | undefined | null)?.checkin;
  return isObj(raw) ? cleanCheckin(raw) : null;
}

/** Nothing measured, felt, planned, written or ticked. */
export function isEmptyCheckin(c: Pick<CheckIn, "stress" | "energy" | "sleep" | "emotions" | "habits"> & Partial<CheckIn>): boolean {
  return (
    c.stress == null &&
    c.energy == null &&
    c.sleep == null &&
    c.emotions.length === 0 &&
    !Object.values(c.habits).some(Boolean) &&
    c.focus == null &&
    c.sleepQuality == null &&
    c.availableMin == null &&
    c.session == null &&
    c.dayRisk == null &&
    c.comment == null &&
    c.custom == null
  );
}

/**
 * How the day's prompt ended: the stored outcome, else `done` when the entry has answers or a mood (a check-in from before
 * the daily prompt existed), else `null` – nothing happened yet. A skipped day carries no answers: it is never a good day.
 */
export function checkinStatusOf(note: DayNote | undefined | null): CheckinStatus | null {
  const raw = checkinRawOf(note);
  if (raw?.status) return raw.status;
  return hasCheckin(note) ? "done" : null;
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
  const clean = cleanCheckin(c as unknown as Record<string, unknown>);
  // an outcome without answers ("Heute überspringen") is still a record; an empty check-in without one is not
  return { mood, checkin: isEmptyCheckin(clean) && !clean.status ? null : { ...clean, at: new Date(now).toISOString() } };
}

/** The answers of two check-ins are the same (habits and the bookkeeping keys do not count). */
export function sameAnswers(a: CheckIn | null, b: CheckIn | null): boolean {
  const strip = (c: CheckIn | null): string => {
    if (!c) return "";
    const { habits: _h, at: _a, status: _s, firstAt: _f, editedAt: _e, late: _l, ...rest } = c;
    return JSON.stringify(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y)));
  };
  return strip(a) === strip(b);
}

export interface DailySave {
  /** `Date.now()`-style instant of the save */
  now: number;
  /** the day the check-in describes (`YYYY-MM-DD`) */
  day: string;
  /** today's key in the trader's time zone – a `day` before it is filled in later ("nachgetragen") */
  todayKey: string;
  status: CheckinStatus;
}

/**
 * `saveDay` input of the DAILY check-in (F61): the answers plus how the prompt ended, with the bookkeeping that keeps the
 * evaluation honest – `firstAt` (never moves), `editedAt` (moves only when an ANSWER changes, not a habit tick) and `late`
 * (filled in on a later day than it describes; sticky). Pure; `prev` is the stored day entry.
 */
export function dailyCheckinInput(prev: DayNote | undefined | null, c: CheckIn, mood: Level5 | null, o: DailySave): DayNoteInput {
  const old = checkinRawOf(prev);
  const clean = cleanCheckin(c as unknown as Record<string, unknown>);
  const nowIso = new Date(o.now).toISOString();
  const changed = !old || !sameAnswers(old, clean) || moodOf(prev) !== mood;
  const out: CheckIn = { ...clean, status: o.status, at: nowIso, firstAt: old?.firstAt ?? old?.at ?? nowIso };
  if (changed) out.editedAt = nowIso;
  else if (old?.editedAt) out.editedAt = old.editedAt;
  else delete out.editedAt;
  if (old?.late || o.day < o.todayKey) out.late = true;
  else delete out.late;
  return { mood, checkin: out };
}

/** `saveDay` input that sets one habit of the day, keeping the rest of the check-in. */
export function habitInput(note: DayNote | undefined | null, habitId: string, done: boolean, now: number): DayNoteInput {
  const cur = checkinRawOf(note) ?? { ...EMPTY_CHECKIN, emotions: [], habits: {} };
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
