/**
 * Series primitive drawing the diagonal PRICE trendlines (F05, `@/domain/trendlines`) on the price pane: a line through
 * two points given in time and price, solid up to where it is known to hold (the newest closed candle, or the break),
 * dotted into the empty space right of it, with a short caption (`4H ↘ nah`, `1D ↗ Bruch ↓`) on a plate.
 *
 * The geometry is time/price → pixel, so it is independent of the chart's own interval: a 1D line also reads on a 4h chart,
 * and the mirror mode (`invertScale`) flips it with the price axis – prices and times are untouched, only the picture is
 * upside down. x: `logicalToX` of the fractional logical index on the bar grid (`../logicalX.ts`); y:
 * `series.priceToCoordinate`. Static (no tween, no timer): the canvas redraws only when lightweight-charts asks for it;
 * geometry is memoised on what moves it. Colours are read at draw time (follow `applyInk`); blind mode (`neutral`) draws
 * the win / loss tones in the neutral ramp. No React.
 */
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { ink, withAlpha } from "../ink";
import { logicalToX } from "../logicalX";
import { barIndexAtOrAfter, estimateTextWidth, LINE_NUDGE, placeLabels, type Box as OverlayBox, type LabelCandidate } from "../overlayLayout";
import { RIGHT_RESERVED } from "./SignalOverlay";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export type TrendTone = "mute" | "fg" | "win" | "loss";

export interface ChartTrendline {
  /** stable per line (timeframe, kind, anchor times) */
  id: string;
  /** two points of the line: ms UTC and price (they define the slope; `t2 > t1`) */
  t1: number;
  p1: number;
  t2: number;
  p2: number;
  /** the solid part runs from `t1` to this time (ms) */
  solidTo: number;
  /** dotted extension to this time (ms), `null` = none */
  extendTo: number | null;
  tone: TrendTone;
  /** caption at the end of the solid part (German, short) */
  label: string;
  /** which side of the line the caption sits on */
  captionAbove: boolean;
  /** drawn heavier (an approach, a fresh break) */
  strong?: boolean;
}

export interface TrendlineHost {
  /** the chart's bars (ascending, UTC seconds) – updated in place by the live engine */
  bars(): ReadonlyArray<{ time: number }>;
  /** seconds per bar of the chart interval (future times → logical indices) */
  intervalSec(): number;
  /** boxes (CSS px) the captions keep clear of */
  reserved?(): readonly OverlayBox[];
}

export interface TrendlineOptions {
  /** blind mode (F62): no win / loss tones */
  neutral: boolean;
}

/** Read-only diagnostics hook a chart puts on its host element under this key (e2e / dev tools). */
export const TREND_DEBUG_KEY = "__tjTrend";
export interface TrendDebugHook {
  /** the lines handed to the chart */
  lines(): readonly ChartTrendline[];
  /** the lines as drawn right now (CSS px, chart-relative) */
  geometry(): readonly TrendGeo[];
}

export interface TrendGeo {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** end of the dotted extension (same line) */
  x3: number | null;
  y3: number | null;
  tone: TrendTone;
  strong: boolean;
  label: PlacedCaption | null;
}
interface PlacedCaption {
  box: OverlayBox;
  text: string;
  color: string;
}

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_PX = 9;
const LABEL_PAD = 3;
const LABEL_H = 12;

/** Fractional logical index of `sec` (UTC s) on the bar grid; left of the first / right of the last bar the grid is extended. */
export function logicalFrac(bars: ReadonlyArray<{ time: number }>, sec: number, intervalSec: number): number | null {
  const n = bars.length;
  if (!n) return null;
  const iv = Math.max(1, intervalSec);
  const first = bars[0]!.time;
  const last = bars[n - 1]!.time;
  if (sec >= last) return n - 1 + (sec - last) / iv;
  if (sec <= first) return (sec - first) / iv;
  const i = barIndexAtOrAfter(bars, sec);
  const t1 = bars[i]!.time;
  if (t1 === sec) return i;
  const t0 = bars[i - 1]!.time;
  return i - 1 + (sec - t0) / Math.max(1, t1 - t0);
}

/** Price of the line `l` at `ms`. */
export const priceAtTime = (l: Pick<ChartTrendline, "t1" | "p1" | "t2" | "p2">, ms: number): number => l.p1 + ((l.p2 - l.p1) * (ms - l.t1)) / Math.max(1, l.t2 - l.t1);

/** Canvas colour of a tone from the live palette; blind mode (`neutral`) draws win / loss in the foreground ink. */
export const trendColor = (tone: TrendTone, neutral: boolean): string => {
  const t: TrendTone = neutral && (tone === "win" || tone === "loss") ? "fg" : tone;
  return t === "win" ? ink.win : t === "loss" ? ink.loss : t === "fg" ? ink.fg : ink.mute;
};

class TrendRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly geo: readonly TrendGeo[],
    private readonly o: TrendlineOptions,
  ) {}

  draw(target: RenderTarget): void {
    if (!this.geo.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, bitmapSize.width, bitmapSize.height);
      ctx.clip();
      ctx.lineCap = "round";
      for (const g of this.geo) {
        const color = trendColor(g.tone, this.o.neutral);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, Math.round((g.strong ? 1.5 : 1.1) * hr));
        ctx.globalAlpha = g.strong ? 1 : 0.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(g.x1 * hr, g.y1 * vr);
        ctx.lineTo(g.x2 * hr, g.y2 * vr);
        ctx.stroke();
        if (g.x3 != null && g.y3 != null) {
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([1.5 * hr, 3.5 * hr]);
          ctx.beginPath();
          ctx.moveTo(g.x2 * hr, g.y2 * vr);
          ctx.lineTo(g.x3 * hr, g.y3 * vr);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const g of this.geo) {
        const l = g.label;
        if (!l) continue;
        const x = Math.round(l.box.x * hr);
        const y = Math.round(l.box.y * vr);
        const w = Math.round(l.box.w * hr);
        const h = Math.round(l.box.h * vr);
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = withAlpha(ink.bg, 0.92);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 3 * hr);
        else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = l.color;
        ctx.font = `${LABEL_PX * vr}px ${FONT}`;
        ctx.textBaseline = "middle";
        ctx.fillText(l.text, x + LABEL_PAD * hr, y + h / 2 + 0.5 * vr);
      }
      ctx.restore();
    });
  }
}

class TrendPaneView implements IPrimitivePaneView {
  constructor(private readonly src: TrendlinePrimitive) {}
  zOrder(): PrimitivePaneViewZOrder {
    return "normal";
  }
  renderer(): IPrimitivePaneRenderer | null {
    return new TrendRenderer(this.src.geometry(), this.src.options);
  }
}

export class TrendlinePrimitive implements ISeriesPrimitive<Time> {
  options: TrendlineOptions;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: TrendPaneView[];
  private lines: readonly ChartTrendline[] = [];
  private geo: TrendGeo[] = [];
  private geoKey = "";

  constructor(
    private readonly host: TrendlineHost,
    opts: Partial<TrendlineOptions> = {},
  ) {
    this.options = { neutral: false, ...opts };
    this.views = [new TrendPaneView(this)];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    requestUpdate();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  applyOptions(o: Partial<TrendlineOptions>): void {
    this.options = { ...this.options, ...o };
    this.geoKey = "";
    this.requestUpdate?.();
  }

  setLines(lines: readonly ChartTrendline[]): void {
    this.lines = lines;
    this.geoKey = "";
    this.requestUpdate?.();
  }

  /** The loaded bars were replaced (history load) or the palette changed: recompute on the next draw. */
  invalidate(): void {
    this.geoKey = "";
    this.requestUpdate?.();
  }

  chartLines(): readonly ChartTrendline[] {
    return this.lines;
  }

  geometry(): readonly TrendGeo[] {
    return this.geo;
  }

  updateAllViews(): void {
    const chart = this.chart;
    const series = this.series;
    const bars = this.host.bars();
    if (!chart || !series || bars.length === 0 || this.lines.length === 0) {
      this.geo = [];
      this.geoKey = "";
      return;
    }
    const ts = chart.timeScale();
    const vis = ts.getVisibleLogicalRange();
    const width = ts.width();
    if (!vis || width <= 0) {
      this.geo = [];
      return;
    }
    const last = bars[bars.length - 1]!;
    const memo = `${bars.length}:${bars[0]!.time}:${last.time}|${vis.from},${vis.to},${width}|${series.priceToCoordinate(1000)},${series.priceToCoordinate(2000)}|${this.options.neutral ? 1 : 0}`;
    if (memo === this.geoKey) return;
    this.geoKey = memo;
    const iv = this.host.intervalSec();
    const right = width - RIGHT_RESERVED;
    const out: TrendGeo[] = [];
    const cands: LabelCandidate<{ set: (c: PlacedCaption) => void; text: string; color: string }>[] = [];
    for (const l of this.lines) {
      const i1 = logicalFrac(bars, Math.floor(l.t1 / 1000), iv);
      const i2 = logicalFrac(bars, Math.floor(l.solidTo / 1000), iv);
      const i3 = l.extendTo == null ? null : logicalFrac(bars, Math.floor(l.extendTo / 1000), iv);
      if (i1 == null || i2 == null) continue;
      const iEnd = i3 ?? i2;
      if (iEnd < vis.from - 1 || i1 > vis.to + 1) continue; // wholly outside the view
      const x1 = logicalToX(ts, i1);
      const x2 = logicalToX(ts, i2);
      const x3 = i3 == null ? null : logicalToX(ts, i3);
      const y1 = series.priceToCoordinate(priceAtTime(l, l.t1));
      const y2 = series.priceToCoordinate(priceAtTime(l, l.solidTo));
      const y3 = l.extendTo == null ? null : series.priceToCoordinate(priceAtTime(l, l.extendTo));
      if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
      const g: TrendGeo = { id: l.id, x1, y1, x2, y2, x3: x3 != null && y3 != null ? x3 : null, y3: x3 != null && y3 != null ? y3 : null, tone: l.tone, strong: !!l.strong, label: null };
      out.push(g);
      if (!l.label) continue;
      // the caption ends at the solid part's end (kept inside the pane, left of the price-line strip)
      const w = estimateTextWidth(l.label, LABEL_PX) + 2 * LABEL_PAD;
      const cx = Math.max(0, Math.min(x2 - w, right - w - 2));
      const t = (cx + w / 2 - x1) / Math.max(1e-6, x2 - x1);
      const cy = y1 + (y2 - y1) * Math.min(1, Math.max(0, t));
      const dy = l.captionAbove ? -LABEL_H - 3 : 3;
      cands.push({ box: { x: cx, y: cy + dy, w, h: LABEL_H }, prio: l.strong ? 0 : 1, nudge: LINE_NUDGE, data: { set: (c) => (g.label = c), text: l.label, color: trendColor(l.tone, this.options.neutral) } });
    }
    const height = (chart.panes()[0]?.getHeight() ?? 0) || 10_000;
    const placed = placeLabels(cands, [{ x: width - RIGHT_RESERVED, y: 0, w: RIGHT_RESERVED, h: height }, ...(this.host.reserved?.() ?? [])], { x: 0, y: 0, w: width, h: height });
    for (const p of placed) p.data.set({ box: p.box, text: p.data.text, color: p.data.color });
    this.geo = out;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
