/**
 * Series primitive drawing the Einstiegs-Check on the price pane (decisions 9 + 10): MCB dots by candle-close state,
 * RSI / WaveTrend divergence lines between their pivots, support / resistance levels (nearest ones with an axis label)
 * and – optional – market structure (BOS / CHoCH, EQH / EQL, swing labels).
 *
 * Look (calm, monochrome where possible; green / red only for long / short signals – the declared journal exception):
 * - MCB dots: provisional = outlined ring in the ~50 % saturated tone, confirmed = filled dot, strong = dot + halo.
 * - Divergences: 1 px lines from pivot to pivot, bullish under the lows (win), bearish over the highs (loss); regular
 *   solid, hidden dashed, provisional dotted in the soft tone; active ones (counting in the check) full, older ones faint.
 *   RSI and WT on the same pivots share one line (`RSI · WT`). Tiny label at the newer pivot.
 * - S/R: the nearest support and resistance as solid `#9b9b9b` lines from their origin bar (order blocks with a faint
 *   band), further levels dotted `#5f5f5f`; labels in-pane at the left (never on the price axis column), the nearest two
 *   also as price-axis labels unless another axis label (level, zone edge, last price) sits within `AXIS_LABEL_GAP`.
 * - Struktur: dotted break segments (pivot → break) with `BOS` / `CHoCH`, EQH / EQL links, HH / HL / LH / LL.
 *
 * Every label is placed collision-free (`placeLabels`): never over another label, a dot, the zone caption or the
 * price-line titles at the right edge – a label that finds no free spot is left out. Geometry is computed in
 * `updateAllViews` (cheap: visible items only, O(log n) bar lookups); no React, no timers. Hidden layers cost nothing.
 */
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { SignalState } from "@/domain/signals/state";
import { AXIS_LABEL_GAP } from "../axisLabels";
import { fmt } from "../format";
import { ink } from "../ink";
import { axisLabelClear, barIndex, barIndexAtOrAfter, estimateTextWidth, LINE_NUDGE, placeLabels, type Box, type LabelCandidate } from "../overlayLayout";
import { signalDots, type SignalDot, type SignalMarker } from "../signalMarkers";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

// ------------------------------------------------------------------ input types (structural; `@/market` fits them)

export interface OverlayPoint {
  /** bar open time, ms UTC */
  time: number;
  price: number;
}

/** A divergence line (`@/market` `ChartDivergence`). */
export interface DivergenceLine {
  osc: "rsi" | "wt";
  kind: "regular" | "hidden";
  /** 1 bullish, −1 bearish */
  dir: 1 | -1;
  from: OverlayPoint;
  to: OverlayPoint;
  state: SignalState;
  /** counts in the check right now */
  active: boolean;
}

/** A support / resistance level (`@/market` `ChartLevel`). */
export interface OverlayLevel {
  /** the edge facing the price */
  price: number;
  top: number;
  btm: number;
  kind: string;
  /** 1 support, −1 resistance */
  dir: 1 | -1;
  /** origin bar, ms; `null` = the premium/discount range (full width) */
  time: number | null;
  /** German name (`Demand-OB`, `Swing-Hoch`, …) */
  label: string;
}

/** Market structure of the chart interval (`@/market` `ChartStructure`). */
export interface StructureOverlay {
  swings: ReadonlyArray<{ time: number; price: number; high: boolean; internal: boolean; label: string }>;
  breaks: ReadonlyArray<{ time: number; level: number; pivotTime: number; kind: "BOS" | "CHoCH"; dir: 1 | -1; internal: boolean }>;
  eqs: ReadonlyArray<{ kind: "EQH" | "EQL"; price: number; from: OverlayPoint; to: OverlayPoint; broken: boolean }>;
  supports: readonly OverlayLevel[];
  resistances: readonly OverlayLevel[];
  support: OverlayLevel | null;
  resistance: OverlayLevel | null;
}

/** Which layers are drawn (legend toggles). */
export interface OverlayLayers {
  mcb: boolean;
  div: boolean;
  sr: boolean;
  struct: boolean;
}

export const DEFAULT_LAYERS: OverlayLayers = { mcb: true, div: true, sr: true, struct: false };

/** What the overlay reads from the chart it sits on. */
export interface OverlayHost {
  /** the chart's bars (ascending, UTC seconds) – updated in place by the live engine */
  bars(): ReadonlyArray<{ time: number; high: number; low: number }>;
  /** prices of the OTHER price-axis labels (trigger levels, zone edges, last price) */
  axisPrices(): readonly number[];
  /** boxes (CSS px) labels must keep clear of, e.g. the zone caption */
  reserved?(): readonly Box[];
}

// ------------------------------------------------------------------ look

const FONT_FAMILY = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
/** label font sizes (CSS px): S/R, divergence / structure */
const SR_PX = 10;
const TINY_PX = 9;
const LABEL_PAD_X = 3;
const LABEL_H_SR = 14;
const LABEL_H_TINY = 12;
/** price-line titles (LONG / INVAL / HART …) sit at the right edge of the pane: labels keep this strip free */
export const RIGHT_RESERVED = 64;
const LABEL_BG = "rgba(10,10,10,0.78)";
const BAND_FILL = "rgba(255,255,255,0.035)";
const NEAR_LINE = ink.mute;
const FAR_LINE = ink.tick;
const STRUCT_LINE = ink.tick;
/** alpha of divergence lines that no longer count in the check */
const OLD_DIV_ALPHA = 0.38;

const OSC_TEXT = { rsi: "RSI", wt: "WT" } as const;
/** divergence lines per side that keep their label after they stopped counting */
const LABELLED_RECENT = 2;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
/** Text width (CSS px) in the overlay font; estimated where no canvas exists (tests). */
function textWidth(text: string, px: number): number {
  const key = `${px}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (measureCtx === undefined) {
    try {
      // jsdom (unit tests) has no canvas: estimate instead of logging "not implemented"
      const jsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
      measureCtx = typeof document !== "undefined" && !jsdom ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measureCtx = null;
    }
  }
  let w = estimateTextWidth(text, px);
  if (measureCtx) {
    measureCtx.font = `${px}px ${FONT_FAMILY}`;
    const m = measureCtx.measureText(text).width;
    if (Number.isFinite(m) && m > 0) w = Math.ceil(m);
  }
  if (widthCache.size > 400) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

// ------------------------------------------------------------------ indexed (bar indices; rebuilt when bars or inputs change)

interface IxDiv {
  i1: number;
  i2: number;
  p1: number;
  p2: number;
  dir: 1 | -1;
  hidden: boolean;
  provisional: boolean;
  active: boolean;
  /** one of the newest `LABELLED_RECENT` lines of its side (labelled even when no longer active) */
  recent: boolean;
  text: string;
}
interface IxLevel {
  /** origin index; −1 → from the left edge */
  i0: number;
  price: number;
  top: number;
  btm: number;
  zone: boolean;
  dir: 1 | -1;
  nearest: boolean;
  text: string;
  /** the label without the level kind, for a narrow pane */
  short: string;
}
interface IxSeg {
  i1: number;
  i2: number;
  p1: number;
  p2: number;
  text: string;
  /** label above (−1) or below (+1) the segment */
  side: -1 | 1;
  faint: boolean;
}
interface IxSwing {
  i: number;
  price: number;
  high: boolean;
  text: string;
}

/** Divergences grouped by pivots: RSI + WT on the same pair share a line. */
function indexDivergences(lines: readonly DivergenceLine[], bars: ReadonlyArray<{ time: number }>): IxDiv[] {
  const map = new Map<string, IxDiv & { oscs: string[] }>();
  for (const d of lines) {
    const i1 = barIndex(bars, Math.floor(d.from.time / 1000));
    const i2 = barIndex(bars, Math.floor(d.to.time / 1000));
    if (i1 < 0 || i2 < 0 || i2 <= i1) continue;
    const key = `${d.dir}:${i1}:${i2}:${d.kind}`;
    const osc = OSC_TEXT[d.osc];
    const prev = map.get(key);
    const provisional = d.state === "provisional";
    if (prev) {
      if (!prev.oscs.includes(osc)) prev.oscs.push(osc);
      prev.active ||= d.active;
      prev.provisional &&= provisional;
      continue;
    }
    map.set(key, { i1, i2, p1: d.from.price, p2: d.to.price, dir: d.dir, hidden: d.kind === "hidden", provisional, active: d.active, recent: false, text: "", oscs: [osc] });
  }
  const out = [...map.values()].map(({ oscs, ...x }) => ({ ...x, text: oscs.sort().join(" · ") }));
  for (const dir of [1, -1]) {
    out
      .filter((x) => x.dir === dir)
      .sort((a, b) => b.i2 - a.i2)
      .slice(0, LABELLED_RECENT)
      .forEach((x) => (x.recent = true));
  }
  return out;
}

function indexLevels(s: StructureOverlay, bars: ReadonlyArray<{ time: number }>): IxLevel[] {
  const out: IxLevel[] = [];
  const near = new Set<OverlayLevel>([s.support, s.resistance].filter((l): l is OverlayLevel => !!l));
  const seen = new Set<string>();
  for (const l of [...(s.support ? [s.support] : []), ...(s.resistance ? [s.resistance] : []), ...s.supports, ...s.resistances]) {
    const key = `${l.dir}:${l.price}:${l.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let i0 = -1;
    if (l.time != null) {
      const t = Math.floor(l.time / 1000);
      i0 = barIndex(bars, t);
      if (i0 < 0) i0 = Math.max(-1, barIndexAtOrAfter(bars, t) - 1);
    }
    const nearest = near.has(l) || (s.support != null && l.dir === 1 && l.price === s.support.price) || (s.resistance != null && l.dir === -1 && l.price === s.resistance.price);
    const zone = l.top - l.btm > 0;
    out.push({
      i0,
      price: l.price,
      top: l.top,
      btm: l.btm,
      zone,
      dir: l.dir,
      nearest,
      text: nearest ? `${l.dir === 1 ? "Support" : "Widerstand"} · ${l.label} ${fmt.price(l.price)}` : l.label,
      short: nearest ? `${l.dir === 1 ? "Support" : "Widerstand"} ${fmt.price(l.price)}` : l.label,
    });
  }
  return out;
}

function indexStructure(s: StructureOverlay, bars: ReadonlyArray<{ time: number }>): { segs: IxSeg[]; swings: IxSwing[] } {
  const segs: IxSeg[] = [];
  for (const b of s.breaks) {
    const i1 = barIndex(bars, Math.floor(b.pivotTime / 1000));
    const i2 = barIndex(bars, Math.floor(b.time / 1000));
    if (i1 < 0 || i2 < 0 || i2 <= i1) continue;
    segs.push({ i1, i2, p1: b.level, p2: b.level, text: b.kind, side: b.dir === 1 ? -1 : 1, faint: b.internal });
  }
  for (const q of s.eqs) {
    if (q.broken) continue;
    const i1 = barIndex(bars, Math.floor(q.from.time / 1000));
    const i2 = barIndex(bars, Math.floor(q.to.time / 1000));
    if (i1 < 0 || i2 < 0 || i2 <= i1) continue;
    segs.push({ i1, i2, p1: q.from.price, p2: q.to.price, text: q.kind, side: q.kind === "EQH" ? -1 : 1, faint: false });
  }
  const swings: IxSwing[] = [];
  for (const p of s.swings) {
    if (p.internal) continue;
    const i = barIndex(bars, Math.floor(p.time / 1000));
    if (i >= 0) swings.push({ i, price: p.price, high: p.high, text: p.label });
  }
  return { segs, swings };
}

// ------------------------------------------------------------------ view geometry (CSS px)

interface Band {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}
interface HLine {
  x1: number;
  x2: number;
  y: number;
  color: string;
  dash: readonly number[];
  alpha: number;
}
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
  r: number;
  color: string;
  style: SignalDot["style"];
}
interface Label {
  box: Box;
  text: string;
  color: string;
  px: number;
  alpha: number;
}

interface Geometry {
  bands: Band[];
  hlines: HLine[];
  segs: Seg[];
  divs: Seg[];
  dots: Dot[];
  labels: Label[];
}

const EMPTY_GEOMETRY: Geometry = { bands: [], hlines: [], segs: [], divs: [], dots: [], labels: [] };

// ------------------------------------------------------------------ renderers

function drawDash(ctx: CanvasRenderingContext2D, dash: readonly number[], ratio: number): void {
  ctx.setLineDash(dash.map((d) => d * ratio));
}

class BottomRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly g: Geometry) {}
  draw(target: RenderTarget): void {
    const g = this.g;
    if (!g.bands.length && !g.hlines.length && !g.segs.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.fillStyle = BAND_FILL;
      for (const b of g.bands) {
        const x = Math.round(b.x1 * hr);
        const y = Math.round(Math.min(b.y1, b.y2) * vr);
        ctx.fillRect(x, y, Math.max(1, Math.round(b.x2 * hr) - x), Math.max(1, Math.round(Math.abs(b.y2 - b.y1) * vr)));
      }
      const lw = Math.max(1, Math.floor(vr));
      ctx.lineWidth = lw;
      const half = lw % 2 ? 0.5 : 0;
      for (const l of g.hlines) {
        ctx.globalAlpha = l.alpha;
        ctx.strokeStyle = l.color;
        drawDash(ctx, l.dash, hr);
        const y = Math.round(l.y * vr) + half;
        ctx.beginPath();
        ctx.moveTo(Math.round(l.x1 * hr), y);
        ctx.lineTo(Math.round(l.x2 * hr), y);
        ctx.stroke();
      }
      for (const s of g.segs) {
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        drawDash(ctx, s.dash, hr);
        ctx.beginPath();
        ctx.moveTo(Math.round(s.x1 * hr), Math.round(s.y1 * vr) + half);
        ctx.lineTo(Math.round(s.x2 * hr), Math.round(s.y2 * vr) + half);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class TopRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly g: Geometry) {}
  draw(target: RenderTarget): void {
    const g = this.g;
    if (!g.divs.length && !g.dots.length && !g.labels.length) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, Math.round(hr));
      for (const s of g.divs) {
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        drawDash(ctx, s.dash, hr);
        ctx.beginPath();
        ctx.moveTo(s.x1 * hr, s.y1 * vr);
        ctx.lineTo(s.x2 * hr, s.y2 * vr);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const d of g.dots) {
        const x = d.x * hr;
        const y = d.y * vr;
        const r = d.r * hr;
        ctx.beginPath();
        if (d.style === "provisional") {
          // outlined ring in the soft tone (decision 9: ~50 % saturation, outlined)
          const w = Math.max(1, 1.25 * hr);
          ctx.lineWidth = w;
          ctx.strokeStyle = d.color;
          ctx.fillStyle = "rgba(10,10,10,0.6)";
          ctx.arc(x, y, Math.max(1, r - w / 2), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = d.color;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (d.style === "strong") {
          ctx.beginPath();
          ctx.lineWidth = Math.max(1, hr);
          ctx.strokeStyle = d.color;
          ctx.globalAlpha = 0.5;
          ctx.arc(x, y, r + 2.25 * hr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.textBaseline = "middle";
      for (const l of g.labels) {
        const x = Math.round(l.box.x * hr);
        const y = Math.round(l.box.y * vr);
        const w = Math.round(l.box.w * hr);
        const h = Math.round(l.box.h * vr);
        ctx.globalAlpha = 1;
        ctx.fillStyle = LABEL_BG;
        const rr = 3 * hr;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, rr);
        else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.globalAlpha = l.alpha;
        ctx.fillStyle = l.color;
        ctx.font = `${l.px * vr}px ${FONT_FAMILY}`;
        ctx.fillText(l.text, x + LABEL_PAD_X * hr, y + h / 2 + 0.5 * vr);
      }
      ctx.restore();
    });
  }
}

class OverlayPaneView implements IPrimitivePaneView {
  constructor(
    private readonly src: SignalOverlay,
    private readonly layer: "bottom" | "top",
  ) {}
  zOrder(): PrimitivePaneViewZOrder {
    return this.layer === "bottom" ? "bottom" : "normal";
  }
  renderer(): IPrimitivePaneRenderer | null {
    const g = this.src.geometry();
    return this.layer === "bottom" ? new BottomRenderer(g) : new TopRenderer(g);
  }
}

class LevelAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly src: SignalOverlay,
    private readonly dir: 1 | -1,
  ) {}
  coordinate(): number {
    return this.src.axisY(this.dir) ?? -10000;
  }
  text(): string {
    const p = this.src.axisPrice(this.dir);
    return p == null ? "" : fmt.price(p);
  }
  textColor(): string {
    return ink.mute;
  }
  backColor(): string {
    return "#161616";
  }
  visible(): boolean {
    return this.src.axisY(this.dir) != null;
  }
  tickVisible(): boolean {
    return false;
  }
}

// ------------------------------------------------------------------ the primitive

export class SignalOverlay implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: OverlayPaneView[];
  private readonly axisViews: LevelAxisView[];

  private markers: readonly SignalMarker[] = [];
  private lines: readonly DivergenceLine[] = [];
  private structure: StructureOverlay | null = null;
  private layers: OverlayLayers = DEFAULT_LAYERS;

  /** bar indices, rebuilt when the inputs or the loaded bars change */
  private ix: { dots: SignalDot[]; divs: IxDiv[]; levels: IxLevel[]; segs: IxSeg[]; swings: IxSwing[] } | null = null;
  private ixKey = "";
  private geo: Geometry = EMPTY_GEOMETRY;
  /** inputs of the last geometry (skips the recompute on redraws that move nothing of the overlay) */
  private geoKey = "";
  private geoIx: SignalOverlay["ix"] = null;
  /** nearest support / resistance on the price axis: price and y (null = hidden) */
  private axis: { sup: { price: number; y: number | null } | null; res: { price: number; y: number | null } | null } = { sup: null, res: null };

  constructor(private readonly host: OverlayHost) {
    this.views = [new OverlayPaneView(this, "bottom"), new OverlayPaneView(this, "top")];
    this.axisViews = [new LevelAxisView(this, 1), new LevelAxisView(this, -1)];
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

  /** MCB events (≤ 1 change per published check). */
  setMarkers(markers: readonly SignalMarker[]): void {
    this.markers = markers;
    this.invalidate();
  }

  setDivergences(lines: readonly DivergenceLine[]): void {
    this.lines = lines;
    this.invalidate();
  }

  setStructure(s: StructureOverlay | null): void {
    this.structure = s;
    this.invalidate();
  }

  setLayers(layers: OverlayLayers): void {
    if (layers.mcb === this.layers.mcb && layers.div === this.layers.div && layers.sr === this.layers.sr && layers.struct === this.layers.struct) return;
    this.layers = layers;
    this.requestUpdate?.();
  }

  /** The loaded bars were replaced (history load): re-index on the next draw. */
  invalidate(): void {
    this.ix = null;
    this.requestUpdate?.();
  }

  geometry(): Geometry {
    return this.geo;
  }

  /** y of the nearest support (1) / resistance (−1) axis label, `null` while hidden. */
  axisY(dir: 1 | -1): number | null {
    const a = dir === 1 ? this.axis.sup : this.axis.res;
    return a?.y ?? null;
  }

  axisPrice(dir: 1 | -1): number | null {
    const a = dir === 1 ? this.axis.sup : this.axis.res;
    return a?.price ?? null;
  }

  /** Prices of the S/R labels currently shown on the price axis (the tick formatter blanks ticks next to them). */
  axisLabelPrices(): number[] {
    const out: number[] = [];
    if (this.axis.sup?.y != null) out.push(this.axis.sup.price);
    if (this.axis.res?.y != null) out.push(this.axis.res.price);
    return out;
  }

  /** Items drawn right now (tests / diagnostics). */
  counts(): { dots: number; divs: number; levels: number; segs: number; labels: number } {
    const g = this.geo;
    return { dots: g.dots.length, divs: g.divs.length, levels: g.hlines.length, segs: g.segs.length, labels: g.labels.length };
  }

  private indexed(): NonNullable<SignalOverlay["ix"]> {
    const bars = this.host.bars();
    const key = `${bars.length}:${bars[0]?.time ?? 0}`;
    if (this.ix && key === this.ixKey) return this.ix;
    this.ixKey = key;
    const s = this.structure;
    const st = s ? indexStructure(s, bars) : { segs: [], swings: [] };
    this.ix = {
      dots: signalDots(this.markers, bars),
      divs: indexDivergences(this.lines, bars),
      levels: s ? indexLevels(s, bars) : [],
      segs: st.segs,
      swings: st.swings,
    };
    return this.ix;
  }

  updateAllViews(): void {
    const chart = this.chart;
    const series = this.series;
    const bars = this.host.bars();
    if (!chart || !series || bars.length === 0) {
      this.geo = EMPTY_GEOMETRY;
      this.geoKey = "";
      this.axis = { sup: null, res: null };
      return;
    }
    const ts = chart.timeScale();
    const vis = ts.getVisibleLogicalRange();
    const width = ts.width();
    const height = chart.panes()[0]?.getHeight() ?? 0;
    if (!vis || width <= 0 || height <= 0) {
      this.geo = EMPTY_GEOMETRY;
      this.geoKey = "";
      this.axis = { sup: null, res: null };
      return;
    }
    const ix = this.indexed();
    const L = this.layers;
    // the chart redraws per live print: recompute only when something that moves the overlay changed
    const last = bars[bars.length - 1]!;
    const axisPrices = this.host.axisPrices();
    const reserved = this.host.reserved?.() ?? [];
    const memo = `${this.ixKey}|${vis.from},${vis.to},${width},${height}|${series.priceToCoordinate(last.low)},${series.priceToCoordinate(last.low * 1.01 + 1)}|${last.high},${last.low}|${+L.mcb}${+L.div}${+L.sr}${+L.struct}|${axisPrices.join(",")}|${reserved.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";")}`;
    if (memo === this.geoKey && ix === this.geoIx) return;
    this.geoKey = memo;
    this.geoIx = ix;
    const lo = Math.floor(vis.from) - 2;
    const hi = Math.ceil(vis.to) + 2;
    const xOf = (i: number): number | null => ts.logicalToCoordinate(i as Logical);
    const yOf = (p: number): number | null => series.priceToCoordinate(p);
    const g: Geometry = { bands: [], hlines: [], segs: [], divs: [], dots: [], labels: [] };
    const cands: LabelCandidate<{ text: string; color: string; px: number; alpha: number }>[] = [];
    const obstacles: Box[] = [{ x: width - RIGHT_RESERVED, y: 0, w: RIGHT_RESERVED, h: height }, ...reserved];
    const tiny = (text: string) => ({ w: textWidth(text, TINY_PX) + 2 * LABEL_PAD_X, h: LABEL_H_TINY });

    // ---- S/R (bottom layer) + its labels
    let sup: { price: number; y: number | null } | null = null;
    let res: { price: number; y: number | null } | null = null;
    if (L.sr) {
      for (const l of ix.levels) {
        const y = yOf(l.price);
        if (y == null || y < -4 || y > height + 4) continue;
        const origin = l.i0 < 0 ? 0 : Math.max(0, xOf(l.i0) ?? 0);
        if (origin >= width && !l.nearest) continue;
        if (l.zone && l.nearest && origin < width) {
          const yt = yOf(l.top);
          const yb = yOf(l.btm);
          if (yt != null && yb != null) g.bands.push({ x1: origin, x2: width, y1: yt, y2: yb });
        }
        // the nearest support / resistance run across the pane with their label at the left edge (clear of the
        // newest candles); further levels start at their origin bar with a small label beside it
        const x1 = l.nearest ? 0 : origin;
        g.hlines.push({ x1, x2: width, y, color: l.nearest ? NEAR_LINE : FAR_LINE, dash: l.nearest ? [] : [1, 3], alpha: l.nearest ? 0.85 : 0.7 });
        const px = l.nearest ? SR_PX : TINY_PX;
        const h = l.nearest ? LABEL_H_SR : LABEL_H_TINY;
        // a narrow pane (phone) gets the label without the level kind
        const fits = (t: string) => 4 + textWidth(t, px) + 2 * LABEL_PAD_X <= width - RIGHT_RESERVED;
        const text = !l.nearest || fits(l.text) ? l.text : l.short;
        const w = textWidth(text, px) + 2 * LABEL_PAD_X;
        let lx = l.nearest ? 4 : origin + 6;
        if (!l.nearest && lx + w > width - RIGHT_RESERVED) lx = origin - 6 - w;
        if (lx < 0 && !l.nearest) continue;
        cands.push({ box: { x: Math.max(4, lx), y: y - h / 2, w, h }, prio: l.nearest ? 0 : 3, nudge: LINE_NUDGE, data: { text, color: l.nearest ? ink.mute : ink.tick, px, alpha: 1 } });
        if (l.nearest) {
          if (l.dir === 1 && !sup) sup = { price: l.price, y };
          if (l.dir === -1 && !res) res = { price: l.price, y };
        }
      }
    }
    // the nearest levels on the price axis only where no other axis label sits (no shoving, no half-covered digits)
    const others = axisPrices.map(yOf);
    const supY = sup && axisLabelClear(sup.y, others, AXIS_LABEL_GAP) ? sup.y : null;
    const resY = res && axisLabelClear(res.y, [...others, supY], AXIS_LABEL_GAP) ? res.y : null;
    this.axis = { sup: sup ? { price: sup.price, y: supY } : null, res: res ? { price: res.price, y: resY } : null };

    // ---- structure (bottom layer)
    if (L.struct) {
      for (const s of ix.segs) {
        if (s.i2 < lo || s.i1 > hi) continue;
        const x1 = xOf(s.i1);
        const x2 = xOf(s.i2);
        const y1 = yOf(s.p1);
        const y2 = yOf(s.p2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        g.segs.push({ x1, y1, x2, y2, color: STRUCT_LINE, dash: [2, 3], alpha: s.faint ? 0.55 : 0.9 });
        const sz = tiny(s.text);
        const mx = (x1 + x2) / 2 - sz.w / 2;
        const my = (y1 + y2) / 2;
        cands.push({ box: { x: mx, y: s.side < 0 ? my - sz.h - 1 : my + 1, ...sz }, prio: 4, data: { text: s.text, color: ink.mute, px: TINY_PX, alpha: s.faint ? 0.7 : 1 } });
      }
      for (const p of ix.swings) {
        if (p.i < lo || p.i > hi) continue;
        const x = xOf(p.i);
        const y = yOf(p.price);
        if (x == null || y == null) continue;
        const sz = tiny(p.text);
        cands.push({ box: { x: x - sz.w / 2, y: p.high ? y - sz.h - 3 : y + 3, ...sz }, prio: 6, data: { text: p.text, color: ink.tick, px: TINY_PX, alpha: 1 } });
      }
    }

    // ---- MCB dots (obstacles for every label)
    if (L.mcb) {
      for (const d of ix.dots) {
        if (d.index < lo || d.index > hi) continue;
        const b = bars[d.index];
        const x = xOf(d.index);
        if (!b || x == null) continue;
        const tip = yOf(d.long ? b.low : b.high);
        if (tip == null) continue;
        const y = d.long ? tip + d.offset : tip - d.offset;
        g.dots.push({ x, y, r: d.r, color: d.color, style: d.style });
        obstacles.push({ x: x - d.r - 1, y: y - d.r - 1, w: 2 * d.r + 2, h: 2 * d.r + 2 });
      }
    }

    // ---- divergences
    if (L.div) {
      for (const d of ix.divs) {
        if (d.i2 < lo || d.i1 > hi) continue;
        const x1 = xOf(d.i1);
        const x2 = xOf(d.i2);
        const y1 = yOf(d.p1);
        const y2 = yOf(d.p2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        const long = d.dir === 1;
        const color = d.provisional ? (long ? ink.winSoft : ink.lossSoft) : long ? ink.win : ink.loss;
        const alpha = d.active ? 0.95 : OLD_DIV_ALPHA;
        g.divs.push({ x1, y1, x2, y2, color, dash: d.provisional ? [1, 3] : d.hidden ? [4, 3] : [], alpha });
        // words only where they matter: lines counting in the check and the newest ones per side
        if (!d.active && !d.recent) continue;
        const sz = tiny(d.text);
        cands.push({
          box: { x: x2 + 5, y: long ? y2 + 2 : y2 - 2 - sz.h, ...sz },
          prio: d.active ? 1 : 5,
          nudge: long ? [sz.h + 2] : [-(sz.h + 2)],
          data: { text: d.text, color, px: TINY_PX, alpha: d.active ? 1 : 0.6 },
        });
      }
    }

    const placed = placeLabels(cands, obstacles, { x: 0, y: 0, w: width, h: height });
    g.labels = placed.map((p) => ({ box: p.box, ...p.data }));
    this.geo = g;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }
}
