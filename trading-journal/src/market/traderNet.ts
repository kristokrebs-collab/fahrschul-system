/**
 * Live "Top-Trader netto (Binance)" for the Long signal: the top-trader POSITION series of the chosen period (the same
 * `topPositionRatio` feed the Top-Trader card reads, 500 points on the first load = about 21 days at 1 h) joined with the
 * candle prices of the same exchange, turned into the pure `TraderNetView` (`@/domain/signals/traderNet`). No extra
 * request, no new feed: the history is the one the app already holds. Only Binance data counts (direct or through the EU
 * proxy); a Bybit/OKX fallback has no top-trader cohort → no view, `status: "none"` with the reason.
 *
 * Re-renders only when the series publishes (once per period), the candle feed opens a new bar, a health field the status
 * reads changes, or once a minute (the "seit 3 Tagen" age). Never per price tick.
 */
import { useEffect, useMemo, useState } from "react";
import { buildTraderNet, type TraderNetView } from "@/domain/signals/traderNet";
import type { Candle, ProviderHealth, RatioPoint, Stamped } from "./types";
import { getProvider, useFeed, useFeedSelect, useHealthSelect } from "./marketStore";
import { isBinanceSeries } from "./mapping";
import { INTERVAL_MS, PERIOD_MS } from "./period";
import { STRINGS } from "./statusLabel";

export type TraderNetFeedStatus = "live" | "stale" | "loading" | "none";

export interface LiveTraderNet {
  /** `null` = nothing loaded (no provider, no Binance series yet, Bybit/OKX source) */
  view: TraderNetView | null;
  status: TraderNetFeedStatus;
  /** German one-liner for the UI when there is no view or it is stale */
  detail?: string;
  /** spacing of the points (ms), `null` = none */
  stepMs: number | null;
  /** `proxy` = EU proxy, `null` = no Binance data */
  source: "binance" | "proxy" | null;
}

const FEED = "topPositionRatio" as const;
/** Candle feed per point spacing: hours and longer → 1 h candles (≈ 21 days), shorter → 15 m candles (≈ 15 days). */
const BAR_FEED = { hour: "kline_1h", quarter: "kline_15m" } as const;
const MINUTE = 60_000;

/** The point spacing: the smallest gap between neighbours (robust against one missing point). */
export function stepOf(points: readonly Pick<RatioPoint, "time">[]): number | null {
  let best: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const d = points[i]!.time - points[i - 1]!.time;
    if (d > 0 && (best === null || d < best)) best = d;
  }
  return best;
}

/** Health fields the status reads (the provider replaces the health object several times a second). */
export function traderNetHealthSignature(h: ProviderHealth): string {
  const f = h.feeds[FEED];
  return `${h.online ? 1 : 0}|${h.primary.blocked ? 1 : 0}|${f ? `${f.state}:${f.source}:${f.reason ?? ""}:${f.consecutiveFailures}` : "-"}`;
}

/** Binance-clock "now" of the provider (device clock without one). */
const providerNow = (p: ReturnType<typeof getProvider>): number => (p && typeof p.serverNow === "function" ? p.serverNow() : Date.now());

const lastBarTime = (v: { data: readonly Candle[] } | undefined): number => v?.data[v.data.length - 1]?.time ?? 0;

/**
 * Pure: the live net view + an honest status from the series, the candles and the provider health. `now` is the Binance-clock
 * time. Used by the hook and tested without React.
 */
export function deriveLiveTraderNet(
  ratio: Stamped<RatioPoint[]> | undefined,
  bars: Stamped<Candle[]> | undefined,
  health: ProviderHealth | null,
  now: number,
  statusText?: string,
): LiveTraderNet {
  const ok = !!health && !!ratio && isBinanceSeries(health, FEED, ratio);
  const f = health?.feeds[FEED];
  const src = ok && f ? (f.source === "proxy" ? "proxy" : "binance") : null;
  if (!ok || !ratio) {
    const detail = !health
      ? "Kein Marktanschluss – keine Top-Trader-Daten."
      : !health.online
        ? STRINGS.offline
        : health.primary.blocked && f?.source !== "proxy"
          ? "Binance blockiert (Region)"
          : f?.reason === "unsupported" || f?.source === "bybit" || f?.source === "okx"
            ? STRINGS.onlyBinance
            : (statusText ?? "Top-Trader-Daten werden geladen …");
    const loading = !!health && health.online && !(f?.reason === "unsupported") && !health.primary.blocked && !(f?.source === "bybit" || f?.source === "okx") && f?.state !== "offline" && !(f && f.consecutiveFailures > 0);
    return { view: null, status: loading ? "loading" : "none", detail, stepMs: null, source: null };
  }
  const step = stepOf(ratio.data) ?? PERIOD_MS["1h"];
  const barMs = step >= PERIOD_MS["1h"] ? INTERVAL_MS["1h"] : INTERVAL_MS["15m"];
  const view = buildTraderNet(ratio.data, bars?.data ?? [], now, barMs);
  const newest = ratio.data[ratio.data.length - 1]?.time ?? 0;
  const stale = now - newest > 2 * step + 2 * MINUTE || f?.state === "stale";
  return { view, status: stale ? "stale" : "live", detail: stale ? "Top-Trader-Daten veraltet" : undefined, stepMs: step, source: src };
}

/** React: the live net view of the Top-Trader positions (see the module comment). */
export function useTraderNet(): LiveTraderNet {
  const ratio = useFeed(FEED);
  const healthSig = useHealthSelect(traderNetHealthSignature);
  // the candle feeds only wake this hook when a new bar opens (never per tick)
  const hourKey = useFeedSelect(BAR_FEED.hour, lastBarTime);
  const quarterKey = useFeedSelect(BAR_FEED.quarter, lastBarTime);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / MINUTE));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / MINUTE)), MINUTE);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const p = getProvider();
    const health = p ? p.getHealth() : null;
    const step = ratio ? (stepOf(ratio.data) ?? PERIOD_MS["1h"]) : PERIOD_MS["1h"];
    const bars = p ? p.get(step >= PERIOD_MS["1h"] ? BAR_FEED.hour : BAR_FEED.quarter) : undefined;
    const now = providerNow(p);
    return deriveLiveTraderNet(ratio, bars, health, now, p?.statusLabel(FEED).text);
    // `healthSig` / `hourKey` / `quarterKey` / `minute` are the change signals for the provider reads above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, healthSig, hourKey, quarterKey, minute]);
}

