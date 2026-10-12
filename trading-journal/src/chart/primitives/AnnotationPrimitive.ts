/**
 * Chart drawings of a trade (Journal v3, P06): horizontal line, trend line, box, text and arrow in TIME / PRICE
 * coordinates (`Annotation.points[].time` = UTC seconds, like the chart data), so a drawing stays on its candles at every
 * zoom and interval. Series primitive (type-only lightweight-charts imports, so it never pulls the chart into the main
 * chunk): x from the bar times (`logicalToCoordinate` with sub-bar interpolation, also right of the last bar), y from
 * `priceToCoordinate`.
 *
 * Draft: while a two-point tool waits for its second click, the shape follows the pointer dashed (`setDraft`). A new
 * drawing draws itself in (stroke progress 0 → 1, ease-out, `drawInMs`, rAF + `requestUpdate`, finite; instant under
 * reduced motion). The selected drawing is thicker with round handles. `hitAt(x, y)` finds a drawing under a point.
 */
import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Annotation, AnnotationKind } from "@/domain/types";
import { logicalToX } from "../logicalX";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export const ANNOTATION_COLORS = { fg: "#f2f2f2", mute: "#9b9b9b", win: "#3ddc84", loss: "#ff4d4f" } as const;
export type AnnotationColor = keyof typeof ANNOTATION_COLORS;
/** Points each tool needs. */
export const TOOL_POINTS: Record<AnnotationKind, 1 | 2> = { hline: 1, text: 1, trend: 2, box: 2, arrow: 2 };

export interface AnnotationHost {
  /** Bar open times (UTC seconds, ascending) of the series. */
  times(): readonly number[];
  /** Bar length in seconds (for drawings right of the last bar). */
  intervalSec(): number;
  reducedMotion(): boolean;
}

export interface AnnotationDraft {
  kind: AnnotationKind;
  points: { time: number; price: number }[];
  color?: string;
}

const FONT = '11px "IBM Plex Mono", ui-monospace, monospace';
const HIT_PX = 6;

/** Fractional logical index of a UTC-second time over ascending bar times (extrapolated beyond both ends). */
export function logicalOf(times: readonly number[], t: number, intervalSec: number): number | null {
  const n = times.length;
  if (!n) return null;
  const first = times[0]!;
  const last = times[n - 1]!;
  if (t <= first) return (t - first) / Math.max(1, intervalSec);
  if (t >= last) return n - 1 + (t - last) / Math.max(1, intervalSec);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const a = times[lo]!;
  const b = times[hi]!;
  return lo + (b > a ? (t - a) / (b - a) : 0);
}

/** Inverse of `logicalOf`: UTC seconds of a fractional logical index. */
export function timeOfLogical(times: readonly number[], logical: number, intervalSec: number): number | null {
  const n = times.length;
  if (!n || !Number.isFinite(logical)) return null;
  if (logical <= 0) return times[0]! + logical * intervalSec;
  if (logical >= n - 1) return times[n - 1]! + (logical - (n - 1)) * intervalSec;
  const i = Math.floor(logical);
  const a = times[i]!;
  const b = times[i + 1]!;
  return Math.round(a + (b - a) * (logical - i));
}

/** Distance of point p to segment ab (CSS px). */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

interface Shape {
  id: string;
  kind: AnnotationKind;
  pts: { x: number; y: number }[];
  color: string;
  text?: string;
  progress: number;
  selected: boolean;
  draft: boolean;
}

class AnnotationRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly shapes: readonly Shape[],
    private readonly width: number,
  ) {}

  draw(target: RenderTarget): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      for (const s of this.shapes) {
        const p = s.pts.map((q) => ({ x: q.x * hr, y: q.y * vr }));
        const a = p[0];
        if (!a) continue;
        const b = p[1] ?? a;
        const k = Math.max(0, Math.min(1, s.progress));
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = (s.selected ? 2 : 1.4) * hr;
        ctx.lineCap = "round";
        ctx.setLineDash(s.draft ? [4 * hr, 3 * hr] : []);
        switch (s.kind) {
          case "hline": {
            const w = this.width * hr;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(0, a.y);
            ctx.lineTo(w * k, a.y);
            ctx.stroke();
            break;
          }
          case "trend":
          case "arrow": {
            const ex = a.x + (b.x - a.x) * k;
            const ey = a.y + (b.y - a.y) * k;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            if (s.kind === "arrow" && k > 0.6) {
              const ang = Math.atan2(ey - a.y, ex - a.x);
              const head = 8 * hr;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(ex, ey);
              ctx.lineTo(ex - head * Math.cos(ang - 0.45), ey - head * Math.sin(ang - 0.45));
              ctx.lineTo(ex - head * Math.cos(ang + 0.45), ey - head * Math.sin(ang + 0.45));
              ctx.closePath();
              ctx.fill();
            }
            break;
          }
          case "box": {
            const x = Math.min(a.x, b.x);
            const y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x) * k;
            const h = Math.abs(b.y - a.y);
            ctx.globalAlpha = 0.1 * k;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 0.85;
            ctx.strokeRect(x, y, w, h);
            break;
          }
          case "text": {
            const label = s.text || "Notiz";
            ctx.font = FONT.replace(/^11px/, `${11 * vr}px`);
            const tw = ctx.measureText(label).width;
            const padX = 6 * hr;
            const h = 18 * vr;
            ctx.globalAlpha = 0.92 * k;
            ctx.fillStyle = "rgba(10,10,10,0.88)";
            ctx.fillRect(a.x, a.y - h / 2, tw + padX * 2, h);
            ctx.globalAlpha = k;
            ctx.strokeRect(a.x, a.y - h / 2, tw + padX * 2, h);
            ctx.fillStyle = s.color;
            ctx.textBaseline = "middle";
            ctx.fillText(label, a.x + padX, a.y);
            break;
          }
        }
        if (s.selected) {
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          for (const q of p) {
            ctx.beginPath();
            ctx.fillStyle = "#0a0a0a";
            ctx.arc(q.x, q.y, 4 * hr, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 1.5 * hr;
            ctx.strokeStyle = s.color;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    });
  }
}

class AnnotationPaneView implements IPrimitivePaneView {
  shapes: Shape[] = [];
  width = 0;
  constructor(private readonly src: AnnotationPrimitive) {}
  update(): void {
    const r = this.src.layout();
    this.shapes = r.shapes;
    this.width = r.width;
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }
  renderer(): IPrimitivePaneRenderer | null {
    return this.shapes.length ? new AnnotationRenderer(this.shapes, this.width) : null;
  }
}

export class AnnotationPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private items: Annotation[] = [];
  private draft: AnnotationDraft | null = null;
  private selected: string | null = null;
  private born = new Map<string, number>();
  private raf = 0;
  private readonly view = new AnnotationPaneView(this);
  /** Draw-in length (ms). */
  drawInMs = 520;

  constructor(private readonly host: AnnotationHost) {}

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
    this.view.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Replaces the drawings; ids not seen before draw themselves in. */
  setAnnotations(list: readonly Annotation[], animateNew = true): void {
    const known = new Set(this.items.map((a) => a.id));
    this.items = [...list];
    const now = performance.now();
    let fresh = false;
    for (const a of list) {
      if (!known.has(a.id) && animateNew && !this.host.reducedMotion()) {
        this.born.set(a.id, now);
        fresh = true;
      }
    }
    for (const id of [...this.born.keys()]) if (!list.some((a) => a.id === id)) this.born.delete(id);
    if (this.selected && !list.some((a) => a.id === this.selected)) this.selected = null;
    if (fresh) this.animate();
    this.requestUpdate?.();
  }
  setDraft(d: AnnotationDraft | null): void {
    this.draft = d;
    this.requestUpdate?.();
  }
  select(id: string | null): void {
    this.selected = id;
    this.requestUpdate?.();
  }
  selectedId(): string | null {
    return this.selected;
  }

  private animate(): void {
    if (this.raf || typeof requestAnimationFrame !== "function") return;
    const step = () => {
      this.raf = 0;
      this.requestUpdate?.();
      const now = performance.now();
      for (const [id, t0] of this.born) if (now - t0 >= this.drawInMs) this.born.delete(id);
      if (this.born.size) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private progressOf(id: string): number {
    const t0 = this.born.get(id);
    if (t0 == null) return 1;
    const p = Math.min(1, (performance.now() - t0) / this.drawInMs);
    return 1 - Math.pow(1 - p, 3);
  }

  /** CSS-px x of a UTC-second time (null off the scale). */
  xOf(time: number): number | null {
    const ts = this.chart?.timeScale();
    if (!ts) return null;
    const l = logicalOf(this.host.times(), time, this.host.intervalSec());
    // sub-bar times are fractional logicals: lwc maps only whole ones (a fractional one lands on x = 0) → interpolate
    return l == null ? null : logicalToX(ts, l);
  }
  yOf(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  /** The time / price under a CSS-px point of the pane (`null` outside the data). */
  pointAt(x: number, y: number): { time: number; price: number } | null {
    const ts = this.chart?.timeScale();
    const series = this.series;
    if (!ts || !series) return null;
    const logical = ts.coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (logical == null || price == null) return null;
    const time = timeOfLogical(this.host.times(), logical, this.host.intervalSec());
    return time == null ? null : { time, price: Number(price) };
  }

  layout(): { shapes: Shape[]; width: number } {
    const width = this.chart?.timeScale().width() ?? 0;
    const shapes: Shape[] = [];
    const toPts = (points: readonly { time: number; price: number }[]) => {
      const out: { x: number; y: number }[] = [];
      for (const p of points) {
        const x = this.xOf(p.time);
        const y = this.yOf(p.price);
        if (x == null || y == null) return null;
        out.push({ x, y });
      }
      return out;
    };
    for (const a of this.items) {
      const pts = toPts(a.points);
      if (!pts?.length) continue;
      shapes.push({ id: a.id, kind: a.kind, pts, color: a.color || ANNOTATION_COLORS.fg, text: a.text, progress: this.progressOf(a.id), selected: a.id === this.selected, draft: false });
    }
    if (this.draft) {
      const pts = toPts(this.draft.points);
      if (pts?.length) shapes.push({ id: "__draft", kind: this.draft.kind, pts, color: this.draft.color || ANNOTATION_COLORS.fg, progress: 1, selected: false, draft: true });
    }
    return { shapes, width };
  }

  /** Id of the drawing under (x, y) CSS px, topmost first. */
  hitAt(x: number, y: number): string | null {
    const { shapes, width } = this.layout();
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]!;
      if (s.draft) continue;
      const a = s.pts[0]!;
      const b = s.pts[1] ?? a;
      let hit: boolean;
      if (s.kind === "hline") hit = Math.abs(y - a.y) <= HIT_PX && x >= 0 && x <= width;
      else if (s.kind === "trend" || s.kind === "arrow") hit = distToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_PX;
      else if (s.kind === "box") hit = x >= Math.min(a.x, b.x) - HIT_PX && x <= Math.max(a.x, b.x) + HIT_PX && y >= Math.min(a.y, b.y) - HIT_PX && y <= Math.max(a.y, b.y) + HIT_PX;
      else hit = x >= a.x - HIT_PX && x <= a.x + 120 && Math.abs(y - a.y) <= 12;
      if (hit) return s.id;
    }
    return null;
  }
}
