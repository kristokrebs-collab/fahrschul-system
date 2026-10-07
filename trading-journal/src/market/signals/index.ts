/** Live / retro "Einstiegs-Check" on market data. See `src/market/README.md` § Signal check. */
export {
  getSignalSnapshot,
  subscribeSignalCheck,
  getSignalConfig,
  setSignalConfig,
  refreshSignalCheck,
  runSignalCheck,
  getMcbSeries,
  getSignalCandles,
  signalsKey,
  toTradeSnapshot,
  SIGNAL_MIN_INTERVAL_MS,
  SIGNAL_HIDDEN_INTERVAL_MS,
  LIVE_PRICE_MAX_AGE_MS,
  type SignalCheckState,
  type SignalCheckStatus,
  type LiveSignals,
  type McbMarker,
} from "./engine";
export { useSignalCheck } from "./hooks";
export { checkTradeAt, retroCheck, RETRO_PAGE_MAX, type RetroResult, type RetroStatus } from "./retro";
export { requestSignalNotifyPermission, signalNotifyPermission, SIGNAL_LAST_KEY, SIGNAL_HOLD_MS, SIGNAL_TOAST_MS, type NotifyPermission } from "./notify";
export { tfSource, type TfSource } from "./bars";
