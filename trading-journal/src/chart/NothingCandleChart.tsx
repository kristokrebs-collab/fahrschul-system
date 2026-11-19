/**
 * NothingCandleChart – lightweight-charts 5.2.1 candlestick chart in the monochrome "Nothing" theme
 * (Plan 5.1–5.6). Creates the chart once (StrictMode-safe), `setData` per history load (newer bars on the right are
 * appended in place instead), a live forming candle that moves with every trade (`liveCandle.ts`), a DOM price pulse,
 * price lines + zone for `levels`, trade markers with a new-trade ripple, the Einstiegs-Check overlay (MCB dots by
 * candle-close state, divergence lines, support / resistance, optional structure – `primitives/SignalOverlay.ts`),
 * optional ratio/OI pane, range morph, interval strip wipe / pane crossfade, a "Folgen" pill away from the live
 * edge, spring tooltip and a skeleton → entrance. Tick labels next to a level / zone / last-price / S/R label are
 * blanked (`axisLabels.ts`), so no axis text overlaps.
 *
 * P02: Box-zu-Box boxes + targets (`boxes`, `primitives/BoxPrimitive.ts`, draw-in on first view) and the RSI pane
 * (`pane="rsi"`, `rsiPane.ts`: RSI 14 of the chart's own bars, O(1) live, diagonal trendlines with glowing breaks; the
 * newest fresh break breathes as a DOM `GlowBreak` in the ripple layer; a legend top-left of the pane shows the RSI of
 * the hovered / newest bar, written through a ref).
 */
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
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
import { GlowBreak } from "@/motion/fx/GlowBreak";
import { observeInView } from "@/motion/inView";
import { playStripWipe } from "@/motion/pulse/StripWipe";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { CHART_FONT, CHART_FONT_LOAD, CHART_MIN_BAR_SPACING, CHART_PRICE_MIN_MOVE, CHART_RIGHT_OFFSET, ink, inkCandleOptions, inkChartOptions, inkVolumeOptions, makeNothingTheme, subscribeInk } from "./theme";
import {
  INTERVAL_SECONDS,
  PaneController,
  createMainSeries,
  normalizeSeries,
  sec,
  toCandleData,
  toVolumeData,
  volumeColor,
  type ChartInterval,
  type MainSeries,
  type PaneKind,
} from "./panes";
import { clearKeyLines, clearLevels, LEVEL_KEYS, setLevels, syncKeyLines, zoneIsSet, type ActiveScenario, type KeyLine, type KeyLineHandle, type LevelLines } from "./levels";
import { filterTickLabels } from "./axisLabels";
import { mirrorRsi, NO_MIRROR, type ChartMirror } from "./mirror";
import { fmt } from "./format";
import type { SignalMarker } from "./signalMarkers";
import { DEFAULT_LAYERS, SignalOverlay, type DivergenceLine, type OverlayLayers, type StructureOverlay } from "./primitives/SignalOverlay";
import { BOX_DEBUG_KEY, BoxPrimitive, type BoxDebugHook, type ChartBox } from "./primitives/BoxPrimitive";
import type { ChartTrendline, TrendlinePrimitive } from "./primitives/TrendlinePrimitive";
import { logicalToX } from "./logicalX";
import type { RsiOverlayBreak } from "./primitives/RsiOverlay";
import type { Box } from "./overlayLayout";
import {
  MARKER_ENTRY_PREFIX,
  MARKER_EXIT_PREFIX,
  neutralizeMarkers,
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
import { fitToWidth, RangeAnimator, rangeForDays, rightOffsetBars, type Range, type RightOffset } from "./animateRange";
import { ChartTooltip, type TooltipData, type TooltipHandle } from "./tooltip";
import { ChartSkeleton } from "./ChartSkeleton";
import { LiveCandle, extendsTail, type Bar } from "./liveCandle";
import { FollowPill, LivePulse, isAwayFromRealtime, spawnMarkerRipple, type PulseHandle, type PulsePoint } from "./overlays";

/** Visible window in days (overview pills 1W / 1M / 3M; the Markt chart also uses 6M / 1J / 2J for 1D and 1W bars). */
export type RangeDays = 7 | 30 | 90 | 180 | 365 | 730;

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
  /** the user's own key levels (F09) as lines - the five fixed levels above keep their own */
  keyLines?: readonly KeyLine[];
  /** highlights the trigger line of the active scenario */
  activeScenario?: ActiveScenario;
  markers?: TradeMarker[];
  /** MCB events of the entry check for this interval (dots below / above the bars, styled by candle-close state) */
  signals?: SignalMarker[];
  /** RSI / WaveTrend divergences of this interval (lines between the pivots) */
  divergences?: DivergenceLine[];
  /** market structure + support / resistance of this interval */
  structure?: StructureOverlay | null;
  /** overlay layers shown (legend toggles); default MCB, divergences and S/R on, structure off */
  layers?: OverlayLayers;
  ratio?: RatioPoint[];
  oi?: OpenInterestPoint[];
  /** sub pane: Long/Short ratio, Open Interest or the RSI 14 with its diagonal trendlines (P02) */
  pane?: PaneKind;
  /** Box-zu-Box boxes and their targets (P02, identity = content; a new box id draws in) */
  boxes?: ChartBox[];
  /** keep the boxes overlapping the view and the active box's targets in the price range (default false) */
  boxAutoscale?: boolean;
  /**
   * Diagonal price trendlines (F05, `primitives/TrendlinePrimitive.ts`): lines in time / price, so they follow the mirror
   * (`invertScale`) and also read on a lower interval. The primitive is a separate chunk, loaded with the first line.
   */
  priceLines?: readonly ChartTrendline[];
  rangeDays?: RangeDays;
  /**
   * "Chart spiegeln" (F62, `./mirror.ts`): the price axis runs upside down (`invertScale`) – a DISPLAY change only: bars,
   * prices, times, boxes and every signal stay as they are. `rsiMirrored` inverts the RSI pane too (read as 100−RSI,
   * labelled in the legend); `trendlines` / `breakouts` show or hide those RSI parts. Default: the plain chart.
   */
  mirror?: ChartMirror;
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
  /** Einstiegs-Check overlay: MCB dots, divergences, S/R, structure (under the trade markers) */
  check: SignalOverlay;
  /** Box-zu-Box boxes + targets (P02), under the check overlay */
  boxes: BoxPrimitive;
  /** price trendlines (F05): created with the first line (lazy chunk), `null` before */
  trend: TrendlinePrimitive | null;
  /** the chart was destroyed: a late-loading chunk attaches nothing */
  dead: boolean;
  /** chart-relative top (CSS px) of the sub pane, measured on resize / pane switch only (RSI legend + glow) */
  subTop: number;
  /** blind mode (F62): trade markers in one neutral colour */
  neutral: boolean;
  range: RangeAnimator;
  live: LiveCandle;
  levels: LevelLines | null;
  keyLines: KeyLineHandle | null;
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
  /**
   * Inputs the effects last applied. A parked instance is re-attached when the kept-alive page is shown again and every
   * effect re-runs then: an input it already holds is skipped (no setData / setMarkers / price-line churn on a return).
   */
  applied: {
    candles?: readonly Candle[];
    levels?: { levels: MarketLevels | undefined; active: ActiveScenario };
    markers?: TradeMarker[] | undefined;
    overlay?: readonly unknown[];
    live?: Candle;
    pane?: readonly unknown[];
    boxes?: ChartBox[] | undefined;
    trend?: readonly ChartTrendline[] | undefined;
  };
  /** a history `setData` is waiting for the chart font (effect 2): the canvas is about to change */
  applying: boolean;
  /** ready, on screen and not collapsed */
  isActive(): boolean;
  /** re-evaluates `isActive` for the pulse and the live engine */
  syncActive(): void;
  /** places the pulse right after lightweight-charts drew its next frame */
  requestPlace(): void;
  /** re-reads the sub pane's top after a resize / pane switch (one layout read, in a frame) */
  measurePanes(): void;
  /** something on the canvas starts to move or change: `data-settled` is false until it is still again */
  unsettle(): void;
}

type Callbacks = Pick<NothingCandleChartProps, "onMarkerClick" | "onCrosshair" | "onOutsideCount">;

/** A chart and its lifecycle: `attach` wires the per-shown-period observers (returns their detach), `destroy` tears down. */
interface ChartRecord {
  instance: Instance;
  attach(): () => void;
  destroy(): void;
}

/**
 * Charts parked by a hidden keep-alive page. React runs no cleanup when a hidden subtree unmounts, so a parked chart whose
 * host left the document is torn down by a slow sweep (one timer, only while something is parked).
 */
const PARKED = new Set<ChartRecord>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;
const SWEEP_MS = 10_000;

function sweepParked(): void {
  for (const rec of PARKED) {
    if (rec.instance.node.isConnected) continue;
    PARKED.delete(rec);
    rec.destroy();
  }
  if (PARKED.size === 0 && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function parkChart(rec: ChartRecord): void {
  PARKED.add(rec);
  if (!sweepTimer) sweepTimer = setInterval(sweepParked, SWEEP_MS);
}

function unparkChart(rec: ChartRecord): void {
  PARKED.delete(rec);
  if (PARKED.size === 0 && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

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

/** The last `days` days on the loaded bars, cut to what fits the time scale at the narrowest bar spacing. */
function windowFor(i: Instance, days: RangeDays, interval: ChartInterval): Range | null {
  const last = i.data[i.data.length - 1];
  const ts = i.chart.timeScale();
  const target = rangeForDays({ timeToIndex: (t, n) => ts.timeToIndex(t, n), length: i.data.length, lastTime: last?.time ?? null }, days, interval, rightOffsetOf(i));
  return target ? fitToWidth(target, i.data.length - 1, ts.width(), CHART_MIN_BAR_SPACING) : null;
}

function syncLevels(i: Instance, levels: MarketLevels | undefined, active: ActiveScenario, reduced = false): void {
  i.applied.levels = { levels, active };
  i.unsettle();
  if (!levels) {
    clearLevels(i.main.candles, i.levels);
    i.levels = null;
    return;
  }
  i.levels = setLevels(i.main.candles, levels, i.levels, { active, from: i.data[0]?.time ?? null, reducedMotion: reduced });
}

const NO_MARKERS: SignalMarker[] = [];
const NO_LINES: DivergenceLine[] = [];

/**
 * Prices that already carry a price-axis label: set trigger levels, both zone edges, the last close. The tick formatter
 * blanks ticks next to them (plus the S/R labels the overlay shows); the overlay hides its S/R axis labels next to them.
 */
function axisLabelPrices(i: Instance, levels: MarketLevels | undefined): number[] {
  const out: number[] = [];
  if (levels) {
    for (const k of LEVEL_KEYS) if (levels[k] > 0) out.push(levels[k]);
    if (zoneIsSet(levels)) out.push(levels.zoneLow, levels.zoneHigh);
  }
  for (const l of i.keyLines?.values() ?? []) out.push(l.options().price);
  const last = i.data[i.data.length - 1];
  if (last) out.push(last.close);
  return out;
}

/** The zone band's `ZONE` caption (top left inside the band, CSS px) – overlay labels keep clear of it. */
function zoneCaptionBox(i: Instance, levels: MarketLevels | undefined): Box[] {
  if (!levels || !zoneIsSet(levels) || !i.levels) return [];
  const top = i.main.candles.priceToCoordinate(Math.max(levels.zoneLow, levels.zoneHigh));
  const btm = i.main.candles.priceToCoordinate(Math.min(levels.zoneLow, levels.zoneHigh));
  if (top == null || btm == null || Math.abs(btm - top) < 16) return [];
  const first = i.data[0];
  const x = first ? (i.chart.timeScale().timeToCoordinate(first.time) ?? 0) : 0;
  return [{ x: x + 2, y: Math.min(top, btm) + 1, w: 44, h: 18 }];
}

/** Overlay inputs; the overlay re-indexes itself when the inputs or the loaded bars change. */
function syncOverlay(i: Instance, p: { signals?: SignalMarker[]; divergences?: DivergenceLine[]; structure?: StructureOverlay | null; layers?: OverlayLayers }): void {
  i.applied.overlay = [p.signals, p.divergences, p.structure, p.layers];
  i.unsettle();
  i.check.setMarkers(p.signals ?? NO_MARKERS);
  i.check.setDivergences(p.divergences ?? NO_LINES);
  i.check.setStructure(p.structure ?? null);
  i.check.setLayers(p.layers ?? DEFAULT_LAYERS);
}

const NO_BOXES: ChartBox[] = [];

/** Key of the read-only diagnostics hook of the trendlines on the host element (same value as `TREND_DEBUG_KEY`). */
const TREND_KEY = "__tjTrend";

/** Price trendlines (F05): the primitive's chunk loads with the first line; later calls update it in place. */
function syncTrend(i: Instance, lines: readonly ChartTrendline[] | undefined, now: { neutral: () => boolean; levels: () => MarketLevels | undefined }): void {
  i.applied.trend = lines;
  if (i.trend) {
    i.trend.setLines(lines ?? []);
    return;
  }
  if (!lines?.length) return;
  void import("./primitives/TrendlinePrimitive").then(({ TrendlinePrimitive: Prim }) => {
    if (i.dead || i.trend) return;
    const prim = new Prim({ bars: () => i.data, intervalSec: () => INTERVAL_SECONDS[i.lastInterval ?? "1h"], reserved: () => [...zoneCaptionBox(i, now.levels()), ...i.check.geometry().labels.map((l) => l.box), ...i.boxes.geometry().flatMap((g) => [g.caption, ...g.targets.map((t) => t.label)].flatMap((l) => (l ? [l.box] : [])))] }, { neutral: now.neutral() });
    i.main.candles.attachPrimitive(prim);
    i.trend = prim;
    Object.defineProperty(i.node, TREND_KEY, { value: { lines: () => prim.chartLines(), geometry: () => prim.geometry() }, configurable: true });
    prim.setLines(i.applied.trend ?? []);
  });
}

/** Box-zu-Box boxes (P02): a new id draws in, the rest is re-indexed by the primitive. */
function syncBoxes(i: Instance, boxes: ChartBox[] | undefined): void {
  i.applied.boxes = boxes;
  i.unsettle();
  i.boxes.setBoxes(boxes ?? NO_BOXES);
}

/**
 * Chart-relative top (CSS px) of the sub pane from the chart's model: the panes above plus lightweight-charts' 1 px
 * separator each. No layout read, so `place` re-derives it whenever it runs – a DOM measure taken on a resize went stale
 * when the panes re-laid out afterwards (the RSI glow sat 5 px above its canvas dot, P2-02).
 */
function subPaneTop(i: Instance): number {
  const idx = i.panes.paneIndex();
  if (idx == null) return 0;
  const panes = i.chart.panes();
  let y = 0;
  for (let k = 0; k < idx; k++) y += (panes[k]?.getHeight() ?? 0) + 1;
  return y;
}

/** What the chart's RSI legend and glow write to (refs and MotionValues of the component, reached imperatively). */
interface RsiFx {
  legend: RefObject<HTMLDivElement | null>;
  value: RefObject<HTMLSpanElement | null>;
  ripples: RefObject<HTMLDivElement | null>;
  /** key of the newest fresh break (`time:dir`) */
  glowKey: { current: string | null };
  setGlow: (g: { key: string; dir: 1 | -1 } | null) => void;
  mv: { x: MotionValue<number>; y: MotionValue<number>; shown: MotionValue<number> };
  reduced: () => boolean;
  /** the RSI axis is mirrored (legend shows 100−RSI) */
  mirrored: () => boolean;
  /** blind mode: no win / loss colours */
  neutral: () => boolean;
}

/** RSI legend text: the hovered bar's RSI (`time`, UTC s) or the newest; written only when it changes. */
function writeRsiLegend(i: Instance, fx: RsiFx, time: number | null): void {
  const el = fx.value.current;
  const rp = i.panes.rsi();
  if (!el || !rp) return;
  const v = time != null ? rp.valueAt(time) : rp.lastValue();
  const text = v == null ? "–" : fmt.n1(fx.mirrored() ? mirrorRsi(v) : v);
  if (el.textContent !== text) el.textContent = text;
}

/** Chart-relative px of an RSI break (sub pane offset + the RSI series' y), `null` out of view. */
function glowPoint(i: Instance, b: RsiOverlayBreak): PulsePoint | null {
  const rp = i.panes.rsi();
  if (!rp) return null;
  const ts = i.chart.timeScale();
  const x = ts.logicalToCoordinate(b.i as never);
  const y = rp.series.priceToCoordinate(b.v);
  if (x == null || y == null || x < 0 || x > ts.width()) return null;
  return { x, y: i.subTop + y };
}

/** The newest fresh RSI break: a new one mounts the breathing glow (and pings once when it appeared live). */
function syncGlow(i: Instance, fx: RsiFx, appended: boolean): void {
  const b = i.panes.rsi()?.freshBreak() ?? null;
  const key = b ? `${i.data[b.i]?.time ?? b.i}:${b.dir}` : null;
  if (key === fx.glowKey.current) return;
  const prev = fx.glowKey.current;
  fx.glowKey.current = key;
  fx.setGlow(b && key ? { key, dir: b.dir } : null);
  const layer = fx.ripples.current;
  if (appended && prev !== null && b && !fx.reduced() && layer) {
    const at = glowPoint(i, b);
    if (at) spawnMarkerRipple(layer, at, fx.neutral() ? ink.fg : b.dir === 1 ? ink.win : ink.loss);
  }
  i.requestPlace();
}

/** Moves the glow with the canvas (in the frame lightweight-charts drew): MotionValues, no React render. */
function placeGlow(i: Instance, fx: RsiFx): void {
  if (!fx.glowKey.current) return;
  const b = i.panes.rsi()?.freshBreak() ?? null;
  const at = b && i.isActive() ? glowPoint(i, b) : null;
  if (!at) {
    fx.mv.shown.set(0);
    return;
  }
  fx.mv.x.set(at.x);
  fx.mv.y.set(at.y);
  fx.mv.shown.set(1);
}

function syncMarkers(i: Instance, markers: TradeMarker[] | undefined): BuiltMarkers {
  const src = snapSourceOf(i.main.candles, i.chart.timeScale());
  const built = buildMarkers(markers ?? [], (t) => snapTime(src, t), i.bounds);
  i.built = built;
  i.applied.markers = markers;
  i.markersApi.setMarkers(i.neutral ? neutralizeMarkers(built.markers, ink.fg) : built.markers);
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
  return ink.bg;
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
  i.unsettle();
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
  i.unsettle();
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
  keyLines,
  activeScenario = null,
  markers,
  signals,
  divergences,
  structure,
  layers,
  ratio,
  oi,
  pane = "none",
  boxes,
  boxAutoscale = false,
  priceLines,
  rangeDays = 30,
  mirror = NO_MIRROR,
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
  /** the instance kept while a keep-alive <Activity> hides the page (see effect 1) */
  const parked = useRef<ChartRecord | null>(null);
  const tip = useRef<TooltipHandle>(null);
  const cb = useRef<Callbacks>({});
  const latest = useRef<{ markers?: TradeMarker[]; signals?: SignalMarker[]; divergences?: DivergenceLine[]; structure?: StructureOverlay | null; layers?: OverlayLayers; levels?: MarketLevels; keyLines?: readonly KeyLine[]; activeScenario: ActiveScenario; boxes?: ChartBox[]; priceLines?: readonly ChartTrendline[] }>({
    activeScenario: null,
  });
  /** RSI legend (top left of the RSI pane): text and position written through refs, never React state */
  const rsiLegend = useRef<HTMLDivElement>(null);
  const rsiValue = useRef<HTMLSpanElement>(null);
  /** the newest fresh RSI break: its key mounts a breathing `GlowBreak`; x / y follow the canvas without renders */
  const [glow, setGlow] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const glowKey = useRef<string | null>(null);
  const glowX = useMotionValue(-100);
  const glowY = useMotionValue(-100);
  const glowShown = useMotionValue(0);
  // the chart's imperative helpers reach the legend / glow through one ref (stable for the effects)
  const fx = useRef<RsiFx>({
    legend: rsiLegend,
    value: rsiValue,
    ripples,
    glowKey,
    setGlow,
    mv: { x: glowX, y: glowY, shown: glowShown },
    reduced: () => reduceRef.current,
    mirrored: () => mirrorRef.current.flipped && mirrorRef.current.rsiMirrored,
    neutral: () => mirrorRef.current.neutral,
  });
  const mirrorRef = useRef<ChartMirror>(mirror);
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
    latest.current = { markers, signals, divergences, structure, layers, levels, keyLines, activeScenario, boxes, priceLines };
  }, [markers, signals, divergences, structure, layers, levels, keyLines, activeScenario, boxes, priceLines]);

  // 1. create once and keep it. A keep-alive <Activity> (the Übersicht on another tab) destroys this effect while the page
  // is hidden but keeps the DOM: the cleanup then PARKS the instance (host still in the document) and the next run
  // re-attaches it – no createChart / setData / first paint on every return to the Übersicht. A real unmount (host
  // detached) tears it down; a parked chart whose host left the document while hidden is swept (`sweepParked`). StrictMode's
  // probe re-run re-attaches the same instance. A passive effect: createChart's forced layout lands after the paint of the
  // commit that shows the chart (perf review perf-08). Every later effect and the imperative handle null-guard `inst`.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let rec = parked.current;
    parked.current = null;
    if (rec) unparkChart(rec);
    if (rec && rec.instance.node !== node) {
      rec.destroy();
      rec = null;
    }
    if (!rec) rec = buildChart(node);
    const kept = rec;
    inst.current = kept.instance;
    const detach = kept.attach();
    return () => {
      detach();
      inst.current = null;
      if (node.isConnected) {
        parked.current = kept;
        parkChart(kept);
      } else kept.destroy();
    };
  }, []);

  // a parked chart's DOM leaves the hidden page (lightweight-charts builds a <table> of canvases: the kept-alive overview
  // holds no real table while another page is shown – that page's selectors, motion.spec / trades.spec) and comes back
  // in the commit that shows the page again, before its first paint. Layout phase: the hide's cleanup runs before the
  // passive one that parks the instance, the show's mount before the passive one that re-attaches it.
  useLayoutEffect(() => {
    const node = host.current;
    const kept = parked.current;
    if (node && kept && kept.instance.node === node) {
      const el = kept.instance.chart.chartElement();
      if (el.parentNode !== node) node.appendChild(el);
    }
    return () => {
      const live = inst.current;
      if (!node || !live || live.node !== node) return;
      const el = live.chart.chartElement();
      if (el.parentNode === node) node.removeChild(el);
    };
  }, []);

  /** Creates the chart on `host`: the instance, its permanent wiring, `attach` (per shown period) and `destroy`. */
  function buildChart(node: HTMLDivElement): ChartRecord {
    // autoSize off: our observer below sizes the chart and ignores the 0 × 0 report of a hidden (display:none) page, so
    // hiding and showing the kept-alive overview never resizes (or repaints) the chart at 0 × 0 and back
    // the theme from the LIVE palette (light mode): a chart built after a theme switch starts in the current ink
    const chart = createChart(node, { ...makeNothingTheme(), autoSize: false });
    const main = createMainSeries(chart);
    const panes = new PaneController(chart);
    // the check overlay first (S/R under the candles, dots / lines / labels with the series), trade markers above it
    const check = new SignalOverlay({
      bars: () => instance.data,
      axisPrices: () => axisLabelPrices(instance, latest.current.levels),
      reserved: () => zoneCaptionBox(instance, latest.current.levels),
    });
    // the Box-zu-Box boxes first (their fills sit under everything), then the check overlay, trade markers on top
    const boxes = new BoxPrimitive({
      bars: () => instance.data,
      intervalSec: () => INTERVAL_SECONDS[instance.lastInterval ?? "1h"],
      reducedMotion: () => reduceRef.current,
      axisPrices: () => [...axisLabelPrices(instance, latest.current.levels), ...check.axisLabelPrices()],
      // target labels / captions keep clear of the check overlay's labels and the zone caption
      reserved: () => [...zoneCaptionBox(instance, latest.current.levels), ...check.geometry().labels.map((l) => l.box)],
      onTween: () => instance.unsettle(),
    });
    main.candles.attachPrimitive(boxes);
    // read-only diagnostics hook (e2e / dev tools): the boxes as drawn against the bar grid – a property, no cost
    const boxDebug: BoxDebugHook = { geometry: () => boxes.geometry(), boxes: () => boxes.chartBoxes(), bars: () => instance.data, x: (l) => logicalToX(chart.timeScale(), l) };
    Object.defineProperty(node, BOX_DEBUG_KEY, { value: boxDebug, configurable: true });
    main.candles.attachPrimitive(check);
    const markersApi = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    const range = new RangeAnimator(chart, { reducedMotion: () => reduceRef.current, onMorph: () => instance.unsettle() });
    let placeRaf = 0;
    let measureRaf = 0;
    let settleRaf = 0;
    // `data-settled` on the wrapper (e2e, diagnostics): the chart shows its bars and nothing on the canvas moves – no
    // history waiting for its draw, range morph, interval wipe, pane crossfade or box / zone tween. Written only when it
    // flips; the frame loop runs only while something moves (each of those ends), queued behind lightweight-charts' own
    // frame, so "true" means that frame is painted. Reduced motion: no tweens, settled once drawn.
    const moving = () =>
      instance.applying ||
      range.isAnimating() ||
      !!instance.cancelWipe ||
      !!instance.overlay?.isConnected ||
      boxes.busy() ||
      (instance.levels?.zone.busy() ?? false) ||
      // bars drawn, the reveal two frames later
      (!readyRef.current && instance.data.length > 0);
    const settle = () => {
      settleRaf = 0;
      const el = wrap.current;
      if (!el || inst.current !== instance) return;
      const busy = moving();
      const v = readyRef.current && !busy ? "true" : "false";
      if (el.dataset.settled !== v) el.dataset.settled = v;
      // no bars yet (no history, offline): nothing to wait for – the next history apply starts the loop again
      if (busy) settleRaf = requestAnimationFrame(settle);
    };
    /** the sub pane's top from the model; the RSI legend follows it (written only when it moved) */
    const syncSubTop = () => {
      const top = subPaneTop(instance);
      const el = fx.current.legend.current;
      if (top === instance.subTop && el?.dataset.top === String(top)) return;
      instance.subTop = top;
      if (el) {
        el.style.transform = `translate3d(0, ${top + 4}px, 0)`;
        el.dataset.top = String(top);
      }
    };
    const measure = () => {
      measureRaf = 0;
      if (inst.current !== instance) return;
      syncSubTop();
      instance.requestPlace();
    };
    const isActive = () => readyRef.current && visibleRef.current && !pausedRef.current;
    const place = () => {
      placeRaf = 0;
      if (inst.current !== instance) return;
      // the panes may have re-laid out since the last resize (model heights – no layout read)
      syncSubTop();
      const last = instance.data[instance.data.length - 1];
      pulse.current?.place(isActive() && last ? pointInPane(instance, last.time, last.close) : null);
      placeGlow(instance, fx.current);
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
        // a bar closed: RSI + trendlines of the closed bars (once per bar), the box geometry re-indexes
        panes.setBars(instance.data);
        boxes.invalidate();
        instance.trend?.invalidate();
        syncGlow(instance, fx.current, true);
        writeRsiLegend(instance, fx.current, null);
      },
      onPush: (tail) => {
        panes.pushLive(tail);
        writeRsiLegend(instance, fx.current, null);
        instance.requestPlace();
      },
    });
    const instance: Instance = {
      chart,
      node,
      main,
      panes,
      markersApi,
      check,
      boxes,
      subTop: 0,
      neutral: false,
      range,
      live,
      levels: null,
      keyLines: null,
      trend: null,
      dead: false,
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
      applied: {},
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
      measurePanes: () => {
        if (!measureRaf) measureRaf = requestAnimationFrame(measure);
      },
      applying: false,
      unsettle: () => {
        const el = wrap.current;
        if (el && el.dataset.settled !== "false") el.dataset.settled = "false";
        // re-queued on every call: behind the frame lightweight-charts requested for the change that called it
        if (settleRaf) cancelAnimationFrame(settleRaf);
        settleRaf = requestAnimationFrame(settle);
      },
    };

    instance.fontReady.then(() => {
      if (instance.node.isConnected || inst.current === instance) chart.applyOptions({ layout: { fontFamily: CHART_FONT } });
    });

    // axis collision guard: ticks next to a level / zone / last-price / S/R label stay blank (the label shows the price)
    chart.applyOptions({
      localization: {
        tickmarksPriceFormatter: (prices: readonly number[]) => {
          const labels = [...axisLabelPrices(instance, latest.current.levels), ...check.axisLabelPrices(), ...boxes.targetPrices()];
          return filterTickLabels(prices, labels, (p) => main.candles.priceToCoordinate(p), (p) => fmt.price(p));
        },
      },
    });

    const sizeOf = () => {
      if (instance.size.width === 0) instance.size = { width: node.clientWidth, height: node.clientHeight };
      return instance.size;
    };
    // sizes the chart (autoSize is off): a 0 × 0 report means the page is hidden – keep size and picture; a real change
    // repaints at once like lightweight-charts' own autoSize (no stretched frame); the first report only confirms the
    // size createChart measured
    let sized = false;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (!r || r.width <= 0 || r.height <= 0) return;
            const changed = r.width !== instance.size.width || r.height !== instance.size.height;
            instance.size = { width: r.width, height: r.height };
            if (changed || !sized) chart.resize(r.width, r.height, sized);
            sized = true;
            instance.requestPlace();
            if (changed) instance.measurePanes();
          })
        : null;

    const onMove = (p: MouseEventParams<Time>) => {
      if (inst.current !== instance) return;
      const point = p.point;
      const bar = point && p.time !== undefined ? p.seriesData.get(main.candles) : undefined;
      const ohlc = bar && "open" in bar ? (bar as CandlestickData<Time>) : null;
      // the RSI legend follows the crosshair on every pane (the RSI pane included), else shows the newest value
      writeRsiLegend(instance, fx.current, point && typeof p.time === "number" ? p.time : null);
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
      instance.requestPlace();
      const away = isAwayFromRealtime(r, instance.data.length - 1);
      if (away === awayRef.current) return;
      awayRef.current = away;
      setFollow(away ? { right: chart.priceScale("right").width() + PILL_GAP } : null);
    };
    const stopMorph = () => range.cancel();
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    // runtime palette (light mode, P13): re-apply the colour options; overlays read `ink` at draw time
    const offInk = subscribeInk(() => {
      chart.applyOptions(inkChartOptions());
      main.candles.applyOptions(inkCandleOptions());
      main.volume.applyOptions(inkVolumeOptions());
      // per-bar volume tints, the sub pane, level lines + zone and the trade markers carry colours of their own
      const vol = main.volume.data();
      if (vol.length) {
        const bar = new Map(instance.data.map((d) => [d.time, d]));
        main.volume.setData(
          vol.map((d) => {
            const c = bar.get(d.time as UTCTimestamp);
            return c && "value" in d ? { ...d, color: volumeColor(c.open, c.close) } : d;
          }),
        );
      }
      panes.applyInk();
      if (instance.levels) syncLevels(instance, latest.current.levels, latest.current.activeScenario, true);
      if (instance.keyLines) instance.keyLines = syncKeyLines(main.candles, latest.current.keyLines ?? [], instance.keyLines);
      if (instance.data.length) syncMarkers(instance, latest.current.markers);
      check.invalidate();
      boxes.invalidate();
      instance.trend?.invalidate();
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    node.addEventListener("wheel", stopMorph, { passive: true });
    node.addEventListener("pointerdown", stopMorph);

    return {
      instance,
      // while shown: size observer and the on-screen observer (pulse + live pushes only while on screen)
      attach: () => {
        ro?.observe(node);
        const offView = wrap.current
          ? observeInView(wrap.current, (inView) => {
              visibleRef.current = inView;
              instance.syncActive();
            })
          : noop;
        return () => {
          offView();
          ro?.disconnect();
          if (placeRaf) cancelAnimationFrame(placeRaf);
          placeRaf = 0;
          // parked: nothing is pushed to the canvas or the pulse until the next attach reports "on screen"
          visibleRef.current = false;
          pulse.current?.setActive(false);
        };
      },
      destroy: () => {
        ro?.disconnect();
        node.removeEventListener("wheel", stopMorph);
        node.removeEventListener("pointerdown", stopMorph);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        chart.unsubscribeCrosshairMove(onMove);
        chart.unsubscribeClick(onClick);
        if (placeRaf) cancelAnimationFrame(placeRaf);
        placeRaf = 0;
        if (measureRaf) cancelAnimationFrame(measureRaf);
        measureRaf = 0;
        if (settleRaf) cancelAnimationFrame(settleRaf);
        settleRaf = 0;
        offInk();
        live.dispose();
        instance.overlay?.remove();
        instance.cancelWipe?.();
        range.dispose();
        markersApi.detach();
        main.candles.detachPrimitive(check);
        boxes.dispose();
        main.candles.detachPrimitive(boxes);
        Reflect.deleteProperty(node, BOX_DEBUG_KEY);
        instance.dead = true;
        if (instance.trend) main.candles.detachPrimitive(instance.trend);
        Reflect.deleteProperty(node, TREND_KEY);
        clearLevels(main.candles, instance.levels);
        clearKeyLines(main.candles, instance.keyLines);
        panes.dispose();
        readyRef.current = false;
        // `awayRef` is NOT reset: it mirrors the `follow` state, which a keep-alive <Activity> preserves – a re-created
        // chart's first live-edge range event must still see "away" and hide the pill
        chart.remove();
      },
    };
  }

  // 2. history → setData (once per array identity); newer bars on the right → live engine; interval → strip wipe
  useEffect(() => {
    const i = inst.current;
    if (!i || candles.length === 0) return;
    // a re-attached (parked) instance already shows these bars
    if (i.applied.candles === candles && i.lastInterval === interval && readyRef.current) return;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    // fade the chart in two frames after its bars are drawn
    const reveal = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled || inst.current !== i) return;
          readyRef.current = true;
          setReady(true);
          i.syncActive();
        });
      });
    };
    const apply = () => {
      if (cancelled || inst.current !== i) return;
      i.applying = false;
      i.unsettle();
      i.applied.candles = candles;
      const data = normalizeSeries(candles.map(toCandleData));
      const intervalChanged = i.lastInterval !== null && i.lastInterval !== interval;
      const first = i.data.length === 0;

      if (!first && !intervalChanged && extendsTail(i.data, data)) {
        // the same history plus a new bar: append in place (keeps the window, follows the live edge, no full repaint).
        // Bars the chart already holds are kept: the kline stream / trades have updated them since this snapshot.
        const lastSec = i.data[i.data.length - 1]?.time ?? 0;
        const added = candles.slice(-(data.length - i.data.length + 1)).filter((c) => sec(c.time) > lastSec);
        if (added.length > 0) i.live.bars(added, 0);
        // these bars replaced the first apply's array before its reveal frames ran (this effect's cleanup cancelled
        // them): reveal here, or the chart stays on the skeleton until the next full history
        if (!readyRef.current) reveal();
        return;
      }

      const prevRange = i.chart.timeScale().getVisibleLogicalRange();
      const prevFirst = i.data[0]?.time;
      if (intervalChanged && readyRef.current && !reduceRef.current) stripWipe(i, wrap.current);

      const volume = normalizeSeries(candles.map(toVolumeData));
      // before setData: range-change callbacks fired from inside it must see the new bars
      i.data = data;
      i.lastInterval = interval;
      i.bounds = boundsOf(data, INTERVAL_SECONDS[interval]);
      i.main.candles.setData(data);
      i.main.volume.setData(volume);
      i.live.reset(interval, volume[volume.length - 1]?.value ?? 0);
      // sub pane shares the time scale → snap its points onto the candle grid (no whitespace slots)
      i.panes.setGrid(data.map((d) => d.time));
      // the RSI pane computes from the chart's own bars
      i.panes.setBars(i.data);

      if (first || intervalChanged) {
        const target = windowFor(i, rangeDays, interval);
        if (target) i.range.goTo(target, false);
      } else if (prevRange) {
        // same interval, different history (older bars prepended, source switch): keep the user's window on the same
        // bars – prepended bars shift every logical index by their count. A range morph still running (a range pill
        // tapped just before its history arrived) shifts with them, or it would land `shift` bars left of the live edge
        const shift = prevFirst === undefined ? 0 : Math.max(0, data.findIndex((d) => d.time === prevFirst));
        if (!i.range.shift(shift)) i.chart.timeScale().setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
      }
      // levels & markers depend on the loaded bars (zone left edge, snapping, bounds)
      syncLevels(i, latest.current.levels, latest.current.activeScenario, reduceRef.current);
      if (i.keyLines || latest.current.keyLines?.length) i.keyLines = syncKeyLines(i.main.candles, latest.current.keyLines ?? [], i.keyLines);
      i.markerIds = null;
      i.check.invalidate();
      syncOverlay(i, latest.current);
      i.boxes.invalidate();
      i.trend?.invalidate();
      syncBoxes(i, latest.current.boxes);
      syncGlow(i, fx.current, false);
      writeRsiLegend(i, fx.current, null);
      const built = syncMarkers(i, latest.current.markers);
      freshMarkerIds(i, built);
      cb.current.onOutsideCount?.(built.outside);
      i.requestPlace();
      reveal();
    };
    // the canvas is about to change: not settled until this history is drawn
    i.applying = true;
    i.unsettle();
    i.fontReady.then(apply);
    return () => {
      cancelled = true;
      i.applying = false;
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
    const target = windowFor(i, rangeDays, interval);
    if (target) i.range.goTo(target, true);
  }, [rangeDays, interval]);

  // 4a. forming candle as a prop: an authoritative kline
  useEffect(() => {
    const i = inst.current;
    if (!i || !live || i.applied.live === live) return;
    i.applied.live = live;
    i.live.bars([live], Number.POSITIVE_INFINITY);
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
    if (!i || (i.applied.levels && i.applied.levels.levels === levels && i.applied.levels.active === activeScenario)) return;
    syncLevels(i, levels, activeScenario, reduceRef.current);
  }, [levels, activeScenario]);

  // 5b. the user's own key levels -> price lines (update in place, no churn while the list is unchanged)
  useEffect(() => {
    const i = inst.current;
    if (!i) return;
    if (!i.keyLines && !keyLines?.length) return;
    i.keyLines = syncKeyLines(i.main.candles, keyLines ?? [], i.keyLines);
  }, [keyLines]);

  // 6. markers (re-snapped after every history load, see step 2); a newly saved trade ripples at its marker
  useEffect(() => {
    const i = inst.current;
    if (!i || ("markers" in i.applied && i.applied.markers === markers)) return;
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

  // 6b. check overlay: MCB dots, divergences, S/R, structure (≤ 1 update per published signal check; identities are
  // memoised by content upstream; re-indexed after every history load, see step 2)
  useEffect(() => {
    const i = inst.current;
    const o = i?.applied.overlay;
    if (!i || (o && o[0] === signals && o[1] === divergences && o[2] === structure && o[3] === layers)) return;
    syncOverlay(i, { signals, divergences, structure, layers });
  }, [signals, divergences, structure, layers]);

  // 6c. Box-zu-Box boxes (identity = content upstream; re-indexed after every history load, see step 2)
  useEffect(() => {
    const i = inst.current;
    if (!i || ("boxes" in i.applied && i.applied.boxes === boxes)) return;
    syncBoxes(i, boxes);
  }, [boxes]);
  useEffect(() => {
    inst.current?.boxes.applyOptions({ autoscale: boxAutoscale });
  }, [boxAutoscale]);

  // 6d. price trendlines (F05): identity = content upstream; the primitive's chunk loads with the first line
  useEffect(() => {
    const i = inst.current;
    if (!i || ("trend" in i.applied && i.applied.trend === priceLines)) return;
    syncTrend(i, priceLines, { neutral: () => mirrorRef.current.neutral, levels: () => latest.current.levels });
  }, [priceLines]);

  // 7. optional sub pane; switching the kind crossfades from a screenshot
  useEffect(() => {
    const i = inst.current;
    const a = i?.applied.pane;
    if (!i || (a && a[0] === pane && a[1] === ratio && a[2] === oi)) return;
    i.applied.pane = [pane, ratio, oi];
    if (i.pane !== null && i.pane !== pane && readyRef.current && !reduceRef.current) crossfade(i, wrap.current);
    i.pane = pane;
    i.panes.setData({ ratio, oi });
    i.panes.set(pane);
    syncGlow(i, fx.current, false);
    writeRsiLegend(i, fx.current, null);
    i.measurePanes();
    i.requestPlace();
  }, [pane, ratio, oi]);

  // 7b. "Chart spiegeln" (F62): the price axis upside down, the RSI axis only on request, RSI parts shown / hidden. Only
  // options change – no data is touched, so a second flip draws the original picture again.
  const { flipped, rsiMirrored, trendlines, breakouts, neutral } = mirror;
  useEffect(() => {
    mirrorRef.current = { flipped, rsiMirrored, trendlines, breakouts, neutral };
    const i = inst.current;
    if (!i) return;
    i.unsettle();
    i.main.candles.priceScale().applyOptions({ invertScale: flipped });
    i.panes.setRsiView({ trendlines, breakouts, mirrored: flipped && rsiMirrored, neutral });
    i.boxes.applyOptions({ neutral });
    i.trend?.applyOptions({ neutral });
    if (i.neutral !== neutral) {
      i.neutral = neutral;
      if (i.data.length) syncMarkers(i, latest.current.markers);
    }
    syncGlow(i, fx.current, false);
    writeRsiLegend(i, fx.current, null);
    i.check.invalidate();
    i.boxes.invalidate();
    i.trend?.invalidate();
    i.requestPlace();
  }, [flipped, rsiMirrored, trendlines, breakouts, neutral]);

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
        const target = windowFor(i, days, i.lastInterval ?? interval);
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
          {pane === "rsi" && glow ? (
            <motion.span className="absolute inset-0" style={{ opacity: glowShown }} data-fx="rsi-glow">
              <GlowBreak key={glow.key} x={glowX} y={glowY} tone={neutral ? "soft" : glow.dir === 1 ? "win" : "loss"} size={30} />
            </motion.span>
          ) : null}
          <LivePulse ref={pulse} reduced={reduce} />
        </div>
        {pane === "rsi" ? (
          <div ref={rsiLegend} className="pointer-events-none absolute left-2 top-0 z-[3] flex items-baseline gap-1.5 font-mono text-[10px] text-faint" data-testid="rsi-legend">
            <span className="uppercase tracking-[0.12em]" data-mirrored={mirror.flipped && mirror.rsiMirrored ? "true" : undefined}>
              {mirror.flipped && mirror.rsiMirrored ? "100−RSI 14" : "RSI 14"}
            </span>
            <span ref={rsiValue} className="num text-[11px] text-mute">
              –
            </span>
          </div>
        ) : null}
        {tooltip ? <ChartTooltip ref={tip} /> : null}
      </motion.div>
      {followLabel ? <FollowPill show={showChart && !paused && follow !== null} label={followLabel} right={follow?.right ?? 0} reduced={reduce} onFollow={followLive} /> : null}
      <AnimatePresence initial={false}>{showChart ? null : <ChartSkeleton key="skeleton" />}</AnimatePresence>
    </div>
  );
});
