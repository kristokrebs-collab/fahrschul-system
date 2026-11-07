/**
 * 1h candles ±3 days around the open trade for `TradeDetail.candles` (Plan 5.9): sliced from the market
 * cache at open time (stable identity per detail id); the missing edge is loaded via `history()` once.
 */
import { useEffect, useMemo, useState } from "react";
import { tradeTime } from "@/lib/dates";
import { getProvider, type Candle } from "@/market";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

export const DETAIL_WINDOW_MS = 3 * 86_400_000;

export function sliceAround(candles: readonly Candle[], center: number, half = DETAIL_WINDOW_MS): Candle[] {
  return candles.filter((c) => c.time >= center - half && c.time <= center + half);
}

export function useDetailCandles(): Candle[] | undefined {
  const id = useUi((s) => s.detail.id);
  const trades = useJournal((s) => s.trades);
  const center = useMemo(() => {
    const t = id ? trades.find((x) => x.id === id) : undefined;
    return t ? +tradeTime(t) : null;
  }, [id, trades]);

  const [loaded, setLoaded] = useState<{ id: string; candles: Candle[] } | null>(null);

  const cached = useMemo(() => {
    if (!id || center == null) return undefined;
    const p = getProvider();
    const all = p?.get("kline_1h")?.data ?? [];
    // the cache is read once per detail id (stable identity for the mini chart)
    return sliceAround(all, center);
  }, [id, center]);

  useEffect(() => {
    if (!id || center == null) return;
    const p = getProvider();
    if (!p) return;
    const from = center - DETAIL_WINDOW_MS;
    const to = Math.min(Date.now(), center + DETAIL_WINDOW_MS);
    const covered = (cached?.[0]?.time ?? Infinity) <= from + 3_600_000 && (cached?.[cached.length - 1]?.time ?? -Infinity) >= to - 3_600_000;
    if (covered || to < from) return;
    let cancelled = false;
    p.history("kline_1h", { from, to })
      .then((res) => {
        if (!cancelled && res.data.length) setLoaded({ id, candles: sliceAround(res.data, center) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, center, cached]);

  if (!id) return undefined;
  if (loaded && loaded.id === id && loaded.candles.length >= (cached?.length ?? 0)) return loaded.candles;
  return cached && cached.length ? cached : undefined;
}
