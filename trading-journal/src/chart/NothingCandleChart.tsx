/**
 * NothingCandleChart – lightweight-charts 5.2.1 candlestick chart in the monochrome "Nothing" theme
 * (Plan 5.1–5.6). Creates the chart once (StrictMode-safe), `setData` per history load, `update` per
 * live tick, price lines + zone for `levels`, trade markers, optional ratio/OI pane, range morph,
 * interval crossfade, spring tooltip and a skeleton → entrance animation.
 */
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import {
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, OpenInterestPoint, RatioPoint } from "@/market/types";
import type { MarketLevels } from "@/domain/types";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { CHART_FONT, CHART_FONT_LOAD, NOTHING_DARK } from "./theme";
import {
  INTERVAL_SECONDS,
  PaneController,
  createMainSeries,
  normalizeSeries,
  sec,
  toCandleData,
  toVolumeData,
  type ChartInterval,
  type MainSeries,
  type PaneKind,
} from "./panes";
import { clearLevels, setLevels, type ActiveScenario, type LevelLines } from "./levels";
import {
  boundsOf,
  buildMarkers,
  hitMarker,
  markerTradeId,
  snapSourceOf,
  snapTime,
  type BuiltMarkers,
  type HistoryBounds,
  type TradeMarker,
} from "./markers";
import { RangeAnimator, rangeForDays } from "./animateRange";
import { ChartTooltip, type TooltipData, type TooltipHandle } from "./tooltip";
import { ChartSkeleton } from "./ChartSkeleton";

export type RangeDays = 7 | 30 | 90;

/** Viewport-relative box of a clicked marker (morph source for the trade detail ghost). */
export interface MarkerRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface CrosshairPoint {
  /** UTC seconds of the hovered bar */
  time: number;
  /** chart-relative css px */
  x: number;
  y: number;
  /** price under the cursor (pane 0) */
  price: number | null;
  bar: TooltipData | null;
}

export interface ChartHandle {
  /** Morph the visible window to the last `days` days (`animate=false` → jump). */
  fitRange(days: RangeDays, animate?: boolean): void;
  /** `scrollToRealTime()` – the "Folgen" button. */
  follow(): void;
  takeScreenshot(): HTMLCanvasElement | null;
  readonly chart: IChartApi | null;
}

export interface NothingCandleChartProps {
  ref?: Ref<ChartHandle>;
  /** history (stable identity per load – live ticks go through `live`) */
  candles: Candle[];
  interval: ChartInterval;
  levels?: MarketLevels;
  /** highlights the trigger line of the active scenario */
  activeScenario?: ActiveScenario;
  markers?: TradeMarker[];
  ratio?: RatioPoint[];
  oi?: OpenInterestPoint[];
  pane?: PaneKind;
  rangeDays?: RangeDays;
  /** forming candle; applied with `series.update`, coalesced to one update per frame */
  live?: Candle;
  onMarkerClick?: (tradeId: string, rect: MarkerRect) => void;
  /** fires per crosshair move – write to refs/MotionValues, never `setState` here */
  onCrosshair?: (point: CrosshairPoint | null) => void;
  /** number of trades outside the loaded history (for the card note) */
  onOutsideCount?: (n: number) => void;
  /** px; default 300 below `md`, 420 above (via classes) */
  height?: number;
  /** show the built-in OHLC tooltip (default true) */
  tooltip?: boolean;
  className?: string;
}

interface Instance {
  chart: IChartApi;
  node: HTMLDivElement;
  main: MainSeries;
  panes: PaneController;
  markersApi: ISeriesMarkersPluginApi<Time>;
  range: RangeAnimator;
  levels: LevelLines | null;
  built: BuiltMarkers | null;
  bounds: HistoryBounds | null;
  data: CandlestickData<UTCTimestamp>[];
  lastInterval: ChartInterval | null;
  fontReady: Promise<void>;
  overlay: HTMLCanvasElement | null;
}

type Callbacks = Pick<NothingCandleChartProps, "onMarkerClick" | "onCrosshair" | "onOutsideCount">;

const noop = () => undefined;

function loadChartFont(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    fonts.load(CHART_FONT_LOAD).then(noop, noop),
    new Promise<void>((r) => setTimeout(r, 600)),
  ]);
}

function syncLevels(i: Instance, levels: MarketLevels | undefined, active: ActiveScenario, reduced = false): void {
  if (!levels) {
    clearLevels(i.main.candles, i.levels);
    i.levels = null;
    return;
  }
  i.levels = setLevels(i.main.candles, levels, i.levels, { active, from: i.data[0]?.time ?? null, reducedMotion: reduced });
}

function syncMarkers(i: Instance, markers: TradeMarker[] | undefined): BuiltMarkers {
  const src = snapSourceOf(i.main.candles, i.chart.timeScale());
  const built = buildMarkers(markers ?? [], (t) => snapTime(src, t), i.bounds);
  i.built = built;
  i.markersApi.setMarkers(built.markers);
  return built;
}

function markerRect(node: HTMLElement, x: number, y: number, size = 16): MarkerRect {
  const host = node.getBoundingClientRect();
  const left = host.left + x - size / 2;
  const top = host.top + y - size / 2;
  return { x: left, y: top, width: size, height: size, top, left, right: left + size, bottom: top + size };
}

export function NothingCandleChart({
  ref,
  candles,
  interval,
  levels,
  activeScenario = null,
  markers,
  ratio,
  oi,
  pane = "none",
  rangeDays = 30,
  live,
  onMarkerClick,
  onCrosshair,
  onOutsideCount,
  height,
  tooltip = true,
  className,
}: NothingCandleChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const inst = useRef<Instance | null>(null);
  const tip = useRef<TooltipHandle>(null);
  const cb = useRef<Callbacks>({});
  const latest = useRef<{ markers?: TradeMarker[]; levels?: MarketLevels; activeScenario: ActiveScenario }>({ activeScenario: null });
  const reduceRef = useRef(false);
  const readyRef = useRef(false);
  const liveQueue = useRef<{ bar: Candle | null; raf: number }>({ bar: null, raf: 0 });
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    cb.current = { onMarkerClick, onCrosshair, onOutsideCount };
  }, [onMarkerClick, onCrosshair, onOutsideCount]);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);
  useEffect(() => {
    latest.current = { markers, levels, activeScenario };
  }, [markers, levels, activeScenario]);

  // 1. create once; full teardown (StrictMode-safe)
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const chart = createChart(node, NOTHING_DARK);
    const main = createMainSeries(chart);
    const panes = new PaneController(chart);
    const markersApi = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    const range = new RangeAnimator(chart, { reducedMotion: () => reduceRef.current });
    const instance: Instance = {
      chart,
      node,
      main,
      panes,
      markersApi,
      range,
      levels: null,
      built: null,
      bounds: null,
      data: [],
      lastInterval: null,
      fontReady: loadChartFont(),
      overlay: null,
    };
    inst.current = instance;

    instance.fontReady.then(() => {
      if (inst.current === instance) chart.applyOptions({ layout: { fontFamily: CHART_FONT } });
    });

    const onMove = (p: MouseEventParams<Time>) => {
      if (inst.current !== instance) return;
      const point = p.point;
      const bar = point && p.time !== undefined ? p.seriesData.get(main.candles) : undefined;
      const ohlc = bar && "open" in bar ? (bar as CandlestickData<Time>) : null;
      if (!point || p.paneIndex !== 0 || !ohlc || typeof ohlc.time !== "number") {
        tip.current?.hide();
        cb.current.onCrosshair?.(null);
        return;
      }
      const data: TooltipData = {
        time: ohlc.time,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
      };
      tip.current?.move({ x: point.x, y: point.y }, data, { width: node.clientWidth, height: node.clientHeight });
      const price = main.candles.coordinateToPrice(point.y);
      cb.current.onCrosshair?.({ time: ohlc.time, x: point.x, y: point.y, price: price ?? null, bar: data });
    };
    const onClick = (p: MouseEventParams<Time>) => {
      if (inst.current !== instance || !p.point) return;
      let id = markerTradeId(p.hoveredInfo?.objectId);
      if (!id && instance.built) {
        id = hitMarker(
          instance.built.markers,
          p.point,
          (t) => chart.timeScale().timeToCoordinate(t),
          (price) => main.candles.priceToCoordinate(price),
        );
      }
      if (id) cb.current.onMarkerClick?.(id, markerRect(node, p.point.x, p.point.y));
    };
    const stopMorph = () => range.cancel();
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    node.addEventListener("wheel", stopMorph, { passive: true });
    node.addEventListener("pointerdown", stopMorph);

    return () => {
      node.removeEventListener("wheel", stopMorph);
      node.removeEventListener("pointerdown", stopMorph);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      if (liveQueue.current.raf) cancelAnimationFrame(liveQueue.current.raf);
      liveQueue.current = { bar: null, raf: 0 };
      instance.overlay?.remove();
      range.dispose();
      markersApi.detach();
      clearLevels(main.candles, instance.levels);
      panes.dispose();
      inst.current = null;
      chart.remove();
    };
  }, []);

  // 2. history → setData (once per array identity); interval change → screenshot crossfade
  useEffect(() => {
    const i = inst.current;
    if (!i || candles.length === 0) return;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const apply = () => {
      if (cancelled || inst.current !== i) return;
      const data = normalizeSeries(candles.map(toCandleData));
      const volume = normalizeSeries(candles.map(toVolumeData));
      const intervalChanged = i.lastInterval !== null && i.lastInterval !== interval;
      const first = i.data.length === 0;
      const prevRange = i.chart.timeScale().getVisibleLogicalRange();

      if (intervalChanged && readyRef.current && !reduceRef.current && wrap.current) {
        try {
          const snap = i.chart.takeScreenshot(true, false);
          snap.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5";
          i.overlay?.remove();
          i.overlay = snap;
          wrap.current.appendChild(snap);
          animate(snap, { opacity: [1, 0] }, { ...tween.crossfade, onComplete: () => snap.remove() });
        } catch {
          /* screenshot unavailable (e.g. tainted canvas) */
        }
      }

      i.main.candles.setData(data);
      i.main.volume.setData(volume);
      const last = data[data.length - 1];
      i.main.pulse.setData(last ? [{ time: last.time, value: last.close }] : []);
      i.data = data;
      i.lastInterval = interval;
      i.bounds = boundsOf(data, INTERVAL_SECONDS[interval]);
      // sub pane shares the time scale → snap its points onto the candle grid (no whitespace slots)
      i.panes.setGrid(data.map((d) => d.time));

      if (first || intervalChanged) {
        const target = rangeForDays(
          { timeToIndex: (t, n) => i.chart.timeScale().timeToIndex(t, n), length: data.length, lastTime: last?.time ?? null },
          rangeDays,
          interval,
        );
        if (target) i.range.goTo(target, false);
      } else if (prevRange) {
        // same interval: keep the user's window (indices of existing bars are stable when bars append on the right)
        i.chart.timeScale().setVisibleLogicalRange(prevRange);
      }
      // levels & markers depend on the loaded bars (zone left edge, snapping, bounds)
      syncLevels(i, latest.current.levels, latest.current.activeScenario, reduceRef.current);
      cb.current.onOutsideCount?.(syncMarkers(i, latest.current.markers).outside);

      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled || inst.current !== i) return;
          readyRef.current = true;
          setReady(true);
        });
      });
    };
    i.fontReady.then(apply);
    return () => {
      cancelled = true;
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // rangeDays is applied by its own effect; here it only seeds the first window
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, interval]);

  // 3. range morph on 1W | 1M | 3M
  const lastRange = useRef<RangeDays | null>(null);
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    if (lastRange.current === null) {
      lastRange.current = rangeDays;
      return;
    }
    if (lastRange.current === rangeDays) return;
    lastRange.current = rangeDays;
    const last = i.data[i.data.length - 1];
    const target = rangeForDays(
      { timeToIndex: (t, n) => i.chart.timeScale().timeToIndex(t, n), length: i.data.length, lastTime: last?.time ?? null },
      rangeDays,
      interval,
    );
    if (target) i.range.goTo(target, true);
  }, [rangeDays, interval]);

  // 4. live tick → series.update, coalesced to one update per frame
  useEffect(() => {
    const i = inst.current;
    if (!i || !live) return;
    const q = liveQueue.current;
    q.bar = live;
    if (q.raf) return;
    q.raf = requestAnimationFrame(() => {
      q.raf = 0;
      const bar = q.bar;
      q.bar = null;
      const cur = inst.current;
      if (!cur || !bar || cur.data.length === 0) return;
      const time = sec(bar.time);
      const lastTime = cur.bounds?.last ?? 0;
      if (time < lastTime) return; // older than the last bar: update() would throw
      cur.main.candles.update(toCandleData(bar));
      cur.main.volume.update(toVolumeData(bar));
      cur.main.pulse.update({ time, value: bar.close });
      if (time > lastTime) {
        const last = cur.data[cur.data.length - 1];
        if (last && last.time === lastTime) {
          cur.data = [...cur.data, toCandleData(bar)];
          cur.panes.setGrid(cur.data.map((d) => d.time));
        }
        if (cur.bounds) cur.bounds = { ...cur.bounds, last: time };
      }
    });
  }, [live]);

  // 5. levels → price lines + zone (update in place)
  useEffect(() => {
    const i = inst.current;
    if (i) syncLevels(i, levels, activeScenario, reduceRef.current);
  }, [levels, activeScenario]);

  // 6. markers (re-snapped after every history load, see step 2)
  useEffect(() => {
    const i = inst.current;
    if (i) cb.current.onOutsideCount?.(syncMarkers(i, markers).outside);
  }, [markers]);

  // 7. optional sub pane
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    i.panes.setData({ ratio, oi });
    i.panes.set(pane);
  }, [pane, ratio, oi]);

  useImperativeHandle(
    ref,
    () => ({
      fitRange(days, animated = true) {
        const i = inst.current;
        if (!i) return;
        const last = i.data[i.data.length - 1];
        const target = rangeForDays(
          { timeToIndex: (t, n) => i.chart.timeScale().timeToIndex(t, n), length: i.data.length, lastTime: last?.time ?? null },
          days,
          i.lastInterval ?? interval,
        );
        if (target) i.range.goTo(target, animated);
      },
      follow() {
        inst.current?.chart.timeScale().scrollToRealTime();
      },
      takeScreenshot() {
        try {
          return inst.current?.chart.takeScreenshot(true, false) ?? null;
        } catch {
          return null;
        }
      },
      get chart() {
        return inst.current?.chart ?? null;
      },
    }),
    [interval],
  );

  const hasData = candles.length > 0;
  const showChart = ready && hasData;

  return (
    <div
      ref={wrap}
      className={cn("relative w-full overflow-hidden", height == null && "h-[300px] md:h-[420px]", className)}
      style={height == null ? undefined : { height }}
      data-ready={showChart ? "true" : "false"}
    >
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={showChart ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.985 }}
        transition={reduce ? { duration: 0 } : tween.chartIn}
      >
        <div ref={host} className="absolute inset-0" aria-label="Kerzenchart" role="img" />
        {tooltip ? <ChartTooltip ref={tip} /> : null}
      </motion.div>
      <AnimatePresence initial={false}>{showChart ? null : <ChartSkeleton key="skeleton" />}</AnimatePresence>
    </div>
  );
}
