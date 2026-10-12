/**
 * Box-zu-Box engine: automatic support / resistance boxes on higher timeframes, breakout by candle close,
 * Box-zu-Box targets, diagonal RSI trendline breaks and graded setups ("trade the best"). Pure — no React, no I/O.
 * See README.md.
 */
export {
  DEFAULT_BOX_CFG,
  PHASE_LABEL,
  boxState,
  boxTargets,
  findBoxes,
  findPivots,
  srLevels,
  type Box,
  type BoxCfg,
  type BoxGrade,
  type BoxPhase,
  type BoxState,
  type Level,
  type Pivot,
  type Target,
  type TargetKind,
} from "./engine";
export { DEFAULT_RSI_LINE_CFG, lineAt, rsiLineText, rsiLines, type RsiLine, type RsiLineCfg, type RsiLineState, type RsiPivot, type RsiTone } from "./rsiLines";
export { KIND_TEXT, analyzeBoxes, boxSetups, gradeOf, type AnalyzeInput, type BoxAnalysis, type BoxSetup, type Grade, type Reason, type SetupKind, type TraderBias } from "./setups";
// P02 additions: settings sanitiser (`settings.boxes`), trade snapshot + analysis fingerprint
export {
  BIAS_LONG_PCT,
  BOX_TFS,
  BOX_TF_LABEL,
  BOX_TF_MS,
  DEFAULT_BOXES_CFG,
  DEFAULT_WATCHLIST,
  HTF_OF,
  WATCHLIST_MAX,
  biasText,
  boxesCfgKey,
  boxesCfgOf,
  gradePasses,
  normalizeWatchSymbol,
  sanitizeWatchlist,
  traderBiasOf,
  withBoxesSettings,
  type BoxTf,
  type BoxesCfg,
  type MinGrade,
} from "./config";
export { bestSetupFor, boxGradeOf, boxIdOf, boxKey, parseBoxSnapshot, r6, toBoxSnapshot, type BoxSnapshot, type ToSnapshotOptions } from "./snapshot";
// P02 box fix: where the newest box is live again after a breakout (the chart never spans the bars that closed outside)
export { reentryIndex } from "./live";
