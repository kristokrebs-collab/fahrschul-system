/**
 * The candles of one timeframe for „Ähnliche Situationen“ (F19): the REAL candles of the timeframe's own feed
 * (`levelCandles`: 1h, 4h, 1D, 1W straight from their feeds, 30m / 2h / 3h resampled from 15m / 1h) – a timeframe the feed
 * cannot serve right now is reported with its reason and gets no candles, never another timeframe's.
 *
 * Re-renders only when the source feed's bar key changes (a bar appended or closed – not on forming-bar ticks) or the
 * availability text changes; nothing runs without a mounted caller.
 */
import { useMemo } from "react";
import { KEY_TF_SOURCE, timeframeAvailability, type KeyTf, type TfAvailability } from "@/domain/keylevels";
import { feedAvailability, levelCandles } from "../keylevels/candles";
import { klineBarKey, useFeedSelect, useHealthSelect, useProvider } from "../marketStore";
import type { Candle } from "../types";

export interface SituationInput {
  /** `idle`: the live market is not running; `waiting`: running, but this timeframe has no candles (yet) */
  state: "idle" | "waiting" | "ok";
  symbol: string | null;
  avail: TfAvailability;
  candles: Candle[] | null;
  /** the clock of the data source, ms */
  now: number;
  /** changes when a candle was appended or closed */
  key: string;
}

export function useSituationInput(tf: KeyTf): SituationInput {
  const provider = useProvider();
  const feed = KEY_TF_SOURCE[tf].feed;
  const barKey = useFeedSelect(feed, klineBarKey);
  // the health text of the feed decides availability („Quelle offline“, „werden geladen …“)
  const healthKey = useHealthSelect((h) => `${h.feeds[feed]?.state ?? ""}|${h.feeds[feed]?.reason ?? ""}|${h.feeds[feed]?.detail ?? ""}`);
  return useMemo((): SituationInput => {
    const avail = timeframeAvailability(feedAvailability(provider)).find((a) => a.tf === tf)!;
    if (!provider) return { state: "idle", symbol: null, avail, candles: null, now: 0, key: "" };
    const symbol = provider.symbolInfo.binance;
    const candles = avail.ok ? levelCandles(provider, tf) : null;
    return { state: candles ? "ok" : "waiting", symbol, avail, candles, now: provider.serverNow(), key: `${symbol}|${tf}|${barKey}` };
    // `barKey` and `healthKey` are the change signals; the values themselves are read from the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, tf, barKey, healthKey]);
}
