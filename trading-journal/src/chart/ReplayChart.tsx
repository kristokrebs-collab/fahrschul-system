/**
 * Trade replay chart (Journal v3, P06) – its own lightweight-charts instance (load it lazily: `lazy(() =>
 * import("@/chart/ReplayChart"))`), driven by ONE MotionValue: `step` = how many bars of the window are shown.
 *
 * - Bars appear left → right as `step` grows (`series.update` per new bar, `setData` only when scrubbing back); the time
 *   and price scales are fixed to the whole window, so nothing jumps while the bars arrive.
 * - Entry / exit markers pop in when the playhead passes them, each with a sonar ripple (`spawnMarkerRipple`, DOM).
 * - A running MAE / MFE band (red below / green above the entry, `ReplayBand` primitive) grows with the excursion.
 * - `wipeKey` changes (interval switch, restart) play the pulse `StripWipe` from the previous picture.
 * Zero React renders per step: everything subscribes to `step` and writes imperatively. Reduced motion: no ripples, no
 * wipe (the bars still follow the scrubber – user driven).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MotionValue } from "motion/react";
import { createChart, createSeriesMarkers, LineStyle, type IChartApi, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi, type ISeriesMarkersPluginApi, type ISeriesPrimitive, type Logical, type PrimitivePaneViewZOrder, type SeriesAttachedParameter, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp } from "lightweight-charts";
import type { ReplayStep } from "@/domain/excursion";
import { cn } from "@/lib/cn";
import { playStripWipe } from "@/motion/pulse/StripWipe";
import { useReducedFx } from "@/motion/useReducedFx";
import { CHART_FONT, CHART_FONT_LOAD, NOTHING_MINI, ink } from "./theme";
import { createMainSeries, type MainSeries } from "./panes";
import { spawnMarkerRipple } from "./overlays";
import { MARKER_COLORS } from "./markers";

export interface ReplayBar {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ReplayTrade {
  side: "long" | "short";
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  /** index of the entry / exit bar in `bars` (exit `null` while open / unknown) */
  entryIndex: number;
  exitIndex: number | null;
  /** realised result for the exit marker colour */
  result: "win" | "loss" | "be" | "open";
}

export interface ReplayChartProps {
  bars: readonly ReplayBar[];
  trade: ReplayTrade;
  steps: readonly ReplayStep[];
  /** shown bar count (fractional while playing; the floor is drawn) */
  step: MotionValue<number>;
  /** a change plays the strip wipe from the previous picture */
  wipeKey?: unknown;
  height?: number;
  className?: string;
}

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** The running MAE (below / above the entry against the trade) and MFE band. */
class ReplayBand implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: IChartApi | null = null;
  private request: (() => void) | null = null;
  private v = { entry: 0, mae: 0, mfe: 0, long: true, from: 0, to: 0 };
  private y = { e: null as number | null, a: null as number | null, f: null as number | null, x1: null as number | null, x2: null as number | null };
  private readonly views: IPrimitivePaneView[];

  constructor() {
    const draw = (target: RenderTarget) => this.draw(target);
    this.views = [
      {
        zOrder: (): PrimitivePaneViewZOrder => "bottom",
        renderer: (): IPrimitivePaneRenderer => ({ draw }),
      },
    ];
  }
  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series;
    this.chart = p.chart as IChartApi;
    this.request = p.requestUpdate;
  }
  detached(): void {
    this.series = null;
    this.chart = null;
    this.request = null;
  }
  set(v: Partial<ReplayBand["v"]>): void {
    this.v = { ...this.v, ...v };
    this.request?.();
  }
  updateAllViews(): void {
    const s = this.series;
    const ts = this.chart?.timeScale();
    if (!s || !ts) return;
    const dir = this.v.long ? 1 : -1;
    this.y = {
      e: s.priceToCoordinate(this.v.entry),
      a: s.priceToCoordinate(this.v.entry - dir * this.v.mae),
      f: s.priceToCoordinate(this.v.entry + dir * this.v.mfe),
      x1: ts.logicalToCoordinate(this.v.from as Logical),
      x2: ts.logicalToCoordinate(this.v.to as Logical),
    };
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
  private draw(target: RenderTarget): void {
    const { e, a, f, x1, x2 } = this.y;
    if (e == null || x1 == null || x2 == null || x2 <= x1) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const band = (y: number | null, color: string) => {
        if (y == null) return;
        const top = Math.min(e, y) * vr;
        const h = Math.abs(y - e) * vr;
        if (h < 0.5) return;
        ctx.fillStyle = color;
        ctx.fillRect(x1 * hr, top, (x2 - x1) * hr, h);
      };
      band(a, "rgba(255,77,79,0.12)");
      band(f, "rgba(61,220,132,0.12)");
    });
  }
}

interface Inst {
  chart: IChartApi;
  main: MainSeries;
  markers: ISeriesMarkersPluginApi<Time>;
  band: ReplayBand;
  shown: number;
  marked: { entry: boolean; exit: boolean };
}

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export default function ReplayChart({ bars, trade, steps, step, wipeKey, height = 300, className }: ReplayChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ripples = useRef<HTMLDivElement>(null);
  const inst = useRef<Inst | null>(null);
  const reduced = useReducedFx();
  const reducedRef = useRef(reduced);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    // the window stays put while bars are appended (lwc would otherwise scroll one bar per `update`)
    const chart = createChart(node, { ...NOTHING_MINI, timeScale: { ...NOTHING_MINI.timeScale, rightOffset: 0, fixLeftEdge: false, fixRightEdge: false, shiftVisibleRangeOnNewBar: false } });
    const main = createMainSeries(chart, { volume: false });
    main.candles.applyOptions({ priceLineVisible: false, lastValueVisible: false });
    const band = new ReplayBand();
    main.candles.attachPrimitive(band);
    const markers = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    inst.current = { chart, main, markers, band, shown: 0, marked: { entry: false, exit: false } };
    document.fonts?.load?.(CHART_FONT_LOAD).then(
      () => inst.current?.chart.applyOptions({ layout: { fontFamily: CHART_FONT } }),
      () => undefined,
    );
    return () => {
      markers.detach();
      main.candles.detachPrimitive(band);
      inst.current = null;
      chart.remove();
    };
  }, []);

  // data window: fixed scales, price lines, then follow `step`
  useEffect(() => {
    const i = inst.current;
    if (!i || !bars.length) return;
    const data = bars.map((b) => ({ time: sec(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
    const prices = [...bars.flatMap((b) => [b.high, b.low]), trade.entry, trade.stop ?? NaN, trade.exit ?? NaN].filter((v) => Number.isFinite(v));
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const pad = (hi - lo) * 0.06 || hi * 0.002;
    i.main.candles.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: lo - pad, maxValue: hi + pad } }) });
    const lines = [
      i.main.candles.createPriceLine({ price: trade.entry, color: ink.fg, lineWidth: 1, lineStyle: LineStyle.Solid, title: "Einstieg", axisLabelVisible: true, axisLabelColor: ink.fg, axisLabelTextColor: ink.bg }),
      ...(trade.stop ? [i.main.candles.createPriceLine({ price: trade.stop, color: ink.mute, lineWidth: 1, lineStyle: LineStyle.Dashed, title: "Stop", axisLabelVisible: true, axisLabelColor: ink.mute, axisLabelTextColor: ink.bg })] : []),
      ...(trade.target ? [i.main.candles.createPriceLine({ price: trade.target, color: ink.tick, lineWidth: 1, lineStyle: LineStyle.Dotted, title: "Ziel", axisLabelVisible: false })] : []),
    ];
    i.band.set({ entry: trade.entry, long: trade.side !== "short", mae: 0, mfe: 0, from: trade.entryIndex - 0.5, to: trade.entryIndex - 0.5 });

    const fit = () => i.chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: data.length - 0.5 });
    const markerList = (n: number): SeriesMarker<Time>[] => {
      const out: SeriesMarker<Time>[] = [];
      const e = data[trade.entryIndex];
      if (e && n > trade.entryIndex) out.push({ time: e.time, position: trade.side === "short" ? "aboveBar" : "belowBar", shape: trade.side === "short" ? "arrowDown" : "arrowUp", color: trade.side === "short" ? MARKER_COLORS.short : MARKER_COLORS.long, text: "E" });
      const x = trade.exitIndex != null ? data[trade.exitIndex] : undefined;
      if (x && trade.exitIndex != null && n > trade.exitIndex) out.push({ time: x.time, position: "inBar", shape: "circle", color: MARKER_COLORS[trade.result === "loss" ? "loss" : trade.result === "win" ? "win" : "be"], text: "X" });
      return out;
    };
    const ripple = (index: number, price: number, color: string) => {
      const layer = ripples.current;
      if (!layer || reducedRef.current) return;
      const x = i.chart.timeScale().logicalToCoordinate(index as Logical);
      const y = i.main.candles.priceToCoordinate(price);
      if (x == null || y == null) return;
      spawnMarkerRipple(layer, { x, y }, color);
    };

    const apply = (raw: number) => {
      const n = Math.max(0, Math.min(data.length, Math.floor(raw)));
      if (n === i.shown) return;
      if (n > i.shown && n - i.shown <= 8) for (let k = i.shown; k < n; k++) i.main.candles.update(data[k]!);
      else i.main.candles.setData(data.slice(0, n));
      fit();
      const forward = n > i.shown;
      i.shown = n;
      const st = steps[Math.max(0, n - 1)];
      i.band.set({ mae: n > trade.entryIndex && st ? st.mae : 0, mfe: n > trade.entryIndex && st ? st.mfe : 0, to: Math.min(n, trade.exitIndex != null ? trade.exitIndex + 1 : n) - 0.5 });
      const entered = n > trade.entryIndex;
      const exited = trade.exitIndex != null && n > trade.exitIndex;
      if (entered !== i.marked.entry || exited !== i.marked.exit) {
        i.markers.setMarkers(markerList(n));
        if (forward && entered && !i.marked.entry) ripple(trade.entryIndex, trade.entry, trade.side === "short" ? MARKER_COLORS.short : MARKER_COLORS.long);
        if (forward && exited && !i.marked.exit && trade.exitIndex != null) ripple(trade.exitIndex, trade.exit ?? data[trade.exitIndex]!.close, MARKER_COLORS[trade.result === "loss" ? "loss" : trade.result === "win" ? "win" : "be"]);
        i.marked = { entry: entered, exit: exited };
      }
    };

    i.shown = -1;
    i.marked = { entry: false, exit: false };
    i.main.candles.setData([]);
    i.shown = 0;
    apply(step.get());
    fit();
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      fit();
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    const off = step.on("change", apply);
    return () => {
      off();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      for (const l of lines) i.main.candles.removePriceLine(l);
      i.markers.setMarkers([]);
    };
  }, [bars, trade, steps, step]);

  // strip wipe on a new key: the cleanup of the previous key snapshots the picture still shown (layout cleanups run
  // before the new key's layout effect and before the passive data effect swaps the bars)
  const lastShot = useRef<HTMLCanvasElement | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current) {
      const box = wrap.current;
      const shot = lastShot.current;
      if (box && shot && !reducedRef.current) playStripWipe(box, shot, { reduced: reducedRef.current });
    }
    mounted.current = true;
    return () => {
      try {
        lastShot.current = inst.current?.chart.takeScreenshot(true, false) ?? null;
      } catch {
        lastShot.current = null;
      }
    };
  }, [wipeKey]);

  return (
    <div ref={wrap} className={cn("relative w-full overflow-hidden rounded-xl", className)} style={{ height }} data-ready={ready ? "true" : "false"}>
      <div ref={host} className="absolute inset-0" role="img" aria-label="Replay-Chart" />
      <div ref={ripples} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" />
    </div>
  );
}
