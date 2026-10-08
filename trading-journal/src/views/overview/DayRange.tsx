/**
 * "24 Stunden" in the market panel (design pass v3, decision 22): the last 24 h of closed 15m bars as a white line
 * over a dot-matrix fill (the Nothing dot grid, fading downwards), the 24 h low / high, and a live dot at the right
 * edge that follows the price by `transform` only.
 *
 * Renders: the line is SVG built once per closed 15m bar (`klineBarKey`) and per box size (its own ResizeObserver,
 * never a layout read); the price moves the dot through MotionValues (no React render per tick, no repaint – the dot
 * is its own layer). In the stretched hero column the chart takes the panel's free height (`flex-1`), so the panel
 * has no empty band above `Chart öffnen` (lg+); elsewhere it keeps its minimum height.
 */
import { motion, useMotionValue, useTransform } from "motion/react";
import { memo, useEffect, useId, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { n0 } from "@/lib/format";
import { getFeed, klineBarKey, priceMv, useFeedSelect, type Candle } from "@/market";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useBoxSize } from "@/primitives/boxSize";

export const DAY_RANGE_TITLE = "24 Stunden";
/** The line has drawn in once in this page session (later mounts show it at once). */
let drawnOnce = false;
const DAY_MS = 86_400_000;
const BAR_MS = 15 * 60_000;
/** Vertical inset of the line inside the box (px): the stroke and the live dot never touch the edges. */
const PAD_Y = 6;
/** Room at the right edge for the live dot (px). */
const PAD_R = 6;

/** Closed 15m bars of the last 24 h (oldest first). */
export function lastDayBars(data: readonly Candle[]): Candle[] {
  let end = data.length - 1;
  while (end >= 0 && !data[end]!.closed) end--;
  if (end < 0) return [];
  const from = data[end]!.time - DAY_MS + BAR_MS;
  let start = end;
  while (start > 0 && data[start - 1]!.time >= from) start--;
  return data.slice(start, end + 1).filter((c) => c.closed);
}

export interface DayGeometry {
  line: string;
  area: string;
  lo: number;
  hi: number;
}

/** Line / area paths of `bars` in a `w × h` box (closes, x by index), `null` with fewer than 2 bars. */
export function dayGeometry(bars: readonly Candle[], w: number, h: number): DayGeometry | null {
  if (bars.length < 2 || w <= PAD_R || h <= 2 * PAD_Y) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.low, b.close);
    hi = Math.max(hi, b.high, b.close);
  }
  const span = hi - lo || 1;
  const iw = w - PAD_R;
  const ih = h - 2 * PAD_Y;
  const n = bars.length - 1;
  let line = "";
  bars.forEach((b, i) => {
    const x = (i / n) * iw;
    const y = PAD_Y + ((hi - b.close) / span) * ih;
    line += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${line}L${iw.toFixed(1)},${h}L0,${h}Z`;
  return { line, area, lo, hi };
}

export const DayRange = memo(function DayRange({ className }: { className?: string }) {
  const key = useFeedSelect("kline_15m", klineBarKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the feed's change signal (bar appended / closed)
  const bars = useMemo(() => lastDayBars(getFeed("kline_15m")?.data ?? []), [key]);
  // no 15m history (a fallback source without it, still loading): no empty titled box — the panel keeps its old layout
  if (bars.length < 2) return null;
  return <DayChart bars={bars} className={className} />;
});

const DayChart = memo(function DayChart({ bars, className }: { bars: Candle[]; className?: string }) {
  const reduced = useReducedFx();
  const id = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);
  const geo = useMemo(() => (size ? dayGeometry(bars, size.w, size.h) : null), [bars, size]);
  // the draw-in plays once per page session (WAAPI on the element, not a motion `initial`: the keep-alive Übersicht
  // re-mounts its motion nodes on every return and motion replays their initial state — the chart flickered in again)
  const svgRef = useRef<SVGSVGElement>(null);
  const ready0 = geo != null;
  useEffect(() => {
    const el = svgRef.current;
    if (!ready0 || !el || drawnOnce) return;
    drawnOnce = true;
    if (reduced || typeof el.animate !== "function") return;
    el.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { duration: tween.draw.duration * 1000, easing: `cubic-bezier(${ease.out.join(",")})`, fill: "backwards" });
  }, [ready0, reduced]);

  // the live dot: domain and box height as MotionValues, the price maps to a translateY (clamped to the box)
  const lo = useMotionValue(0);
  const hi = useMotionValue(0);
  const ih = useMotionValue(0);
  useEffect(() => {
    if (!geo || !size) return;
    lo.set(geo.lo);
    hi.set(geo.hi);
    ih.set(size.h - 2 * PAD_Y);
  }, [geo, size, lo, hi, ih]);
  const dotY = useTransform(() => {
    const p = priceMv.get();
    const a = lo.get();
    const b = hi.get();
    if (!(p > 0) || !(b > a)) return PAD_Y + ih.get() / 2;
    const k = Math.min(1, Math.max(0, (b - p) / (b - a)));
    return PAD_Y + k * ih.get();
  });

  // Tief / Hoch of the 24 h including the live price (a new extreme of the forming bar shows at once; the dot sits on
  // the box edge then): text leaves, the strings change only with a new extreme
  const live = (p: number) => (p > 0 ? p : NaN);
  const loText = useTransform(() => n0(Math.min(lo.get(), live(priceMv.get())) || lo.get()));
  const hiText = useTransform(() => n0(Math.max(hi.get(), live(priceMv.get())) || hi.get()));
  const ready = geo != null;
  return (
    <div className={cn("grid min-h-[104px] grid-rows-[auto_minmax(64px,1fr)_auto] gap-1.5", className)} data-testid="day-range">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute">{DAY_RANGE_TITLE}</span>
        {ready && (
          // a new extreme changes a number: contained leaves (no repaint of the panel); centred, as a contained box has
          // no text baseline
          <span className="num inline-flex items-center gap-1 font-mono text-[11px] text-faint">
            <span>T</span>
            <motion.span className="inline-block text-mute [contain:layout_paint]">{loText}</motion.span>
            <span aria-hidden="true">·</span>
            <span>H</span>
            <motion.span className="inline-block text-mute [contain:layout_paint]">{hiText}</motion.span>
          </span>
        )}
      </div>
      <div ref={box} className="relative min-h-0" aria-hidden="true">
        {ready && size && (
          <svg
            ref={svgRef}
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="absolute inset-0 overflow-visible"
          >
            <defs>
              <pattern id={`${id}-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="0.85" fill="#fff" />
              </pattern>
              <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id={`${id}-mask`}>
                <path d={geo.area} fill={`url(#${id}-fade)`} />
              </mask>
            </defs>
            <rect width={size.w} height={size.h} fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} />
            <path d={geo.line} fill="none" stroke="#f2f2f2" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
        {ready && (
          // the live price: its own layer, moved by transform only
          <motion.span className="pointer-events-none absolute -mt-[4px] size-2 rounded-full bg-fg shadow-[0_0_0_3px_rgb(255_255_255/0.12),0_0_10px_rgb(255_255_255/0.45)] will-change-transform" style={{ y: dotY, top: 0, right: 0 }} />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-faint">
        <span>vor 24 h</span>
        <span>jetzt</span>
      </div>
    </div>
  );
});
