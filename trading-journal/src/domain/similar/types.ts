/**
 * Historisch ähnliche Situationen (F19): the data model. Pure types and the defaults – no React, no I/O.
 *
 * The idea in one paragraph: the LAST closed candle of a timeframe is described by a few numbers (RSI, slope of the RSI,
 * distance to the EMAs in ATR, range / ATR, relative volume, the move of the last N candles in ATR, optional weekday /
 * session). Every earlier closed candle of the loaded period is described the same way; the ones whose description lies
 * closest, not overlapping each other, are the hits. For each hit the REAL course afterwards is measured. Similarity is
 * a description of the past, not a forecast.
 */
import type { KeyTf } from "../keylevels/types";

export type SimilarTf = KeyTf;

/** A candle as the market layer delivers it (ms, `closed` = final); volume is optional. */
export interface SimCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  closed: boolean;
  closeTime?: number;
}

export const FEATURE_IDS = ["rsi", "rsiSlope", "emaFast", "emaSlow", "range", "volume", "trend", "weekday", "session"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export interface FeatureDef {
  id: FeatureId;
  /** German name */
  label: string;
  /** German one-liner: what it measures */
  hint: string;
  /**
   * The distance of two values that counts as "one unit" of difference. FIXED numbers, not derived from the data: a
   * data-dependent scale (z-score over the whole period) would let later candles shape the description of earlier ones.
   * Categorical features count 0 (same) or 1 (different), their scale is 1.
   */
  scale: number;
  kind: "num" | "cat";
  /** part of the default set */
  on: boolean;
}

export const FEATURES: Readonly<Record<FeatureId, FeatureDef>> = {
  rsi: { id: "rsi", label: "RSI-Stand", hint: "RSI (Wilder) des Schlusskurses", scale: 10, kind: "num", on: true },
  rsiSlope: { id: "rsiSlope", label: "RSI-Steigung", hint: "RSI jetzt minus RSI vor 5 Kerzen", scale: 8, kind: "num", on: true },
  emaFast: { id: "emaFast", label: "Abstand EMA 50", hint: "(Schluss − EMA 50) in ATR", scale: 1.5, kind: "num", on: true },
  emaSlow: { id: "emaSlow", label: "Abstand EMA 200", hint: "(Schluss − EMA 200) in ATR – braucht 200+ Kerzen Vorlauf", scale: 3, kind: "num", on: false },
  range: { id: "range", label: "Range / ATR", hint: "Hoch − Tief der Kerze in ATR", scale: 0.8, kind: "num", on: true },
  volume: { id: "volume", label: "Volumen relativ", hint: "ln(Volumen ÷ Ø der letzten 20 Kerzen)", scale: 0.7, kind: "num", on: true },
  trend: { id: "trend", label: "Trend der letzten 10 Kerzen", hint: "(Schluss − Schluss vor 10 Kerzen) in ATR", scale: 3, kind: "num", on: true },
  weekday: { id: "weekday", label: "Wochentag", hint: "UTC-Wochentag der Kerze (nur Zeiteinheiten unter 1D)", scale: 1, kind: "cat", on: false },
  session: { id: "session", label: "Session", hint: "Asien / London / New York / spät / Wochenende (UTC, nur bis 2h)", scale: 1, kind: "cat", on: false },
};

/** Lengths of the indicators. Defaults are the usual ones; tests use short ones so the arithmetic can be done by hand. */
export interface SimLens {
  rsi: number;
  atr: number;
  emaFast: number;
  emaSlow: number;
  volume: number;
  slope: number;
  trend: number;
}
export const DEFAULT_LENS: Readonly<SimLens> = { rsi: 14, atr: 14, emaFast: 50, emaSlow: 200, volume: 20, slope: 5, trend: 10 };

/** `r`: 1 R = 1 ATR of the hit's candle; `pct`: percent of the hit's close. */
export type SimUnit = "r" | "pct";

export interface SimilarCfg {
  features: FeatureId[];
  /** candles after the hit that are measured (the course "danach") */
  horizon: number;
  unit: SimUnit;
  /** at most this many hits */
  maxHits: number;
  /** a candidate farther away than this is no hit (distance 1 = on average one scale unit apart per feature) */
  maxDistance: number;
  /** candles between two hits at least (never below `horizon`: the courses must not overlap) */
  minGap: number;
  lens: SimLens;
}

export const DEFAULT_SIMILAR_CFG: Readonly<SimilarCfg> = {
  features: FEATURE_IDS.filter((f) => FEATURES[f].on),
  horizon: 12,
  unit: "r",
  maxHits: 40,
  maxDistance: 1.2,
  minGap: 12,
  lens: DEFAULT_LENS,
};

/** Horizons the card offers (candles). */
export const HORIZONS = [6, 12, 24, 48] as const;

/** Fewest hits for a distribution; below it the result says „zu wenig Daten“ and shows no shares. */
export const MIN_HITS = 20;

export type FeatureValues = Partial<Record<FeatureId, number | null>>;

export type Dir = "up" | "down" | "flat";
/** Which of ±1 unit (1 R or 1 %) was reached first inside the horizon. */
export type FirstTouch = "up" | "down" | "both" | "none";

/** The real course after one hit. All distances in `unit`; `up` / `down` are excursions (never negative). */
export interface Outcome {
  /** highest high in the horizon above the hit's close, ≥ 0 */
  up: number;
  /** lowest low in the horizon below the hit's close, ≥ 0 */
  down: number;
  /** close after `horizon` candles minus the hit's close (signed) */
  change: number;
  dir: Dir;
  first: FirstTouch;
  /** candle count (1 = the candle right after the hit) at which `first` happened; null for none / both in one candle */
  firstBars: number | null;
  /** price of the hit's close and of the close after the horizon */
  ref: number;
  last: number;
}

export interface SimilarHit {
  /** index in the CLOSED candles (the situation's last candle) */
  index: number;
  /** open time of that candle, ms */
  time: number;
  /** distance to the current situation (0 = identical description) */
  distance: number;
  values: FeatureValues;
  outcome: Outcome;
}

export interface QueryInfo {
  index: number;
  time: number;
  close: number;
  values: FeatureValues;
}

export interface DroppedFeature {
  id: FeatureId;
  reason: string;
}

export interface Spread {
  median: number;
  q25: number;
  q75: number;
  mean: number;
  sd: number | null;
}

export interface Share {
  k: number;
  n: number;
  share: number;
  /** 80 % Wilson interval (the level of the Auswertung) */
  lo: number;
  hi: number;
}

export interface SimilarSummary {
  n: number;
  up: Share;
  down: Share;
  flat: Share;
  change: Spread;
  /** median excursions over the hits */
  medianUp: number;
  medianDown: number;
  /** the direction the majority of the hits went; null on a tie */
  expectation: "up" | "down" | null;
  /** hits that went the OTHER way, largest move first – all of them, none hidden */
  counters: SimilarHit[];
  /** median excursion AGAINST the majority direction (the „Rücklauf“); null without an expectation */
  medianSetback: number | null;
  /** first-touch shares of ±1 unit */
  touch: { up: number; down: number; both: number; none: number; medianBarsUp: number | null; medianBarsDown: number | null };
}

/** All candidates of the period with a complete course, regardless of similarity – the yardstick. */
export interface Baseline {
  n: number;
  up: Share;
  medianChange: number;
}

export type SimilarStatus = "ok" | "few" | "noCandles" | "noFeatures";

export interface SimilarResult {
  status: SimilarStatus;
  tf: SimilarTf;
  cfg: SimilarCfg;
  /** closed candles used / the least needed */
  bars: number;
  need: number;
  /** open time of the newest closed candle (the situation) */
  asOf: number | null;
  features: FeatureId[];
  dropped: DroppedFeature[];
  query: QueryInfo | null;
  /** candidates that were compared (complete course, all features known) */
  candidates: number;
  /** hits, nearest first */
  hits: SimilarHit[];
  /** null when `status` is not `ok` (fewer than `MIN_HITS` hits, or nothing to compare) */
  summary: SimilarSummary | null;
  baseline: Baseline | null;
}
