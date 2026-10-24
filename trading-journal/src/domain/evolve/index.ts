/**
 * Background optimiser (Hintergrund-Optimierer): improves strategies (rule sets of the lab) step by step and checks itself so it
 * does not fit chance. Pure TypeScript (no React, no I/O) except `runner.ts` / `environment.ts` (worker, timers, browser sensors).
 * Import from `@/domain/evolve` only where it is needed – the optimiser is a lazy chunk. See README.md.
 */
export * from "./types";
export { mutate, mutateWeighted, mutateChain, allowedKinds, lightOnly, freedomOf, searchIntervals, searchWarmupMs, LIGHT_KINDS, type MutationCtx, type Freedom } from "./mutations";
export { evolveWindows, MIN_WINDOW_BARS, type EvolveWindows, type Win, type WindowResult } from "./windows";
export { metricsOf, robustScore, chronological, capR, scoredR, scoredPnl, riskMoney, fundingIncome, R_CAP, type TradeFacts, MIN_TEST_TRADES, WARN_TRADES, DD_WEIGHT, COMPLEXITY_W } from "./score";
export { realityCheck, inflateForPrior, naiveP, overfitLevel, holdoutFloor, HOLDOUT_MIN_TRADES, RC_BOOT, RC_SD_FLOOR, type RcResult } from "./significance";
export { allNeighbors, neighborsOf, plateauOf, isPlateau, NEIGHBOUR_SHARE, PLATEAU_MIN, type Neighbor } from "./plateau";
export { Evaluator, signalKey, type EvalEnv } from "./evaluate";
export { EvolveJob, DEFAULT_OPTS, mixSeed } from "./search";
export { EvolveMulti, MAX_STRATEGIES, SLICE_MS, RANK_MIN_TRADES } from "./multi";
export { buildDraft, proposalWarnings, changeLines, expectedOf } from "./proposal";
export { weightOf, weightsOf, recordDecision, recordOutcome, emptyKind, MIN_WEIGHT, MAX_WEIGHT, type KindStats, type LearnMap } from "./learn";
export { liveCheck, liveFactsOf, MIN_LIVE_DAYS, MIN_LIVE_TRADES, type LiveCheck, type LiveFacts, type LiveLevel } from "./selfcheck";
export { learnedSummary, MIN_DECISIONS, MIN_LIVE_VERDICTS, MIN_KIND, type LearnedSummary, type KindRow, type Rate } from "./learned";
export { evolveCfgOf, evolveOfSettings, withEvolve, proposalOf, trimProposals, effectivePrior, nextLineage, EMPTY_EVOLVE, EMPTY_STATS, MAX_PROPOSALS, MAX_OPEN, MAX_REASON, type EvolveSettings, type EvolveStats, type Lineage, type Power, type EvolvePatch } from "./config";
export { appendEntries, parseBook, bookToJson, EMPTY_LOG, LOG_MAX, KEEP_TOP, type StoredLog, type LogBook } from "./protocol";
export { throttleFor, restAfter, DEFAULT_THROTTLE, type Throttle, type ThrottleEnv } from "./throttle";
export { createEvolveHost, PROGRESS_MS, type EvolveRequest, type EvolveResponse, type RunState, type HostEnv, type Host } from "./host";
export { startEvolve, evolveWorkerAllowed, type EvolveRun, type EvolveOutcome, type RunHandlers, type RunOptions } from "./runner";
