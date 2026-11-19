/**
 * The description of a candle (F19): one number per feature, computed from the CLOSED candles up to and including that
 * candle – never a later one. That is the whole no-look-ahead rule and it is checked by `tests/unit/similar.features.test.ts`
 * (the table of a series cut at candle i equals the table of the full series at i, for every i).
 *
 * Every indicator here is causal by construction: Wilder RSI / ATR and the EMA are recursions over earlier candles, the
 * rolling volume mean looks back, the trend is a difference to an EARLIER close. The scales that turn the numbers into a
 * distance are fixed constants (`FEATURES[id].scale`), not statistics of the data.
 */
import { atrSeries } from "../keylevels/evaluate";
import { KEY_TF_MS } from "../keylevels/types";
import { sessionOf, type SessionKey } from "../insights/time";
import { rsi as wilderRsi } from "../signals/indicators";
import { DEFAULT_LENS, FEATURE_IDS, FEATURES, type FeatureId, type FeatureValues, type SimCandle, type SimLens, type SimilarTf } from "./types";

export type FeatureTable = Record<FeatureId, (number | null)[]>;

export interface FeatureSeries {
  table: FeatureTable;
  /** ATR as known at the close of each candle (`null` until `lens.atr + 1` candles exist) */
  atr: (number | null)[];
}

const SESSION_CODE: Readonly<Record<SessionKey, number>> = { weekend: 0, asia: 1, london: 2, ny: 3, late: 4 };

/** Why a feature cannot be used on a timeframe (`null` = it can). */
export function featureBlockedReason(id: FeatureId, tf: SimilarTf): string | null {
  if (id === "weekday" && KEY_TF_MS[tf] >= KEY_TF_MS["1W"]) return "Bei Wochenkerzen ist der Wochentag immer derselbe.";
  if (id === "session" && KEY_TF_MS[tf] > KEY_TF_MS["2h"]) return "Eine Kerze ab 3h überspannt mehrere Sessions.";
  return null;
}

/**
 * EMA like TradingView `ta.ema`: seeded with the SMA of the first `len` closes (so the value at candle `len − 1` is that
 * mean), `null` before. Causal: the value at i depends on candles 0…i only.
 */
export function emaSma(src: readonly number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  if (len < 1 || src.length < len) return out;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += src[i]!;
  let prev = sum / len;
  out[len - 1] = prev;
  const a = 2 / (len + 1);
  for (let i = len; i < src.length; i++) {
    prev = a * src[i]! + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** `ln(volume ÷ mean of the last len volumes)` at each candle; `null` while the window is short or a volume is missing / 0. */
export function relativeVolume(vol: readonly (number | undefined)[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(vol.length).fill(null);
  if (len < 1) return out;
  for (let i = len - 1; i < vol.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = i - len + 1; k <= i; k++) {
      const v = vol[k];
      if (!fin(v) || v < 0) {
        ok = false;
        break;
      }
      sum += v;
    }
    const cur = vol[i];
    const mean = sum / len;
    out[i] = ok && fin(cur) && cur > 0 && mean > 0 ? Math.log(cur / mean) : null;
  }
  return out;
}

/** The whole feature table of `closed` (ascending, closed only) – every feature for every candle, `null` where undefined. */
export function featureSeries(closed: readonly SimCandle[], lens: SimLens = DEFAULT_LENS): FeatureSeries {
  const n = closed.length;
  const closes = closed.map((c) => c.close);
  const atr = atrSeries(closed, lens.atr);
  const rs = wilderRsi(closes, lens.rsi).map((x) => (Number.isFinite(x) ? x : null));
  const eFast = emaSma(closes, lens.emaFast);
  const eSlow = emaSma(closes, lens.emaSlow);
  const vol = relativeVolume(
    closed.map((c) => c.volume),
    lens.volume,
  );
  const atrAt = (i: number): number | null => {
    const a = atr[i];
    return fin(a) && a > 0 ? a : null;
  };
  const table: FeatureTable = {
    rsi: rs,
    rsiSlope: [],
    emaFast: [],
    emaSlow: [],
    range: [],
    volume: vol,
    trend: [],
    weekday: [],
    session: [],
  };
  for (let i = 0; i < n; i++) {
    const a = atrAt(i);
    const c = closed[i]!;
    const now = rs[i];
    const before = i >= lens.slope ? rs[i - lens.slope] : null;
    table.rsiSlope.push(fin(now) && fin(before) ? now - before : null);
    const ef = eFast[i];
    const es = eSlow[i];
    table.emaFast.push(a != null && fin(ef) ? (c.close - ef) / a : null);
    table.emaSlow.push(a != null && fin(es) ? (c.close - es) / a : null);
    table.range.push(a != null ? (c.high - c.low) / a : null);
    table.trend.push(a != null && i >= lens.trend ? (c.close - closed[i - lens.trend]!.close) / a : null);
    const d = new Date(c.time);
    table.weekday.push(d.getUTCDay());
    table.session.push(SESSION_CODE[sessionOf(d)]);
  }
  return { table, atr };
}

/** First candle index at which `id` can be defined, given the lengths (the candles before it always read `null`). */
export function firstValidIndex(id: FeatureId, lens: SimLens): number {
  switch (id) {
    case "rsi":
      return lens.rsi;
    case "rsiSlope":
      return lens.rsi + lens.slope;
    case "emaFast":
      return Math.max(lens.emaFast - 1, lens.atr);
    case "emaSlow":
      return Math.max(lens.emaSlow - 1, lens.atr);
    case "range":
      return lens.atr;
    case "volume":
      return lens.volume - 1;
    case "trend":
      return Math.max(lens.trend, lens.atr);
    default:
      return 0;
  }
}

/** The values of candle `i` for the given features. */
export function valuesAt(t: FeatureTable, i: number, ids: readonly FeatureId[]): FeatureValues {
  const out: FeatureValues = {};
  for (const id of ids) out[id] = t[id][i] ?? null;
  return out;
}

/**
 * Distance of two descriptions over the same features: the root of the mean squared difference in units of each feature's
 * fixed scale. 0 = identical; 1 = on average one scale unit apart per feature. `null` if a value is missing.
 */
export function distance(a: FeatureValues, b: FeatureValues, ids: readonly FeatureId[]): number | null {
  if (!ids.length) return null;
  let s = 0;
  for (const id of ids) {
    const x = a[id];
    const y = b[id];
    if (!fin(x) || !fin(y)) return null;
    const def = FEATURES[id];
    const d = def.kind === "cat" ? (x === y ? 0 : 1) : (x - y) / def.scale;
    s += d * d;
  }
  return Math.sqrt(s / ids.length);
}

export { FEATURE_IDS };
