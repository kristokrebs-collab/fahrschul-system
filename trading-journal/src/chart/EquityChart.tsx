/**
 * "Kontostand" equity curve – Recharts AreaChart, 1:1 with the bundle (Plan 5.7, brief read_stats §7).
 * Data shape = `stats.equity`: `[{ i: 0, v: start, t: null }, { i: 1, v, t: Trade }, …]`.
 *
 * Motion (all compositor, zero React renders after mount):
 * - draw-in: the area wipes open left to right (`clip-path`, `tween.draw`) the first time the chart is in view;
 * - "jetzt": a breathing dot at the last point (`PulseDot`), gliding (`spring.smooth`) and pinging on new data;
 * - hover: a cursor line, a point dot and a readout that glide between points (`spring.tooltip`); text is written
 *   through refs and positions through MotionValues, so moving the pointer never re-renders the chart.
 * Recharts' own animation stays off (`isAnimationActive={false}`, bundle parity). Reduced motion: static.
 */
import { animate, motion, useMotionValue, useSpring, type AnimationPlaybackControls } from "motion/react";
import { memo, useCallback, useId, useLayoutEffect, useRef, type PointerEvent } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis, usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import type { Trade } from "@/domain/types";
import { ChartContainer, type ChartConfig } from "@/ui/chart";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { PulseDot } from "@/motion/PulseDot";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";
import { fmt, tradeTime } from "./format";
import { TOOLTIP_CLASS, placeTooltip } from "./tooltip";

export interface EquityPoint {
  /** 0 = start, n = n-th closed trade */
  i: number;
  /** balance after trade `i` */
  v: number;
  t: Trade | null;
}

export interface EquityChartProps {
  points: EquityPoint[];
  /** start capital (reference line) */
  start: number;
  /** current balance → accent colour (`#f2f2f2` ≥ start, `#ff4d4f` below) */
  balance: number;
  currency: string;
  /** px, default 268 */
  height?: number;
  className?: string;
}

export const EQUITY_COLORS = { up: "#f2f2f2", down: "#ff4d4f", strokeStart: "#5f5f5f", grid: "#1c1c1c", ref: "#3a3a3a", tick: "#5f5f5f" } as const;
export const TICK_STYLE = { fill: "#5f5f5f", fontSize: 11, fontFamily: "IBM Plex Mono, monospace" } as const;

export const equityAccent = (balance: number, start: number): string => (balance >= start ? EQUITY_COLORS.up : EQUITY_COLORS.down);
export const equityTickLabel = (i: number): string => (i === 0 ? "Start" : "#" + i);

/** Pixel geometry of the plotted points (chart-relative px) and the plot area's vertical extent. */
export interface EquityGeometry {
  xs: number[];
  ys: number[];
  top: number;
  height: number;
}

/** Index of the point whose x is closest to `x` (`xs` ascending; `-1` when empty). */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs((xs[hi] as number) - x) < Math.abs((xs[lo] as number) - x) ? hi : lo;
}

/** Changes when the curve's end changes (a new trade, an edit), not when the chart is resized. */
const endKeyOf = (points: readonly EquityPoint[]): string => {
  const last = points[points.length - 1];
  return `${points.length}:${last?.v ?? 0}`;
};

const config: ChartConfig = { v: { label: "Kontostand", color: "#f2f2f2" } };
const TIP_WIDTH = 188;
/** Pointer slack beyond the first/last point before the readout hides, px. */
const HOVER_SLACK = 12;

/** Reads the plotted coordinates from inside the chart (Recharts 3 scale hooks) and hands them out. */
function EquityProbe({ points, onGeometry }: { points: EquityPoint[]; onGeometry: (g: EquityGeometry, endKey: string) => void }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  useLayoutEffect(() => {
    if (!xScale || !yScale || !plot) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of points) {
      const x = xScale(p.i);
      const y = yScale(p.v);
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      xs.push(x);
      ys.push(y);
    }
    onGeometry({ xs, ys, top: plot.y, height: plot.height }, endKeyOf(points));
  }, [xScale, yScale, plot, points, onGeometry]);
  return null;
}

export const EquityChart = memo(function EquityChart({ points, start, balance, currency, height = 268, className }: EquityChartProps) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const accent = equityAccent(balance, start);
  const fillId = `eqFill-${id}`;
  const strokeId = `eqStroke-${id}`;
  const box = useRef<HTMLDivElement>(null);
  const geom = useRef<EquityGeometry | null>(null);
  const tracker = useHoverRect();

  // "jetzt" endpoint
  const endX = useMotionValue(0);
  const endY = useMotionValue(0);
  const endOpacity = useMotionValue(0);
  const endPing = useMotionValue(0);
  const endKey = useRef<string | null>(null);
  const revealed = useRef(false);

  // hover readout
  const curX = useMotionValue(0);
  const curY = useMotionValue(0);
  const hover = useMotionValue(0);
  const tipXRaw = useMotionValue(0);
  const tipYRaw = useMotionValue(0);
  const tipX = useSpring(tipXRaw, spring.tooltip);
  const tipY = useSpring(tipYRaw, spring.tooltip);
  const cursor = useRef<HTMLDivElement>(null);
  const tipBox = useRef<HTMLDivElement>(null);
  const tipTitle = useRef<HTMLDivElement>(null);
  const tipPnl = useRef<HTMLSpanElement>(null);
  const tipBalance = useRef<HTMLSpanElement>(null);
  const active = useRef(-1);
  const tipHeight = useRef(0);
  const pnlTone = useRef<string | null>(null);

  const onGeometry = useCallback(
    (g: EquityGeometry, key: string) => {
      geom.current = g;
      if (cursor.current) {
        cursor.current.style.top = `${g.top}px`;
        cursor.current.style.height = `${g.height}px`;
      }
      const n = g.xs.length - 1;
      const x = g.xs[n];
      const y = g.ys[n];
      if (x === undefined || y === undefined) return;
      const fresh = endKey.current !== null && endKey.current !== key;
      endKey.current = key;
      if (fresh && revealed.current && !reduced) {
        animate(endX, x, spring.smooth);
        animate(endY, y, spring.smooth);
        endPing.set(endPing.get() + 1);
      } else {
        endX.jump(x);
        endY.jump(y);
      }
    },
    [endX, endY, endPing, reduced],
  );

  // draw-in on first view: clipped before the first paint (CSS on `data-draw`), wiped open once 10 % is visible
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || revealed.current) return;
    if (reduced || !canObserveInView()) {
      revealed.current = true;
      endOpacity.jump(1);
      return;
    }
    el.dataset.draw = "pending";
    let area: SVGGElement | null = null;
    let wipe: AnimationPlaybackControls | null = null;
    const finish = () => {
      revealed.current = true;
      animate(endOpacity, 1, tween.fade);
      endPing.set(endPing.get() + 1);
    };
    const off = observeInView(el, (inView) => {
      if (!inView || wipe || revealed.current) return;
      area = el.querySelector<SVGGElement>(".eq-area");
      if (area) area.style.clipPath = "inset(0 100% 0 0)";
      el.dataset.draw = "done";
      if (!area) {
        finish();
        return;
      }
      const target = area;
      const run = animate(target, { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] }, tween.draw);
      wipe = run;
      run.then(() => {
        target.style.clipPath = "";
        finish();
      });
    });
    return () => {
      off();
      wipe?.stop();
      if (area) area.style.clipPath = "";
      el.dataset.draw = "done";
    };
  }, [reduced, endOpacity, endPing]);

  const hide = () => {
    if (active.current === -1) return;
    active.current = -1;
    if (reduced) hover.jump(0);
    else animate(hover, 0, tween.exit);
  };

  const paint = (i: number, g: EquityGeometry, bounds: { width: number; height: number }) => {
    const p = points[i];
    const px = g.xs[i];
    const py = g.ys[i];
    if (!p || px === undefined || py === undefined) return;
    const first = hover.get() === 0;
    const t = p.t;
    if (tipTitle.current) tipTitle.current.textContent = t ? `Trade #${p.i} · ${fmt.date(new Date(tradeTime(t)))}` : "Start";
    if (tipPnl.current) {
      const pnl = t?.pnl ?? null;
      tipPnl.current.textContent = t ? `${fmt.signed(pnl)} ${currency}` : "–";
      const tone = !t ? "text-mute" : pnl != null && pnl < 0 ? "text-loss" : "text-win";
      if (tone !== pnlTone.current) {
        pnlTone.current = tone;
        tipPnl.current.className = cn("num font-mono font-medium", tone);
      }
    }
    if (tipBalance.current) tipBalance.current.textContent = `${fmt.n0(p.v)} ${currency}`;
    // fixed width and row count: one measurement, never a layout read per move
    if (!tipHeight.current && tipBox.current) tipHeight.current = tipBox.current.offsetHeight;
    const pos = placeTooltip({ x: px, y: py }, bounds, { width: TIP_WIDTH, height: tipHeight.current || 80 });
    if (first || reduced) {
      curX.jump(px);
      curY.jump(py);
      tipXRaw.jump(pos.x);
      tipYRaw.jump(pos.y);
      tipX.jump(pos.x);
      tipY.jump(pos.y);
    } else {
      animate(curX, px, spring.tooltip);
      animate(curY, py, spring.tooltip);
      tipXRaw.set(pos.x);
      tipYRaw.set(pos.y);
    }
    if (first) {
      if (reduced) hover.jump(1);
      else animate(hover, 1, tween.fade);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = geom.current;
    const rect = tracker.tracks(e.currentTarget) ? tracker.read() : tracker.enter(e.currentTarget);
    if (!g || !rect || g.xs.length === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const firstX = g.xs[0] as number;
    const lastX = g.xs[g.xs.length - 1] as number;
    if (x < firstX - HOVER_SLACK || x > lastX + HOVER_SLACK || y < 0 || y > rect.height) {
      hide();
      return;
    }
    const i = nearestIndex(g.xs, x);
    if (i === active.current) return;
    active.current = i;
    paint(i, g, { width: rect.width, height: rect.height });
  };

  const onPointerLeave = () => {
    tracker.leave();
    hide();
  };

  return (
    <div
      ref={box}
      className={cn("relative w-full [&[data-draw=pending]_.eq-area]:[clip-path:inset(0_100%_0_0)]", className)}
      style={{ height }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerLeave}
    >
      <ChartContainer config={config} className="aspect-auto size-full" role="img" aria-label="Kontostand-Verlauf">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
              <stop offset="100%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={EQUITY_COLORS.strokeStart} />
              <stop offset="100%" stopColor={accent} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={EQUITY_COLORS.grid} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="i" tickLine={false} axisLine={false} minTickGap={28} tick={TICK_STYLE} tickFormatter={equityTickLabel} />
          <YAxis width={62} tickLine={false} axisLine={false} domain={["auto", "auto"]} tick={TICK_STYLE} tickFormatter={fmt.mio} />
          <ReferenceLine y={start} stroke={EQUITY_COLORS.ref} strokeDasharray="3 4" />
          <Area className="eq-area" type="linear" dataKey="v" stroke={`url(#${strokeId})`} strokeWidth={2} fill={`url(#${fillId})`} isAnimationActive={false} dot={false} activeDot={false} />
          <EquityProbe points={points} onGeometry={onGeometry} />
        </AreaChart>
      </ChartContainer>

      {/* hover: cursor line, point dot, readout */}
      <motion.div ref={cursor} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 w-px bg-faint" style={{ x: curX, opacity: hover }} />
      <motion.div aria-hidden="true" className="pointer-events-none absolute left-0 top-0" style={{ x: curX, y: curY, opacity: hover }}>
        <span className="absolute -left-[5px] -top-[5px] size-2.5 rounded-full border-2 border-ink-900" style={{ background: accent }} />
      </motion.div>
      <motion.div
        ref={tipBox}
        aria-hidden="true"
        className={cn("pointer-events-none absolute left-0 top-0 z-10 will-change-transform", TOOLTIP_CLASS)}
        style={{ x: tipX, y: tipY, opacity: hover, width: TIP_WIDTH }}
      >
        <div ref={tipTitle} className="text-mute" />
        <div className="mt-1 flex justify-between gap-4">
          <span className="text-mute">P&L</span>
          <span ref={tipPnl} className="num font-mono font-medium" />
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-mute">Kontostand</span>
          <span ref={tipBalance} className="num font-mono font-medium" />
        </div>
      </motion.div>

      {/* "jetzt": the current balance */}
      <motion.div aria-hidden="true" data-fx="equity-now" className="pointer-events-none absolute left-0 top-0" style={{ x: endX, y: endY, opacity: endOpacity }}>
        <span className="absolute -translate-x-1/2 -translate-y-1/2">
          <PulseDot tone={balance >= start ? "fg" : "loss"} size={7} rings={2} ping={endPing} />
        </span>
      </motion.div>
    </div>
  );
});
