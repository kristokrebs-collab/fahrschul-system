/**
 * Rule-based trading coach (P04) – barrel. Pure TypeScript (no React, no I/O), deterministic and offline: behaviour
 * detectors (Wave-0 contract `events.ts`), behaviour costs, edge finder / leak detection with bootstrap intervals,
 * Benjamini-Hochberg and stability, recommendations with what-if, the improvement plan (goal drafts for P08), the
 * trading score, the behaviour profile, the review of one trade, the live watcher logic and the German question
 * parser (`./nlq`). See README.md.
 */
export * from "./events";
export { runDetectors, stopWidenings, brokenRules, DETECT, BEHAVIOR_ORDER } from "./detectors";
export * from "./behaviors";
export * from "./edges";
export * from "./recommendations";
export * from "./tradeReview";
export * from "./watch";
export * from "./copy";
export { accountOf, byEntry, closeMs, entryMs, hashSeed, sizeRatio, minutesLabel } from "./shared";
