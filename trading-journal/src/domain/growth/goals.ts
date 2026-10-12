/**
 * Goals contract (Wave 0 – owner P08; producers P04 improvement plan, P12 mentor assignments, P13 onboarding).
 * Signatures are final.
 *
 * Storage: `settings.growth.goals` – a passthrough array of `Goal` objects with `id`, merged per id by `merge3` (cloud
 * sync, the local adapter's `saveSettings`) and kept verbatim by `normalizeSettings`. Goals default to PROCESS goals
 * (discipline, journaling); a trade count is only ever an upper limit ("atMost") – `sanitizeGoalDraft` enforces it.
 * Outcome metrics (win rate, profit factor, R) may exist (a mentor can set one) but are never celebrated.
 */
import type { AccountId, Settings } from "../types";
import { newId } from "@/lib/ids";

export type GoalKind = "process" | "outcome" | "limit";
export type GoalPeriod = "day" | "week" | "month" | "quarter" | "year";
export type GoalComparator = "atLeast" | "atMost";
export type GoalMetric =
  | "journalRate" // share of trades with notes / review, 0–1
  | "planAdherence" // share of trades with followedPlan, 0–1
  | "checklistRate" // share of complete checklists, 0–1
  | "ruleBreaks" // count of rule violations (BehaviorEvent ruleViolation)
  | "behavior" // count of a BehaviorKey in `scope.behavior`
  | "tradesPerDay" // upper limit only
  | "lossDayPct" // worst day loss in % of capital (upper limit)
  | "riskPerTradePct" // average risk per trade in % of capital
  | "expectancyR"
  | "winRate"
  | "profitFactor"
  | "netR"
  | "habit" // habit id in `scope.habit`, completion rate 0–1
  | "custom";

export interface GoalDraft {
  /** German title shown on the card ("Jeden Trade mit Review abschließen"). */
  title: string;
  kind: GoalKind;
  metric: GoalMetric;
  target: number;
  comparator: GoalComparator;
  period: GoalPeriod;
  /** Optional end date `YYYY-MM-DD` (local). */
  due?: string;
  /** Narrows the metric. */
  scope?: { account?: AccountId; setupId?: string; pair?: string; behavior?: string; habit?: string };
  /** Who proposed it (P04 coach plan, P12 mentor, P13 onboarding, the user). */
  source: { kind: "user" | "coach" | "mentor" | "onboarding"; ref?: string; by?: string };
  /** Evidence / reasoning shown with the goal ("Revenge-Trades kosten dich −3,2 R im Monat"). */
  why?: string;
}

export type GoalStatus = "active" | "done" | "dropped";

export interface Goal extends GoalDraft {
  id: string;
  /** ISO. */
  createdAt: string;
  status: GoalStatus;
  /** ISO, set when status became "done". */
  doneAt?: string;
  /** P08: complete periods in a row the goal must hold to count as reached (default `HOLD_DEFAULT[period]`). */
  hold?: number;
  /** P08: self-check of goals the journal cannot measure (`custom`): period key → held. */
  log?: Record<string, boolean>;
}

/** Periods in a row a goal must hold to be reached. */
export const HOLD_DEFAULT: Readonly<Record<GoalPeriod, number>> = { day: 5, week: 4, month: 3, quarter: 1, year: 1 };
export const HOLD_MAX = 52;
export const GOALS_MAX = 40;

/** Metrics the journal measures as a share 0–1. */
export const RATE_METRICS: ReadonlySet<GoalMetric> = new Set(["journalRate", "planAdherence", "checklistRate", "habit", "winRate", "lossDayPct", "riskPerTradePct"]);
/** Result metrics – shown, never celebrated or counted as growth. */
export const OUTCOME_METRICS: ReadonlySet<GoalMetric> = new Set(["expectancyR", "winRate", "profitFactor", "netR"]);
/** Metrics that only make sense as an upper limit. */
export const LIMIT_METRICS: ReadonlySet<GoalMetric> = new Set(["ruleBreaks", "behavior", "tradesPerDay", "lossDayPct", "riskPerTradePct"]);

const METRICS = new Set<GoalMetric>(["journalRate", "planAdherence", "checklistRate", "ruleBreaks", "behavior", "tradesPerDay", "lossDayPct", "riskPerTradePct", "expectancyR", "winRate", "profitFactor", "netR", "habit", "custom"]);
const PERIODS = new Set<GoalPeriod>(["day", "week", "month", "quarter", "year"]);
const SOURCES = new Set(["user", "coach", "mentor", "onboarding"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * A clean draft, or `null` when it cannot be measured or stored (no title, unknown metric / period, no finite target).
 * Enforced: a trade count (`tradesPerDay`) and the limit metrics are upper limits (`atMost`); rates are clamped to
 * 0–1, counts to ≥ 0; outcome metrics get `kind: "outcome"`.
 */
export function sanitizeGoalDraft(raw: unknown): GoalDraft | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title, 120);
  const metric = raw.metric as GoalMetric;
  const period = raw.period as GoalPeriod;
  if (!title || !METRICS.has(metric) || !PERIODS.has(period)) return null;
  if (typeof raw.target !== "number" || !Number.isFinite(raw.target)) return null;
  let comparator: GoalComparator = raw.comparator === "atMost" ? "atMost" : "atLeast";
  if (LIMIT_METRICS.has(metric)) comparator = "atMost";
  let target = Math.max(0, raw.target);
  if (RATE_METRICS.has(metric)) target = Math.min(1, target);
  const kind: GoalKind = OUTCOME_METRICS.has(metric) ? "outcome" : raw.kind === "limit" ? "limit" : "process";
  const src = isObj(raw.source) ? raw.source : {};
  const source: GoalDraft["source"] = { kind: SOURCES.has(String(src.kind)) ? (src.kind as GoalDraft["source"]["kind"]) : "user" };
  const ref = str(src.ref, 120);
  const by = str(src.by, 120);
  if (ref) source.ref = ref;
  if (by) source.by = by;
  const out: GoalDraft = { title, kind, metric, target, comparator, period, source };
  const due = typeof raw.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : undefined;
  if (due) out.due = due;
  if (isObj(raw.scope)) {
    const s = raw.scope;
    const scope: NonNullable<GoalDraft["scope"]> = {};
    if (s.account === "makro" || s.account === "scalp") scope.account = s.account;
    for (const k of ["setupId", "pair", "behavior", "habit"] as const) {
      const v = str(s[k], 80);
      if (v) scope[k] = v;
    }
    if (Object.keys(scope).length) out.scope = scope;
  }
  if ((metric === "behavior" && !out.scope?.behavior) || (metric === "habit" && !out.scope?.habit)) return null;
  const why = str(raw.why, 400);
  if (why) out.why = why;
  return out;
}

/** A stored goal (sanitised; unknown keys kept), or `null`. */
export function goalOf(raw: unknown): Goal | null {
  const d = sanitizeGoalDraft(raw);
  if (!d || !isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const status: GoalStatus = raw.status === "done" || raw.status === "dropped" ? raw.status : "active";
  const g: Goal = { ...(raw as object), ...d, id: raw.id, createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(), status };
  for (const k of ["due", "scope", "why"] as const) if (!(k in d)) delete g[k];
  if (typeof raw.doneAt === "string") g.doneAt = raw.doneAt;
  else delete g.doneAt;
  const hold = typeof raw.hold === "number" && Number.isInteger(raw.hold) && raw.hold >= 1 ? Math.min(HOLD_MAX, raw.hold) : undefined;
  if (hold) g.hold = hold;
  else delete g.hold;
  if (isObj(raw.log)) {
    const log: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw.log)) if (typeof v === "boolean" && k.length <= 16) log[k] = v;
    g.log = log;
  } else delete g.log;
  return g;
}

/** Periods in a row the goal needs. */
export const holdOf = (g: Pick<Goal, "hold" | "period">): number => g.hold ?? HOLD_DEFAULT[g.period];

/** The same goal is already active (same title, or same metric + scope + period + comparator). */
export function sameGoal(a: GoalDraft, b: GoalDraft): boolean {
  if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) return true;
  return a.metric !== "custom" && a.metric === b.metric && a.period === b.period && a.comparator === b.comparator && JSON.stringify(a.scope ?? {}) === JSON.stringify(b.scope ?? {});
}

/* ------------------------------------------------------------------ store contract */

/** Minimal store surface `addGoalFromDraft` writes through (the journal store in the app, a fake in tests). */
export interface GoalStore {
  getSettings(): Settings;
  saveSettings(s: Settings): Promise<void>;
}

let storeOverride: GoalStore | null = null;
/** Tests / harnesses: route `addGoalFromDraft` to another store (`null` = the journal store). */
export function setGoalStore(s: GoalStore | null): void {
  storeOverride = s;
}

async function goalStore(): Promise<GoalStore> {
  if (storeOverride) return storeOverride;
  // loaded on demand: the domain stays free of a static store import (the store is in the app chunk anyway)
  const { useJournal } = await import("@/store/journalStore");
  return { getSettings: () => useJournal.getState().settings, saveSettings: (s) => useJournal.getState().saveSettings(s) };
}

/** Pure: `settings` with `goal` appended to `settings.growth.goals` (every other key of `growth` and `settings` kept). */
export function withGoalAppended(settings: Settings, goal: Goal): Settings {
  const s = settings as Settings & { growth?: unknown };
  const growth = isObj(s.growth) ? s.growth : {};
  const goals = Array.isArray(growth.goals) ? growth.goals : [];
  return { ...s, growth: { ...growth, goals: [...goals, goal].slice(-GOALS_MAX) } } as Settings;
}

/** Active goals of `settings` (sanitised). */
export function activeGoalsOf(settings: object): Goal[] {
  const growth = (settings as { growth?: unknown }).growth;
  const list = isObj(growth) && Array.isArray(growth.goals) ? growth.goals : [];
  return list.map(goalOf).filter((g): g is Goal => g !== null && g.status === "active");
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Adds a goal built from `draft` to `settings.growth.goals` and resolves the stored goal (`null` when the draft is
 * invalid or it could not be stored). An already active goal with the same title / measurement is returned as is
 * (no duplicate). Calls are serialised, so a plan handing over three goals at once never loses one.
 */
export function addGoalFromDraft(draft: GoalDraft): Promise<Goal | null> {
  const run = async (): Promise<Goal | null> => {
    const clean = sanitizeGoalDraft(draft);
    if (!clean) return null;
    const store = await goalStore();
    const settings = store.getSettings();
    const existing = activeGoalsOf(settings).find((g) => sameGoal(g, clean));
    if (existing) return existing;
    const goal: Goal = { ...clean, id: newId("gl_"), createdAt: new Date().toISOString(), status: "active" };
    // the P08 sheet may pass how often in a row (`Goal.hold`) with the draft
    const hold = (draft as { hold?: unknown }).hold;
    if (typeof hold === "number" && Number.isInteger(hold) && hold >= 1) goal.hold = Math.min(HOLD_MAX, hold);
    try {
      await store.saveSettings(withGoalAppended(settings, goal));
      return goal;
    } catch {
      return null;
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => null);
  return next;
}
