/**
 * Series & panes (Plan 5.3): pane 0 = volume (overlay) + candles, pane 1 (optional, ~25 % height) =
 * Long/Short ratio (`longPct` + 50 % baseline), Open Interest or the RSI 14 with its diagonal trendlines (P02, `rsiPane.ts`). The live price pulse is a DOM overlay
 * (`overlays.tsx`), not a series, so the canvas only redraws when data changes.
 */
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, OpenInterestPoint, RatioPoint } from "@/market/types";
import { NOTHING_CANDLES, NOTHING_OI_LINE, NOTHING_RATIO_LINE, NOTHING_VOLUME, VOLUME_SCALE_MARGINS, ink } from "./theme";
import { RsiPane, type RsiBar } from "./rsiPane";

export type PaneKind = "none" | "ratio" | "oi" | "rsi";
export type ChartInterval = "1m" | "30m" | "1h" | "4h" | "1d" | "1w";

/** Seconds per bar for each interval (`30m` is built from 15m klines, UTC-aligned like every other bucket). */
export const INTERVAL_SECONDS: Record<ChartInterval, number> = { "1m": 60, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
/** Stretch factors: pane 0 : pane 1 = 3 : 1 → sub pane takes ~25 % of the height. */
export const PANE_STRETCH = { main: 3, sub: 1 } as const;

export const sec = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

export function toCandleData(c: Candle): CandlestickData<UTCTimestamp> {
  return { time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
}
/** Volume bar tint: brighter under rising candles. */
export const volumeColor = (open: number, close: number): string => (close >= open ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)");

export function toVolumeData(c: Candle): HistogramData<UTCTimestamp> {
  return { time: sec(c.time), value: c.volume, color: volumeColor(c.open, c.close) };
}
export function toRatioData(p: RatioPoint): LineData<UTCTimestamp> {
  return { time: sec(p.time), value: p.longPct };
}
export function toOiData(p: OpenInterestPoint): LineData<UTCTimestamp> {
  return { time: sec(p.time), value: p.openInterest };
}

/** Sorts ascending by time and drops duplicate timestamps (lightweight-charts requires strictly ascending data). */
export function normalizeSeries<T extends { time: UTCTimestamp }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const out: T[] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last && last.time === row.time) out[out.length - 1] = row;
    else out.push(row);
  }
  return out;
}

export interface MainSeries {
  volume: ISeriesApi<"Histogram">;
  candles: ISeriesApi<"Candlestick">;
}

/** Creates the pane-0 series in draw order (volume below candles). */
export function createMainSeries(chart: IChartApi, opts?: { volume?: boolean }): MainSeries {
  const volume = chart.addSeries(HistogramSeries, {
    ...NOTHING_VOLUME,
    visible: opts?.volume !== false,
  });
  volume.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS });
  const candles = chart.addSeries(CandlestickSeries, NOTHING_CANDLES);
  return { volume, candles };
}

/**
 * Snaps a series onto the candle grid: lightweight-charts shares ONE time scale across panes, so an hourly
 * ratio/OI series on a 4h chart would insert three whitespace slots per candle (sparse candles on the
 * right, dense on the left). Every point moves to the latest candle time ≤ its own time (last point per
 * candle wins); points before the first candle are dropped. Without a grid the rows pass through unchanged.
 */
export function alignToGrid<T extends { time: UTCTimestamp }>(rows: T[], grid: readonly UTCTimestamp[] | null | undefined): T[] {
  if (!grid || grid.length === 0) return rows;
  const out: T[] = [];
  let g = 0;
  for (const row of rows) {
    if (row.time < (grid[0] as UTCTimestamp)) continue;
    while (g + 1 < grid.length && (grid[g + 1] as UTCTimestamp) <= row.time) g++;
    const time = grid[g] as UTCTimestamp;
    const last = out[out.length - 1];
    const snapped = { ...row, time };
    if (last && last.time === time) out[out.length - 1] = snapped;
    else out.push(snapped);
  }
  return out;
}

export interface PaneData {
  ratio?: RatioPoint[];
  oi?: OpenInterestPoint[];
}

/**
 * Owns the optional sub pane; switch kinds with `set`, refresh data with `setData` (ratio / OI) or `setBars` (RSI: the
 * chart's own bars), push the forming bar with `pushLive`, `dispose` on unmount. One sub pane at a time (`rsi` is
 * exclusive with ratio / OI); the pane index is resolved from the series, never assumed.
 */
export class PaneController {
  private kind: PaneKind = "none";
  private line: ISeriesApi<"Line"> | null = null;
  private baseline: IPriceLine | null = null;
  private rsiPane: RsiPane | null = null;
  private data: PaneData = {};
  private grid: UTCTimestamp[] = [];
  private bars: readonly RsiBar[] = [];

  constructor(private readonly chart: IChartApi) {}

  /** Candle times (seconds, ascending) the pane series snaps onto; call after every `setData` of the candles. */
  setGrid(times: readonly UTCTimestamp[]): void {
    this.grid = [...times];
    this.apply();
  }

  /** The chart's bars (the last one forming): the RSI pane computes from them; call after `setData` and on append. */
  setBars(bars: readonly RsiBar[]): void {
    this.bars = bars;
    this.rsiPane?.setBars(bars);
  }

  /** The forming bar moved (at most once per frame): the RSI follows in O(1). */
  pushLive(bar: RsiBar): void {
    this.rsiPane?.push(bar);
  }

  current(): PaneKind {
    return this.kind;
  }

  series(): ISeriesApi<"Line"> | null {
    return this.line;
  }

  /** The RSI pane while `kind === "rsi"`. */
  rsi(): RsiPane | null {
    return this.rsiPane;
  }

  /** Index of the sub pane (resolved from its series), `null` without one. */
  paneIndex(): number | null {
    const l = this.line as (ISeriesApi<"Line"> & { getPane?: () => { paneIndex(): number } }) | null;
    if (!l) return null;
    try {
      return l.getPane?.().paneIndex() ?? 1;
    } catch {
      return 1;
    }
  }

  setData(data: PaneData): void {
    this.data = data;
    this.apply();
  }

  set(kind: PaneKind): void {
    if (kind === this.kind) return;
    this.remove();
    this.kind = kind;
    if (kind === "none") return;
    if (kind === "rsi") {
      this.rsiPane = new RsiPane(this.chart, 1);
      this.line = this.rsiPane.series;
      this.rsiPane.setBars(this.bars);
    } else {
      const line = this.chart.addSeries(LineSeries, kind === "ratio" ? NOTHING_RATIO_LINE : NOTHING_OI_LINE, 1);
      this.line = line;
      if (kind === "ratio") {
        this.baseline = line.createPriceLine({
          price: 50,
          color: ink.ref,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: "",
        });
      }
    }
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(PANE_STRETCH.main);
    panes[this.paneIndex() ?? 1]?.setStretchFactor(PANE_STRETCH.sub);
    this.apply();
  }

  dispose(): void {
    this.remove();
    this.kind = "none";
  }

  private apply(): void {
    if (!this.line) return;
    if (this.kind === "ratio") this.line.setData(alignToGrid(normalizeSeries((this.data.ratio ?? []).map(toRatioData)), this.grid));
    else if (this.kind === "oi") this.line.setData(alignToGrid(normalizeSeries((this.data.oi ?? []).map(toOiData)), this.grid));
  }

  /**
   * Removes the sub pane's series and - only if lightweight-charts kept it - its now empty pane. The pane is resolved
   * BEFORE the removal: removing the last series of a pane drops the pane and shifts every pane below it up, so a blind
   * `removePane(1)` deleted the next sub pane when there were two.
   */
  private remove(): void {
    if (!this.line) return;
    const before = this.chart.panes().length;
    const idx = this.paneIndex();
    if (this.baseline) this.line.removePriceLine(this.baseline);
    this.baseline = null;
    this.rsiPane?.dispose();
    this.rsiPane = null;
    this.chart.removeSeries(this.line);
    this.line = null;
    const panes = this.chart.panes();
    const left = idx != null && idx > 0 && panes.length === before ? (panes[idx] as { getSeries?: () => unknown[] } | undefined) : undefined;
    if (left && (typeof left.getSeries !== "function" || left.getSeries().length === 0)) {
      try {
        this.chart.removePane(idx as number);
      } catch {
        /* pane already gone */
      }
    }
    this.chart.panes()[0]?.setStretchFactor(1);
  }
}
