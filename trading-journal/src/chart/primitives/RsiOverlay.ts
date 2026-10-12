/**
 * Series primitive on the RSI pane line (P02): the diagonal RSI trendlines (resistance through falling RSI highs,
 * support through rising lows – `@/domain/boxes` `rsiLines`) and their glowing break markers.
 *
 * Look: active lines 1 px `ink.mute`, extended a few bars into the future space (dotted); a broken line in its tone
 * (falling line broken up = win, rising line broken down = loss) ending one bar past the break; the break marker a dot
 * with a soft canvas glow (`shadowBlur`, none under `data-safe-fx`) and a halo ring at α .5 – the "strong" dot style of the
 * check overlay; a provisional break (forming bar) in the ~50 % saturated soft tone, outlined. A tiny `Bruch ↑` label.
 * The breathing glow over the newest break is DOM (`GlowBreak` in the chart's ripple layer), never a canvas loop.
 *
 * Geometry in `updateAllViews` (visible items only, memoised); y from the RSI series, height from the RSI pane
 * (`series.getPane().getHeight()`, not pane 0). No React, no timers.
 */
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { isSafeFx } from "@/motion/safeFx";
import { ink } from "../ink";
import { estimateTextWidth } from "../overlayLayout";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface RsiOverlayLine {
  kind: "res" | "sup";
  /** anchor pivot (bar index on the chart's bars) and slope in RSI points per bar */
  a: { i: number; v: number };
  slope: number;
  /** index where the solid part ends (break bar + 1, or the last bar) */
  end: number;
  /** dotted extension to this index (active lines only) */
  extend: number | null;
  broken: boolean;
  /** broken within `maxAge` bars */
  fresh: boolean;
}

export interface RsiOverlayBreak {
  i: number;
  v: number;
  /** 1 = falling line broken up, −1 = rising line broken down */
  dir: 1 | -1;
  fresh: boolean;
  /** on the forming bar (close pending) */
  provisional: boolean;
}

export interface RsiOverlayData {
  lines: readonly RsiOverlayLine[];
  breaks: readonly RsiOverlayBreak[];
}

export const EMPTY_RSI_OVERLAY: RsiOverlayData = { lines: [], breaks: [] };

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const TINY_PX = 9;

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dash: readonly number[];
  alpha: number;
}
interface Dot {
  x: number;
  y: number;
  color: string;
  provisional: boolean;
  fresh: boolean;
  text: string;
}
interface Geo {
  segs: Seg[];
  dots: Dot[];
}
const EMPTY: Geo = { segs: [], dots: [] };

class RsiRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly g: Geo) {}
  draw(target: RenderTarget): void {
    const g = this.g;
    if (!g.segs.length && !g.dots.length) return;
    const glow = !isSafeFx();
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, Math.round(hr));
      for (const s of g.segs) {
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        ctx.setLineDash(s.dash.map((d) => d * hr));
        ctx.beginPath();
        ctx.moveTo(s.x1 * hr, s.y1 * vr);
        ctx.lineTo(s.x2 * hr, s.y2 * vr);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const d of g.dots) {
        const x = d.x * hr;
        const y = d.y * vr;
        const r = (d.fresh ? 3.5 : 2.75) * hr;
        ctx.globalAlpha = d.fresh ? 1 : 0.6;
        ctx.beginPath();
        if (d.provisional) {
          ctx.lineWidth = Math.max(1, 1.25 * hr);
          ctx.strokeStyle = d.color;
          ctx.fillStyle = "rgba(10,10,10,0.6)";
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          if (glow && d.fresh) {
            ctx.shadowBlur = 8 * hr;
            ctx.shadowColor = d.color;
          }
          ctx.fillStyle = d.color;
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.lineWidth = Math.max(1, hr);
          ctx.strokeStyle = d.color;
          ctx.globalAlpha = d.fresh ? 0.5 : 0.3;
          ctx.arc(x, y, r + 2.25 * hr, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (d.text) {
          ctx.globalAlpha = d.fresh ? 0.95 : 0.6;
          ctx.fillStyle = d.color;
          ctx.font = `${TINY_PX * vr}px ${FONT}`;
          ctx.textBaseline = "middle";
          const w = estimateTextWidth(d.text, TINY_PX) * hr;
          ctx.fillText(d.text, x - w - r - 5 * hr, y);
        }
      }
      ctx.restore();
    });
  }
}

class RsiPaneView implements IPrimitivePaneView {
  constructor(private readonly src: RsiOverlay) {}
  zOrder(): PrimitivePaneViewZOrder {
    return "normal";
  }
  renderer(): IPrimitivePaneRenderer | null {
    return new RsiRenderer(this.src.geometry());
  }
}

export class RsiOverlay implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views = [new RsiPaneView(this)];
  private data: RsiOverlayData = EMPTY_RSI_OVERLAY;
  private geo: Geo = EMPTY;
  private geoKey = "";

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

  setData(d: RsiOverlayData): void {
    this.data = d;
    this.geoKey = "";
    this.requestUpdate?.();
  }

  geometry(): Geo {
    return this.geo;
  }

  /** Items drawn right now (tests). */
  counts(): { lines: number; breaks: number } {
    return { lines: this.geo.segs.length, breaks: this.geo.dots.length };
  }

  /** Height of the pane this line lives in (the RSI pane, never pane 0). */
  private paneHeight(): number {
    const s = this.series as (ISeriesApi<SeriesType, Time> & { getPane?: () => { getHeight(): number } }) | null;
    try {
      const h = s?.getPane?.().getHeight();
      if (h != null && h > 0) return h;
    } catch {
      /* pane gone */
    }
    return this.chart?.panes()[1]?.getHeight() ?? 0;
  }

  updateAllViews(): void {
    const chart = this.chart;
    const series = this.series;
    const d = this.data;
    if (!chart || !series || (!d.lines.length && !d.breaks.length)) {
      this.geo = EMPTY;
      this.geoKey = "";
      return;
    }
    const ts = chart.timeScale();
    const vis = ts.getVisibleLogicalRange();
    const width = ts.width();
    const height = this.paneHeight();
    if (!vis || width <= 0 || height <= 0) {
      this.geo = EMPTY;
      return;
    }
    const memo = `${vis.from},${vis.to},${width},${height}|${series.priceToCoordinate(30)},${series.priceToCoordinate(70)}`;
    if (memo === this.geoKey) return;
    this.geoKey = memo;
    const xOf = (i: number): number | null => ts.logicalToCoordinate(i as Logical);
    const yOf = (v: number): number | null => series.priceToCoordinate(v);
    const lo = vis.from - 2;
    const hi = vis.to + 2;
    const g: Geo = { segs: [], dots: [] };
    for (const l of d.lines) {
      const at = (i: number) => l.a.v + l.slope * (i - l.a.i);
      const tone = l.broken ? (l.kind === "res" ? ink.win : ink.loss) : ink.mute;
      const push = (i1: number, i2: number, dash: readonly number[], alpha: number) => {
        if (i2 < lo || i1 > hi) return;
        const x1 = xOf(i1);
        const x2 = xOf(i2);
        const y1 = yOf(at(i1));
        const y2 = yOf(at(i2));
        if (x1 == null || x2 == null || y1 == null || y2 == null) return;
        g.segs.push({ x1, y1, x2, y2, color: tone, dash, alpha });
      };
      push(l.a.i, l.end, [], l.broken ? (l.fresh ? 0.9 : 0.45) : 0.75);
      if (l.extend != null && l.extend > l.end) push(l.end, l.extend, [1, 3], 0.55);
    }
    for (const b of d.breaks) {
      if (b.i < lo || b.i > hi) continue;
      const x = xOf(b.i);
      const y = yOf(b.v);
      if (x == null || y == null) continue;
      const up = b.dir === 1;
      const color = b.provisional ? (up ? ink.winSoft : ink.lossSoft) : up ? ink.win : ink.loss;
      g.dots.push({ x, y, color, provisional: b.provisional, fresh: b.fresh, text: b.fresh ? (up ? "Bruch ↑" : "Bruch ↓") : "" });
    }
    this.geo = g;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
