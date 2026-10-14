/**
 * Pro-Analytics (P03) – barrel. Pure (no React, no I/O) except `mcRunner` (worker / idle scheduling).
 * The Wave-0 contract names and shapes are kept: `monteCarlo`, `riskOfRuin`, `streaks`, `expectedLongestLosingStreak`
 * and their types (consumers: P05 streak risk, P04 coach / NLQ, P07 setup comparison, P13 cockpit widgets).
 * Every metric runs on `accountView(…).closed` (time order) and aggregates with `aggregate()`, so the numbers agree
 * with the Hero and the explainers. See README.md.
 */
export * from "./stats";
export * from "./streaks";
export * from "./montecarlo";
export * from "./ratios";
export * from "./dimensions";
export * from "./breakdowns";
export * from "./excursion";
export * from "./distribution";
export * from "./rolling";
export * from "./benchmark";
export * from "./compare";
export * from "./customStats";
export * from "./heatmap";
export * from "./copy";
export { runMonteCarlo, runRiskOfRuin, isAbort, workerAllowed, WORKER_TIMEOUT_MS, type RunOptions, type McRunMode } from "./mcRunner";
