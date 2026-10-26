/**
 * Candle window for a replay-like view (trade replay, what-if, training): the provider's klines through the same
 * budgeted, memoised loader as the MAE / MFE measurement (`@/market/excursion`). Honest states: no market connection,
 * another pair than the live market, no candles, failed. Nothing is fetched until all of that is clear.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReplayBar } from "@/chart/ReplayChart";
import { useProvider } from "@/market";
import { loadBars, measurablePair, MEASURE_HINTS } from "@/market/excursion";
import type { ReplayInterval } from "./replayModel";

export type CandleLoad = { status: "loading" } | { status: "ok"; bars: ReplayBar[] } | { status: "error"; message: string };

export interface CandleWindow {
  pair: string;
  interval: ReplayInterval;
  from: number;
  to: number;
}

/** `otherPairHint`: the sentence for "not the live market's pair" (default: the MAE / MFE one). */
export function useCandles(w: CandleWindow, otherPairHint: string = MEASURE_HINTS.otherPair): CandleLoad {
  const provider = useProvider();
  const pairOk = measurablePair(w.pair, provider);
  const key = `${w.pair}|${w.interval}|${w.from}|${w.to}|${provider?.symbol ?? ""}`;
  const [load, setLoad] = useState<{ key: string; v: CandleLoad } | null>(null);

  useEffect(() => {
    if (!provider || !pairOk) return;
    let alive = true;
    loadBars(provider, w.interval, w.from, w.to).then(
      (bars) => alive && setLoad({ key, v: bars.length ? { status: "ok", bars } : { status: "error", message: MEASURE_HINTS.noData } }),
      () => alive && setLoad({ key, v: { status: "error", message: MEASURE_HINTS.failed } }),
    );
    return () => {
      alive = false;
    };
    // `key` covers pair, interval, window and provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(
    () => (!provider ? { status: "error", message: MEASURE_HINTS.noProvider } : !pairOk ? { status: "error", message: `${otherPairHint} (${provider.symbol})` } : load?.key === key ? load.v : { status: "loading" }),
    [provider, pairOk, load, key, otherPairHint],
  );
}
