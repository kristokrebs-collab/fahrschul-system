/**
 * `Box-Chart` (P02): an own `NothingCandleChart` (the overview chart is a separate, keep-alive instance) on 4h / 1D / 1W
 * with the Box-zu-Box boxes and targets (`boxes`, autoscaled) and the RSI pane with its diagonal trendlines. Switching
 * the timeframe wipes the new picture in strip by strip (`StripWipe` inside the chart); new boxes draw in, a fresh RSI
 * break breathes (`GlowBreak`). History: the provider's series (4h extended once by `provider.history`), the forming bar
 * from the trade stream and the kline frames – never a React render per tick.
 */
import { themePaint } from "@/lib/themePaint";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChartSkeleton } from "@/chart/ChartSkeleton";
import type { BarsListener, RangeDays } from "@/chart/NothingCandleChart";
import type { ChartInterval } from "@/chart/panes";
import { BOX_TF_MS, type BoxTf } from "@/domain/boxes";
import { getProvider, priceMv, subscribeFeed, tickDirMv, tradeTimeMv, useFeedSelect, volAccumMv, type Candle, type Stamped } from "@/market";
import { BOX_FEED, type BoxesView } from "@/market/boxes/store";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { chartBoxesKey, toChartBoxes } from "./chartBoxes";
import { MARKT, TF_TEXT } from "./strings";

const NothingCandleChart = lazy(() => import("@/chart/NothingCandleChart").then((m) => ({ default: m.NothingCandleChart })));

const S = MARKT.chart;
const TFS: readonly { v: BoxTf; label: string }[] = [
  { v: "4h", label: TF_TEXT["4h"] },
  { v: "1d", label: TF_TEXT["1d"] },
  { v: "1w", label: TF_TEXT["1w"] },
];
const INTERVAL: Readonly<Record<BoxTf, ChartInterval>> = { "4h": "4h", "1d": "1d", "1w": "1w" };
/** Visible window per timeframe: 1 month of 4h, 6 months of 1D, 2 years of 1W. */
const RANGE: Readonly<Record<BoxTf, RangeDays>> = { "4h": 30, "1d": 180, "1w": 730 };
/** 4h history reaching the oldest box the engine may draw (700 bars ≈ 117 days). */
const HISTORY_4H_DAYS = 120;

/** The kline value as of its last bar-key change (one render per new bar, never per tick). */
const feedKey = (v: Stamped<Candle[]> | undefined): string => (v ? `${v.data.length}:${v.data[v.data.length - 1]?.time ?? 0}:${v.data[0]?.time ?? 0}` : "");
const selectBars = (v: Stamped<Candle[]> | undefined): Stamped<Candle[]> | undefined => v;
const sameBarKey = (a: Stamped<Candle[]> | undefined, b: Stamped<Candle[]> | undefined): boolean => feedKey(a) === feedKey(b);

function merge(older: readonly Candle[], data: readonly Candle[]): Candle[] {
  const first = data[0]?.time ?? Infinity;
  const head = older.filter((c) => c.time < first);
  return head.length ? [...head, ...data] : [...data];
}

/** Legend glyphs (decorative). */
function Glyph({ kind }: { kind: "box" | "broken" | "pending" | "target" | "stop" | "rsi" }) {
  const common = { width: 18, height: 10, viewBox: "0 0 18 10", "aria-hidden": true, className: "shrink-0" } as const;
  if (kind === "box" || kind === "broken" || kind === "pending") {
    const c = kind === "broken" ? "var(--color-win)" : kind === "pending" ? themePaint("#65b488") : themePaint("#9b9b9b");
    return (
      <svg {...common}>
        <rect x="1" y="1.5" width="16" height="7" fill={kind === "broken" ? "rgba(61,220,132,0.12)" : "rgb(var(--veil-rgb, 255 255 255) / 0.08)"} stroke={c} strokeWidth="1" strokeDasharray={kind === "pending" ? "2 2" : undefined} />
      </svg>
    );
  }
  const stroke = kind === "stop" ? "var(--color-loss)" : kind === "target" ? "var(--color-win)" : themePaint("#9b9b9b");
  return (
    <svg {...common}>
      <path d={kind === "rsi" ? "M1 2 L17 8" : "M1 5 H17"} stroke={stroke} strokeWidth="1.25" strokeDasharray={kind === "target" ? "1.5 2.5" : kind === "stop" ? "4 3" : undefined} strokeLinecap="round" />
    </svg>
  );
}

const LEGEND: readonly { kind: Parameters<typeof Glyph>[0]["kind"]; label: string }[] = [
  { kind: "box", label: S.legendBox },
  { kind: "broken", label: S.legendBroken },
  { kind: "pending", label: S.legendPending },
  { kind: "target", label: S.legendTarget },
  { kind: "stop", label: S.legendStop },
  { kind: "rsi", label: S.legendRsi },
];

export const BoxChartCard = memo(function BoxChartCard({ view }: { view: BoxesView }) {
  const [tf, setTf] = useState<BoxTf>("4h");
  const feedId = BOX_FEED[tf];
  const feed = useFeedSelect(feedId, selectBars, sameBarKey);
  const symbol = view.symbol ?? "";
  // 4h: one history page so the oldest boxes have their bars (the provider's ring keeps ~600)
  const [older, setOlder] = useState<{ symbol: string; candles: Candle[] }>({ symbol: "", candles: [] });
  useEffect(() => {
    if (tf !== "4h" || !symbol || older.symbol === symbol) return;
    const p = getProvider();
    if (!p) return;
    let cancelled = false;
    const now = Date.now();
    p.history("kline_4h", { from: now - HISTORY_4H_DAYS * 86_400_000, to: now })
      .then((res) => {
        if (!cancelled) setOlder({ symbol, candles: res.data });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tf, symbol, older.symbol]);
  const candles = useMemo(() => {
    const data = feed?.data ?? [];
    return tf === "4h" && older.symbol === symbol && older.candles.length ? merge(older.candles, data) : data.slice();
    // `feed` identity changes per new bar only (bar-key selector)
  }, [feed, tf, older, symbol]);

  const analysis = view.tfs[tf].analysis;
  const liveFrom = view.tfs[tf].liveFrom ?? null;
  const boxesKeyed = useMemo(() => {
    const b = toChartBoxes(analysis, { intervalMs: BOX_TF_MS[tf], liveFrom });
    return { key: chartBoxesKey(b), boxes: b };
  }, [analysis, tf, liveFrom]);
  // identity per content: the chart re-sets the boxes only when something drawn changed
  const [stable, setStable] = useState(boxesKeyed);
  if (stable.key !== boxesKeyed.key) setStable(boxesKeyed);

  const subscribeBars = useCallback((listener: BarsListener) => subscribeFeed(feedId, (v) => v && listener(v.data, v.asOf)), [feedId]);

  return (
    <Card
      title={S.title}
      note={S.note}
      action={<Segmented<BoxTf> size="sm" aria-label={S.tf} options={TFS} value={tf} onChange={setTf} />}
      data-testid="markt-chart"
    >
      <div data-tf={tf} data-boxes={stable.boxes.length}>
        <Suspense fallback={<ChartSkeleton className="h-[360px] md:h-[480px]" />}>
          <NothingCandleChart
            key={symbol}
            candles={candles}
            interval={INTERVAL[tf]}
            boxes={stable.boxes}
            boxAutoscale
            pane="rsi"
            rangeDays={RANGE[tf]}
            price={priceMv}
            tradeTime={tradeTimeMv}
            tickDir={tickDirMv}
            tradeVolume={volAccumMv}
            subscribeBars={subscribeBars}
            followLabel="Folgen"
            className="h-[360px] md:h-[480px]"
          />
        </Suspense>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11px] text-faint" data-testid="markt-chart-legend">
        {LEGEND.map((l) => (
          <span key={l.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Glyph kind={l.kind} />
            {l.label}
          </span>
        ))}
      </div>
    </Card>
  );
});
