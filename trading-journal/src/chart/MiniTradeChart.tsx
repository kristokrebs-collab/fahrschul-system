/**
 * MiniTradeChart (Plan 5.9) – small non-interactive lightweight-charts view for the trade detail:
 * candles around the trade, lines `Einstieg` / `Stop` / `Ziel` / `Ausstieg`, entry/exit markers.
 * Mount: skeleton (fixed 160 px) → setData → 2 rAF → opacity fade (`tween.fade`, no scale: it lives
 * inside a `layout` dialog).
 *
 * Journal v3 (P06): `annotations` are drawn by the `AnnotationPrimitive`; with `onAnnotationsChange` a toolbar above
 * the chart offers line / trend / box / arrow / text in four colours: a tap places a point (two-point tools show a
 * dashed preview that follows the pointer), a tap on a drawing selects it, `Zeichnung löschen` removes it. Drawings are
 * stored in time / price, so they stay on their candles.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createChart, createSeriesMarkers, LineStyle, type IChartApi, type IPriceLine } from "lightweight-charts";
import type { Annotation, AnnotationKind, EnrichedTrade } from "@/domain/types";
import { newId } from "@/lib/ids";
import { AnnotationToolbar, DRAW_COLORS, TOOLS } from "@/journal/annotations/AnnotationToolbar";
import { AnnotationPrimitive } from "./primitives/AnnotationPrimitive";
import type { Candle } from "@/market/types";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { CHART_FONT, CHART_FONT_LOAD, NOTHING_MINI, ink, inkChartOptions } from "./theme";
import { INTERVAL_SECONDS, createMainSeries, normalizeSeries, toCandleData, type ChartInterval, type MainSeries } from "./panes";
import { boundsOf, buildMarkers, snapSourceOf, snapTime, toTradeMarkers } from "./markers";
import { ChartSkeleton } from "./ChartSkeleton";

export type MiniTrade = Pick<EnrichedTrade, "id" | "side" | "entry" | "stop" | "target" | "exit" | "pnl" | "result" | "date" | "createdAt">;

export interface MiniTradeChartProps {
  /** 1h candles around the trade (±3 days); the caller slices/loads them */
  candles: Candle[];
  trade: MiniTrade;
  interval?: ChartInterval;
  /** px, default 160 */
  height?: number;
  className?: string;
  /** Journal v3: chart drawings of the trade (time / price). */
  annotations?: readonly Annotation[];
  /** Journal v3: given → the drawing toolbar shows and every change is reported (the caller saves the trade). */
  onAnnotationsChange?: (next: Annotation[]) => void;
}

/** Trade lines of the mini chart; colours from the live palette (read when a line is created). */
export const MINI_LINES = {
  entry: {
    title: "Einstieg",
    get color(): string {
      return ink.fg;
    },
    lineStyle: LineStyle.Solid,
  },
  stop: {
    title: "Stop",
    get color(): string {
      return ink.mute;
    },
    lineStyle: LineStyle.Dashed,
  },
  target: {
    title: "Ziel",
    get color(): string {
      return ink.tick;
    },
    lineStyle: LineStyle.Dotted,
  },
  exit: {
    title: "Ausstieg",
    get color(): string {
      return ink.fg;
    },
    lineStyle: LineStyle.Dotted,
  },
} as const;
export type MiniLineKey = keyof typeof MINI_LINES;

interface Instance {
  chart: IChartApi;
  main: MainSeries;
  lines: Partial<Record<MiniLineKey, IPriceLine>>;
  detach: () => void;
  notes: AnnotationPrimitive;
  times: number[];
}

export function MiniTradeChart({ candles, trade, interval = "1h", height = 160, className, annotations, onAnnotationsChange }: MiniTradeChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<Instance | null>(null);
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotion() ?? false;
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);
  const editable = typeof onAnnotationsChange === "function";
  const [tool, setTool] = useState<AnnotationKind | null>(null);
  const [color, setColor] = useState<string>(DRAW_COLORS[0].hex);
  const [placed, setPlaced] = useState<{ time: number; price: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const list = annotations ?? EMPTY_NOTES;

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const chart = createChart(node, NOTHING_MINI);
    // the current palette (light mode): `NOTHING_MINI` holds the ink of the moment the chart module loaded
    chart.applyOptions(inkChartOptions());
    const main = createMainSeries(chart, { volume: false });
    main.candles.applyOptions({ priceLineVisible: false, lastValueVisible: false });
    const markers = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    const own = { times: [] as number[] };
    const notes = new AnnotationPrimitive({ times: () => inst.current?.times ?? own.times, intervalSec: () => INTERVAL_SECONDS[interval], reducedMotion: () => reduceRef.current });
    main.candles.attachPrimitive(notes);
    const instance: Instance = { chart, main, lines: {}, detach: () => markers.detach(), notes, times: own.times };
    inst.current = instance;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.load?.(CHART_FONT_LOAD).then(
      () => {
        if (inst.current === instance) chart.applyOptions({ layout: { fontFamily: CHART_FONT } });
      },
      () => undefined,
    );
    return () => {
      instance.detach();
      main.candles.detachPrimitive(notes);
      inst.current = null;
      chart.remove();
    };
    // the interval only feeds the primitive's host getter (read lazily)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const i = inst.current;
    if (!i || candles.length === 0) return;
    let raf1 = 0;
    let raf2 = 0;
    const data = normalizeSeries(candles.map(toCandleData));
    i.main.candles.setData(data);
    i.times = data.map((b) => Number(b.time));

    for (const key of Object.keys(MINI_LINES) as MiniLineKey[]) {
      const price = trade[key];
      const style = MINI_LINES[key];
      const existing = i.lines[key];
      const visible = typeof price === "number" && Number.isFinite(price);
      if (existing) {
        existing.applyOptions({ price: visible ? price : 0, lineVisible: visible, axisLabelVisible: visible });
      } else {
        i.lines[key] = i.main.candles.createPriceLine({
          id: key,
          price: visible ? price : 0,
          color: style.color,
          lineWidth: 1,
          lineStyle: style.lineStyle,
          lineVisible: visible,
          axisLabelVisible: visible,
          title: style.title,
          axisLabelColor: style.color,
          axisLabelTextColor: ink.bg,
        });
      }
    }

    const src = snapSourceOf(i.main.candles, i.chart.timeScale());
    const built = buildMarkers(toTradeMarkers([trade]), (t) => snapTime(src, t), boundsOf(data, INTERVAL_SECONDS[interval]));
    const markers = createSeriesMarkers(i.main.candles, built.markers, { zOrder: "aboveSeries" });
    const prevDetach = i.detach;
    prevDetach();
    i.detach = () => markers.detach();
    i.chart.timeScale().fitContent();

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (inst.current === i) setReady(true);
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [candles, trade, interval]);

  // drawings → primitive (new ids draw themselves in)
  useEffect(() => {
    inst.current?.notes.setAnnotations(list);
  }, [list]);
  useEffect(() => {
    inst.current?.notes.select(selected);
  }, [selected]);
  useEffect(() => {
    if (!tool) inst.current?.notes.setDraft(null);
  }, [tool]);

  /* ------------------------------------------------------------ drawing input (DOM pointer, one rect read per gesture) */
  const rect = useRef<DOMRect | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = rect.current ?? e.currentTarget.getBoundingClientRect();
    rect.current = r;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || !tool || !placed) return;
    pending.current = local(e);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const i = inst.current;
      const p = pending.current;
      if (!i || !p || !placed) return;
      const at = i.notes.pointAt(p.x, p.y);
      if (at) i.notes.setDraft({ kind: tool, points: [placed, at], color });
    });
  };
  const commit = useCallback(
    (a: Annotation) => {
      onAnnotationsChange?.([...list, a]);
    },
    [list, onAnnotationsChange],
  );
  const onTap = (e: ReactPointerEvent<HTMLDivElement>) => {
    const i = inst.current;
    if (!editable || !i) return;
    rect.current = e.currentTarget.getBoundingClientRect();
    const { x, y } = local(e);
    if (!tool) {
      setSelected(i.notes.hitAt(x, y));
      return;
    }
    const at = i.notes.pointAt(x, y);
    if (!at) return;
    const spec = TOOLS.find((t) => t.kind === tool);
    if (spec?.points === 2 && !placed) {
      setPlaced(at);
      i.notes.setDraft({ kind: tool, points: [at, at], color });
      return;
    }
    const points = spec?.points === 2 && placed ? [placed, at] : [at];
    commit({ id: newId("a_"), kind: tool, points, color, ...(tool === "text" ? { text: noteText.trim() || "Notiz" } : null), tf: interval });
    setPlaced(null);
    i.notes.setDraft(null);
    if (tool === "text") setNoteText("");
    setTool(null);
  };

  const show = ready && candles.length > 0;
  const chartBox = (
    <div className={cn("relative w-full overflow-hidden rounded-xl", !editable && className)} style={{ height }} data-ready={show ? "true" : "false"}>
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: show ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : tween.fade}
      >
        <div ref={host} className="absolute inset-0" role="img" aria-label={list.length ? `Trade-Chart mit ${list.length} Zeichnung${list.length === 1 ? "" : "en"}` : "Trade-Chart"} />
      </motion.div>
      {editable && (
        <div
          className={cn("absolute inset-0 z-[2]", tool ? "cursor-crosshair touch-none" : "cursor-default")}
          data-testid="annotation-surface"
          aria-hidden="true"
          onPointerEnter={() => (rect.current = null)}
          onPointerMove={onMove}
          onPointerUp={onTap}
        />
      )}
      <AnimatePresence initial={false}>{show ? null : <ChartSkeleton key="skeleton" rows={3} cols={4} className="rounded-xl" />}</AnimatePresence>
    </div>
  );
  if (!editable) return chartBox;
  return (
    <div className={cn("grid gap-2", className)}>
      <AnnotationToolbar
        tool={tool}
        onTool={(t) => {
          setTool(t);
          setPlaced(null);
          setSelected(null);
        }}
        color={color}
        onColor={setColor}
        placed={placed ? 1 : 0}
        selected={selected != null}
        onDelete={() => {
          onAnnotationsChange?.(list.filter((a) => a.id !== selected));
          setSelected(null);
        }}
        count={list.length}
        onClear={() => {
          onAnnotationsChange?.([]);
          setSelected(null);
        }}
        text={noteText}
        onText={setNoteText}
      />
      {chartBox}
    </div>
  );
}

const EMPTY_NOTES: readonly Annotation[] = [];
