/**
 * Market hooks for the overview cards. The live numbers (price, book, mark, funding, ages, countdowns, order flow)
 * are rendered straight from the MotionValues in `@/market` and the shared `nowMv` clock – no React render per
 * tick. React state is reserved for what changes the STRUCTURE of a card: health/status, closed bars, scenario
 * flips, a trigger coming into reach. Every hook below re-renders only when such a key changes.
 */
import { useMotionValue, useSpring, type MotionValue } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MarketLevels } from "@/domain/types";
import {
  buildFeedSpecs,
  buyVolMv,
  deriveMarket,
  deriveTopTrader,
  getProvider,
  initialHealth,
  klineBarKey,
  priceMv,
  sellVolMv,
  useFeed,
  useFeedSelect,
  useHealthSelect,
  useProvider,
  volAccumMv,
  type FeedId,
  type MarketView,
  type ProviderHealth,
  type Source,
  type Stamped,
  type StatusLabel,
  type TopTraderBase,
  type TopTraderView,
} from "@/market";
import type { ChangeSource } from "@/motion/StatusPill";
import { spring } from "@/motion/tokens";
import { createFlowWindow, FLOW_QUIET_WINDOWS, FLOW_WINDOW_MS, flowWindowStep, formingScenarioKey, nextDeadline, panelHealthKey, topTraderHealthKey, viewDeadlines } from "./marketMath";

/* ------------------------------------------------------------------ external-store helpers */

const EMPTY_HEALTH: ProviderHealth = initialHealth(buildFeedSpecs("1h"));

/**
 * Re-renders when `read()` – a primitive computed from MotionValues – changes. `sources` must be a stable array
 * (module constant or memoised); `read` runs on every change event, so keep it cheap.
 */
export function useMotionSelect<T extends string | number | boolean | null>(sources: readonly ChangeSource[], read: () => T): T {
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = sources.map((s) => s.on("change", cb));
      return () => {
        for (const off of offs) off();
      };
    },
    [sources],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The live price classified by `classify` (e.g. trigger flags): re-renders only when the class changes and returns
 * the price sampled at that moment, so anything computed from it is consistent with the class. Before the first
 * trade (`priceMv` 0) the snapshot `fallback` is classified.
 */
export function usePriceClass(classify: (price: number | null) => string, fallback: number | null): PriceClass {
  const read = useMemo(() => priceClassReader(classify, fallback), [classify, fallback]);
  return useSyncExternalStore(subscribePrice, read, read);
}

export interface PriceClass {
  key: string;
  /** the price sampled when the class last changed (`null` without any price) */
  price: number | null;
}

const subscribePrice = (cb: () => void) => priceMv.on("change", cb);

/** Memoised snapshot getter: the same object while the class is unchanged (useSyncExternalStore contract). */
function priceClassReader(classify: (price: number | null) => string, fallback: number | null): () => PriceClass {
  let last: PriceClass | null = null;
  return () => {
    const v = priceMv.get();
    const price = v > 0 ? v : fallback;
    const key = classify(price);
    if (last && last.key === key) return last;
    last = { key, price };
    return last;
  };
}

/* ------------------------------------------------------------------ market panel view */

const sourceKey = (v: Stamped<unknown> | undefined): string => (v ? v.source : "");
const changeKey = (v: Stamped<{ priceChangePercent: number }> | undefined): number | null => v?.data.priceChangePercent ?? null;
const presenceKey = (v: Stamped<unknown> | undefined): boolean => v !== undefined;

export interface MarketPanelView extends MarketView {
  /** Tooltip detail of the `markPrice` status label (fallback / error explanations). */
  statusDetail?: string;
}

/**
 * Market-panel view (`deriveMarket`) re-derived only on structural changes: lifecycle, the health fields the panel
 * shows, closed 4 h / weekly bars, the forming bar's scenario, price/ticker presence and source, mark presence, REST
 * values (OI, taker) and the time deadlines of `viewDeadlines`. Price, book, mark and the countdowns are NOT in
 * here – they are MotionValue leaves.
 */
export function useMarketPanelView(levels: MarketLevels): MarketPanelView {
  const provider = useProvider();
  const health = useHealthSelect(panelHealthKey);
  const k4 = useFeedSelect("kline_4h", klineBarKey);
  const kw = useFeedSelect("kline_1w", klineBarKey);
  const selectForming = useCallback((v: Stamped<{ close: number; closed: boolean }[]> | undefined) => formingScenarioKey(v?.data, levels), [levels]);
  const forming = useFeedSelect("kline_4h", selectForming);
  const agg = useFeedSelect("aggTrade", sourceKey);
  const book = useFeedSelect("bookTop", sourceKey);
  const ticker = useFeedSelect("ticker24h", sourceKey);
  const change = useFeedSelect("ticker24h", changeKey);
  const mark = useFeedSelect("markPrice", presenceKey);
  const oi = useFeed("openInterest");
  const taker = useFeed("takerRatio");
  // `now` only feeds the time-dependent parts of `deriveMarket`; it is refreshed by one timer at the next deadline
  // (past deadlines fire at once). Between deadlines time cannot change the result, so a stale `now` is exact.
  const [now, setNow] = useState(() => Date.now());

  const derived = useMemo(() => {
    const snap = provider ? provider.snapshot() : {};
    const view: MarketPanelView = deriveMarket(snap, provider?.getHealth() ?? EMPTY_HEALTH, { now });
    view.statusDetail = provider?.statusLabel("markPrice").detail;
    return { view, deadlines: viewDeadlines(snap) };
    // the keys are the change signals; the values are read from the provider snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, health, k4, kw, forming, agg, book, ticker, change, mark, oi, taker, now]);

  const next = nextDeadline(derived.deadlines, now);
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 1);
    return () => clearTimeout(id);
  }, [next]);

  return derived.view;
}

/**
 * Source serving the last price (`aggTrade` → `bookTop` → `ticker24h`, as `lastPrice`), re-rendering only when it
 * switches – not per trade.
 */
export function usePriceSource(): Source | null {
  const agg = useFeedSelect("aggTrade", sourceKey);
  const book = useFeedSelect("bookTop", sourceKey);
  const ticker = useFeedSelect("ticker24h", sourceKey);
  return (agg || book || ticker || null) as Source | null;
}

/* ------------------------------------------------------------------ top trader */

const RATIO_STATUS: Record<TopTraderBase, FeedId> = { accounts: "topAccountRatio", positions: "topPositionRatio" };

/**
 * Top-trader view + its status label without the global version counter: re-derives when one of the four REST
 * series publishes or a health field `deriveTopTrader` reads changes – never on price, book or kline ticks.
 */
export function useTopTraderView(base: TopTraderBase): { tt: TopTraderView; label: StatusLabel } {
  const provider = useProvider();
  const selectHealth = useCallback((h: ProviderHealth) => topTraderHealthKey(h, base), [base]);
  const health = useHealthSelect(selectHealth);
  const topAccountRatio = useFeed("topAccountRatio");
  const topPositionRatio = useFeed("topPositionRatio");
  const globalAccountRatio = useFeed("globalAccountRatio");
  const takerRatio = useFeed("takerRatio");
  return useMemo(() => {
    const h = provider?.getHealth() ?? EMPTY_HEALTH;
    const tt = deriveTopTrader({ topAccountRatio, topPositionRatio, globalAccountRatio, takerRatio }, h, base);
    const label = provider?.statusLabel(RATIO_STATUS[base]) ?? { tone: "muted" as const, text: "" };
    return { tt, label };
    // `health` is the change signal for the health object read from the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, health, topAccountRatio, topPositionRatio, globalAccountRatio, takerRatio, base]);
}

/* ------------------------------------------------------------------ MotionValue helpers */

export interface GlideOptions {
  /** Glide only while true (reduced motion → follow the source exactly). */
  enabled: boolean;
  /** Jump instead of gliding for this move (e.g. the first known value after "unknown"). */
  jump?: (prev: number, next: number) => boolean;
  transition?: typeof spring.price;
}

/** A price-like value is unknown at `0`: the first real value (and a reset to 0) must not glide. */
export const jumpFromUnknownPrice = (prev: number, next: number): boolean => !(prev > 0) || !(next > 0);
/** Ratios / percentages are unknown at `NaN`. */
export const jumpFromNaN = (prev: number, next: number): boolean => !Number.isFinite(prev) || !Number.isFinite(next);

/**
 * A MotionValue that glides after `source` on `spring.price` (Motion steers the running spring towards every new
 * value, keeping its velocity), with no React render. Unlike a bare `useSpring` it jumps for selected moves, so a
 * value that becomes known never sweeps up from zero, and it follows exactly while `enabled` is false.
 */
export function useGlide(source: MotionValue<number>, { enabled, jump, transition = spring.price }: GlideOptions): MotionValue<number> {
  const out = useSpring(source, transition);
  useEffect(() => {
    out.jump(source.get());
    // registered after the spring's own listener (insertion effect), so this jump overrides the glide it just started
    return source.on("change", (v) => {
      if (!enabled || (jump?.(out.get(), v) ?? false)) out.jump(v);
    });
  }, [source, out, enabled, jump]);
  return out;
}

/**
 * Order-flow meter input: one value per `FLOW_WINDOW_MS` window (see `flowWindowStep`) from the monotonic taker
 * accumulators, so no traded quantity is lost to frame coalescing. The sampler runs only while trades print and
 * stops after the meter has settled, so a quiet market leaves no timer behind.
 */
export function useOrderFlowMeter(): MotionValue<number> {
  const out = useMotionValue(0);
  useEffect(() => {
    const win = createFlowWindow(buyVolMv.get(), sellVolMv.get());
    let timer: ReturnType<typeof setInterval> | null = null;
    let quiet = 0;
    const sample = () => {
      const v = flowWindowStep(win, buyVolMv.get(), sellVolMv.get());
      out.set(v);
      quiet = v === 0 ? quiet + 1 : 0;
      if (quiet >= FLOW_QUIET_WINDOWS && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const wake = () => {
      quiet = 0;
      timer ??= setInterval(sample, FLOW_WINDOW_MS);
    };
    const off = volAccumMv.on("change", wake);
    return () => {
      off();
      if (timer) clearInterval(timer);
    };
  }, [out]);
  return out;
}

/* ------------------------------------------------------------------ refresh */

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
