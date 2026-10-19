/**
 * Preis- und RSI-Struktur über Zeiteinheiten (F05): the data model of the diagonal trendlines. Pure types and the
 * defaults – no React, no I/O.
 *
 * - `down` = Abwärtstrendlinie: through FALLING pivot highs (resistance). Broken when a candle CLOSES above it.
 * - `up`   = Aufwärtstrendlinie: through RISING pivot lows (support). Broken when a candle CLOSES below it.
 *
 * The same algorithm runs on two series: the price (highs / lows, tolerances in ATR) and the RSI (tolerances in RSI
 * points). Approach, break and retest are three separate facts of a line, never one fuzzy "signal".
 */
import type { KeyTf } from "../keylevels/types";

export type TrendSeries = "price" | "rsi";
export type TrendKind = "down" | "up";

/** Index (bar) and value (price or RSI) of a swing point. */
export interface TrendPivot {
  i: number;
  v: number;
}

/** A line through two confirmed pivots. All indices refer to the CLOSED candle series it was found in. */
export interface TrendLine {
  kind: TrendKind;
  a: TrendPivot;
  b: TrendPivot;
  /** value units per bar */
  slope: number;
  touches: number;
  /**
   * First bar at which the second pivot is KNOWN (`b.i + pivotR`): the line does not exist before the close of this
   * candle – nothing on it is read from the future.
   */
  confirmedAt: number;
  /** first bar that closed beyond the line (index), `null` = unbroken */
  brokeAt: number | null;
}

/** What happened after a break: the price comes back to the broken line and holds, or it does not. */
export type RetestState =
  /** no touch yet, still inside the window */
  | "none"
  /** the price touched the broken line, the closing confirmation is still missing */
  | "pending"
  /** touched and a candle closed beyond the line again */
  | "held"
  /** a candle closed back on the old side of the line: the break was taken back */
  | "failed"
  /** no touch within the window – the price left without a retest */
  | "expired";

export interface TrendRetest {
  state: RetestState;
  touchedAt: number | null;
  heldAt: number | null;
  failedAt: number | null;
}

/** Tolerances and thresholds of the two series. Price: multiples of the ATR; RSI: points. */
export interface TrendlineCfg {
  /** bars left / right of a swing; a pivot is known `pivotR` bars later */
  pivotL: number;
  pivotR: number;
  /** bars searched for pivots */
  lookback: number;
  /** pivots closer than this cannot span a line */
  minGap: number;
  /** newest pivots paired */
  maxPivots: number;
  /** the break counts as fresh for this many bars */
  maxAge: number;
  /** a broken line is kept for this many bars */
  keepBars: number;
  /** bars after the break in which a touch counts as the retest */
  retestBars: number;
  /** closed candles needed before any line is looked for */
  minBars: number;
  atrLen: number;
  price: {
    /** a close this far beyond the line (×ATR) between the two points voids the pair */
    inner: number;
    /** a close this far beyond the line (×ATR) is the break */
    brk: number;
    /** a pivot this close to the line (×ATR) is a touch */
    touch: number;
    /** the price this close to the broken line (×ATR) is the retest */
    retest: number;
    /** within this distance (×ATR) of an unbroken line = Annäherung */
    approach: number;
    /** minimum |slope| in ATR per bar: a horizontal line is a level, not a trendline */
    minSlope: number;
  };
  rsi: {
    len: number;
    inner: number;
    brk: number;
    touch: number;
    retest: number;
    approach: number;
    minSlope: number;
  };
}

export const DEFAULT_TRENDLINE_CFG: Readonly<TrendlineCfg> = {
  pivotL: 5,
  pivotR: 3,
  lookback: 160,
  minGap: 5,
  maxPivots: 14,
  maxAge: 8,
  keepBars: 30,
  retestBars: 20,
  minBars: 44,
  atrLen: 14,
  price: { inner: 0.15, brk: 0.1, touch: 0.4, retest: 0.4, approach: 1, minSlope: 0.03 },
  // the RSI numbers are those of `rsiLines` (box engine): tol 1.2, break at half of it, touch 1.6 × tol, 3 points = near
  rsi: { len: 14, inner: 1.2, brk: 0.6, touch: 1.92, retest: 1.5, approach: 3, minSlope: 0.02 },
};

/** Timeframes the structure can be read on – the key-level timeframes, i.e. what the market feed can serve. */
export type TrendTf = KeyTf;

/** One line as the card and the chart show it (indices and times of the closed candle series). */
export interface TrendLineView {
  series: TrendSeries;
  kind: TrendKind;
  tf: TrendTf;
  a: TrendPivot;
  b: TrendPivot;
  /** open times (ms) of the candles of the two points, of the confirming candle and of the break candle */
  aTime: number;
  bTime: number;
  confirmedTime: number;
  brokeTime: number | null;
  slope: number;
  touches: number;
  /** line value at the newest closed candle */
  value: number;
  /** newest closed value of the series (close / RSI) */
  last: number;
  /** distance of the newest close to the line on the side the line holds, in value units (negative = beyond the line) */
  dist: number;
  /** `dist` in % of the close (price only) and in ATR (price only) */
  distPct: number | null;
  distAtr: number | null;
  /** unbroken: within the approach distance of the line */
  approach: boolean;
  /** `null` while unbroken */
  brk: { at: number; age: number; fresh: boolean } | null;
  /** `null` while unbroken */
  retest: TrendRetest | null;
  /** index of the newest closed candle (= `brk.age` 0 means the break is on it) */
  lastIndex: number;
}

/** The unbroken line and the recently broken one of one kind (both can exist). */
export interface TrendSlot {
  active: TrendLineView | null;
  broken: TrendLineView | null;
}

export interface TrendSeriesResult {
  down: TrendSlot;
  up: TrendSlot;
}

export interface TrendlineAnalysis {
  tf: TrendTf;
  /** `few`: too few closed candles for any line – the lines are empty, never guessed */
  status: "ok" | "few";
  /** closed candles used / needed */
  bars: number;
  need: number;
  /** open time of the newest closed candle (ms), `null` without any */
  asOf: number | null;
  close: number | null;
  atr: number | null;
  /** newest RSI, `null` while it is not defined */
  rsiLast: number | null;
  price: TrendSeriesResult;
  rsi: TrendSeriesResult;
}

const EMPTY_SLOT: TrendSlot = Object.freeze({ active: null, broken: null });
export const EMPTY_SERIES: TrendSeriesResult = Object.freeze({ down: EMPTY_SLOT, up: EMPTY_SLOT });
