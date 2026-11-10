/**
 * Habits (P08): manual habits are ticked in the day check-in (`checkin.habits[id]`), automatic ones read the day
 * journal – a check-in or mood (`checkin`), a pre-market plan (`plan`), a review / day note (`review`). The grid is
 * the last `weeks` ISO weeks (Monday first) up to today; the rate and the streak count calendar days. Pure.
 */
import type { DayNotes } from "../types";
import { dayFromKey } from "../insights/shared";
import { localDateKey } from "@/lib/dates";
import { checkinOf, hasCheckin } from "../psych/checkin";
import type { Habit } from "./model";

export function habitDone(h: Pick<Habit, "id" | "auto">, key: string, days: DayNotes): boolean {
  const note = days[key];
  if (!note) return false;
  switch (h.auto) {
    case "checkin":
      return hasCheckin(note);
    case "plan":
      return typeof note.plan === "string" && note.plan.trim() !== "";
    case "review":
      return [note.review, note.note].some((s) => typeof s === "string" && s.trim() !== "");
    default:
      return checkinOf(note)?.habits[h.id] === true;
  }
}

/** `YYYY-MM-DD` `n` days after `key` (negative = before). */
export function addDays(key: string, n: number): string {
  const d = dayFromKey(key);
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

export interface HabitCell {
  key: string;
  done: boolean;
  today: boolean;
  future: boolean;
}

export interface HabitRow {
  habit: Habit;
  cells: HabitCell[];
  /** share of done days in the last `RATE_DAYS` days up to today (today counts only when done) */
  rate: number;
  streak: number;
  best: number;
  doneToday: boolean;
}

export const RATE_DAYS = 30;

/** Days done in a row ending today (today still open does not break it) or yesterday. */
export function habitStreak(h: Pick<Habit, "id" | "auto">, days: DayNotes, todayKey: string): number {
  let n = 0;
  let k = todayKey;
  if (!habitDone(h, k, days)) k = addDays(k, -1);
  while (habitDone(h, k, days)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

/** Longest run of done days in the journal. */
export function habitBest(h: Pick<Habit, "id" | "auto">, days: DayNotes): number {
  const keys = Object.keys(days)
    .filter((k) => habitDone(h, k, days))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/** Completion rate of a habit over [fromKey, toKey] (inclusive); `null` for an empty range. */
export function habitRate(h: Pick<Habit, "id" | "auto">, days: DayNotes, fromKey: string, toKey: string): number | null {
  if (fromKey > toKey) return null;
  let n = 0;
  let done = 0;
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) {
    n++;
    if (habitDone(h, k, days)) done++;
    if (n > 400) break;
  }
  return n ? done / n : null;
}

/** Grid rows of `habits` over the last `weeks` ISO weeks up to `todayKey`. */
export function habitGrid(habits: readonly Habit[], days: DayNotes, todayKey: string, weeks = 5): { columns: string[]; rows: HabitRow[] } {
  const today = dayFromKey(todayKey);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) - 7 * (weeks - 1));
  const columns: string[] = [];
  for (let i = 0; i < weeks * 7; i++) columns.push(localDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  const rateFrom = addDays(todayKey, -(RATE_DAYS - 1));
  const rows = habits.map((habit): HabitRow => {
    const doneToday = habitDone(habit, todayKey, days);
    const cells = columns.map((key) => ({ key, done: key <= todayKey && habitDone(habit, key, days), today: key === todayKey, future: key > todayKey }));
    const yesterday = addDays(todayKey, -1);
    const r = habitRate(habit, days, rateFrom, doneToday ? todayKey : yesterday) ?? 0;
    return { habit, cells, rate: r, streak: habitStreak(habit, days, todayKey), best: habitBest(habit, days), doneToday };
  });
  return { columns, rows };
}
