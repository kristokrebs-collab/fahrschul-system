/** Earnings analyst (F68): reduced SEC facts → quarters, changes, notes. See `README.md`. */
export { analyse, deltaOf, DEFAULT_QUARTERS } from "./analyse";
export type { AnalyseOptions } from "./analyse";
export { buildChanges, buildNotes } from "./changes";
export { calendarLabel, dateDe, levelText, money, NO_DATA, perShare, pctText, pointsText, quarterLabel, shareCount } from "./fmt";
export { CONSENSUS_TEXT, DEBT_RULE_TEXT } from "./texts";
export type { AnalystResult, Cell, ChangeLine, Comparison, CompareMetric, DebtCell, Delta, Derivation, Note, QuarterRow, Ttm } from "./types";
export { COMPARE_METRICS } from "./types";
