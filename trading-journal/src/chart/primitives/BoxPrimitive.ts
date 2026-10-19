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
 *   fg), a small label `T1 86.100` left of the price-line strip – the label ends its line (the stroke stops at the
 *   plate), unless it had to move off the line.
 *
 * Motion (finite canvas tweens only – every one ends, nothing animates at rest; reduced motion: static):
 * - a NEW box id draws in: the fill grows from → to (`easeOutCubic` over `tween.draw`), the edges fade in
 *   (ZonePrimitive `fadeIn` pattern), its target lines extend left → right one after another (`stagger.cards`);
 * - provisional → confirmed: the solid edge wipes in over `tween.reveal`.
 * The rAF loop runs only while a tween runs and calls `requestUpdate`; geometry is computed in `updateAllViews` for the
 * boxes in view, memoised on what moves it. x: `logicalToX(barIndex ± 0.5)` (`../logicalX.ts` – lwc maps only WHOLE
 * logicals, a fractional one would land on x = 0); a box spans its bars edge to edge, times beyond the last bar map to
 * logical indices past it (`last + Δt / interval`), so targets reach into the future space; a box older than the loaded
 * bars starts off screen on the same grid, one that ended before them is not drawn. No React, no timers.
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
import { ink, withAlpha } from "../ink";
import { logicalToX } from "../logicalX";
import { axisLabelClear, barIndexAtOrAfter, estimateTextWidth, LINE_NUDGE, placeLabels, type Box as OverlayBox, type LabelCandidate } from "../overlayLayout";
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
  /** boxes (CSS px) the labels keep clear of: the check overlay's labels, the zone caption */
  reserved?(): readonly OverlayBox[];
  /** a draw-in or edge wipe starts its frame loop (the chart is not settled until `busy()` is false again) */
  onTween?(): void;
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
  /** blind mode (F62): no win / loss tones – boxes and targets in the neutral grey ramp (form, not colour, tells them apart) */
  neutral: boolean;
}

/**
 * Read-only diagnostics hook a chart puts on its host element under `BOX_DEBUG_KEY` (e2e / dev tools: where a box is
 * drawn against the bar grid). A plain property – nothing runs until it is read.
 */
export const BOX_DEBUG_KEY = "__tjBoxes";
export interface BoxDebugHook {
  /** the boxes as drawn right now (CSS px, chart-relative) */
  geometry(): readonly BoxGeo[];
  /** the boxes handed to the chart (times in ms) */
  boxes(): readonly ChartBox[];
  /** the chart's bars (ascending, UTC seconds) */
  bars(): ReadonlyArray<{ time: number; open: number; high: number; low: number; close: number }>;
  /** CSS-px x of a logical index (fractional allowed: `i − 0.5` is the left edge of bar `i`) */
  x(logical: number): number | null;
}

export const BOX_DEFAULTS: BoxOptions = { fillAlpha: 0.08, edgeAlpha: 0.55, inMs: tween.draw.duration * 1000, autoscale: false, axisLabels: true, neutral: false };

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_PX = 9;
const CAPTION_PX = 10;
const LABEL_PAD = 3;
const LABEL_H = 12;
const CAPTION_H = 14;
/** label plate from the live palette (dark: rgba(10,10,10,0.92)) */
const labelBg = (): string => withAlpha(ink.bg, 0.92);
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
const TARGET_COLOR = (kind: ChartBoxTarget["kind"], tone: BoxTone, neutral = false): string => (neutral ? (kind === "entry" ? ink.fg : ink.mute) : kind === "sl" ? ink.loss : kind === "entry" ? ink.fg : tone === "loss" ? ink.loss : tone === "win" ? ink.win : ink.mute);
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
  /** caption box (CSS px, placed collision-free), `null` = no room */
  caption: PlacedLabel | null;
  targets: Array<{ y: number; x1: number; x2: number; color: string; dash: readonly number[]; text: string; grow: number; label: PlacedLabel | null }>;
}

/** A label placed by `placeLabels` (never over another label, the zone caption or the check overlay's labels). */
export interface PlacedLabel {
  box: OverlayBox;
  text: string;
  color: string;
}

/** A label on a nearly opaque plate (price action behind it never shows through the text). */
function drawLabel(ctx: CanvasRenderingContext2D, l: PlacedLabel, px: number, alpha: number, hr: number, vr: number): void {
  const x = Math.round(l.box.x * hr);
  const y = Math.round(l.box.y * vr);
  const w = Math.round(l.box.w * hr);
  const h = Math.round(l.box.h * vr);
  ctx.setLineDash([]);
  ctx.globalAlpha = Math.min(1, alpha + 0.1);
  ctx.fillStyle = labelBg();
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 3 * hr);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = l.color;
  ctx.font = `${px * vr}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(l.text, x + LABEL_PAD * hr, y + h / 2 + 0.5 * vr);
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
          // a label on its own line is the line's end: the line stops at the plate (no dash pokes out behind the price
          // – „82.264,96 -“ read like a minus); a label nudged off the line leaves it full length
          const onLine = t.label != null && Math.abs(t.label.box.y + t.label.box.h / 2 - t.y) < 1;
          const end = onLine ? Math.min(t.x2, t.label!.box.x - 2) : t.x2;
          const tx2 = Math.round((t.x1 + Math.max(0, end - t.x1) * t.grow) * hr);
          const ty = Math.round(t.y * vr) + (lw % 2 ? 0.5 : 0);
          ctx.globalAlpha = 0.85 * b.edge;
          ctx.strokeStyle = t.color;
          ctx.lineWidth = lw;
          ctx.setLineDash(t.dash.map((d) => d * hr));
          ctx.beginPath();
          ctx.moveTo(tx1, ty);
          ctx.lineTo(tx2, ty);
          ctx.stroke();
          if (t.grow >= 1 && t.label) drawLabel(ctx, t.label, LABEL_PX, b.edge, hr, vr);
        }
        if (b.caption && b.edge > 0) drawLabel(ctx, b.caption, CAPTION_PX, 0.85 * b.edge * k, hr, vr);
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
    return ink.grid;
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

  /** The boxes as handed in (`setBoxes`; tests / diagnostics). */
  chartBoxes(): readonly ChartBox[] {
    return this.boxes;
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
    if (this.animating(performance.now())) {
      this.raf = requestAnimationFrame(step);
      this.host.onTween?.();
    }
  }

  /** A draw-in or edge wipe is running (its frame loop; reduced motion: never). */
  busy(): boolean {
    return this.raf !== 0;
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
    const cands: LabelCandidate<{ set: (l: PlacedLabel) => void; text: string; color: string }>[] = [];
    /** captions already wanted: the two parts of a re-entered box share theirs – the first part in view with room shows it */
    const captions = new Set<string>();
    for (const b of this.boxes) {
      const s0 = Math.floor(b.from / 1000);
      // a box older than the loaded bars starts on the bar grid left of them (off screen), never on the first bar
      const i0 = logicalAt(bars, s0, iv) ?? (s0 - bars[0]!.time) / Math.max(1, iv);
      let i1: number | null = null;
      if (b.to != null) {
        i1 = logicalAt(bars, Math.floor(b.to / 1000), iv);
        if (i1 == null) continue; // ended before the first loaded bar (never the live edge)
      }
      if (i1 != null && i1 < vis.from - 1) continue; // ends left of the view
      if (i0 > vis.to + 1) continue; // starts right of the view
      // bar edges are half-integer logicals: lwc maps only whole ones (`logicalToX` interpolates)
      const xa = logicalToX(ts, i0 - 0.5);
      const xb = i1 == null ? width : logicalToX(ts, i1 - 0.5);
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
      const tone = this.options.neutral ? "neutral" : b.tone;
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
          color: TARGET_COLOR(t.kind, tone, this.options.neutral),
          dash: TARGET_DASH[t.kind],
          text: t.label ? `${t.label} ${fmt.price(t.price)}` : fmt.price(t.price),
          grow: Number.isFinite(t0) ? easeOutCubic(tAge / (this.options.inMs * 0.6)) : 1,
          label: null,
        });
      });
      const g: BoxGeo = { id: b.id, x1, x2, y1, y2, tone, provisional: b.state === "provisional", active: !!b.active, grow: Number.isFinite(t0) ? grow : 1, edge: Number.isFinite(t0) ? edge : 1, wipe: c0 == null || !Number.isFinite(c0) ? 1 : wipe, caption: null, targets };
      out.push(g);
      // candidates: the target labels at the right (left of the price-line strip), the caption top left inside the box
      targets.forEach((t, k) => {
        const w = estimateTextWidth(t.text, LABEL_PX) + 2 * LABEL_PAD;
        cands.push({ box: { x: right - w - 4, y: t.y - LABEL_H / 2, w, h: LABEL_H }, prio: k, nudge: LINE_NUDGE.slice(0, 2), data: { set: (l) => (t.label = l), text: t.text, color: t.color } });
      });
      const text = (b.label ?? "").toUpperCase();
      if (text && !captions.has(`${text}@${b.top}:${b.btm}`) && Math.abs(y2 - y1) >= CAPTION_H + 4 && x2 - x1 > 60) {
        captions.add(`${text}@${b.top}:${b.btm}`);
        const w = estimateTextWidth(text, CAPTION_PX) + 2 * LABEL_PAD;
        const color = b.state === "provisional" ? toneOf(tone).soft : tone === "neutral" ? ink.mute : toneOf(tone).solid;
        cands.push({ box: { x: x1 + 4, y: Math.min(y1, y2) + 3, w, h: CAPTION_H }, prio: b.active ? 10 : 20, nudge: [CAPTION_H + 2], data: { set: (l) => (g.caption = l), text, color } });
      }
    }
    // collision-free: never over another label, the check overlay's labels or the zone caption (else left out)
    const height = (this.chart?.panes()[0]?.getHeight() ?? 0) || 10_000;
    const placed = placeLabels(cands, [{ x: width - RIGHT_RESERVED, y: 0, w: RIGHT_RESERVED, h: height }, ...(this.host.reserved?.() ?? [])], { x: 0, y: 0, w: width, h: height });
    for (const p of placed) p.data.set({ box: p.box, text: p.data.text, color: p.data.color });
    this.geo = out;
    this.updateAxis(axisPrices, yOf);
  }

  /** The active box's edges on the price axis, only where no other axis label sits. */
  private updateAxis(axisPrices: readonly number[], yOf: (p: number) => number | null): void {
    // an active box in view (a re-entered box has two active parts with the same edges: whichever is drawn)
    const act = this.options.axisLabels ? this.boxes.find((b) => b.active && this.geo.some((g) => g.id === b.id)) : undefined;
    if (!act) {
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
