/**
 * Zeitmaschine (trader-timemachine): types and constants. Pure data, JSON-safe (the job runs in a Web Worker, so the
 * input and the result travel through `postMessage`). Bars are the backtest engine's `Bar` (`t` = open time in UNIX
 * SECONDS); every time in a result is epoch MILLISECONDS; R = result ÷ the planned risk of the trade (entry → stop).
 */
import type { Bar, BtSide, CostModel, ExitReason } from "../backtest/types";

export type { Bar, BtSide, CostModel, ExitReason };

/** Candle lengths the Zeitmaschine knows (seconds in `TM_SEC`). 5m / 1m serve stock data, the rest the crypto lab. */
export type TmInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1d";

export const TM_SEC: Readonly<Record<TmInterval, number>> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14_400, "1d": 86_400 };
export const isTmInterval = (s: unknown): s is TmInterval => typeof s === "string" && Object.prototype.hasOwnProperty.call(TM_SEC, s);

/** Plain-language names of the intervals ("4 Stunden"). */
export const TM_INTERVAL_TEXT: Readonly<Record<TmInterval, string>> = { "1m": "1 Minute", "5m": "5 Minuten", "15m": "15 Minuten", "30m": "30 Minuten", "1h": "1 Stunde", "2h": "2 Stunden", "4h": "4 Stunden", "1d": "1 Tag" };

/** The plan: direction, entry (a price), stop, target – all prices of the market, nothing is sized. */
export interface TmPlan {
  side: BtSide;
  entry: number;
  stop: number;
  target: number;
}

/**
 * How earlier occasions are found (part b). The plan's prices are turned into a RULE that can be applied to every past candle:
 * - `close`: the same distances, in ATR(14), from the close of every candle – the order is re-placed at every close (valid for `validBars` candles);
 * - `range`: the entry keeps its place inside the range of the last `lookback` candles (0 = low, 1 = high; above 1 = breakout), stop and target keep their ATR distances;
 * - `level`: the entry price stays what it is – every time the price came to it from the side it came from at plan time.
 * One position at a time in all three (the next occasion is looked for after the exit).
 */
export type TmTrigger = { kind: "close" } | { kind: "range"; lookback: number } | { kind: "level" };

/** Optional management of the position, as the backtest engine knows it (decided at candle closes, in force from the next candle). */
export interface TmManage {
  /** after the best price reached +x R the stop moves to the entry; null = off */
  breakEvenR: number | null;
  /** ATR(14) multiple trailing behind the best price; null = off */
  trailAtr: number | null;
  /** the trailing stop starts once +x R was reached (0 = from the first close) */
  trailFromR: number;
}

export type TmMethod = "block" | "single";

export interface TmOptions {
  /** simulated sessions */
  runs: number;
  /** PRNG seed – same seed, same numbers, on any machine */
  seed: number;
  /** time stop = length of one session in candles */
  horizon: number;
  /** `block`: runs of consecutive real candles are drawn (keeps volatility clustering); `single`: one candle at a time */
  method: TmMethod;
  blockLen: number;
  /** `keep`: the drift of the history flows in; `zero`: it is taken out (a neutral market) */
  drift: "keep" | "zero";
  /** `now`: the real candles are scaled to today's volatility (the last full day); `history`: they stay as they were */
  vol: "now" | "history";
  trigger: TmTrigger;
  /** a re-placed order of the history search is valid for this many candles */
  validBars: number;
  manage: TmManage;
}

export interface TmInput extends TmOptions {
  symbol: string;
  plan: TmPlan;
  /** closed candles, ascending */
  bars: readonly Bar[];
  interval: TmInterval;
  costs: CostModel;
  /** open time (ms) of the first simulated candle; null = the candle after the last one given */
  startMs: number | null;
}

export type TmPhase = "pool" | "sim" | "fan" | "history" | "summary" | "done";

export const TM_PHASE_LABEL: Readonly<Record<TmPhase, string>> = {
  pool: "Kerzen vorbereiten",
  sim: "Sitzungen simulieren",
  fan: "Fächer berechnen",
  history: "Frühere Vorfälle suchen",
  summary: "Auswerten",
  done: "Fertig",
};

/* ------------------------------------------------------------------------------------------------ constants */

export const TM_RUNS = 10_000;
/** The skill's default seed – shown with every result so a run can be repeated. */
export const TM_SEED = 19;
/** Fewer usable candles than this: no simulation (the time-of-day pools would be empty). */
export const MIN_POOL_BARS = 200;
/** A time-of-day pool with fewer candles than this is widened (±1, ±2 … slots) – and said so when it stays thin. */
export const MIN_SLOT_BARS = 30;
/** Fewer resolved earlier occasions than this: shown as examples, no percentages, no comparison. */
export const MIN_EVENTS = 20;
/** From this many occasions on the shares are shown (with their interval). */
export const MIN_EVENTS_SHARES = 10;
export const MAX_HORIZON = 400;
export const SAMPLE_PATHS = 36;
export const BLOCK_LEN = 6;
export const VALID_BARS = 4;
/** Cap of the stored fan cells (runs × steps); above it the bands use the first runs only. */
export const FAN_CELL_CAP = 4_000_000;
/** The engine's minimum stop distance (`MIN_RISK_FRAC`) with a margin for the entry slippage. */
export const MIN_STOP_FRAC = 0.0006;

/** Default session length in candles per interval (about 1–2 days, 30 days for daily candles). */
export const DEFAULT_HORIZON: Readonly<Record<TmInterval, number>> = { "1m": 240, "5m": 78, "15m": 96, "30m": 96, "1h": 48, "2h": 48, "4h": 42, "1d": 30 };

export const NO_MANAGE: TmManage = { breakEvenR: null, trailAtr: null, trailFromR: 1 };

export function defaultOptions(interval: TmInterval): TmOptions {
  return { runs: TM_RUNS, seed: TM_SEED, horizon: DEFAULT_HORIZON[interval], method: "block", blockLen: BLOCK_LEN, drift: "keep", vol: "now", trigger: { kind: "close" }, validBars: VALID_BARS, manage: { ...NO_MANAGE } };
}

/* ------------------------------------------------------------------------------------------------ results */

/** A share with its 95 % Wilson interval (`k` of `n`). */
export interface Prob {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

/** Quartiles of a count (candles) – `null` when there is nothing to take them from. */
export interface Quart {
  n: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface Mean {
  n: number;
  mean: number;
  sd: number;
  /** 95 % interval of the mean */
  lo: number;
  hi: number;
}

export interface HistBin {
  lo: number;
  hi: number;
  n: number;
}

export interface Hist {
  bins: HistBin[];
  width: number;
}

export type FanBand = "p5" | "p25" | "p50" | "p75" | "p95";

/** One drawn path: the closes in R from the entry (index 0 = entry = 0 R), where and how the trade ended. */
export interface FanPath {
  r: number[];
  /** candle index (1-based) of the exit, null = open until the end */
  exit: number | null;
  kind: "target" | "stop" | "moved" | "neither";
}

export interface TmFan {
  /** 0 … horizon */
  steps: number[];
  bands: Record<FanBand, number[]>;
  paths: FanPath[];
  /** runs the bands rest on (all, or the first ones above `FAN_CELL_CAP`) */
  bandRuns: number;
}

export interface TmCases {
  worst: number;
  p5: number;
  median: number;
  mean: number;
  p95: number;
  best: number;
}

/** The shares of one set of trades (simulated or real). `moved` = stopped out at a moved stop (break-even / trailing). */
export interface TmShares {
  target: Prob;
  stop: Prob;
  neither: Prob;
  moved: Prob;
}

export interface TmSim extends TmShares {
  runs: number;
  /** runs the engine did not trade (should be 0) */
  skipped: number;
  horizon: number;
  expectancy: Mean;
  /** fees + slippage + funding per trade in R (positive = cost) */
  costR: number;
  cases: TmCases;
  hist: Hist;
  /** candles until the exit among the trades that ended at the target / the stop */
  timeTarget: Quart | null;
  timeStop: Quart | null;
  /** largest move against the position before the exit, in R */
  maeAll: Quart | null;
  maeTarget: Quart | null;
  /** price at the end of the session relative to the entry, in R (all runs, the session runs to its end whatever the trade did) */
  endR: { p5: number; p50: number; p95: number; /** share of the runs whose end price lies above the entry (in the trade's direction) */ above: number };
  ambiguous: number;
  fan: TmFan;
}

export interface TmEvent {
  /** index (in the bars) of the entry candle – the candle in which the position was opened – and the entry time / price */
  i: number;
  entryT: number;
  entry: number;
  stop: number;
  target: number;
  kind: "market" | "limit" | "stop";
  exitT: number;
  /** candles in the trade (entry candle included) */
  bars: number;
  reason: ExitReason;
  r: number;
  /** largest move against / for the position in R of the original risk */
  mae: number;
  mfe: number;
  ambiguous: boolean;
}

export interface TmHistory extends TmShares {
  trigger: TmTrigger;
  /** found occasions that ended before the data ended */
  n: number;
  /** orders that filled but were still open when the data ended (left out) */
  openAtEnd: number;
  /** orders that did not fill within their validity */
  unfilled: number;
  /** signals the engine skipped (open beyond stop / target) */
  skippedGap: number;
  expectancy: Mean | null;
  timeTarget: Quart | null;
  timeStop: Quart | null;
  maeAll: Quart | null;
  maeTarget: Quart | null;
  ambiguous: number;
  /** all resolved occasions, oldest first */
  events: TmEvent[];
  fromMs: number;
  toMs: number;
}

export interface TmCompareRow {
  id: "target" | "stop" | "neither" | "expectancy";
  label: string;
  sim: number;
  hist: number | null;
  /** hist − sim */
  diff: number | null;
  unit: "%" | "R";
  /** the simulation lies outside the interval of the history AND the gap is big */
  off: boolean;
}

export interface TmCompare {
  /** `unavailable`: too few occasions, no comparison */
  status: "ok" | "unavailable";
  reason: string | null;
  rows: TmCompareRow[];
  warn: boolean;
  text: string;
}

export type TmVerdictTone = "win" | "loss" | "warn" | "mute";

export interface TmVerdict {
  id: "coin" | "breakeven" | "target" | "stop" | "strongTarget" | "strongStop" | "none";
  tone: TmVerdictTone;
  text: string;
  /** extra lines under the verdict (many runs ended neither / the average R points the other way) */
  lines: string[];
  /** share of target first among the runs that hit a side, and the share a break-even needs */
  decided: { share: number; needs: number } | null;
}

export interface TmNote {
  id: string;
  level: "info" | "warn";
  text: string;
}

export interface TmResult {
  v: 1;
  symbol: string;
  plan: TmPlan;
  interval: TmInterval;
  seed: number;
  options: TmOptions;
  /** the fees, slippage and funding the engine charged */
  costs: CostModel;
  /** R of the target in R of the planned risk */
  targetR: number;
  /** the time-of-day pool: candles used, slots, radius range, thinnest slot */
  pool: { bars: number; slots: number; radiusMin: number; radiusMax: number; thinnest: number; fromMs: number; toMs: number; driftPerBar: number; volRatio: number | null; volScale: { mean: number; min: number; max: number } | null };
  sim: TmSim;
  history: TmHistory;
  compare: TmCompare;
  verdict: TmVerdict;
  notes: TmNote[];
  /** the plan: the distances the history search keeps (ATR units) */
  relative: { atr: number; stopAtr: number; targetAtr: number; entryOffsetAtr: number; rangePos: number | null; kind: "market" | "limit" | "stop" };
}

/** Why a run cannot start (German, shown as is). */
export interface TmRefusal {
  ok: false;
  why: string;
}
