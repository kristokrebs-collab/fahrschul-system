/**
 * Goal progress (P08). A goal is measured per period (day / week / month / quarter / year, local, the report periods
 * of P04) with the SAME function the reports use for "Zielerreichung" (`goalActual`) – plus the habit metric (habit
 * completion rate of the period) and `custom` goals the journal cannot measure (self-check in `goal.log`).
 *
 *   current period  actual, ratio 0–1 for the ring, state met · onTrack · atRisk · missed · noData
 *   history         the last complete periods, held or not
 *   streak          complete periods held in a row SINCE the goal was set (periods without data are skipped)
 *   achieved        streak ≥ `holdOf(goal)` – the goal is reached
 *
 * An upper limit (`atMost`) can only be "held so far" while its period runs: its ring fills with the elapsed share of
 * the period as long as it holds. Outcome metrics (win rate, PF, R) are measured but never celebrated. Pure.
 */
import type { EnrichedTrade } from "../types";
import { accountOf } from "../insights/shared";
import { goalActual } from "../reports/build";
import { periodOf, shiftPeriod, type ReportPeriod } from "../reports/periods";
import { localDateKey, tradeTime } from "@/lib/dates";
import type { Prepared } from "./context";
import { holdOf, OUTCOME_METRICS, RATE_METRICS, type Goal, type GoalMetric, type GoalPeriod } from "./goals";
import { addDays, habitRate } from "./habits";
import { AUTO_HABITS, type Habit } from "./model";

export type GoalState = "met" | "onTrack" | "atRisk" | "missed" | "noData";

export interface PeriodResult {
  key: string;
  short: string;
  actual: number | null;
  /** `null` = no data in that period (neutral) */
  met: boolean | null;
}

export interface GoalMilestone {
  n: number;
  label: string;
  reached: boolean;
}

export interface GoalProgress {
  goal: Goal;
  period: ReportPeriod;
  actual: number | null;
  ratio: number;
  state: GoalState;
  /** elapsed share of the current period */
  elapsed: number;
  history: PeriodResult[];
  streak: number;
  hold: number;
  achieved: boolean;
  milestones: GoalMilestone[];
  /** the journal measures it (else a self-check) */
  measurable: boolean;
  /** process / limit goals – an outcome goal is never celebrated */
  celebrate: boolean;
  /** `due` passed without reaching it */
  overdue: boolean;
  valueText: string;
  targetText: string;
}

export const HISTORY_MAX = 12;

const UNIT: Readonly<Record<GoalPeriod, [string, string]>> = {
  day: ["Tag", "Tage"],
  week: ["Woche", "Wochen"],
  month: ["Monat", "Monate"],
  quarter: ["Quartal", "Quartale"],
  year: ["Jahr", "Jahre"],
};
export const periodUnit = (p: GoalPeriod, n: number): string => (n === 1 ? UNIT[p][0] : UNIT[p][1]);

/** "90 %", "0", "1,5 %", "+0,40 R", "1,80". */
export function goalValueText(metric: GoalMetric, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (metric === "lossDayPct" || metric === "riskPerTradePct") return `${(Math.round(v * 1000) / 10).toString().replace(".", ",")} %`;
  if (RATE_METRICS.has(metric)) return `${Math.round(v * 100)} %`;
  if (metric === "expectancyR" || metric === "netR") return `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",").replace("-", "−")} R`;
  if (metric === "profitFactor") return v.toFixed(2).replace(".", ",");
  return String(Math.round(v * 100) / 100).replace(".", ",");
}

/** All habits a goal can point at (the stored ones + the automatic ones). */
export function habitById(habits: readonly Habit[], id: string): Pick<Habit, "id" | "auto"> | null {
  const own = habits.find((h) => h.id === id);
  if (own) return own;
  const auto = AUTO_HABITS.find((h) => h.id === id);
  return auto ? { id: auto.id, auto: auto.auto } : null;
}

function scoped(list: readonly EnrichedTrade[], scope: Goal["scope"]): EnrichedTrade[] {
  if (!scope) return [...list];
  return list.filter((t) => (!scope.account || accountOf(t) === scope.account) && (!scope.setupId || (t.setups ?? []).includes(scope.setupId)) && (!scope.pair || t.pair === scope.pair));
}

/** The goal's value in one period (`null` = nothing to measure). */
export function goalValue(goal: Goal, period: ReportPeriod, p: Prepared, habits: readonly Habit[]): number | null {
  if (goal.metric === "custom") {
    const v = goal.log?.[period.key];
    return v == null ? null : v ? 1 : 0;
  }
  if (goal.metric === "habit") {
    const h = goal.scope?.habit ? habitById(habits, goal.scope.habit) : null;
    if (!h) return null;
    const from = localDateKey(new Date(period.from));
    const last = localDateKey(new Date(period.to - 1));
    // the running period counts up to yesterday – today only once it is done
    const to = last < p.todayKey ? last : habitRate(h, p.days, p.todayKey, p.todayKey) === 1 ? p.todayKey : addDays(p.todayKey, -1);
    return habitRate(h, p.days, from, to);
  }
  const inP = scoped(p.sorted, goal.scope).filter((t) => {
    const ms = +tradeTime(t);
    return ms >= period.from && ms < period.to;
  });
  const closed = inP.filter((t) => t.result !== "open");
  // a review follows the close: an open trade cannot be reviewed yet and must not pull the journaling rate down
  return goalActual(goal.metric, goal.scope, { closed, list: goal.metric === "journalRate" ? closed : inP, events: p.events, settings: p.settings });
}

const metOf = (goal: Goal, v: number | null): boolean | null => {
  if (v == null) return null;
  if (goal.metric === "custom") return v === 1;
  return goal.comparator === "atLeast" ? v >= goal.target - 1e-9 : v <= goal.target + 1e-9;
};

function milestonesOf(hold: number, period: GoalPeriod, streak: number): GoalMilestone[] {
  // at most four steps (a compact rail): 1 … hold up to 4, else the quarters of the hold
  const ns = hold <= 4 ? Array.from({ length: hold }, (_, i) => i + 1) : [...new Set([Math.ceil(hold / 4), Math.round(hold / 2), Math.round((3 * hold) / 4), hold])].filter((n) => n >= 1);
  return ns.map((n) => ({ n, label: `${n} ${periodUnit(period, n)}`, reached: streak >= n }));
}

export function goalProgress(goal: Goal, p: Prepared, habits: readonly Habit[] = []): GoalProgress {
  const kind = goal.period;
  const now = p.now;
  const period = periodOf(kind, now);
  const actual = goalValue(goal, period, p, habits);
  const elapsed = Math.max(0, Math.min(1, (now - period.from) / Math.max(1, period.to - period.from)));
  const hold = holdOf(goal);
  const created = Date.parse(goal.createdAt);
  const since = Number.isFinite(created) ? created : 0;

  // complete periods, newest first, back to the creation (plus older ones for context, up to HISTORY_MAX)
  const history: PeriodResult[] = [];
  let streak = 0;
  let counting = true;
  let per = shiftPeriod(period, -1);
  for (let i = 0; i < Math.max(HISTORY_MAX, hold + 2) && i < 60; i++) {
    const v = goalValue(goal, per, p, habits);
    const met = metOf(goal, v);
    if (history.length < HISTORY_MAX) history.push({ key: per.key, short: per.short, actual: v, met });
    if (per.to <= since) counting = false;
    if (counting && met !== null) {
      if (met) streak++;
      else counting = false;
    }
    if (!counting && history.length >= HISTORY_MAX) break;
    per = shiftPeriod(per, -1);
  }
  history.reverse();

  const met = metOf(goal, actual);
  let state: GoalState;
  let ratio: number;
  if (goal.comparator === "atMost" && goal.metric !== "custom") {
    if (actual == null) {
      state = "noData";
      ratio = 0;
    } else if (met) {
      state = "onTrack";
      ratio = elapsed;
    } else {
      state = "missed";
      ratio = 0;
    }
  } else {
    // a floor at or below zero ("Woche nicht schlechter als −2 R", P14 rule for signed metrics) has no share to fill:
    // the ring is full while it holds, empty when it broke
    ratio = actual == null ? 0 : goal.metric === "custom" ? actual : goal.target <= 0 ? (met ? 1 : 0) : Math.max(0, Math.min(1, actual / goal.target));
    state = actual == null ? "noData" : met ? "met" : ratio >= 0.75 ? "onTrack" : "atRisk";
  }
  // only COMPLETE periods count: a rate can still drop and a limit can still break while the period runs
  const liveStreak = streak;
  const achieved = liveStreak >= hold;
  const overdue = !!goal.due && p.todayKey > goal.due && !achieved;
  return {
    goal,
    period,
    actual,
    ratio,
    state,
    elapsed,
    history,
    streak: liveStreak,
    hold,
    achieved,
    milestones: milestonesOf(hold, kind, liveStreak),
    measurable: goal.metric !== "custom",
    celebrate: !OUTCOME_METRICS.has(goal.metric) && goal.kind !== "outcome",
    overdue,
    valueText: goal.metric === "custom" ? (actual == null ? "offen" : actual ? "gehalten" : "verfehlt") : goalValueText(goal.metric, actual),
    targetText: `${goal.comparator === "atLeast" ? "≥" : "≤"} ${goalValueText(goal.metric, goal.target)}`,
  };
}

/** Goals in display order: reached-but-not-yet-marked first, then the ones at risk, then on track, outcome goals last. */
export function rankGoals(list: readonly GoalProgress[]): GoalProgress[] {
  const rank = (g: GoalProgress) => (g.achieved ? 0 : g.state === "missed" || g.state === "atRisk" ? 1 : g.state === "onTrack" || g.state === "met" ? 2 : 3) + (g.celebrate ? 0 : 4);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.streak / b.hold - a.streak / a.hold);
}

export interface WeekSummary {
  total: number;
  met: number;
  onTrack: number;
  atRisk: number;
  missed: number;
  daysLeft: number;
}

/** This week's goals at a glance. */
export function weekSummary(list: readonly GoalProgress[], now: number): WeekSummary {
  const week = list.filter((g) => g.goal.period === "week");
  const p = periodOf("week", now);
  return {
    total: week.length,
    met: week.filter((g) => g.state === "met").length,
    onTrack: week.filter((g) => g.state === "onTrack").length,
    atRisk: week.filter((g) => g.state === "atRisk" || g.state === "noData").length,
    missed: week.filter((g) => g.state === "missed").length,
    daysLeft: Math.max(0, Math.ceil((p.to - now) / 86_400_000)),
  };
}
