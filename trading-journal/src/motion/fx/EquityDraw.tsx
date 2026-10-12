import { animate, useMotionValue, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { FX_TONE, playWaapi, useFxPlay, type FxTone } from "@/motion/fx/shared";
import { isSafeFx } from "@/motion/safeFx";
import { ease, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * EquityDraw – an equity / P&L line that draws itself left → right with a glowing head riding its tip
 * (`tween.draw`), then the head breathes 3× (finite) and rests at the last point. The draw is a `clip-path: inset()`
 * on the line group and a `transform` on the head – both written from ONE MotionValue (`progress`, 0..1), so the
 * draw never re-renders React. Pass your own `progress` MotionValue to scrub / race two lines (a scenario slider,
 * a benchmark race); otherwise it draws on first view and on every new `play` key.
 *
 * Geometry: the width is measured on resize only (ResizeObserver), the path is built in px (no non-uniform SVG
 * scale, so the head stays round). Pure helpers: `equityPoints`, `pointAt`. `role="img"` + `label`; the head and
 * the baseline are decorative. Reduced motion: fully drawn, head at the end, no breathing. Safe-fx: no glow filter.
 */
export const EQUITY_DRAW = {
  height: 120,
  pad: 8,
  /** fallback width before the first measurement (jsdom / SSR) */
  width: 320,
  stroke: 1.75,
  head: 3.5,
  halo: 13,
} as const;

export interface EquityPoint {
  x: number;
  y: number;
}

/** Plot points of `values` in a `w × h` box with `pad` px inset (min/max include `baseline` when given). */
export function equityPoints(values: readonly number[], w: number, h: number, pad: number = EQUITY_DRAW.pad, baseline?: number | null): EquityPoint[] {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length === 0) return [];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (baseline != null && Number.isFinite(baseline)) {
    lo = Math.min(lo, baseline);
    hi = Math.max(hi, baseline);
  }
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const n = vs.length;
  const iw = Math.max(1, w - pad * 2);
  const ih = Math.max(1, h - pad * 2);
  return vs.map((v, i) => ({ x: pad + (n === 1 ? iw : (i / (n - 1)) * iw), y: pad + (1 - (v - lo) / (hi - lo)) * ih }));
}

/** y of the polyline at x (linear between neighbours, clamped to the ends). */
export function pointAt(points: readonly EquityPoint[], x: number): EquityPoint {
  const n = points.length;
  if (n === 0) return { x, y: 0 };
  const first = points[0]!;
  const last = points[n - 1]!;
  if (x <= first.x) return first;
  if (x >= last.x) return last;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
  return { x, y: a.y + (b.y - a.y) * f };
}

function pathOf(points: readonly EquityPoint[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("");
}

export interface EquityDrawProps {
  values: readonly number[];
  /** Height in px (default 120); the width follows the container. */
  height?: number;
  /** `auto`: win when the last value is above the first, loss below, fg flat. */
  tone?: "auto" | Extract<FxTone, "win" | "loss" | "fg" | "signal" | "mute">;
  /** Soft fill under the line (default true). */
  area?: boolean;
  /** Dashed reference line (default: the first value; `null` = none). */
  baseline?: number | null;
  /** Replay key: every new number (or false → true) draws again from the left. */
  play?: number | boolean;
  /** Draw once on first view (default true). */
  playOnView?: boolean;
  /** External 0..1 driver – overrides the built-in draw (scrubbing, races). */
  progress?: MotionValue<number>;
  /** Draw duration in s (default `tween.draw`). */
  duration?: number;
  label: string;
  className?: string;
  onDone?: () => void;
}

export function EquityDraw({ values, height = EQUITY_DRAW.height, tone = "auto", area = true, baseline, play, playOnView = true, progress, duration = tween.draw.duration, label, className, onDone }: EquityDrawProps) {
  const reduced = useReducedFx();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const [width, setWidth] = useState<number>(EQUITY_DRAW.width);
  const own = useMotionValue(reduced || !playOnView ? 1 : 0);
  const p = progress ?? own;
  const run = useRef<AnimationPlaybackControls | null>(null);
  const [safe] = useState(isSafeFx);

  const first = values.find((v) => Number.isFinite(v));
  const lastV = [...values].reverse().find((v) => Number.isFinite(v));
  const base = baseline === undefined ? first : baseline;
  const resolved = tone === "auto" ? (first == null || lastV == null || lastV === first ? "fg" : lastV > first ? "win" : "loss") : tone;
  const color = FX_TONE[resolved];

  const points = useMemo(() => equityPoints(values, width, height, EQUITY_DRAW.pad, base), [values, width, height, base]);
  const line = useMemo(() => pathOf(points), [points]);
  const fill = points.length > 1 ? `${line}L${points[points.length - 1]!.x.toFixed(2)} ${height}L${points[0]!.x.toFixed(2)} ${height}Z` : "";
  const baseY = base != null && points.length > 0 ? equityPoints([...values, base], width, height, EQUITY_DRAW.pad, base).at(-1)!.y : null;

  // width: once and on resize
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // progress → clip + head (imperative, zero renders); re-applied when the geometry changes
  const geo = useRef({ points, width });
  useLayoutEffect(() => {
    geo.current = { points, width };
    const apply = (raw: number) => {
      const t = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 1));
      const g = geo.current;
      const pts = g.points;
      if (pts.length === 0) return;
      const x0 = pts[0]!.x;
      const x1 = pts[pts.length - 1]!.x;
      const x = x0 + (x1 - x0) * t;
      const right = Math.max(0, g.width - x - 0.5);
      if (clipRef.current) clipRef.current.style.clipPath = t >= 1 ? "none" : `inset(-20px ${right.toFixed(2)}px -20px -20px)`;
      const at = pointAt(pts, x);
      if (headRef.current) {
        headRef.current.style.transform = `translate(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px)`;
        headRef.current.style.opacity = t > 0 ? "1" : "0";
      }
    };
    apply(p.get());
    return p.on("change", apply);
  }, [p, points, width]);

  useFxPlay(rootRef, progress ? undefined : play, !progress && playOnView, !reduced && !progress, () => {
    run.current?.stop();
    own.set(0);
    run.current = animate(own, 1, {
      duration,
      ease: ease.out,
      onComplete: () => {
        playWaapi(haloRef.current, [{ opacity: 0.35, transform: "scale(0.8)" }, { opacity: 0.9, transform: "scale(1.25)" }, { opacity: 0.55, transform: "scale(1)" }], {
          duration: tween.glow.duration,
          ease: "easeInOut",
          iterations: tween.glow.repeat + 1,
        });
        onDone?.();
      },
    });
  });

  useEffect(() => {
    if (reduced && !progress) {
      run.current?.stop();
      own.set(1);
    }
  }, [reduced, progress, own]);
  useEffect(() => () => run.current?.stop(), []);

  return (
    <div ref={rootRef} role="img" aria-label={label} data-fx="equity-draw" data-tone={resolved} className={cn("relative w-full", className)} style={{ height }}>
      <div ref={clipRef} aria-hidden="true" className="absolute inset-0" style={{ clipPath: "inset(-20px 100% -20px -20px)" }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 block overflow-visible" focusable="false">
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {baseY != null && <line x1={0} x2={width} y1={baseY} y2={baseY} stroke="var(--color-line-2)" strokeDasharray="3 4" strokeWidth={1} />}
          {area && fill && <path d={fill} fill={`url(#${uid}-area)`} />}
          <path d={line} fill="none" stroke={color} strokeWidth={EQUITY_DRAW.stroke} strokeLinejoin="round" strokeLinecap="round" style={safe ? undefined : { filter: `drop-shadow(0 0 4px color-mix(in srgb, ${color} 45%, transparent))` }} />
        </svg>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 block overflow-visible" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0" stopColor={color} stopOpacity="0.55" />
            <stop offset="0.45" stopColor={color} stopOpacity="0.16" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g ref={headRef} style={{ opacity: 0 }}>
          <circle ref={haloRef} r={EQUITY_DRAW.halo} fill={`url(#${uid}-halo)`} style={{ opacity: 0.55, transformBox: "fill-box", transformOrigin: "center" }} />
          <circle r={EQUITY_DRAW.head} fill={color} />
          <circle r={1.4} fill="#fff" opacity={0.9} />
        </g>
      </svg>
    </div>
  );
}
