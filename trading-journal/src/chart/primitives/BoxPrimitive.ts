/**
 * Series primitive drawing Box-zu-Box boxes on the price pane (P02): time-bounded support / resistance boxes, their
 * Box-zu-Box targets (stop, entry, T1 … T3) running into the empty space right of the live bar, and the edges' prices on
 * the axis. Built for many boxes (one primitive, one geometry pass) where `ZonePrimitive` draws one full-width band.
 *
 * Look (calm, grey ramp; win / loss only for a broken box and its targets – the journal exception):
 * - fill `fillAlpha` in the box tone, edges `edgeAlpha`; the active box brighter, older ones faint;
 * - provisional (live price beyond an edge, close pending): dashed edges in the soft tone; the confirmation at the close
 *   wipes the solid edge over the dashed one left → right;
 * - targets: thin lines from the box's right end to the pane edge (T dotted in the tone, stop dashed loss, entry solid
 *   fg), a small label `T1 86.100` left of the price-line strip.
 *
 * Motion (finite canvas tweens only – every one ends, nothing animates at rest; reduced motion: static):
 * - a NEW box id draws in: the fill grows from → to (`easeOutCubic` over `tween.draw`), the edges fade in
 *   (ZonePrimitive `fadeIn` pattern), its target lines extend left → right one after another (`stagger.cards`);
 * - provisional → confirmed: the solid edge wipes in over `tween.reveal`.
 * The rAF loop runs only while a tween runs and calls `requestUpdate`; geometry is computed in `updateAllViews` for the
 * boxes in view, memoised on what moves it. x: `logicalToCoordinate(barIndex)`; times beyond the last bar map to logical
 * indices past it (`last + Δt / interval`), so targets reach into the future space. No React, no timers.
 */
import type {
  AutoscaleInfo,
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
import { stagger, tween } from "@/motion/tokens";
import { AXIS_LABEL_GAP } from "../axisLabels";
import { fmt } from "../format";
import { ink } from "../ink";
import { axisLabelClear, barIndexAtOrAfter, estimateTextWidth } from "../overlayLayout";
import { RIGHT_RESERVED } from "./SignalOverlay";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export type BoxTone = "win" | "loss" | "neutral";
export type ChartBoxState = "provisional" | "confirmed";

export interface ChartBoxTarget {
  price: number;
  /** `T1`, `Stop`, `Einstieg` … (drawn left of the price-line strip) */
  label?: string;
  kind: "tp" | "sl" | "entry";
}

export interface ChartBox {
  /** stable; a new id draws in */
  id: string;
  /** ms UTC (Candle.time units): first bar of the box */
  from: number;
  /** ms UTC: end of the box (exclusive end of its last bar); `null` = the live edge (to the pane's right edge) */
  to: number | null;
  top: number;
  btm: number;
  tone: BoxTone;
  /** provisional = close pending (dashed, soft tone); default confirmed */
  state?: ChartBoxState;
  /** the active (newest) box: brighter fill, edge prices on the axis */
  active?: boolean;
  /** caption inside the box, top left (German, upper-cased) */
  label?: string;
  targets?: readonly ChartBoxTarget[];
}

export interface BoxHost {
  /** the chart's bars (ascending, UTC seconds) – updated in place by the live engine */
  bars(): ReadonlyArray<{ time: number; high: number; low: number }>;
  /** seconds per bar of the chart interval (future times → logical indices) */
  intervalSec(): number;
  reducedMotion(): boolean;
  /** prices of the OTHER price-axis labels (levels, last price, S/R): the edge labels keep clear of them */
  axisPrices?(): readonly number[];
}

export interface BoxOptions {
  fillAlpha: number;
  edgeAlpha: number;
  /** draw-in duration (ms) */
  inMs: number;
  /** keep the boxes (and targets) in the price range of the visible bars */
  autoscale: boolean;
  /** price-axis labels of the active box's edges */
  axisLabels: boolean;
}

export const BOX_DEFAULTS: BoxOptions = { fillAlpha: 0.08, edgeAlpha: 0.55, inMs: tween.draw.duration * 1000, autoscale: false, axisLabels: true };

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_PX = 9;
const CAPTION_PX = 10;
/** faint alpha multiplier of older (inactive) boxes */
const OLD = 0.5;
/** reveal of the confirmation wipe (ms) */
const WIPE_MS = tween.reveal.duration * 1000;
const TARGET_STAGGER_MS = stagger.cards * 1000;
/** draw-in start of a box that has not been drawn yet */
const PENDING = Number.NaN;

/** Tone colours, read at draw time (follows `applyInk`). */
const toneOf = (t: BoxTone): { solid: string; soft: string } =>
  t === "win" ? { solid: ink.win, soft: ink.winSoft } : t === "loss" ? { solid: ink.loss, soft: ink.lossSoft } : { solid: ink.fg, soft: ink.mute };
const TARGET_COLOR = (kind: ChartBoxTarget["kind"], tone: BoxTone): string => (kind === "sl" ? ink.loss : kind === "entry" ? ink.fg : tone === "loss" ? ink.loss : tone === "win" ? ink.win : ink.mute);
const TARGET_DASH: Record<ChartBoxTarget["kind"], readonly number[]> = { tp: [1, 3], sl: [4, 3], entry: [] };

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

/**
 * Logical index of a time (UTC s) on the bar grid: the bar at or after it inside the data, past the last bar
 * `last + (t − lastTime) / interval` (the future space), `null` before the first bar.
 */
export function logicalAt(bars: ReadonlyArray<{ time: number }>, sec: number, intervalSec: number): number | null {
  const n = bars.length;
  if (!n) return null;
  const first = bars[0]!.time;
  const last = bars[n - 1]!.time;
  if (sec > last) return n - 1 + (sec - last) / Math.max(1, intervalSec);
  if (sec < first) return null;
  return barIndexAtOrAfter(bars, sec);
}

// ------------------------------------------------------------------ geometry (CSS px)

export interface BoxGeo {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  tone: BoxTone;
  provisional: boolean;
  active: boolean;
  /** draw-in progress 0..1 (fill width) and edge alpha 0..1 */
  grow: number;
  edge: number;
  /** solid-edge wipe 0..1 (confirmation) */
  wipe: number;
  label: string;
  targets: Array<{ y: number; x1: number; x2: number; color: string; dash: readonly number[]; text: string; grow: number }>;
}

class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly boxes: readonly BoxGeo[],
    private readonly o: BoxOptions,
    private readonly layer: "bottom" | "top",
  ) {}

  draw(target: RenderTarget): void {
    if (!this.boxes.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      const lw = Math.max(1, Math.floor(vr));
      for (const b of this.boxes) {
        const col = toneOf(b.tone);
        const k = b.active ? 1 : OLD;
        const x1 = Math.round(b.x1 * hr);
        const x2 = Math.round((b.x1 + (b.x2 - b.x1) * b.grow) * hr);
        const y1 = Math.round(Math.min(b.y1, b.y2) * vr);
        const y2 = Math.round(Math.max(b.y1, b.y2) * vr);
        if (this.layer === "bottom") {
          if (x2 <= x1 || y2 <= y1) continue;
          ctx.globalAlpha = this.o.fillAlpha * k * (b.active ? 1.4 : 1);
          ctx.fillStyle = b.provisional ? col.soft : col.solid;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          // edges: dashed while provisional, the solid edge wipes in on the confirmation
          ctx.lineWidth = lw;
          const half = lw % 2 ? 0.5 : 0;
          const edgeAlpha = this.o.edgeAlpha * k * b.edge;
          const rect = () => {
            ctx.beginPath();
            ctx.rect(x1 + half, y1 + half, x2 - x1 - lw, y2 - y1 - lw);
            ctx.stroke();
          };
          if (b.provisional || b.wipe < 1) {
            ctx.globalAlpha = edgeAlpha;
            ctx.strokeStyle = col.soft;
            ctx.setLineDash([3 * hr, 3 * hr]);
            rect();
          }
          if (!b.provisional && b.wipe > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x1 - lw, y1 - lw, (x2 - x1 + 2 * lw) * b.wipe, y2 - y1 + 2 * lw);
            ctx.clip();
            ctx.globalAlpha = edgeAlpha;
            ctx.strokeStyle = col.solid;
            ctx.setLineDash([]);
            rect();
            ctx.restore();
          }
          continue;
        }
        // top layer: target lines + labels + caption
        ctx.setLineDash([]);
        for (const t of b.targets) {
          if (t.grow <= 0) continue;
          const tx1 = Math.round(t.x1 * hr);
          const tx2 = Math.round((t.x1 + (t.x2 - t.x1) * t.grow) * hr);
          const ty = Math.round(t.y * vr) + (lw % 2 ? 0.5 : 0);
          ctx.globalAlpha = 0.85 * b.edge;
          ctx.strokeStyle = t.color;
          ctx.lineWidth = lw;
          ctx.setLineDash(t.dash.map((d) => d * hr));
          ctx.beginPath();
          ctx.moveTo(tx1, ty);
          ctx.lineTo(tx2, ty);
          ctx.stroke();
          if (t.grow >= 1 && t.text) {
            ctx.setLineDash([]);
            ctx.font = `${LABEL_PX * vr}px ${FONT}`;
            const w = (estimateTextWidth(t.text, LABEL_PX) + 6) * hr;
            const lx = tx2 - w - 4 * hr;
            const lh = 12 * vr;
            ctx.globalAlpha = 0.92;
            ctx.fillStyle = "rgba(10,10,10,0.92)";
            ctx.fillRect(lx, ty - lh / 2, w, lh);
            ctx.globalAlpha = b.edge;
            ctx.fillStyle = t.color;
            ctx.textBaseline = "middle";
            ctx.fillText(t.text, lx + 3 * hr, ty + 0.5 * vr);
          }
        }
        if (b.label && b.edge > 0 && Math.abs(b.y2 - b.y1) >= 18 && b.x2 - b.x1 > 60) {
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.8 * b.edge * k;
          ctx.fillStyle = b.provisional ? toneOf(b.tone).soft : b.tone === "neutral" ? ink.mute : toneOf(b.tone).solid;
          ctx.font = `${CAPTION_PX * vr}px ${FONT}`;
          ctx.textBaseline = "top";
          ctx.fillText(b.label.toUpperCase(), Math.round(b.x1 * hr) + 6 * hr, Math.round(Math.min(b.y1, b.y2) * vr) + 4 * vr);
        }
      }
      ctx.restore();
    });
  }
}

class BoxPaneView implements IPrimitivePaneView {
  constructor(
    private readonly src: BoxPrimitive,
    private readonly layer: "bottom" | "top",
  ) {}
  zOrder(): PrimitivePaneViewZOrder {
    return this.layer === "bottom" ? "bottom" : "normal";
  }
  renderer(): IPrimitivePaneRenderer | null {
    return new BoxRenderer(this.src.geometry(), this.src.options, this.layer);
  }
}

class EdgeAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly src: BoxPrimitive,
    private readonly edge: "top" | "btm",
  ) {}
  coordinate(): number {
    return this.src.axisY(this.edge) ?? -10000;
  }
  text(): string {
    const p = this.src.axisPrice(this.edge);
    return p == null ? "" : fmt.price(p);
  }
  textColor(): string {
    return ink.fg;
  }
  backColor(): string {
    return "#1c1c1c";
  }
  visible(): boolean {
    return this.src.axisY(this.edge) != null;
  }
  tickVisible(): boolean {
    return false;
  }
}

// ------------------------------------------------------------------ the primitive

export class BoxPrimitive implements ISeriesPrimitive<Time> {
  options: BoxOptions;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: BoxPaneView[];
  private readonly axisViews: EdgeAxisView[];
  private boxes: readonly ChartBox[] = [];
  /** draw-in start per box id (performance.now), confirmation wipe start per id */
  private born = new Map<string, number>();
  private confirmedAt = new Map<string, number>();
  private states = new Map<string, ChartBoxState>();
  private geo: BoxGeo[] = [];
  private geoKey = "";
  private raf = 0;
  private axis: { top: { price: number; y: number | null } | null; btm: { price: number; y: number | null } | null } = { top: null, btm: null };

  constructor(
    private readonly host: BoxHost,
    opts: Partial<BoxOptions> = {},
  ) {
    this.options = { ...BOX_DEFAULTS, ...opts };
    this.views = [new BoxPaneView(this, "bottom"), new BoxPaneView(this, "top")];
    this.axisViews = [new EdgeAxisView(this, "top"), new EdgeAxisView(this, "btm")];
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

  applyOptions(o: Partial<BoxOptions>): void {
    this.options = { ...this.options, ...o };
    this.geoKey = "";
    this.requestUpdate?.();
  }

  /**
   * New boxes: an id not seen before draws in – from the first frame it is actually drawn (data loaded, in view), not
   * from this call; a provisional → confirmed change wipes its edge. Reduced motion: everything static.
   */
  setBoxes(boxes: readonly ChartBox[]): void {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const animate = !this.host.reducedMotion();
    const ids = new Set<string>();
    for (const b of boxes) {
      ids.add(b.id);
      const state = b.state ?? "confirmed";
      if (!this.born.has(b.id)) this.born.set(b.id, animate ? PENDING : -Infinity);
      const prev = this.states.get(b.id);
      if (prev === "provisional" && state === "confirmed") this.confirmedAt.set(b.id, animate ? now : -Infinity);
      this.states.set(b.id, state);
    }
    for (const id of [...this.born.keys()]) if (!ids.has(id)) this.born.delete(id);
    for (const id of [...this.states.keys()]) if (!ids.has(id)) this.states.delete(id);
    for (const id of [...this.confirmedAt.keys()]) if (!ids.has(id)) this.confirmedAt.delete(id);
    this.boxes = boxes;
    this.geoKey = "";
    this.kick();
    this.requestUpdate?.();
  }

  /** The loaded bars were replaced (history load): re-index on the next draw. */
  invalidate(): void {
    this.geoKey = "";
    this.requestUpdate?.();
  }

  geometry(): readonly BoxGeo[] {
    return this.geo;
  }

  /** Boxes drawn right now (tests / diagnostics). */
  count(): number {
    return this.geo.length;
  }

  axisY(edge: "top" | "btm"): number | null {
    return this.axis[edge]?.y ?? null;
  }

  axisPrice(edge: "top" | "btm"): number | null {
    return this.axis[edge]?.price ?? null;
  }

  /** Prices this primitive labels on the axis (the tick formatter blanks ticks next to them). */
  targetPrices(): number[] {
    const out: number[] = [];
    if (this.axis.top?.y != null) out.push(this.axis.top.price);
    if (this.axis.btm?.y != null) out.push(this.axis.btm.price);
    return out;
  }

  /** Runs the finite tween loop while a draw-in or wipe is in flight. */
  private kick(): void {
    if (this.raf || typeof requestAnimationFrame !== "function" || this.host.reducedMotion()) return;
    const step = () => {
      this.raf = 0;
      this.geoKey = "";
      this.requestUpdate?.();
      if (this.animating(performance.now())) this.raf = requestAnimationFrame(step);
    };
    if (this.animating(performance.now())) this.raf = requestAnimationFrame(step);
  }

  private animating(now: number): boolean {
    const span = this.options.inMs + TARGET_STAGGER_MS * 4 + 80;
    // a pending draw-in (not drawn yet) needs no loop: its first draw starts the tween (`updateAllViews` → `kick`)
    for (const t of this.born.values()) if (now - t < span) return true;
    for (const t of this.confirmedAt.values()) if (now - t < WIPE_MS + 80) return true;
    return false;
  }

  updateAllViews(): void {
    const chart = this.chart;
    const series = this.series;
    const bars = this.host.bars();
    if (!chart || !series || bars.length === 0 || this.boxes.length === 0) {
      this.geo = [];
      this.geoKey = "";
      this.axis = { top: null, btm: null };
      return;
    }
    const ts = chart.timeScale();
    const vis = ts.getVisibleLogicalRange();
    const width = ts.width();
    if (!vis || width <= 0) {
      this.geo = [];
      this.axis = { top: null, btm: null };
      return;
    }
    const last = bars[bars.length - 1]!;
    const yProbe = series.priceToCoordinate(last.low);
    const memo = `${bars.length}:${bars[0]!.time}:${last.time}|${vis.from},${vis.to},${width}|${yProbe},${series.priceToCoordinate(last.low * 1.01 + 1)}`;
    const axisPrices = this.host.axisPrices?.() ?? [];
    const yOf = (p: number): number | null => series.priceToCoordinate(p);
    if (memo === this.geoKey) {
      this.updateAxis(axisPrices, yOf);
      return;
    }
    this.geoKey = memo;
    const iv = this.host.intervalSec();
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const right = width - RIGHT_RESERVED;
    const out: BoxGeo[] = [];
    for (const b of this.boxes) {
      const i0 = logicalAt(bars, Math.floor(b.from / 1000), iv) ?? 0;
      const i1 = b.to == null ? null : logicalAt(bars, Math.floor(b.to / 1000), iv);
      if (i1 != null && i1 < vis.from - 1) continue; // ends left of the view
      if (i0 > vis.to + 1) continue; // starts right of the view
      const xa = ts.logicalToCoordinate((i0 - 0.5) as Logical);
      const xb = i1 == null ? width : ts.logicalToCoordinate((i1 - 0.5) as Logical);
      const y1 = yOf(b.top);
      const y2 = yOf(b.btm);
      if (xa == null || xb == null || y1 == null || y2 == null) continue;
      const x1 = Math.max(0, xa);
      const x2 = Math.min(width, Math.max(x1, xb));
      let t0 = this.born.get(b.id) ?? -Infinity;
      if (Number.isNaN(t0)) {
        // the draw-in starts with the first frame this box is drawn
        t0 = now;
        this.born.set(b.id, now);
        this.kick();
      }
      const age = now - t0;
      const grow = easeOutCubic(age / this.options.inMs);
      const edge = Math.min(1, Math.max(0, age / (this.options.inMs * 0.45)));
      const c0 = this.confirmedAt.get(b.id);
      const wipe = c0 == null ? 1 : easeOutCubic((now - c0) / WIPE_MS);
      const tone = b.tone;
      const targets: BoxGeo["targets"] = [];
      (b.targets ?? []).forEach((t, k) => {
        const y = yOf(t.price);
        if (y == null) return;
        const tx1 = Math.min(right - 24, Math.max(0, x2));
        const tAge = age - this.options.inMs * 0.5 - k * TARGET_STAGGER_MS;
        targets.push({
          y,
          x1: tx1,
          x2: right,
          color: TARGET_COLOR(t.kind, tone),
          dash: TARGET_DASH[t.kind],
          text: t.label ? `${t.label} ${fmt.price(t.price)}` : fmt.price(t.price),
          grow: Number.isFinite(t0) ? easeOutCubic(tAge / (this.options.inMs * 0.6)) : 1,
        });
      });
      out.push({ id: b.id, x1, x2, y1, y2, tone, provisional: b.state === "provisional", active: !!b.active, grow: Number.isFinite(t0) ? grow : 1, edge: Number.isFinite(t0) ? edge : 1, wipe: c0 == null || !Number.isFinite(c0) ? 1 : wipe, label: b.label ?? "", targets });
    }
    this.geo = out;
    this.updateAxis(axisPrices, yOf);
  }

  /** The active box's edges on the price axis, only where no other axis label sits. */
  private updateAxis(axisPrices: readonly number[], yOf: (p: number) => number | null): void {
    const act = this.options.axisLabels ? this.boxes.find((b) => b.active) : undefined;
    if (!act || !this.geo.some((g) => g.id === act.id)) {
      this.axis = { top: null, btm: null };
      return;
    }
    const others = axisPrices.map(yOf);
    const ty = yOf(act.top);
    const by = yOf(act.btm);
    const topY = axisLabelClear(ty, others, AXIS_LABEL_GAP) ? ty : null;
    const btmY = axisLabelClear(by, [...others, topY], AXIS_LABEL_GAP) ? by : null;
    this.axis = { top: { price: act.top, y: topY }, btm: { price: act.btm, y: btmY } };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  /** Opt-in: the boxes overlapping the visible range (and their targets) stay in the price range. */
  autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    if (!this.options.autoscale || !this.boxes.length) return null;
    const bars = this.host.bars();
    if (!bars.length) return null;
    const iv = this.host.intervalSec();
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of this.boxes) {
      const i0 = logicalAt(bars, Math.floor(b.from / 1000), iv) ?? 0;
      const i1 = b.to == null ? Infinity : (logicalAt(bars, Math.floor(b.to / 1000), iv) ?? -Infinity);
      if (i1 < start || i0 > end) continue;
      lo = Math.min(lo, b.btm);
      hi = Math.max(hi, b.top);
      if (b.active) for (const t of b.targets ?? []) {
        lo = Math.min(lo, t.price);
        hi = Math.max(hi, t.price);
      }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? { priceRange: { minValue: lo, maxValue: hi } } : null;
  }

  /** CSS-pixel hit test: the topmost (newest) box under the pointer → `b:{id}`. */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    for (let k = this.geo.length - 1; k >= 0; k--) {
      const g = this.geo[k]!;
      if (x >= g.x1 && x <= g.x2 && y >= Math.min(g.y1, g.y2) && y <= Math.max(g.y1, g.y2)) return { externalId: `b:${g.id}`, zOrder: "bottom", hitTestPriority: 0, cursorStyle: "default" };
    }
    return null;
  }

  /** Stops a running tween (unmount). */
  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
