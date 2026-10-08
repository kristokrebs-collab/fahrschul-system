/**
 * Pure signal engine ("Einstiegs-Check"): MCB/WaveTrend (close 9/21/2) Bottom/Top + Kauf/Verkauf, RSI 14 (Wilder)
 * near the extremes, Premium/Discount after LuxAlgo, the ladder 30m → 45m → 1h → 4h with score and strength.
 * Core ported 1:1 from the other journal (`signals.ts`); ours on top: candle-close states (vorläufig / bestätigt /
 * stark bestätigt), graded parts (Top-Trader-Kombi, divergences, support / resistance), the falling-knife filter.
 * No React, no I/O. Live data: `@/market` (`useSignalCheck`, `checkTradeAt`, `getMcbSeries`, `getDivergences`,
 * `getStructure`). See README.md.
 */
export {
  DEFAULT_SIGNAL_CFG,
  SIGNAL_TFS,
  STRENGTH_LABEL,
  SIGNAL_BARS,
  MIN_SIGNAL_BARS,
  tfSeconds,
  sanitizeSignalCfg,
  signalCfgKey,
  DEFAULT_WHALE_CFG,
  WHALE_PERIODS,
  WHALE_MIN_RUN_MAX,
  WHALE_WEIGHT_MAX,
  sanitizeWhaleCfg,
  whaleCfgOf,
  WHALE_RETAIL_PERIODS,
  DEFAULT_STRONG_CLOSES,
  STRONG_CLOSES_MAX,
  strongClosesCap,
  PART_WEIGHT_MAX,
  DEFAULT_DIV_CFG,
  DEFAULT_SR_CFG,
  sanitizeDivCfg,
  sanitizeSrCfg,
  divCfgOf,
  srCfgOf,
  strongClosesOf,
  type Side,
  type SignalCfg,
  type WhaleCfg,
  type DivCfg,
  type SrCfg,
} from "./config";
export {
  whalePeriod,
  whaleReading,
  whaleVerdict,
  applyWhale,
  whaleReasonText,
  WHALE_TITLE,
  WHALE_FRESH_PERIODS,
  WHALE_STRENGTH_NOTE,
  type RatioSample,
  type WhaleSeries,
  type WhalePeriod,
  type WhaleReading,
  type WhaleVerdict,
} from "./whale";
export { ema, sma, rma, rsi, waveTrend, type Bar } from "./indicators";
export { wtSignal, mcbEvents, isLongKind, WT_RANK, type WtKind, type WtEvent, type WtSignal, type McbBarEvent } from "./mcb";
export { zoneOf, pdZone, luxZone, PD_FALLBACK_BARS, type Zone, type ZoneInfo, type ZoneBreak } from "./zones";
export {
  checkTf,
  verdict,
  bestVerdict,
  confirmVerdict,
  gradeSignals,
  regradeSignals,
  rungState,
  PROVISIONAL_PREFIX,
  computeSignals,
  signalsAt,
  closedAt,
  covers,
  LIVE_WINDOW_MS,
  type TfCheck,
  type Verdict,
  type VerdictReason,
  type BestVerdict,
  type Signals,
  type Strength,
  type BarsByTf,
  type SignalInputs,
  type Graded,
} from "./verdict";
export {
  rungConf,
  eventState,
  isForming,
  lastCloseAt,
  isSignalState,
  isConfirmedState,
  mmss,
  provisionalText,
  stateText,
  STATE_RANK,
  STATE_TEXT,
  SIGNAL_STATES,
  PROVISIONAL_FACTOR,
  NO_CONF,
  type SignalState,
  type RungConf,
} from "./state";
export { findDivergences, tfDivergences, divGrade, DIV_MIDLINE, type Divergence, type DivPivot, type DivOsc, type DivKind, type TfDivergences } from "./divergence";
export {
  marketStructure,
  lastInternalPivot,
  atr,
  type Structure,
  type StructureCfg,
  type SwingPoint,
  type SwingLabel,
  type StructureBreak,
  type OrderBlock,
  type EqualLevel,
  type Level,
  type LevelKind,
} from "./structure";
export { traderReading, TRADER_STEP_MS, TRADER_FRESH_STEPS, TRADERS_TITLE, TRADERS_SIDE_TITLE, type TraderSeries, type TraderReading } from "./traders";
export { tradersPart, divPart, srPart, divHitsText, partReasonText, verdictPart, SR_STOP_ATR, type GradedPart, type PartItem, type PartId } from "./parts";
export { knifeFilter, knifeStructure, KNIFE_TFS, KNIFE_BREAK_MAX_AGE, KNIFE_TITLE, KNIFE_INFO, type KnifeFilter, type KnifeItem, type KnifeId } from "./knife";
export { bucketOpen, resampleBars, withLivePrice } from "./resample";
export { mcbSeries, MAJOR_KINDS, type McbPoint } from "./series";
export {
  snapshot,
  toSignalSnapshot,
  parseSignalSnapshot,
  snapshotLadderLength,
  snapshotPart,
  snapshotState,
  mtfAutoChecks,
  type MtfItem,
  type SignalSnap,
  type SignalSnapTf,
  type SignalSnapshot,
  type SignalSnapshotTf,
  type SignalSnapshotWhale,
  type SignalSnapshotWhalePeriod,
  type SignalSnapshotPart,
  type SignalSnapshotPartItem,
  type SignalSnapshotKnife,
  type SnapshotMeta,
} from "./snapshot";
export * from "./copy";
export { WHALE_DRAFT_KEYS, WHALE_WEIGHTS, parseWhalePeriods, whaleToDraft, defaultWhaleDraft, whaleFromDraft, type WhaleDraft, type WhaleDraftKey, type WhaleFromDraft, type StoredWhale } from "./whaleDraft";
