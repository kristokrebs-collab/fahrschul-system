/**
 * Pure signal engine ("Einstiegs-Check"): MCB/WaveTrend (close 9/21/2) Bottom/Top + Kauf/Verkauf, RSI 14 (Wilder)
 * near the extremes, Premium/Discount after LuxAlgo, the ladder 30m → 45m → 1h → 4h with score and strength.
 * Ported 1:1 from the other journal (`signals.ts`); no React, no I/O. Live data: `@/market` (`useSignalCheck`,
 * `checkTradeAt`, `getMcbSeries`). See README.md.
 */
export { DEFAULT_SIGNAL_CFG, SIGNAL_TFS, STRENGTH_LABEL, SIGNAL_BARS, MIN_SIGNAL_BARS, tfSeconds, sanitizeSignalCfg, signalCfgKey, type Side, type SignalCfg } from "./config";
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
export { snapshot, toSignalSnapshot, parseSignalSnapshot, snapshotLadderLength, mtfAutoChecks, type MtfItem, type SignalSnap, type SignalSnapTf, type SignalSnapshot, type SignalSnapshotTf, type SnapshotMeta } from "./snapshot";
export * from "./copy";
