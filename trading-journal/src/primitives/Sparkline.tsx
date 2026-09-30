import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export const SPARK_POINTS = 20;
const W = 220;
const H = 48;

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
  className?: string;
  stroke?: string;
  dot?: string;
}

/**
 * Bundle `eK` + Plan 3.3 "Sparkline": the input is resampled to 20 points so `d` always has the same
 * command count; `d` and the end dot (`cx`/`cy`) are MotionValues animated with `animate(mv, …, tween.bar)`
 * and written to the DOM directly (no React render per frame). Reduced motion → instant.
 */
export function Sparkline({ values, className, stroke = "#f2f2f2", dot = "#e5202e" }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const pts = useMemo(() => toPoints(resample(values)), [values]);
  const d = useMemo(() => toPath(pts), [pts]);
  const end = useMemo<[number, number]>(() => pts[pts.length - 1] ?? [W, H / 2], [pts]);

  const dMv = useMotionValue(d);
  const cx = useMotionValue(end[0]);
  const cy = useMotionValue(end[1]);
  const line = useRef<SVGPathElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const circle = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const t = reduced ? { duration: 0 } : tween.bar;
    const a = animate(dMv, d, t);
    const b = animate(cx, end[0], t);
    const c = animate(cy, end[1], t);
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [d, end, dMv, cx, cy, reduced]);

  useMotionValueEvent(dMv, "change", (v) => {
    line.current?.setAttribute("d", v);
    fill.current?.setAttribute("d", `${v}L${W},${H}L0,${H}Z`);
  });
  useMotionValueEvent(cx, "change", (v) => circle.current?.setAttribute("cx", String(v)));
  useMotionValueEvent(cy, "change", (v) => circle.current?.setAttribute("cy", String(v)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-12 w-full", className)} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`hbf${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path ref={fill} d={`${d}L${W},${H}L0,${H}Z`} fill={`url(#hbf${id})`} />
      <path ref={line} d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <circle ref={circle} cx={end[0]} cy={end[1]} r="3" fill={dot} />
    </svg>
  );
}
