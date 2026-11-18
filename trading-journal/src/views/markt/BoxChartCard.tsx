/**
 * `Box-Chart` (P02): an own `NothingCandleChart` (the overview chart is a separate, keep-alive instance) on 4h / 1D / 1W
 * with the Box-zu-Box boxes and targets (`boxes`, autoscaled) and the RSI pane with its diagonal trendlines. Switching
 * the timeframe wipes the new picture in strip by strip (`StripWipe` inside the chart); new boxes draw in, a fresh RSI
 * break breathes (`GlowBreak`). History: the provider's series (4h extended once by `provider.history`), the forming bar
 * from the trade stream and the kline frames – never a React render per tick.
 */
import { themePaint } from "@/lib/themePaint";
import { cn } from "@/lib/cn";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChartSkeleton } from "@/chart/ChartSkeleton";
import type { BarsListener, RangeDays } from "@/chart/NothingCandleChart";
import type { ChartInterval } from "@/chart/panes";
import type { ChartBox } from "@/chart/primitives/BoxPrimitive";
import type { ChartTrendline } from "@/chart/primitives/TrendlinePrimitive";
import { lastClosedAnchor } from "@/chart/mirror";
import { toTradeMarkers } from "@/chart/markers";
import { BOX_TF_MS, normalizeWatchSymbol, type BoxTf } from "@/domain/boxes";
import { analyzeTrendlines, trendlinesCfgOf } from "@/domain/trendlines";
import type { KeyTf } from "@/domain/keylevels";
import type { BiasContext, BiasTest } from "@/domain/biasTest";
import { getProvider, priceMv, subscribeFeed, tickDirMv, tradeTimeMv, useFeedSelect, volAccumMv, type Candle, type Stamped } from "@/market";
import { BOX_FEED, type BoxesView } from "@/market/boxes/store";
import { useKeyLines } from "@/market/keylevels/chartLines";
import { useTrendView } from "@/market/trendlines/useTrendView";
import { writeTrendlines } from "@/market/trendlines/write";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched, useJournal } from "@/store/journalStore";
import { MirrorPanel, useFrozenBars, useMirrorState, visibleMarkers } from "@/views/biasTest";
import { BIAS } from "@/views/biasTest/strings";
import { chartBoxesKey, toChartBoxes } from "./chartBoxes";
import { chartTrendlinesKey, toChartTrendlines } from "./chartTrendlines";
import { MARKT, TF_TEXT } from "./strings";
import { TREND } from "./trendStrings";

const NO_BOXES: ChartBox[] = [];
const NO_LINES: ChartTrendline[] = [];
const KEY_TF: Readonly<Record<BoxTf, KeyTf>> = { "4h": "4h", "1d": "1D", "1w": "1W" };
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
function Glyph({ kind }: { kind: "box" | "brokenUp" | "brokenDown" | "pending" | "target" | "stop" | "rsi" | "trend" }) {
  const common = { width: 18, height: 10, viewBox: "0 0 18 10", "aria-hidden": true, className: "shrink-0" } as const;
  if (kind === "box" || kind === "brokenUp" || kind === "brokenDown" || kind === "pending") {
    // a box broken up is drawn in the win tone, one broken down in the loss tone (BoxPrimitive `toneOf`)
    const tone = kind === "brokenUp" ? "var(--color-win)" : kind === "brokenDown" ? "var(--color-loss)" : null;
    const c = tone ?? (kind === "pending" ? themePaint("#65b488") : themePaint("#9b9b9b"));
    return (
      <svg {...common}>
        <rect x="1" y="1.5" width="16" height="7" fill={tone ? `color-mix(in srgb, ${tone} 12%, transparent)` : "rgb(var(--veil-rgb, 255 255 255) / 0.08)"} stroke={c} strokeWidth="1" strokeDasharray={kind === "pending" ? "2 2" : undefined} />
      </svg>
    );
  }
  const stroke = kind === "stop" ? "var(--color-loss)" : kind === "target" ? "var(--color-win)" : themePaint("#9b9b9b");
  return (
    <svg {...common}>
      <path d={kind === "rsi" || kind === "trend" ? "M1 2 L17 8" : "M1 5 H17"} stroke={stroke} strokeWidth="1.25" strokeDasharray={kind === "target" ? "1.5 2.5" : kind === "stop" ? "4 3" : undefined} strokeLinecap="round" />
    </svg>
  );
}

const LEGEND: readonly { kind: Parameters<typeof Glyph>[0]["kind"]; label: string }[] = [
  { kind: "box", label: S.legendBox },
  { kind: "brokenUp", label: S.legendBrokenUp },
  { kind: "brokenDown", label: S.legendBrokenDown },
  { kind: "pending", label: S.legendPending },
  { kind: "target", label: S.legendTarget },
  { kind: "stop", label: S.legendStop },
  { kind: "rsi", label: S.legendRsi },
  { kind: "trend", label: TREND.legend },
];

export const BoxChartCard = memo(function BoxChartCard({ view }: { view: BoxesView }) {
  const [tf, setTf] = useState<BoxTf>("4h");
  const feedId = BOX_FEED[tf];
  const feed = useFeedSelect(feedId, selectBars, sameBarKey);
  const symbol = view.symbol ?? "";
  // the user's own key levels (F09) as lines in this chart as well
  const keyLines = useKeyLines(symbol);
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

  // "Chart spiegeln / Bias prüfen" (F62): the mirror, the layers and – during a test – the frozen picture
  const mirror = useMirrorState("markt");
  const shownCandles = useFrozenBars(candles, mirror.anchorMs);
  // price trendlines (F05): the store loads only while the switch is on; a frozen bias-test picture computes its own lines
  // from the frozen bars of the chart's timeframe (nothing after the anchor may shape a line)
  const trendCfg = trendlinesCfgOf(useJournal((st) => st.settings.trendlines));
  const trendOn = trendCfg.chart && mirror.view.layers.trendlines;
  const trendView = useTrendView(trendOn && !mirror.frozen);
  const trendLines = useMemo(() => {
    if (!trendOn) return NO_LINES;
    if (mirror.frozen) {
      // "now" of the frozen picture = the close of its last bar: the lines of that moment, with no clock involved
      const lastBar = shownCandles[shownCandles.length - 1];
      const a = analyzeTrendlines(shownCandles, KEY_TF[tf], lastBar ? lastBar.time + BOX_TF_MS[tf] : 0);
      return toChartTrendlines([{ tf: KEY_TF[tf], selected: true, avail: { tf: KEY_TF[tf], ok: true, reason: null }, analysis: a }], BOX_TF_MS[tf]);
    }
    return trendView ? toChartTrendlines(trendView.items, BOX_TF_MS[tf]) : NO_LINES;
  }, [trendOn, trendView, tf, mirror.frozen, shownCandles]);
  const trendKeyed = useMemo(() => ({ key: chartTrendlinesKey(trendLines), lines: trendLines }), [trendLines]);
  const [trendStable, setTrendStable] = useState(trendKeyed);
  if (trendStable.key !== trendKeyed.key) setTrendStable(trendKeyed);
  const trades = useEnriched();
  const markers = useMemo(() => {
    if (!mirror.view.layers.trades || !symbol) return undefined;
    const own = toTradeMarkers(trades.filter((t) => normalizeWatchSymbol(t.pair) === symbol));
    return visibleMarkers(own, { layerOn: true, anchorMs: mirror.anchorMs, intervalMs: BOX_TF_MS[tf], blind: mirror.blind });
  }, [trades, symbol, tf, mirror.view.layers.trades, mirror.anchorMs, mirror.blind]);
  const capture = useCallback((): BiasContext | { reason: string } => {
    const anchorMs = lastClosedAnchor(candles, BOX_TF_MS[tf], Date.now());
    return anchorMs == null || !symbol ? { reason: BIAS.setup.noAnchor } : { surface: "markt", symbol, interval: tf, anchorMs };
  }, [candles, tf, symbol]);
  const canResume = useCallback((t: BiasTest) => t.context.symbol === symbol && t.context.interval === tf && candles.some((c) => c.time === t.context.anchorMs), [candles, symbol, tf]);

  return (
    <Card
      title={S.title}
      note={S.note}
      action={<Segmented<BoxTf> size="sm" aria-label={S.tf} options={mirror.frozen ? TFS.map((o) => ({ ...o, disabled: o.v !== tf })) : TFS} value={tf} onChange={setTf} />}
      data-testid="markt-chart"
    >
      <div data-tf={tf} data-boxes={stable.boxes.length} data-trendlines={trendStable.lines.length}>
        <Suspense fallback={<ChartSkeleton className="h-[360px] md:h-[480px]" />}>
          <NothingCandleChart
            key={symbol}
            candles={shownCandles as Candle[]}
            interval={INTERVAL[tf]}
            boxes={mirror.view.layers.boxes ? stable.boxes : NO_BOXES}
            keyLines={keyLines}
            priceLines={trendStable.lines}
            boxAutoscale
            pane={mirror.view.layers.rsi ? "rsi" : "none"}
            rangeDays={RANGE[tf]}
            mirror={mirror.chart}
            markers={markers}
            // a frozen test picture takes no live data: nothing after the anchor may move it
            price={mirror.frozen ? undefined : priceMv}
            tradeTime={mirror.frozen ? undefined : tradeTimeMv}
            tickDir={mirror.frozen ? undefined : tickDirMv}
            tradeVolume={mirror.frozen ? undefined : volAccumMv}
            subscribeBars={mirror.frozen ? undefined : subscribeBars}
            followLabel="Folgen"
            className="h-[360px] md:h-[480px]"
          />
        </Suspense>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11px] text-mute" data-testid="markt-chart-legend">
        {LEGEND.map((l) => (
          <span key={l.kind} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Glyph kind={l.kind} />
            {l.label}
          </span>
        ))}
        <button
          type="button"
          aria-pressed={trendCfg.chart}
          title={TREND.legendHelp}
          onClick={() => void writeTrendlines({ chart: !trendCfg.chart })}
          data-testid="chart-trend-toggle"
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-[color,border-color,background-color] duration-200 pointer-coarse:min-h-11 pointer-coarse:px-3",
            trendCfg.chart ? "border-white/25 bg-white/[0.06] text-fg" : "border-line-2 text-faint hover:text-mute",
          )}
        >
          {TREND.chartShort}
        </button>
      </div>
      <MirrorPanel surface="markt" capture={capture} canResume={canResume} className="mt-3 border-t border-line pt-3" />
    </Card>
  );
});
