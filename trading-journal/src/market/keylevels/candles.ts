/**
 * Candles of a key level's own timeframe, built from the provider's real feeds – nothing is substituted: a timeframe
 * the feed cannot serve right now yields `null` (the level then reads `unknown`), never another timeframe's candles.
 *
 * 30m = 2 × `kline_15m`; 1h / 2h / 3h = 1 × / 2 × / 3 × `kline_1h`; 4h, 1D, 1W straight from their feeds. Buckets are
 * aligned to the epoch (= UTC midnight for every length that divides a day), like the chart's 30m and the signal rungs.
 */
import { KEY_TF_SOURCE, KEY_TIMEFRAMES, type FeedAvailabilityMap, type KeyTf, type TfFeed } from "@/domain/keylevels";
import type { MarketProvider } from "../provider";
import type { Candle } from "../types";
import { barsOfTf, isNativeTf } from "./bars";

const memo = new WeakMap<object, Map<KeyTf, Candle[]>>();

/** Candles of `tf` (ascending, the last may be forming), `null` while the source feed has none. */
export function levelCandles(p: MarketProvider, tf: KeyTf): Candle[] | null {
  const src = KEY_TF_SOURCE[tf];
  const v = p.get(src.feed);
  if (!v || !v.data.length) return null;
  if (isNativeTf(tf)) return v.data;
  let byTf = memo.get(v);
  if (!byTf) memo.set(v, (byTf = new Map()));
  let out = byTf.get(tf);
  if (!out) byTf.set(tf, (out = barsOfTf(tf, v.data)));
  return out;
}

/** What the timeframe picker needs per candle feed (see `timeframeAvailability`). */
export function feedAvailability(p: MarketProvider | null): FeedAvailabilityMap | null {
  if (!p) return null;
  const health = p.getHealth().feeds;
  const out: FeedAvailabilityMap = {};
  const feeds = new Set<TfFeed>(KEY_TIMEFRAMES.map((tf) => KEY_TF_SOURCE[tf].feed));
  for (const feed of feeds) {
    const h = health[feed];
    out[feed] = {
      count: p.get(feed)?.data.length ?? 0,
      unsupported: h?.reason === "unsupported",
      offline: h?.state === "offline",
      detail: h?.detail,
    };
  }
  return out;
}
