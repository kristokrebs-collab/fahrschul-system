/**
 * "Auswertung" metrics (Tradezella-style evaluations) – pure, no React. Every card takes the closed trades of the
 * current account view (`accountView().closed`, already in trade-time order) and aggregates with `aggregate()`, so
 * its numbers agree with the Hero, the explainers and every other view. See README.md.
 */
export { dayKeyOf, dayFromKey, groupByDay, accountOf, clamp, piecewise, mean, wilson, Z80, compact, mode, byTime } from "./shared";
export {
  calendarMonth,
  monthRange,
  initialMonth,
  unitValue,
  dayView,
  adjacentTradedDays,
  addMonths,
  ymKey,
  ymOf,
  ymIndex,
  monthTitle,
  p90,
  WEEKDAY_SHORT,
  MONTHS_LONG,
  type YearMonth,
  type CalendarUnit,
  type DayCell,
  type WeekRow,
  type CalendarMonth,
  type CalendarOptions,
  type DayView,
} from "./calendar";
export {
  edgeScore,
  edgeScoreUntil,
  edgeTimeline,
  equityDrawdown,
  dailyNets,
  scorePF,
  scorePayoff,
  scoreDrawdown,
  scoreWinRate,
  scoreRecovery,
  scoreConsistency,
  recoveryFactor,
  bestDayShare,
  EDGE_WEIGHTS,
  EDGE_ORDER,
  EDGE_LABELS,
  EDGE_MIN_TRADES,
  EDGE_WIN_TARGET,
  PF_ANCHORS,
  RF_ANCHORS,
  type EdgeAxis,
  type EdgeAxisKey,
  type EdgeResult,
  type EdgeInput,
  type EdgePoint,
} from "./edge";
export { mistakeReport, autoMistakes, manualMistakes, tradeMistakes, AUTO_MISTAKES, AUTO_RULES, type MistakeRow, type MistakeReport, type TradeMistakes } from "./mistakes";
export { snapOf, strengthRows, conditionEffects, STRENGTH_ORDER, NO_CHECK_LABEL, CONDITION_LABELS, CONDITION_ORDER, type StrengthKey, type StrengthRow, type StrengthResult, type ConditionEffect } from "./signal";
export {
  disciplineSummary,
  disciplineDays,
  disciplineLimits,
  disciplineStreak,
  disciplineAvg,
  scoreDay,
  heatMap,
  heatLevel,
  ruleLabel,
  RULE_HINTS,
  RULE_ORDER,
  DEFAULT_LIMITS,
  STREAK_MIN,
  type DisciplineLimits,
  type DisciplineDay,
  type DisciplineSummary,
  type DisciplineInput,
  type RuleKey,
  type RuleResult,
  type RuleRate,
  type HeatCell,
} from "./discipline";
export { sessionOf, byWeekday, bySession, byHour, bucketSummary, SESSIONS, BUCKET_MIN_N, type SessionKey, type TimeBucket, type BucketSummary } from "./time";
export { rDistribution, drawdownReport, rBinIndex, R_BIN_DEFS, BIG_LOSS_R, type RBin, type RDistribution, type DrawdownReport, type DrawdownInput, type UnderwaterPoint, type UnderwaterPhase } from "./risk";
export { winnersVsLosers, TEXT_DIFF, type CompareRow, type CompareKey, type WinLossReport } from "./winloss";
export { findings, findingCandidates, FINDING_MIN_N, FINDING_MIN_DWIN, FINDING_MIN_IMPACT_PCT, REVENGE_MINUTES, OVERTRADING_PER_DAY, type Finding, type FindingKey } from "./findings";
export { recap, recapFor, periodRange, recapSentence, RECAP_MIN_TRADES, type Recap, type RecapKind, type RecapInput, type PeriodRange, type RecapDay } from "./recap";
export * from "./copy";
