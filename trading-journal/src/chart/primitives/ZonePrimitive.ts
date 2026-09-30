/**
 * Series primitive drawing the macro zone band `zoneLow–zoneHigh` (Plan 5.4):
 * fill `#ffffff0e`, dashed edges `[2,3]·DPR`, `zOrder 'bottom'`, price-axis labels `Zone`,
 * `autoscaleInfo` keeps the band in view, `hitTest` → `externalId:'zone'`, `fadeIn` via requestUpdate.
 */
import type {
  AutoscaleInfo,
  Coordinate,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface ZoneOptions {
  /** fill colour incl. alpha (default `#ffffff0e`) */
  fill: string;
  /** edge colour (default `#f2f2f2`) */
  stroke: string;
  /** edge alpha multiplier (default 0.35) */
  strokeOpacity: number;
  /** overall alpha 0–1 (animated by `fadeIn`) */
  opacity: number;
  /** price-axis label text */
  label: string;
  labelBackground: string;
  labelText: string;
}

export const ZONE_DEFAULTS: ZoneOptions = {
  fill: "#ffffff0e",
  stroke: "#f2f2f2",
  strokeOpacity: 0.35,
  opacity: 1,
  label: "Zone",
  labelBackground: "#1c1c1c",
  labelText: "#9b9b9b",
};

export interface ZoneRange {
  low: number;
  high: number;
  /** left edge; `null` = from the left border of the pane */
  from?: Time | null;
  /** right edge; `null` = to the right border of the pane */
  to?: Time | null;
}

/** Pixel-aligned box helper (verbatim from `@tradingview/lwc-toolkit/dimensions/positions`). */
export function positionsBox(p1: number, p2: number, pixelRatio: number): { position: number; length: number } {
  const a = Math.round(pixelRatio * p1);
  const b = Math.round(pixelRatio * p2);
  return { position: Math.min(a, b), length: Math.abs(b - a) + 1 };
}

interface ViewBox {
  x1: number | null;
  x2: number | null;
  y1: Coordinate | null;
  y2: Coordinate | null;
  width: number;
}

class ZoneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly box: ViewBox,
    private readonly o: ZoneOptions,
  ) {}

  draw(target: RenderTarget): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { y1, y2 } = this.box;
      if (y1 === null || y2 === null || this.o.opacity <= 0) return;
      const ctx = scope.context;
      const x1 = this.box.x1 ?? 0;
      const x2 = this.box.x2 ?? this.box.width;
      const h = positionsBox(x1, x2, scope.horizontalPixelRatio);
      const v = positionsBox(y1, y2, scope.verticalPixelRatio);
      ctx.save();
      ctx.globalAlpha = this.o.opacity;
      ctx.fillStyle = this.o.fill;
      ctx.fillRect(h.position, v.position, h.length, v.length);
      ctx.globalAlpha = this.o.opacity * this.o.strokeOpacity;
      ctx.strokeStyle = this.o.stroke;
      ctx.lineWidth = Math.max(1, Math.floor(scope.verticalPixelRatio));
      ctx.setLineDash([2 * scope.horizontalPixelRatio, 3 * scope.horizontalPixelRatio]);
      ctx.beginPath();
      ctx.moveTo(h.position, v.position + 0.5);
      ctx.lineTo(h.position + h.length, v.position + 0.5);
      ctx.moveTo(h.position, v.position + v.length - 0.5);
      ctx.lineTo(h.position + h.length, v.position + v.length - 0.5);
      ctx.stroke();
      ctx.restore();
    });
  }
}

class ZonePaneView implements IPrimitivePaneView {
  private box: ViewBox = { x1: null, x2: null, y1: null, y2: null, width: 0 };

  constructor(private readonly src: ZonePrimitive) {}

  update(): void {
    const chart = this.src.chartApi();
    const series = this.src.seriesApi();
    if (!chart || !series) return;
    const ts = chart.timeScale();
    const r = this.src.range;
    this.box = {
      x1: r.from == null ? null : ts.timeToCoordinate(r.from),
      x2: r.to == null ? null : ts.timeToCoordinate(r.to),
      y1: series.priceToCoordinate(r.high),
      y2: series.priceToCoordinate(r.low),
      width: ts.width(),
    };
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    return new ZoneRenderer(this.box, this.src.options);
  }

  /** CSS-pixel hit test on the band. */
  contains(x: number, y: number): boolean {
    const { y1, y2 } = this.box;
    if (y1 === null || y2 === null) return false;
    const x1 = this.box.x1 ?? 0;
    const x2 = this.box.x2 ?? this.box.width;
    return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
  }
}

class ZoneAxisView implements ISeriesPrimitiveAxisView {
  private y: number | null = null;

  constructor(
    private readonly src: ZonePrimitive,
    private readonly edge: "low" | "high",
  ) {}

  update(): void {
    const series = this.src.seriesApi();
    this.y = series ? series.priceToCoordinate(this.src.range[this.edge]) : null;
  }
  coordinate(): number {
    return this.y ?? -10000;
  }
  text(): string {
    return this.src.options.label;
  }
  textColor(): string {
    return this.src.options.labelText;
  }
  backColor(): string {
    return this.src.options.labelBackground;
  }
  visible(): boolean {
    return this.y !== null && this.src.options.opacity > 0;
  }
  tickVisible(): boolean {
    return false;
  }
}

export class ZonePrimitive implements ISeriesPrimitive<Time> {
  options: ZoneOptions;
  range: ZoneRange;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly paneViewsArr: ZonePaneView[];
  private readonly axisViewsArr: ZoneAxisView[];
  private raf = 0;

  constructor(range: ZoneRange, options: Partial<ZoneOptions> = {}) {
    this.range = range;
    this.options = { ...ZONE_DEFAULTS, ...options };
    this.paneViewsArr = [new ZonePaneView(this)];
    this.axisViewsArr = [new ZoneAxisView(this, "high"), new ZoneAxisView(this, "low")];
  }

  chartApi(): IChartApiBase<Time> | null {
    return this.chart;
  }
  seriesApi(): ISeriesApi<SeriesType, Time> | null {
    return this.series;
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    requestUpdate();
  }

  detached(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  updateAllViews(): void {
    for (const v of this.paneViewsArr) v.update();
    for (const v of this.axisViewsArr) v.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.paneViewsArr;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViewsArr;
  }

  autoscaleInfo(_start: Logical, _end: Logical): AutoscaleInfo | null {
    if (this.options.opacity <= 0) return null;
    return { priceRange: { minValue: this.range.low, maxValue: this.range.high } };
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const view = this.paneViewsArr[0];
    if (!view || !view.contains(x, y)) return null;
    return { externalId: "zone", zOrder: "bottom", hitTestPriority: 0, cursorStyle: "default" };
  }

  setRange(range: ZoneRange): void {
    this.range = range;
    this.requestUpdate?.();
  }

  applyOptions(o: Partial<ZoneOptions>): void {
    this.options = { ...this.options, ...o };
    this.requestUpdate?.();
  }

  /** Tweens `opacity` 0 → target over `ms` with rAF + requestUpdate (ease-out cubic). Reduced motion → instant. */
  fadeIn(ms = 320, reducedMotion = false): void {
    const target = this.options.opacity || 1;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (reducedMotion || ms <= 0 || typeof requestAnimationFrame !== "function") {
      this.applyOptions({ opacity: target });
      return;
    }
    this.options = { ...this.options, opacity: 0 };
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      this.options = { ...this.options, opacity: target * (1 - Math.pow(1 - p, 3)) };
      this.requestUpdate?.();
      this.raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
  }
}
