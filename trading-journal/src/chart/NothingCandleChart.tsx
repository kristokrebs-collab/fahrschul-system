/**
 * NothingCandleChart – lightweight-charts 5.2.1 candlestick chart in the monochrome "Nothing" theme
 * (Plan 5.1–5.6). Creates the chart once (StrictMode-safe), `setData` per history load (newer bars on the right are
 * appended in place instead), a live forming candle that moves with every trade (`liveCandle.ts`), a DOM price pulse,
 * price lines + zone for `levels`, trade markers with a new-trade ripple, MCB signal dots (`signals`, own marker
 * layer), optional ratio/OI pane, range morph, interval strip wipe / pane crossfade, a "Folgen" pill away from the live
 * edge, spring tooltip and a skeleton → entrance. Tick labels next to a level / zone / last-price label are blanked
 * (`axisLabels.ts`), so no axis text overlaps.
 */
import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AnimatePresence, animate, motion, useReducedMotion, type MotionValue } from "motion/react";
import {
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, OpenInterestPoint, RatioPoint } from "@/market/types";
import type { MarketLevels } from "@/domain/types";
import { observeInView } from "@/motion/inView";
import { playStripWipe } from "@/motion/pulse/StripWipe";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { CHART_FONT, CHART_FONT_LOAD, CHART_PRICE_MIN_MOVE, CHART_RIGHT_OFFSET, NOTHING_DARK, ink } from "./theme";
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
import { clearLevels, LEVEL_KEYS, setLevels, zoneIsSet, type ActiveScenario, type LevelLines } from "./levels";
import { filterTickLabels } from "./axisLabels";
import { fmt } from "./format";
import { buildSignalMarkers, signalMarkersKey, type SignalMarker } from "./signalMarkers";
import {
  MARKER_ENTRY_PREFIX,
  MARKER_EXIT_PREFIX,
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
import { RangeAnimator, rangeForDays, rightOffsetBars, type RightOffset } from "./animateRange";
import { ChartTooltip, type TooltipData, type TooltipHandle } from "./tooltip";
import { ChartSkeleton } from "./ChartSkeleton";
import { LiveCandle, extendsTail, type Bar } from "./liveCandle";
import { FollowPill, LivePulse, isAwayFromRealtime, spawnMarkerRipple, type PulseHandle, type PulsePoint } from "./overlays";

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
  /** Glide back to the live edge, keeping the zoom (the "Folgen" pill). */
  follow(): void;
  takeScreenshot(): HTMLCanvasElement | null;
  readonly chart: IChartApi | null;
}

/** Kline bars (ascending, ms open times) and the exchange time they describe; called at most once per frame. */
export type BarsListener = (bars: readonly Candle[], asOf: number) => void;
export type SubscribeBars = (listener: BarsListener) => () => void;

export interface NothingCandleChartProps {
  ref?: Ref<ChartHandle>;
  /** history (stable identity per load – live updates go through `price` / `subscribeBars` / `live`) */
  candles: Candle[];
  interval: ChartInterval;
  levels?: MarketLevels;
  /** highlights the trigger line of the active scenario */
  activeScenario?: ActiveScenario;
  markers?: TradeMarker[];
  /** MCB events of the entry check for this interval (dots below / above the bars) */
  signals?: SignalMarker[];
  ratio?: RatioPoint[];
  oi?: OpenInterestPoint[];
  pane?: PaneKind;
  rangeDays?: RangeDays;
  /** last traded price: every print moves the forming candle (the close jumps; the canvas never glides) */
  price?: MotionValue<number>;
  /** exchange time (ms) of the print in `price` (buckets the forming candle); required with `price` */
  tradeTime?: MotionValue<number>;
  /** `+1` / `−1` direction of the last move: tints the price pulse */
  tickDir?: MotionValue<number>;
  /** monotonic traded volume: grows the forming bar's volume between klines */
  tradeVolume?: MotionValue<number>;
  /** imperative kline stream: authoritative OHLC / volume and new bars, without a React render */
  subscribeBars?: SubscribeBars;
  /** forming candle as a prop (applied as an authoritative kline, without glide) */
  live?: Candle;
  /** card collapsed: nothing is pushed to the canvas, no pulse, no pill */
  paused?: boolean;
  /** label of the floating "back to the live edge" pill; omit to hide the pill */
  followLabel?: string;
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
  /** MCB signal dots (separate layer under the trade markers) */
  signalsApi: ISeriesMarkersPluginApi<Time>;
  /** `signalMarkersKey` + data length of the last signal sync */
  signalsKey: string;
  range: RangeAnimator;
  live: LiveCandle;
  levels: LevelLines | null;
  built: BuiltMarkers | null;
  /** trade ids that had a marker after the last sync; `null` right after a history load (seed, no ripple) */
  markerIds: Set<string> | null;
  bounds: HistoryBounds | null;
  data: CandlestickData<UTCTimestamp>[];
  lastInterval: ChartInterval | null;
  pane: PaneKind | null;
  fontReady: Promise<void>;
  overlay: HTMLCanvasElement | null;
  /** cancels a running interval strip wipe (removes its overlay) */
  cancelWipe: (() => void) | null;
  /** host size from a ResizeObserver (tooltip bounds without a layout read per move) */
  size: { width: number; height: number };
  /** ready, on screen and not collapsed */
  isActive(): boolean;
  /** re-evaluates `isActive` for the pulse and the live engine */
  syncActive(): void;
  /** places the pulse right after lightweight-charts drew its next frame */
  requestPlace(): void;
}

type Callbacks = Pick<NothingCandleChartProps, "onMarkerClick" | "onCrosshair" | "onOutsideCount">;

const noop = () => undefined;
/** Space between the follow pill and the price scale, px. */
const PILL_GAP = 12;

function loadChartFont(): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  return Promise.race([
    fonts.load(CHART_FONT_LOAD).then(noop, noop),
    new Promise<void>((r) => setTimeout(r, 600)),
  ]);
}

/** Right offset that keeps the price-line titles and the live pulse clear of the last bar (pixel based). */
const rightOffsetOf = (i: Instance): RightOffset => (bars: number) => rightOffsetBars(bars, i.chart.timeScale().width());

function syncLevels(i: Instance, levels: MarketLevels | undefined, active: ActiveScenario, reduced = false): void {
  if (!levels) {
    clearLevels(i.main.candles, i.levels);
    i.levels = null;
    return;
  }
  i.levels = setLevels(i.main.candles, levels, i.levels, { active, from: i.data[0]?.time ?? null, reducedMotion: reduced });
}

/** MCB dots on the bars the chart holds; re-set only when the list or the loaded bars changed. */
function syncSignals(i: Instance, signals: SignalMarker[] | undefined): void {
  const list = signals ?? [];
  const key = `${signalMarkersKey(list)}|${i.data.length}:${i.data[0]?.time ?? 0}`;
  if (key === i.signalsKey) return;
  i.signalsKey = key;
  if (list.length === 0) {
    i.signalsApi.setMarkers([]);
    return;
  }
  const times = new Set<number>();
  for (const d of i.data) times.add(d.time);
  // dots only: words on the canvas collided on clustered events (legend in the card note)
  i.signalsApi.setMarkers(buildSignalMarkers(list, times));
}

function syncMarkers(i: Instance, markers: TradeMarker[] | undefined): BuiltMarkers {
  const src = snapSourceOf(i.main.candles, i.chart.timeScale());
  const built = buildMarkers(markers ?? [], (t) => snapTime(src, t), i.bounds);
  i.built = built;
  i.markersApi.setMarkers(built.markers);
  return built;
}

/** Trade ids that gained a marker since the last sync (none on the seeding sync after a history load). */
function freshMarkerIds(i: Instance, built: BuiltMarkers): string[] {
  const ids = new Set(built.byId.values());
  const prev = i.markerIds;
  i.markerIds = ids;
  if (!prev) return [];
  return [...ids].filter((id) => !prev.has(id));
}

function markerRect(node: HTMLElement, x: number, y: number, size = 16): MarkerRect {
  const host = node.getBoundingClientRect();
  const left = host.left + x - size / 2;
  const top = host.top + y - size / 2;
  return { x: left, y: top, width: size, height: size, top, left, right: left + size, bottom: top + size };
}

/** Chart-relative px of `price` at bar `time` when it lies inside pane 0, else `null`. */
function pointInPane(i: Instance, time: Time, price: number): PulsePoint | null {
  const ts = i.chart.timeScale();
  const x = ts.timeToCoordinate(time);
  const y = i.main.candles.priceToCoordinate(price);
  if (x === null || y === null) return null;
  const height = i.chart.panes()[0]?.getHeight() ?? i.size.height;
  return x >= 0 && x <= ts.width() && y >= 0 && y <= height ? { x, y } : null;
}

/** First opaque background colour behind `el` (one style read per wipe). */
function surfaceColor(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return "#0a0a0a";
}

/**
 * The chart canvas is transparent (the card shows through): a strip of the OLD chart must hide the new one beneath it,
 * so the snapshot gets the card surface painted under it.
 */
function opaque(snap: HTMLCanvasElement, wrap: HTMLElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = snap.width;
  out.height = snap.height;
  const ctx = out.getContext("2d");
  if (!ctx) return snap;
  ctx.fillStyle = surfaceColor(wrap);
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(snap, 0, 0);
  return out;
}

/**
 * Interval switch (pulse `parallax-strip-slider`): the old chart, as a screenshot over the new one, gives way in 10
 * vertical strips left → right, so the new interval grows in strip by strip. Compositor-only; a new switch cancels
 * the running wipe.
 */
function stripWipe(i: Instance, wrap: HTMLElement | null): void {
  if (!wrap) return;
  i.cancelWipe?.();
  i.cancelWipe = null;
  i.overlay?.remove();
  i.overlay = null;
  try {
    const snap = opaque(i.chart.takeScreenshot(true, false), wrap);
    snap.setAttribute("aria-hidden", "true");
    i.cancelWipe = playStripWipe(wrap, snap, {
      onDone: () => {
        i.cancelWipe = null;
      },
    });
  } catch {
    /* screenshot unavailable (e.g. tainted canvas) */
  }
}

/** Screenshot of the current canvas faded out on top of the new state (sub-pane switch). */
function crossfade(i: Instance, wrap: HTMLElement | null): void {
  if (!wrap) return;
  i.cancelWipe?.();
  i.cancelWipe = null;
  try {
    const snap = i.chart.takeScreenshot(true, false);
    snap.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5";
    snap.setAttribute("aria-hidden", "true");
    i.overlay?.remove();
    i.overlay = snap;
    wrap.appendChild(snap);
    animate(snap, { opacity: [1, 0] }, { ...tween.crossfade, onComplete: () => snap.remove() });
  } catch {
    /* screenshot unavailable (e.g. tainted canvas) */
  }
}

export const NothingCandleChart = memo(function NothingCandleChart({
  ref,
  candles,
  interval,
  levels,
  activeScenario = null,
  markers,
  signals,
  ratio,
  oi,
  pane = "none",
  rangeDays = 30,
  price,
  tradeTime,
  tickDir,
  tradeVolume,
  subscribeBars,
  live,
  paused = false,
  followLabel,
  onMarkerClick,
  onCrosshair,
  onOutsideCount,
  height,
  tooltip = true,
  className,
}: NothingCandleChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ripples = useRef<HTMLDivElement>(null);
  const pulse = useRef<PulseHandle>(null);
  const inst = useRef<Instance | null>(null);
  const tip = useRef<TooltipHandle>(null);
  const cb = useRef<Callbacks>({});
  const latest = useRef<{ markers?: TradeMarker[]; signals?: SignalMarker[]; levels?: MarketLevels; activeScenario: ActiveScenario }>({ activeScenario: null });
  const reduceRef = useRef(false);
  const readyRef = useRef(false);
  const visibleRef = useRef(true);
  const pausedRef = useRef(paused);
  const awayRef = useRef(false);
  const [ready, setReady] = useState(false);
  /** `null` at the live edge; otherwise the pill's distance from the right edge */
  const [follow, setFollow] = useState<{ right: number } | null>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    cb.current = { onMarkerClick, onCrosshair, onOutsideCount };
  }, [onMarkerClick, onCrosshair, onOutsideCount]);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);
  useEffect(() => {
    latest.current = { markers, signals, levels, activeScenario };
  }, [markers, signals, levels, activeScenario]);

  // 1. create once; full teardown (StrictMode-safe). A passive effect, not a layout effect: a keep-alive <Activity>
  // re-show re-runs it, and createChart's forced layout must land after the reveal paint, not inside its commit
  // (perf review perf-08). Every later effect and the imperative handle null-guard `inst`.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const chart = createChart(node, NOTHING_DARK);
    const main = createMainSeries(chart);
    const panes = new PaneController(chart);
    // MCB dots first (normal z-order, with the series), trade markers above them
    const signalsApi = createSeriesMarkers(main.candles, [], { zOrder: "normal" });
    const markersApi = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    const range = new RangeAnimator(chart, { reducedMotion: () => reduceRef.current });
    let placeRaf = 0;
    const isActive = () => readyRef.current && visibleRef.current && !pausedRef.current;
    const place = () => {
      placeRaf = 0;
      if (inst.current !== instance) return;
      const last = instance.data[instance.data.length - 1];
      pulse.current?.place(isActive() && last ? pointInPane(instance, last.time, last.close) : null);
    };
    const live = new LiveCandle({
      host: {
        get data(): Bar[] {
          return instance.data;
        },
      },
      target: main,
      isActive,
      // the canvas never glides: a spring on the close pushed `series.update` (a full canvas repaint) on every display
      // frame while trades flow. Every print jumps the close, coalesced to ≤ 1 push per frame with a print or kline;
      // only the DOM price pulse moves by transform (perf review perf-03)
      isSmooth: () => false,
      minMove: CHART_PRICE_MIN_MOVE,
      onAppend: () => {
        const last = instance.data[instance.data.length - 1];
        if (instance.bounds && last) instance.bounds = { ...instance.bounds, last: last.time };
        panes.setGrid(instance.data.map((d) => d.time));
      },
      onPush: () => instance.requestPlace(),
    });
    const instance: Instance = {
      chart,
      node,
      main,
      panes,
      markersApi,
      signalsApi,
      signalsKey: "",
      range,
      live,
      levels: null,
      built: null,
      markerIds: null,
      bounds: null,
      data: [],
      lastInterval: null,
      pane: null,
      fontReady: loadChartFont(),
      overlay: null,
      cancelWipe: null,
      size: { width: 0, height: 0 },
      isActive,
      syncActive: () => {
        pulse.current?.setActive(isActive());
        live.resume();
        instance.requestPlace();
      },
      // lightweight-charts draws in its own rAF, requested by update()/range changes: queue behind it so the pulse
      // lands in the same frame as the candle it marks
      requestPlace: () => {
        if (!placeRaf) placeRaf = requestAnimationFrame(place);
      },
    };
    inst.current = instance;

    instance.fontReady.then(() => {
      if (inst.current === instance) chart.applyOptions({ layout: { fontFamily: CHART_FONT } });
    });

    // axis collision guard: ticks next to a level / zone / last-price label stay blank (the label shows the price)
    chart.applyOptions({
      localization: {
        tickmarksPriceFormatter: (prices: readonly number[]) => {
          const lv = latest.current.levels;
          const labels: number[] = [];
          if (lv) {
            for (const k of LEVEL_KEYS) if (lv[k] > 0) labels.push(lv[k]);
            if (zoneIsSet(lv)) labels.push(lv.zoneLow, lv.zoneHigh);
          }
          const last = instance.data[instance.data.length - 1];
          if (last) labels.push(last.close);
          return filterTickLabels(prices, labels, (p) => main.candles.priceToCoordinate(p), (p) => fmt.price(p));
        },
      },
    });

    const sizeOf = () => {
      if (instance.size.width === 0) instance.size = { width: node.clientWidth, height: node.clientHeight };
      return instance.size;
    };
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (!r) return;
            instance.size = { width: r.width, height: r.height };
            instance.requestPlace();
          })
        : null;
    ro?.observe(node);

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
      tip.current?.move({ x: point.x, y: point.y }, data, sizeOf());
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
    const onRange = (r: LogicalRange | null) => {
      if (inst.current !== instance) return;
      instance.requestPlace();
      const away = isAwayFromRealtime(r, instance.data.length - 1);
      if (away === awayRef.current) return;
      awayRef.current = away;
      setFollow(away ? { right: chart.priceScale("right").width() + PILL_GAP } : null);
    };
    const stopMorph = () => range.cancel();
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    node.addEventListener("wheel", stopMorph, { passive: true });
    node.addEventListener("pointerdown", stopMorph);
    const offView = wrap.current
      ? observeInView(wrap.current, (inView) => {
          visibleRef.current = inView;
          instance.syncActive();
        })
      : noop;

    return () => {
      offView();
      ro?.disconnect();
      node.removeEventListener("wheel", stopMorph);
      node.removeEventListener("pointerdown", stopMorph);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      if (placeRaf) cancelAnimationFrame(placeRaf);
      placeRaf = 0;
      live.dispose();
      instance.overlay?.remove();
      instance.cancelWipe?.();
      range.dispose();
      markersApi.detach();
      signalsApi.detach();
      clearLevels(main.candles, instance.levels);
      panes.dispose();
      inst.current = null;
      readyRef.current = false;
      // `awayRef` is NOT reset: it mirrors the `follow` state, which a keep-alive <Activity> preserves across this
      // cleanup – the re-created chart's first live-edge range event must still see "away" and hide the pill
      chart.remove();
    };
  }, []);

  // 2. history → setData (once per array identity); newer bars on the right → live engine; interval → strip wipe
  useEffect(() => {
    const i = inst.current;
    if (!i || candles.length === 0) return;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    const apply = () => {
      if (cancelled || inst.current !== i) return;
      const data = normalizeSeries(candles.map(toCandleData));
      const intervalChanged = i.lastInterval !== null && i.lastInterval !== interval;
      const first = i.data.length === 0;

      if (!first && !intervalChanged && extendsTail(i.data, data)) {
        // the same history plus a new bar: append in place (keeps the window, follows the live edge, no full repaint).
        // Bars the chart already holds are kept: the kline stream / trades have updated them since this snapshot.
        const lastSec = i.data[i.data.length - 1]?.time ?? 0;
        const added = candles.slice(-(data.length - i.data.length + 1)).filter((c) => sec(c.time) > lastSec);
        if (added.length > 0) i.live.bars(added, 0);
        return;
      }

      const prevRange = i.chart.timeScale().getVisibleLogicalRange();
      const prevFirst = i.data[0]?.time;
      if (intervalChanged && readyRef.current && !reduceRef.current) stripWipe(i, wrap.current);

      const volume = normalizeSeries(candles.map(toVolumeData));
      const last = data[data.length - 1];
      // before setData: range-change callbacks fired from inside it must see the new bars
      i.data = data;
      i.lastInterval = interval;
      i.bounds = boundsOf(data, INTERVAL_SECONDS[interval]);
      i.main.candles.setData(data);
      i.main.volume.setData(volume);
      i.live.reset(interval, volume[volume.length - 1]?.value ?? 0);
      // sub pane shares the time scale → snap its points onto the candle grid (no whitespace slots)
      i.panes.setGrid(data.map((d) => d.time));

      if (first || intervalChanged) {
        const target = rangeForDays(
          { timeToIndex: (t, n) => i.chart.timeScale().timeToIndex(t, n), length: data.length, lastTime: last?.time ?? null },
          rangeDays,
          interval,
          rightOffsetOf(i),
        );
        if (target) i.range.goTo(target, false);
      } else if (prevRange) {
        // same interval, different history (older bars prepended, source switch): keep the user's window on the same
        // bars – prepended bars shift every logical index by their count
        const shift = prevFirst === undefined ? 0 : Math.max(0, data.findIndex((d) => d.time === prevFirst));
        i.chart.timeScale().setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
      }
      // levels & markers depend on the loaded bars (zone left edge, snapping, bounds)
      syncLevels(i, latest.current.levels, latest.current.activeScenario, reduceRef.current);
      i.markerIds = null;
      syncSignals(i, latest.current.signals);
      const built = syncMarkers(i, latest.current.markers);
      freshMarkerIds(i, built);
      cb.current.onOutsideCount?.(built.outside);
      i.requestPlace();

      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled || inst.current !== i) return;
          readyRef.current = true;
          setReady(true);
          i.syncActive();
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
      rightOffsetOf(i),
    );
    if (target) i.range.goTo(target, true);
  }, [rangeDays, interval]);

  // 4a. forming candle as a prop: an authoritative kline
  useEffect(() => {
    const i = inst.current;
    if (i && live) i.live.bars([live], Number.POSITIVE_INFINITY);
  }, [live]);

  // 4b. trades: every print moves the forming candle and pings the pulse (MotionValue events, no React render)
  useEffect(() => {
    const i = inst.current;
    if (!i || !price || !tradeTime) return;
    const disconnect = i.live.connect({ price, tradeTime, volume: tradeVolume });
    let prev = price.get();
    const offTick = price.on("change", (p) => {
      const dir = tickDir ? tickDir.get() : Math.sign(p - prev);
      prev = p;
      if (p > 0) pulse.current?.tick(dir);
    });
    return () => {
      offTick();
      disconnect();
    };
  }, [price, tradeTime, tickDir, tradeVolume]);

  // 4c. kline stream: reconcile OHLC / volume, open bars (ignored until the history of this interval is loaded)
  useEffect(() => {
    const i = inst.current;
    if (!i || !subscribeBars) return;
    return subscribeBars((bars, asOf) => {
      if (inst.current === i && i.lastInterval === interval) i.live.bars(bars, asOf);
    });
  }, [subscribeBars, interval]);

  // 5. levels → price lines + zone (update in place)
  useEffect(() => {
    const i = inst.current;
    if (i) syncLevels(i, levels, activeScenario, reduceRef.current);
  }, [levels, activeScenario]);

  // 6. markers (re-snapped after every history load, see step 2); a newly saved trade ripples at its marker
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    const built = syncMarkers(i, markers);
    cb.current.onOutsideCount?.(built.outside);
    const fresh = freshMarkerIds(i, built).slice(0, 3);
    if (fresh.length === 0 || reduceRef.current || !i.isActive()) return;
    // after lightweight-charts drew the new markers
    const raf = requestAnimationFrame(() => {
      const layer = ripples.current;
      if (!layer || inst.current !== i) return;
      for (const id of fresh) {
        const m = built.markers.find((x) => x.id === MARKER_ENTRY_PREFIX + id) ?? built.markers.find((x) => x.id === MARKER_EXIT_PREFIX + id);
        const at = m && m.price != null ? pointInPane(i, m.time, m.price) : null;
        if (m && at) spawnMarkerRipple(layer, at, m.color ?? ink.fg);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [markers]);

  // 6b. MCB signal dots (≤ 1 update per published signal check; re-synced after every history load, see step 2)
  useEffect(() => {
    const i = inst.current;
    if (i && i.data.length) syncSignals(i, signals);
  }, [signals]);

  // 7. optional sub pane; switching the kind crossfades from a screenshot
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    if (i.pane !== null && i.pane !== pane && readyRef.current && !reduceRef.current) crossfade(i, wrap.current);
    i.pane = pane;
    i.panes.setData({ ratio, oi });
    i.panes.set(pane);
    i.requestPlace();
  }, [pane, ratio, oi]);

  // 8. collapsed card: stop pushing to the canvas and park the pulse
  useEffect(() => {
    pausedRef.current = paused;
    inst.current?.syncActive();
  }, [paused]);

  const followLive = () => {
    const i = inst.current;
    if (!i) return;
    const r = i.chart.timeScale().getVisibleLogicalRange();
    const last = i.data.length - 1;
    if (!r || last < 0) {
      i.chart.timeScale().scrollToRealTime();
      return;
    }
    const to = last + Math.max(CHART_RIGHT_OFFSET, rightOffsetBars(r.to - r.from, i.chart.timeScale().width()));
    i.range.goTo({ from: to - (r.to - r.from), to }, true);
  };

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
          rightOffsetOf(i),
        );
        if (target) i.range.goTo(target, animated);
      },
      follow: followLive,
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
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
          <div ref={ripples} className="absolute inset-0" />
          <LivePulse ref={pulse} reduced={reduce} />
        </div>
        {tooltip ? <ChartTooltip ref={tip} /> : null}
      </motion.div>
      {followLabel ? <FollowPill show={showChart && !paused && follow !== null} label={followLabel} right={follow?.right ?? 0} reduced={reduce} onFollow={followLive} /> : null}
      <AnimatePresence initial={false}>{showChart ? null : <ChartSkeleton key="skeleton" />}</AnimatePresence>
    </div>
  );
});
