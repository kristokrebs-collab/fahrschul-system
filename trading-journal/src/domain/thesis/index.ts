/** Kaufthese (F69): the thesis record (`settings.theses`), scenarios through the DCF, refutation criteria and their check. See `README.md`. */
export { EMPTY_BASE, EMPTY_SCENARIO, EMPTY_THESES, newThesis, saveVersion, snapshotOfThesis, thesesCfgOf, thesesOfSettings, thesisOf, updateThesis, withTheses } from "./config";
export type { NewThesisInput, ThesisPatch } from "./config";
export { actualText, checkDue, checkThesis, criterionText, evaluateCriteria, holds, METRIC_DEFS, metricDef, metricValue } from "./criteria";
export type { CriterionEval, MetricDef, MetricUnit } from "./criteria";
export { diffSnapshots } from "./diff";
export { computeAll, computeScenario, simpleOf, versusPrice, whatMustHold } from "./scenarios";
export type { ScenarioValue } from "./scenarios";
export * from "./types";
