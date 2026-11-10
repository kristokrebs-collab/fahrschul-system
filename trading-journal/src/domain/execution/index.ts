/**
 * Ausführbarkeit (F44): spread, depth and the price of a market order of a given size, from one order-book snapshot – held
 * against the slippage a plan assumed. Pure; the snapshot is fetched in `@/market/execution`, the card is
 * `@/views/plan/ExecutionCheck`. See README.md.
 */
export { bandOf, bookOf, marketImpact, touchOf, walk, type Band, type Book, type Fill, type Impact, type Level, type Touch } from "./book";
export {
  BAND_PCTS,
  SPREAD_NORMAL_BPS,
  SPREAD_TIGHT_BPS,
  SPREAD_WIDE_BPS,
  TURNOVER_HUGE,
  TURNOVER_LARGE,
  checkExecution,
  spreadWord,
  type ExecCheck,
  type ExecInput,
  type Finding,
  type FindingId,
  type SpreadWord,
  type Tone,
} from "./check";
