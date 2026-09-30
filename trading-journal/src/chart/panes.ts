/**
 * Series & panes (Plan 5.3): pane 0 = volume (overlay) + candles + hidden pulse line,
 * pane 1 (optional, ~25 % height) = Long/Short ratio (`longPct` + 50 % baseline) or Open Interest.
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
import {
  NOTHING_CANDLES,
  NOTHING_OI_LINE,
  NOTHING_PULSE,
  NOTHING_RATIO_LINE,
  NOTHING_VOLUME,
  VOLUME_SCALE_MARGINS,
  ink,
} from "./theme";

export type PaneKind = "none" | "ratio" | "oi";
export type ChartInterval = "1m" | "1h" | "4h" | "1w";

/** Seconds per bar for each interval. */
export const INTERVAL_SECONDS: Record<ChartInterval, number> = { "1m": 60, "1h": 3600, "4h": 14400, "1w": 604800 };
/** Stretch factors: pane 0 : pane 1 = 3 : 1 → sub pane takes ~25 % of the height. */
export const PANE_STRETCH = { main: 3, sub: 1 } as const;

export const sec = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

export function toCandleData(c: Candle): CandlestickData<UTCTimestamp> {
  return { time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
}
export function toVolumeData(c: Candle): HistogramData<UTCTimestamp> {
  return {
    time: sec(c.time),
    value: c.volume,
    color: c.close >= c.open ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)",
  };
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
  pulse: ISeriesApi<"Line">;
}

/** Creates the pane-0 series in draw order (volume below candles). */
export function createMainSeries(chart: IChartApi, opts?: { volume?: boolean; pulse?: boolean }): MainSeries {
  const volume = chart.addSeries(HistogramSeries, {
    ...NOTHING_VOLUME,
    visible: opts?.volume !== false,
  });
  volume.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS });
  const candles = chart.addSeries(CandlestickSeries, NOTHING_CANDLES);
  const pulse = chart.addSeries(LineSeries, { ...NOTHING_PULSE, visible: opts?.pulse !== false });
  return { volume, candles, pulse };
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

/** Owns the optional sub pane; switch kinds with `set`, refresh data with `setData`, `dispose` on unmount. */
export class PaneController {
  private kind: PaneKind = "none";
  private line: ISeriesApi<"Line"> | null = null;
  private baseline: IPriceLine | null = null;
  private data: PaneData = {};
  private grid: UTCTimestamp[] = [];

  constructor(private readonly chart: IChartApi) {}

  /** Candle times (seconds, ascending) the pane series snaps onto; call after every `setData` of the candles. */
  setGrid(times: readonly UTCTimestamp[]): void {
    this.grid = [...times];
    this.apply();
  }

  current(): PaneKind {
    return this.kind;
  }

  series(): ISeriesApi<"Line"> | null {
    return this.line;
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
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(PANE_STRETCH.main);
    panes[1]?.setStretchFactor(PANE_STRETCH.sub);
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

  private remove(): void {
    if (!this.line) return;
    if (this.baseline) this.line.removePriceLine(this.baseline);
    this.baseline = null;
    this.chart.removeSeries(this.line);
    this.line = null;
    // removing the last series of a pane drops the pane unless preserveEmptyPane is set; be defensive
    if (this.chart.panes().length > 1) {
      try {
        this.chart.removePane(1);
      } catch {
        /* pane already gone */
      }
    }
    this.chart.panes()[0]?.setStretchFactor(1);
  }
}
