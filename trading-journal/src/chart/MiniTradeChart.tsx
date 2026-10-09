/**
 * MiniTradeChart (Plan 5.9) – small non-interactive lightweight-charts view for the trade detail:
 * candles around the trade, lines `Einstieg` / `Stop` / `Ziel` / `Ausstieg`, entry/exit markers.
 * Mount: skeleton (fixed 160 px) → setData → 2 rAF → opacity fade (`tween.fade`, no scale: it lives
 * inside a `layout` dialog).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createChart, createSeriesMarkers, LineStyle, type IChartApi, type IPriceLine } from "lightweight-charts";
import type { EnrichedTrade } from "@/domain/types";
import type { Candle } from "@/market/types";
import { tween } from "@/motion/tokens";
import { cn } from "@/lib/cn";
import { CHART_FONT, CHART_FONT_LOAD, NOTHING_MINI, ink } from "./theme";
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
}

export const MINI_LINES = {
  entry: { title: "Einstieg", color: ink.fg, lineStyle: LineStyle.Solid },
  stop: { title: "Stop", color: ink.mute, lineStyle: LineStyle.Dashed },
  target: { title: "Ziel", color: ink.tick, lineStyle: LineStyle.Dotted },
  exit: { title: "Ausstieg", color: ink.fg, lineStyle: LineStyle.Dotted },
} as const;
export type MiniLineKey = keyof typeof MINI_LINES;

interface Instance {
  chart: IChartApi;
  main: MainSeries;
  lines: Partial<Record<MiniLineKey, IPriceLine>>;
  detach: () => void;
}

export function MiniTradeChart({ candles, trade, interval = "1h", height = 160, className }: MiniTradeChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<Instance | null>(null);
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotion() ?? false;

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const chart = createChart(node, NOTHING_MINI);
    const main = createMainSeries(chart, { volume: false });
    main.candles.applyOptions({ priceLineVisible: false, lastValueVisible: false });
    const markers = createSeriesMarkers(main.candles, [], { zOrder: "aboveSeries" });
    const instance: Instance = { chart, main, lines: {}, detach: () => markers.detach() };
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
      inst.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const i = inst.current;
    if (!i || candles.length === 0) return;
    let raf1 = 0;
    let raf2 = 0;
    const data = normalizeSeries(candles.map(toCandleData));
    i.main.candles.setData(data);

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

  const show = ready && candles.length > 0;
  return (
    <div className={cn("relative w-full overflow-hidden rounded-xl", className)} style={{ height }} data-ready={show ? "true" : "false"}>
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: show ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : tween.fade}
      >
        <div ref={host} className="absolute inset-0" role="img" aria-label="Trade-Chart" />
      </motion.div>
      <AnimatePresence initial={false}>{show ? null : <ChartSkeleton key="skeleton" rows={3} cols={4} className="rounded-xl" />}</AnimatePresence>
    </div>
  );
}
