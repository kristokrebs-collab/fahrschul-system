/**
 * Pure signal engine ("Einstiegs-Check"): MCB/WaveTrend (close 9/21/2) Bottom/Top + Kauf/Verkauf, RSI 14 (Wilder)
 * near the extremes, Premium/Discount after LuxAlgo, the ladder 30m → 45m → 1h → 4h with score and strength.
 * Ported 1:1 from the other journal (`signals.ts`); no React, no I/O. Live data: `@/market` (`useSignalCheck`,
 * `checkTradeAt`, `getMcbSeries`). See README.md.
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
  type Side,
  type SignalCfg,
  type WhaleCfg,
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
} from "./verdict";
export { bucketOpen, resampleBars, withLivePrice } from "./resample";
export { mcbSeries, MAJOR_KINDS, type McbPoint } from "./series";
export { snapshot, toSignalSnapshot, parseSignalSnapshot, snapshotLadderLength, mtfAutoChecks, type MtfItem, type SignalSnap, type SignalSnapTf, type SignalSnapshot, type SignalSnapshotTf, type SignalSnapshotWhale, type SignalSnapshotWhalePeriod, type SnapshotMeta } from "./snapshot";
export * from "./copy";
export { WHALE_DRAFT_KEYS, WHALE_WEIGHTS, parseWhalePeriods, whaleToDraft, defaultWhaleDraft, whaleFromDraft, type WhaleDraft, type WhaleDraftKey, type WhaleFromDraft } from "./whaleDraft";
