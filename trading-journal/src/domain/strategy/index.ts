/**
 * Strategy management (P07): the strategy description of an Entscheidungsgrundlage (passthrough extras on
 * `settings.setups`), automatic classification, conformity / exit fidelity, comparison with intervals, the library
 * filter and best-practice examples. Pure, no React, no I/O. See README.md.
 */
export {
  strategyOf,
  withStrategy,
  cleanStrategy,
  cleanCriteria,
  hasStrategyData,
  extrasOf,
  extrasKey,
  marketKey,
  EMPTY_RISK,
  EMPTY_AUTO,
  STOP_RULE_LABEL,
  type SetupX,
  type StrategyExtras,
  type CriteriaItem,
  type RiskModel,
  type AutoRule,
  type StopRule,
} from "./types";
export { classifyTrade, KIND_TEXT as BOX_KIND_TEXT, SESSION_TEXT, classifyUntagged, historyModel, levelOf, LEVEL_MIN, type Suggestion, type BulkSuggestion, type ConfidenceLevel, type ClassifyOptions, type HistoryModel, type Reason as ClassifyReason } from "./classify";
export {
  tradeConformity,
  strategyConformity,
  exitFollowed,
  planBreakers,
  CONFORMITY_WEIGHTS,
  CONFORMITY_LABEL,
  PLAN_EXITS,
  EXIT_TOL_R,
  STOP_BREACH_R,
  CONFORM_MIN,
  type TradeConformity,
  type StrategyConformity,
  type ConformityPart,
  type ExitVerdict,
} from "./conformity";
export { compareStrategies, COMPARE_MIN, type StrategyRow, type StrategyComparison } from "./compare";
export { matchesLibrary, libraryFacets, isFilterActive, EMPTY_LIBRARY_FILTER, type LibraryFilter } from "./library";
export { examplesOf, EXAMPLES_MAX, type ExampleSet } from "./examples";
