import { animate, motion, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export const SPARK_POINTS = 20;
const W = 220;
const H = 48;
/** End-dot ring at the top of each breath (`tween.pingFew`: 3 beats when it appears, then rest). */
const RING_SCALE = 2.6;

/** Linear resampling over the index axis to exactly `n` points; < 2 values → flat line at `y = 24`. */
export function resample(values: readonly number[], n = SPARK_POINTS): number[] {
  if (values.length < 2) return Array.from({ length: n }, () => Number.NaN);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    const a = values[lo] ?? 0;
    const b = values[hi] ?? a;
    out.push(a + (b - a) * (t - lo));
  }
  return out;
}

function toPoints(values: number[]): [number, number][] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return values.map((_, i) => [(i / (values.length - 1)) * W, H / 2]);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)]);
}

function toPath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1)).join("");
}

export interface SparklineProps {
  values: readonly number[];
  /** Wrapper classes (width, spacing); the line is a fixed 48 px tall. */
  className?: string;
  stroke?: string;
  dot?: string;
}

/**
 * Bundle `eK` + Plan 3.3 "Sparkline": the input is resampled to 20 points so `d` always has the same command count;
 * `d` and the end dot (`cx`/`cy`) are MotionValues animated with `tween.bar` and written to the DOM directly (no React
 * render per frame). Geometry is memoised by value, so a new array with equal numbers never restarts the morph.
 * The first time it scrolls into view the line draws itself left to right (clip-path, `tween.draw`); afterwards the
 * end dot breathes with a compositor ping ring (paused off-screen). Reduced motion → static, instant.
 */
export function Sparkline({ values, className, stroke = "#f2f2f2", dot = "#e5202e" }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const key = values.join(",");
  const pts = useMemo(() => toPoints(resample(key ? key.split(",").map(Number) : [])), [key]);
  const d = useMemo(() => toPath(pts), [pts]);
  const endX = pts[pts.length - 1]?.[0] ?? W;
  const endY = pts[pts.length - 1]?.[1] ?? H / 2;

  const dMv = useMotionValue(d);
  const cx = useMotionValue(endX);
  const cy = useMotionValue(endY);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPathElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const circle = useRef<SVGCircleElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const t = reduced ? { duration: 0 } : tween.bar;
    const a = animate(dMv, d, t);
    const b = animate(cx, endX, t);
    const c = animate(cy, endY, t);
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [d, endX, endY, dMv, cx, cy, reduced]);

  useMotionValueEvent(dMv, "change", (v) => {
    line.current?.setAttribute("d", v);
    fill.current?.setAttribute("d", `${v}L${W},${H}L0,${H}Z`);
  });
  useMotionValueEvent(cx, "change", (v) => circle.current?.setAttribute("cx", String(v)));
  useMotionValueEvent(cy, "change", (v) => circle.current?.setAttribute("cy", String(v)));

  // draw-in on first view: clipped before the first paint, wiped open once 10 % is visible
  const drawn = useRef(false);
  useLayoutEffect(() => {
    const el = svg.current;
    const host = wrap.current;
    if (!el || !host || reduced || drawn.current || !canObserveInView()) return;
    el.style.clipPath = "inset(0 100% 0 0)";
    let wipe: AnimationPlaybackControls | null = null;
    const off = observeInView(host, (inView) => {
      if (!inView || wipe) return;
      drawn.current = true;
      const run = animate(el, { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] }, tween.draw);
      wipe = run;
      run.then(() => {
        el.style.clipPath = "";
      });
    });
    return () => {
      off();
      wipe?.stop();
      el.style.clipPath = "";
    };
  }, [reduced]);

  // breathing ring on the end dot, from the end of the draw-in: 3 beats (finite, perf-05), replayed on re-entry; paused while off-screen
  useEffect(() => {
    const el = ring.current;
    const host = wrap.current;
    if (!el || !host || reduced) return;
    let loop: AnimationPlaybackControls | null = null;
    const off = observeInView(host, (inView) => {
      if (inView) {
        loop ??= animate(el, { transform: ["scale(1)", `scale(${RING_SCALE})`], opacity: [0.55, 0] }, { ...tween.pingFew, delay: drawn.current ? tween.draw.duration : 0 });
        loop.play();
      } else loop?.pause();
    });
    return () => {
      off();
      loop?.cancel();
    };
  }, [reduced]);

  return (
    <div ref={wrap} className={cn("relative w-full", className)}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-12 w-full" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`hbf${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path ref={fill} d={`${d}L${W},${H}L0,${H}Z`} fill={`url(#hbf${id})`} />
        <path ref={line} d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
        <circle ref={circle} cx={endX} cy={endY} r="3" fill={dot} />
      </svg>
      {/* the svg is 48 px tall with a 48-unit viewBox, so `cy` is already in px; the end sits on the right edge */}
      <motion.span aria-hidden="true" className="pointer-events-none absolute right-0 top-0" style={{ y: cy }}>
        <span ref={ring} className="absolute -right-[3px] -top-[3px] size-1.5 rounded-full opacity-0" style={{ background: dot }} />
      </motion.span>
    </div>
  );
}
