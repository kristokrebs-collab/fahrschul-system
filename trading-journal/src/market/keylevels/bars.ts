/**
 * The candles of a key level's own timeframe from the candles of its source feed – shared by the live provider
 * (`candles.ts`) and the server watch (`netlify/functions/_lib/alertWatch`). Alias-free on purpose (the Netlify function
 * bundles it). 30m = 2 × 15m; 2h / 3h = 2 × / 3 × 1h; 1h, 4h, 1D, 1W are served as they are. Buckets are aligned to the
 * epoch (= UTC midnight for every length that divides a day). Nothing is substituted: the caller hands in the source
 * feed of `KEY_TF_SOURCE[tf]`.
 */
import { resampleCandles } from "../../chart/resample";
import { KEY_TF_SOURCE } from "../../domain/keylevels/timeframes";
import { KEY_TF_MS, type KeyTf } from "../../domain/keylevels/types";
import type { Candle } from "../types";

/** The source feed of `tf` is already made of candles of `tf`. */
export const isNativeTf = (tf: KeyTf): boolean => KEY_TF_SOURCE[tf].srcMs === KEY_TF_MS[tf];

/** `source` (ascending candles of `KEY_TF_SOURCE[tf].feed`) as candles of `tf`; the same array when no resampling is needed. */
export function barsOfTf(tf: KeyTf, source: Candle[]): Candle[] {
  return isNativeTf(tf) ? source : resampleCandles(source, KEY_TF_SOURCE[tf].srcMs, KEY_TF_MS[tf]);
}
