/** Live / retro "Einstiegs-Check" on market data. See `src/market/README.md` § Signal check. */
export {
  getSignalSnapshot,
  subscribeSignalCheck,
  getSignalConfig,
  getLageConfig,
  setSignalConfig,
  refreshSignalCheck,
  runSignalCheck,
  getMcbSeries,
  getDivergences,
  getStructure,
  getChartOverlay,
  getSignalCandles,
  signalClockOffset,
  signalsKey,
  toTradeSnapshot,
  SIGNAL_MIN_INTERVAL_MS,
  SIGNAL_HIDDEN_INTERVAL_MS,
  SIGNAL_FRAME_MS,
  SIGNAL_FRAME_GRACE_MS,
  LIVE_PRICE_MAX_AGE_MS,
  type SignalCheckState,
  type SignalCheckStatus,
  type LiveSignals,
  type McbMarker,
  type ChartDivergence,
  type ChartPivot,
  type ChartStructure,
  type ChartLevel,
  type ChartOverlayData,
} from "./engine";
export { useSignalCheck } from "./hooks";
export { checkTradeAt, retroCheck, RETRO_PAGE_MAX, type RetroResult, type RetroStatus } from "./retro";
export { requestSignalNotifyPermission, signalNotifyPermission, signalBarOpen, signalNotifyDetail, SIGNAL_LAST_KEY, SIGNAL_HOLD_MS, SIGNAL_TOAST_MS, type NotifyPermission } from "./notify";
export { tfSource, type TfSource } from "./bars";
export { tradersAt, liveTraders, liveTraderSeriesOf, tradersInputKey } from "./traders";
