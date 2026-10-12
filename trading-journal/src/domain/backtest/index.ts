/**
 * Backtest lab (P07): bar-loop engine on closed bars, the real Box-zu-Box engine and MCB ladder plus a rule builder as
 * strategies, fees / funding / slippage models, in-sample / out-of-sample split, walk-forward, Deflated Sharpe,
 * PBO (CSCV) and a parameter heat map. Pure except `labRunner.ts` (schedules the job on a worker / in idle chunks) and
 * `history.ts` (paging + cache with injected I/O). See README.md.
 */
export * from "./types";
export { FEE_PRESETS, DEFAULT_FEES, DEFAULT_FUNDING_RATE, FUNDING_EVERY_MS, feePreset, feeFor, settlementsBetween, rateAt, fundingCost, type FeePreset } from "./fees";
export { DEFAULT_SLIPPAGE, SLIPPAGE_LABEL, slipDistance, slipped, slippageText } from "./slippage";
export { atrSeries, aggregateBars, toDaily, toWeekly, dayOpenS, weekOpenS, closedCount, indexAtOrAfter, gapsOf, cleanBars } from "./bars";
export { runBacktest, MIN_RISK_FRAC, type RunOptions } from "./engine";
export { runStats, maxDrawdown, dailyReturns, sharpeOf, downsample, downsampleIdx, type RunStats } from "./metrics";
export { evaluate, scoreOf, trialOf, bestTrial, oosSplit, MIN_TRADES, type Trial, type Window } from "./optimize";
export { wfLayout, wfWindow, summarizeWf, type WalkForward, type WfWindow } from "./walkForward";
export { deflatedSharpe, expectedMaxSharpe, pboOf, combinations, paramHeat, robustness, ROBUST, VERDICT_TEXT, PBO_MIN_TRADES, DSR_MIN_TRADES, type Dsr, type Pbo, type Heat, type HeatCell, type RobustVerdict, type Robustness, type RobustInput } from "./overfit";
export { loadKlines, loadFunding, estimatePages, lastClosedOpen, KLINE_PAGE, FUNDING_PAGE, CACHE_MAX_BARS, type KlinePager, type KlineQuery, type FundingPager, type SeriesStore, type LoadProgress, type Loaded } from "./history";
export { toBacktestReference, referenceLabel, STRATEGY_TITLE } from "./reference";
export { createLabJob, completeParams, strategyOf, strategyCfg, fundingModelOf, PHASE_LABEL, type LabJobInput, type LabJob, type LabPhase, type LabResult, type LabStrategyId, type SplitResult, type TrialLite, type WfWindowLite, type HeatLite, type HeatAxis } from "./job";
export { runLab, runLabIdle, labWorkerAllowed, isLabAbort, LAB_WORKER_SILENCE_MS, __resetLabRunner, type LabRunOptions, type LabRunMode } from "./labRunner";
export * from "./strategies";
