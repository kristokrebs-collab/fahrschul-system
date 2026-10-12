/**
 * Goals contract (Wave 0 – owner P08; producers P04 improvement plan, P12 mentor assignments, P13 onboarding).
 * Signatures are final; `addGoalFromDraft` is a STUB (persists nothing, resolves `null`) until P08 lands.
 *
 * Storage (P08): `settings.growth.goals` – a passthrough array of `Goal` objects with `id`, merged per id by `merge3`.
 * Goals default to PROCESS goals (discipline, journaling); a trade count is only ever an upper limit ("atMost").
 */
import type { AccountId } from "../types";

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
}

/**
 * Adds a goal built from `draft` to `settings.growth.goals` and resolves the stored goal (`null` when it could not
 * be stored). STUB: stores nothing and resolves `null` until P08.
 */
export async function addGoalFromDraft(draft: GoalDraft): Promise<Goal | null> {
  void draft;
  return null;
}
