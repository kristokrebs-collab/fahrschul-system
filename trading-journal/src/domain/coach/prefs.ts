/**
 * Coach settings (P04) in the passthrough key `settings.coach` – kept by `normalizeSettings`, the backup and the cloud
 * `merge3` like `settings.analytics` / `settings.risk`:
 *
 *   coach.reports.seen   report keys the trader has opened ("2026-W41", "2026-10", …) – the "Bericht bereit" wipe
 *                        plays once per period and device-independently; newest 400 kept.
 *   coach.plan           the accepted improvement plan: `{ goals: GoalDraft[], acceptedAt }` (pinned on the coach page,
 *                        evaluated in the reports' "Zielerreichung"; also handed to P08 `addGoalFromDraft`).
 *   coach.ai             `{ notes: boolean }` – opt-in to send note excerpts to the optional LLM rephrasing (default off).
 *   coach.reviews        Paket P: the weekly reviews the trader closed himself, `{ "2026-W45": { closed, at, lesson } }` – closed means
 *                        "I looked at this week" (never a score); `lesson` is his own sentence for tomorrow (≤ 200 characters). Re-opening
 *                        sets `closed: false` (a key is never deleted, so the merge of two devices stays lossless); newest 60 kept.
 *
 *   coach.dayCloses      Paket F2 "Heute abschließen": the days the trader closed himself, `{ "2026-11-08": { closed, at, ready } }` – `ready`: the
 *                        process items (checklist, review) were all done when he closed it; re-opening sets `closed: false`; newest 120 kept.
 *
 * Writers return a NEW settings object with every other key untouched (unknown keys inside `coach` too).
 */
import type { Settings } from "../types";
import type { GoalDraft } from "../growth/goals";

export const SEEN_MAX = 400;
export const PLAN_MAX = 5;
export const REVIEWS_MAX = 60;
export const LESSON_MAX = 200;

/** The weekly review of one period as the trader left it (`closed: false` = re-opened). */
export interface WeekClose {
  closed: boolean;
  /** ISO – when it was closed */
  at: string;
  /** his own sentence for tomorrow (may be empty) */
  lesson: string;
}

export interface CoachPlan {
  goals: GoalDraft[];
  /** ISO */
  acceptedAt: string;
}

export interface CoachPrefs {
  seen: string[];
  plan: CoachPlan | null;
  aiNotes: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const PERIODS = new Set(["day", "week", "month", "quarter", "year"]);
const COMPARATORS = new Set(["atLeast", "atMost"]);

/** A stored goal draft, or null when it lacks the required fields. */
function draftOf(v: unknown): GoalDraft | null {
  const o = obj(v);
  if (typeof o.title !== "string" || !o.title.trim() || typeof o.metric !== "string" || typeof o.target !== "number" || !Number.isFinite(o.target)) return null;
  if (!COMPARATORS.has(String(o.comparator)) || !PERIODS.has(String(o.period))) return null;
  return { ...(o as unknown as GoalDraft) };
}

/** The coach settings of `settings` (sanitised; a broken key reads as the defaults). */
export function coachPrefsOf(settings: object): CoachPrefs {
  const c = obj((settings as { coach?: unknown }).coach);
  const r = obj(c.reports);
  const seen = Array.isArray(r.seen) ? [...new Set(r.seen.filter((x): x is string => typeof x === "string" && x.length <= 16))] : [];
  const p = obj(c.plan);
  const goals = Array.isArray(p.goals) ? p.goals.map(draftOf).filter((g): g is GoalDraft => g !== null).slice(0, PLAN_MAX) : [];
  const plan = goals.length && typeof p.acceptedAt === "string" ? { goals, acceptedAt: p.acceptedAt } : null;
  return { seen, plan, aiNotes: obj(c.ai).notes === true };
}

function withCoach(settings: Settings, patch: (c: Record<string, unknown>) => Record<string, unknown>): Settings {
  const s = settings as Settings & { coach?: unknown };
  return { ...s, coach: patch({ ...obj(s.coach) }) } as Settings;
}

/** Marks report keys as seen (newest first, capped); the same object when nothing changes. */
export function withReportSeen(settings: Settings, keys: readonly string[]): Settings {
  const cur = coachPrefsOf(settings).seen;
  const add = keys.filter((k) => !cur.includes(k));
  if (!add.length) return settings;
  return withCoach(settings, (c) => ({ ...c, reports: { ...obj(c.reports), seen: [...add, ...cur].slice(0, SEEN_MAX) } }));
}

/** Stores the accepted plan (`null` removes it). */
export function withCoachPlan(settings: Settings, goals: readonly GoalDraft[] | null, now: number): Settings {
  return withCoach(settings, (c) => {
    if (!goals || !goals.length) {
      const rest = { ...c };
      delete rest.plan;
      return rest;
    }
    return { ...c, plan: { goals: goals.slice(0, PLAN_MAX), acceptedAt: new Date(now).toISOString() } };
  });
}

/** Opt-in for note excerpts in the LLM rephrasing. */
export function withAiNotes(settings: Settings, on: boolean): Settings {
  return withCoach(settings, (c) => ({ ...c, ai: { ...obj(c.ai), notes: on } }));
}

const WEEK_KEY = /^\d{4}-W\d{2}$/;

/** The closed weekly reviews of `settings` (sanitised: week keys only, text clipped). */
export function weekClosesOf(settings: object): Record<string, WeekClose> {
  const raw = obj(obj((settings as { coach?: unknown }).coach).reviews);
  const out: Record<string, WeekClose> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!WEEK_KEY.test(k)) continue;
    const o = obj(v);
    out[k] = { closed: o.closed === true, at: typeof o.at === "string" ? o.at.slice(0, 40) : "", lesson: typeof o.lesson === "string" ? o.lesson.slice(0, LESSON_MAX) : "" };
  }
  return out;
}

/** Did the trader close the review of this week? */
export const weekClosed = (settings: object, key: string): boolean => weekClosesOf(settings)[key]?.closed === true;

/** Closes (or re-opens) the weekly review of `key`; the same object for an invalid key. Never deletes a key. */
export function withWeekClosed(settings: Settings, key: string, patch: { closed: boolean; lesson?: string }, now: number): Settings {
  if (!WEEK_KEY.test(key)) return settings;
  const all = weekClosesOf(settings);
  const prev = all[key];
  const next: WeekClose = { closed: patch.closed, at: patch.closed ? new Date(now).toISOString() : (prev?.at ?? ""), lesson: (patch.lesson ?? prev?.lesson ?? "").trim().slice(0, LESSON_MAX) };
  const merged = { ...all, [key]: next };
  const keep = Object.entries(merged)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, REVIEWS_MAX);
  return withCoach(settings, (c) => ({ ...c, reviews: Object.fromEntries(keep) }));
}

/* ------------------------------------------------------------------ Heute abschließen (Paket F2) */

export const DAY_CLOSES_MAX = 120;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The closing of one day as the trader left it (`closed: false` = re-opened). `ready`: the process items were all done when he closed it. */
export interface DayClose {
  closed: boolean;
  /** ISO – when it was closed */
  at: string;
  ready: boolean;
}

/** The closed days of `settings` (`coach.dayCloses`, sanitised: day keys only). */
export function dayClosesOf(settings: object): Record<string, DayClose> {
  const raw = obj(obj((settings as { coach?: unknown }).coach).dayCloses);
  const out: Record<string, DayClose> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!DAY_KEY.test(k)) continue;
    const o = obj(v);
    out[k] = { closed: o.closed === true, at: typeof o.at === "string" ? o.at.slice(0, 40) : "", ready: o.ready === true };
  }
  return out;
}

/** Closes (or re-opens) the day `key`; the same object for an invalid key. Never deletes a key (the merge of two devices stays lossless); newest 120 kept. */
export function withDayClosed(settings: Settings, key: string, patch: { closed: boolean; ready?: boolean }, now: number): Settings {
  if (!DAY_KEY.test(key)) return settings;
  const all = dayClosesOf(settings);
  const prev = all[key];
  const next: DayClose = { closed: patch.closed, at: patch.closed ? new Date(now).toISOString() : (prev?.at ?? ""), ready: patch.closed ? patch.ready === true : (prev?.ready ?? false) };
  const keep = Object.entries({ ...all, [key]: next })
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, DAY_CLOSES_MAX);
  return withCoach(settings, (c) => ({ ...c, dayCloses: Object.fromEntries(keep) }));
}
