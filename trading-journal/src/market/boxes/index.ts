/**
 * Live Box-zu-Box layer (P02): the running box store (4h / 1D / 1W, closed candles, live price for the pending state),
 * the alerts (toast + optional notification at a candle close), the watchlist scanner (own budget, A+ / A only) and the
 * trade snapshot contract. The pure engine lives in `@/domain/boxes`. See `src/market/README.md` → "Box-zu-Box".
 */
export {
  BOX_FEED,
  BOX_HISTORY_4H,
  BOX_LIVE_MS,
  BOX_MAX_BARS,
  BOX_MIN_BARS,
  BOXES_STRINGS,
  closedKeyOf,
  getBoxBars,
  getBoxes,
  retainBoxes,
  subscribeBoxes,
  useBoxes,
  type BestSetup,
  type BoxesState,
  type BoxesView,
  type BoxTfView,
} from "./store";
export { ALERT_PHASES, BOX_ALERTS_KEY, BoxAlertHost, evaluateBoxes, phaseAlertText, startBoxAlerts, useRecentBoxAlerts, type BoxAlert } from "./alerts";
export {
  SCAN_BUDGET,
  SCAN_JITTER_MS,
  SCAN_LIMIT,
  SCAN_STRINGS,
  getScan,
  lastClosedOpen,
  nextScanAt,
  retainScanner,
  scanNow,
  scanSymbol,
  subscribeScan,
  useScan,
  type ScanRow,
  type ScanState,
  type ScanTf,
  type ScanView,
} from "./scanner";
export { RESOLVE_TIMEOUT_MS, barOpenOf, boxGradeOf, closedBefore, parseBoxSnapshot, resolveTradeBoxes, toBoxSnapshot, tradeDateMs, type BoxSnapshot, type BoxTf, type ResolveBoxesOptions } from "./snapshot";
