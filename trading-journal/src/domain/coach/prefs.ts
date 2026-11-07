/**
 * Coach settings (P04) in the passthrough key `settings.coach` – kept by `normalizeSettings`, the backup and the cloud
 * `merge3` like `settings.analytics` / `settings.risk`:
 *
 *   coach.reports.seen   report keys the trader has opened ("2026-W41", "2026-10", …) – the "Bericht bereit" wipe
 *                        plays once per period and device-independently; newest 400 kept.
 *   coach.plan           the accepted improvement plan: `{ goals: GoalDraft[], acceptedAt }` (pinned on the coach page,
 *                        evaluated in the reports' "Zielerreichung"; also handed to P08 `addGoalFromDraft`).
 *   coach.ai             `{ notes: boolean }` – opt-in to send note excerpts to the optional LLM rephrasing (default off).
 *
 * Writers return a NEW settings object with every other key untouched (unknown keys inside `coach` too).
 */
import type { Settings } from "../types";
import type { GoalDraft } from "../growth/goals";

export const SEEN_MAX = 400;
export const PLAN_MAX = 5;

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
