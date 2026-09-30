/**
 * Market hooks for the overview cards. `useMarketView()` from the market layer re-renders on EVERY
 * provider emit (aggTrade ≈ 10 Hz); the cards only need ≤ 1 Hz, so they subscribe to the slow feeds
 * and read the snapshot from the provider. The live price itself is rendered from `priceMv`.
 */
import { useMotionValueEvent } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { deriveMarket, getProvider, lastPrice, priceMv, useFeed, useHealth, useProvider, type MarketView, type Provenance } from "@/market";

/** Re-renders every `ms` while mounted (LivePill age, funding countdown). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Legacy market-panel view derived from the ≤ 1 Hz feeds (kline_4h/1w, ticker24h, markPrice, bookTop) + health. */
export function useMarketPanelView(now: number): MarketView {
  const provider = useProvider();
  const health = useHealth();
  const k4 = useFeed("kline_4h");
  const kw = useFeed("kline_1w");
  const t24 = useFeed("ticker24h");
  const mark = useFeed("markPrice");
  const book = useFeed("bookTop");
  const oi = useFeed("openInterest");
  const taker = useFeed("takerRatio");
  return useMemo(
    () => deriveMarket(provider ? provider.snapshot() : {}, health, { now }),
    // the feed values are the change signals; the snapshot is read from the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, health, k4, kw, t24, mark, book, oi, taker, now],
  );
}

/** Rounded last price + provenance, refreshed with the 30-s ticker / health changes (no 10-Hz renders). */
export function usePriceSnapshot(): { price: number | null; provenance: Provenance | null } {
  const provider = useProvider();
  const health = useHealth();
  const t24 = useFeed("ticker24h");
  const mark = useFeed("markPrice");
  return useMemo(() => {
    const lp = provider ? lastPrice(provider.snapshot()) : null;
    return { price: lp ? Math.round(lp.price) : null, provenance: lp?.provenance ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, health, t24, mark]);
}

/**
 * Integer price for `RollingDigits`, fed from `priceMv` and throttled to ≤ 4 Hz so the odometer springs
 * (Plan 3.3 "Live-Preis"); falls back to the snapshot price until the stream delivers.
 */
export function useRollingPrice(fallback: number | null, intervalMs = 250): number | null {
  const [price, setPrice] = useState<number | null>(() => {
    const v = priceMv.get();
    return v > 0 ? Math.round(v) : fallback;
  });
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMotionValueEvent(priceMv, "change", (v) => {
    if (!(v > 0)) return;
    const apply = () => {
      last.current = Date.now();
      setPrice(Math.round(priceMv.get()));
    };
    const wait = intervalMs - (Date.now() - last.current);
    if (wait <= 0) apply();
    else if (!timer.current)
      timer.current = setTimeout(() => {
        timer.current = null;
        apply();
      }, wait);
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return price ?? fallback;
}

/** Force-refresh of the market-card feeds (bundle `refresh()`, Plan 4.4): ≤ one force per 5 s. */
export const REFRESH_FEEDS = ["ticker24h", "kline_4h", "kline_1h", "kline_1w", "markPrice"] as const;
export const REFRESH_COOLDOWN_MS = 5000;

export function useForceRefresh(): { refresh: () => void; refreshing: boolean; disabled: boolean } {
  const [refreshing, setRefreshing] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = () => {
    const p = getProvider();
    if (!p || refreshing || disabled) return;
    setRefreshing(true);
    setDisabled(true);
    void Promise.allSettled(REFRESH_FEEDS.map((f) => p.refresh(f, { force: true }))).then(() => {
      if (mounted.current) setRefreshing(false);
    });
    setTimeout(() => {
      if (mounted.current) setDisabled(false);
    }, REFRESH_COOLDOWN_MS);
  };
  return { refresh, refreshing, disabled };
}
