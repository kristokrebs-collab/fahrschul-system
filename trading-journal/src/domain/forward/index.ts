/**
 * Forward test (F23): virtual accounts that run a frozen "Eigene Idee" rule tree on new, closed candles from a fixed start on.
 * Pure TypeScript, no React, no I/O. The runner (candle loading, timer, saving) lives in `src/views/labor/forward`.
 */
export * from "./types";
export { forwardCfgOf, forwardOfSettings, accountOf, hasActiveForward, withAccounts, newAccount, newAccountError, startOf, cursorSig, emptyCursor, EMPTY_FORWARD, type NewAccountInput } from "./config";
export { advanceAccount, planOf, engineCfgOf, gateStrategy, strategyInOf, btTradeOf, isCoherent, validCarry, lastClosedIndex, pauseAccount, resumeAccount, endAccount, type Advance } from "./advance";
export { accountView, type AccountView, type OpenView } from "./view";
export { compareForward, backtestWindow, backtestStats, COMPARE_MIN_TRADES, LOOKBACK_DAYS, lookbackMs, type CompareRow, type ForwardCompare, type Lookback } from "./compare";
