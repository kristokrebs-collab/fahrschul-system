/**
 * `settings.growth` (P08) – a passthrough settings key, synced like every setting:
 *
 *   growth.goals       Goal[]       (goals.ts; status active | done | dropped – dropped instead of deleted)
 *   growth.challenges  Challenge[]  (challenges.ts templates; status active | done | failed | dropped)
 *   growth.habits      Habit[]      (manual, ticked in the check-in, or automatic from the day journal)
 *
 * Every list is an array of objects with `id`, so `merge3` (cloud sync, the local adapter) merges two devices per id
 * and an edit beats a delete. Writers return a NEW settings object with every other key – also unknown keys inside
 * `growth` and inside each item – untouched. Pure.
 */
import type { Settings } from "../types";
import { goalOf, type Goal } from "./goals";

export type HabitAuto = "checkin" | "plan" | "review";

export interface Habit {
  id: string;
  title: string;
  /** automatic habits read the day journal (check-in / plan / review written); manual ones are ticked */
  auto?: HabitAuto;
  createdAt: string;
  archived?: boolean;
}

export type ChallengeStatus = "active" | "done" | "failed" | "dropped";

export interface Challenge {
  id: string;
  /** template key (`CHALLENGES`) */
  template: string;
  title: string;
  /** first day `YYYY-MM-DD` (local) */
  start: string;
  createdAt: string;
  status: ChallengeStatus;
  /** ISO, set when the status left "active" */
  endedAt?: string;
}

export interface GrowthPrefs {
  goals: Goal[];
  challenges: Challenge[];
  habits: Habit[];
}

export const HABITS_MAX = 12;
export const AUTO_HABITS: readonly { auto: HabitAuto; id: string; title: string }[] = [
  { auto: "checkin", id: "auto:checkin", title: "Täglicher Check-in" },
  { auto: "plan", id: "auto:plan", title: "Plan vor dem Markt" },
  { auto: "review", id: "auto:review", title: "Tagesreview geschrieben" },
];
/** Suggestions for manual habits (no trading counts – routines around the screen). */
export const HABIT_SUGGESTIONS: readonly string[] = ["Bewegung", "Kein Trade in den ersten 15 Minuten", "News-Kalender gecheckt", "Bildschirmpause nach jedem Trade", "8 Stunden Schlaf"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function habitOf(raw: unknown): Habit | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string" || !raw.title.trim()) return null;
  const h: Habit = { ...(raw as object), id: raw.id, title: raw.title.trim().slice(0, 60), createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString() };
  if (raw.auto === "checkin" || raw.auto === "plan" || raw.auto === "review") h.auto = raw.auto;
  else delete h.auto;
  if (raw.archived === true) h.archived = true;
  else delete h.archived;
  return h;
}

function challengeOf(raw: unknown): Challenge | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.template !== "string" || typeof raw.start !== "string" || !DAY_KEY.test(raw.start)) return null;
  const status: ChallengeStatus = raw.status === "done" || raw.status === "failed" || raw.status === "dropped" ? raw.status : "active";
  const c: Challenge = { ...(raw as object), id: raw.id, template: raw.template, title: typeof raw.title === "string" ? raw.title : raw.template, start: raw.start, createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(), status };
  if (typeof raw.endedAt === "string") c.endedAt = raw.endedAt;
  else delete c.endedAt;
  return c;
}

const listOf = <T>(v: unknown, of: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(of).filter((x): x is T => x !== null) : []);

/** The sanitised growth settings (a broken key reads as empty lists). */
export function growthOf(settings: object): GrowthPrefs {
  const g = (settings as { growth?: unknown }).growth;
  const o = isObj(g) ? g : {};
  return { goals: listOf(o.goals, goalOf), challenges: listOf(o.challenges, challengeOf), habits: listOf(o.habits, habitOf) };
}

type ListKey = "goals" | "challenges" | "habits";

function withList(settings: Settings, key: ListKey, edit: (list: Record<string, unknown>[]) => Record<string, unknown>[]): Settings {
  const s = settings as Settings & { growth?: unknown };
  const growth = isObj(s.growth) ? s.growth : {};
  const cur = Array.isArray(growth[key]) ? (growth[key] as unknown[]).filter(isObj) : [];
  return { ...s, growth: { ...growth, [key]: edit(cur) } } as Settings;
}

/** Appends an item (or replaces the one with the same id). */
export function withGrowthItem(settings: Settings, key: ListKey, item: Goal | Challenge | Habit): Settings {
  return withList(settings, key, (list) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i < 0) return [...list, { ...item }];
    const next = [...list];
    next[i] = { ...list[i], ...item };
    return next;
  });
}

/** Merges `patch` into the item `id` (unknown keys kept); the same object when the item is missing. */
export function withGrowthPatch(settings: Settings, key: ListKey, id: string, patch: Record<string, unknown>): Settings {
  const s = settings as Settings & { growth?: unknown };
  const growth = isObj(s.growth) ? s.growth : {};
  const list = Array.isArray(growth[key]) ? (growth[key] as unknown[]) : [];
  if (!list.some((x) => isObj(x) && x.id === id)) return settings;
  return withList(settings, key, (l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

/** Habits shown in the grid: the automatic ones the trader enabled + the manual ones, not archived. */
export function activeHabits(prefs: GrowthPrefs): Habit[] {
  return prefs.habits.filter((h) => !h.archived).slice(0, HABITS_MAX);
}
