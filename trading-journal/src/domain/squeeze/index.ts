/**
 * Squeeze-Beobachtung (F07): extreme funding, strongly rising open interest and a one-sided account split – read from the
 * data archive, put next to the box phase (before / after a breakout, after a failed one), with the thresholds shown and
 * adjustable and a sample statement of how often the same lean held earlier and what followed. An observation with numbers,
 * not a signal. Pure; see README.md.
 */
export type { LsPt, OiPt, PremiumPt, Signal, SignalKey, SqueezeData, SqueezeReading, SqueezeSide, SqueezeState } from "./types";
export { DEFAULT_SQUEEZE_CFG, MIN_MET_CHOICES, OI_HOURS_CHOICES, SQUEEZE_LIMITS, SQUEEZE_VERSION, squeezeCfgOf, squeezeOfSettings, withSqueeze, type SqueezeCfg } from "./config";
export { LS_FRESH_MS, OI_FRESH_MS, accountsSignal, combine, evaluateNow, fundingSignal, lastAtOrBefore, nearestWithin, oiSignal, readingAt } from "./evaluate";
export { FUNDING_MAX_AGE_MS, historyCoverage, squeezeDataFromHistory, type HistoryRows } from "./fromHistory";
export { EPISODE_STEP_MS, HORIZONS, coverageHours, findEpisodes, sampleWord, summarize, type Episode, type Horizon, type HorizonStats, type SampleWord } from "./history";
export { TF_NAME, crowdedText, situationOf, type BoxCtx, type CtxPhase, type CtxTf, type Relation, type Situation, type Timing } from "./situation";
