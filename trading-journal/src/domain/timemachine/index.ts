/**
 * `@/domain/timemachine` – the Zeitmaschine (trader-timemachine): one trade plan played through 10 000 simulated sessions and
 * through every earlier occasion on the real candles, both with the backtest engine's rules and costs. Pure, deterministic,
 * no language model. See README.md. Import the heavy parts (the job, the runner) only where they are used.
 */
export * from "./types";
export { checkInput, checkPlan, isRefusal, orderKind, parseCount, parsePrice, rangeOf, relativeOf, riskOf, targetROf, triggerText, sameRun, fmtPx, MARKET_BAND_ATR, RANGE_TOL, type OrderKind, type Relative } from "./plan";
export { buildPool, slotOf, slotsPerDay, type Pool } from "./pool";
export { runSeed, SimJob, type SimOut } from "./sim";
export { HistoryJob } from "./history";
export { createTmJob, runTimeMachineSync, type TmJob } from "./job";
export { createTmHost, PROGRESS_MS, SLICE_DESKTOP, SLICE_MOBILE, type TmHost, type TmHostEnv, type TmRequest, type TmResponse, type TmSlice } from "./host";
export { runTimeMachine, runTimeMachineIdle, isTmAbort, sliceForDevice, tmWorkerAllowed, TM_WORKER_SILENCE_MS, __resetTmRunner, type TmRunMode, type TmRunOptions } from "./tmRunner";
export { compareOf, durationText, notesOf, pc, pc0, planLine, rPlain, rr, summaryLines, verdictOf, count, LEAN, STRONG, OFF_R, OFF_SHARE } from "./texts";
export { histogram, meanOf, prob, quantile, quart, tCrit95 } from "./stats";
