/**
 * Pure geometry of the Zeitmaschine's two pictures (the fan of price paths and the histogram of results): scales, ticks and
 * SVG path data in CSS pixels. No React – tested on their own (`tests/unit/views.timemachine.geometry.test.ts`).
 */
import type { Hist, TmFan } from "@/domain/timemachine";

export interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** "Nice" tick values (multiples of 1 / 2 / 5 × 10ⁿ) covering `lo … hi` with at most `max` ticks. */
export function niceTicks(lo: number, hi: number, max = 7): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, max - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step + 0);
  return out;
}

export interface FanGeometry {
  w: number;
  h: number;
  box: Box;
  x: (step: number) => number;
  y: (r: number) => number;
  lo: number;
  hi: number;
  yTicks: number[];
  xTicks: number[];
  /** area between two bands as SVG path data */
  band90: string;
  band50: string;
  median: string;
  paths: { d: string; kind: "target" | "stop" | "moved" | "neither"; end: { x: number; y: number } | null }[];
  stopY: number;
  targetY: number;
  zeroY: number;
}

const line = (xs: (i: number) => number, ys: (v: number) => number, vals: readonly number[], from = 0, to = vals.length - 1): string => {
  let d = "";
  for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${xs(i).toFixed(1)} ${ys(vals[i]!).toFixed(1)}`;
  return d;
};

/** The fan in a `w × h` box. The scale holds the 5–95 % band, the stop (−1 R) and the target; single paths are clipped to it. */
export function fanGeometry(fan: TmFan, targetR: number, w: number, h: number, box: Box = { l: 40, r: 10, t: 10, b: 42 }): FanGeometry | null {
  const n = fan.steps.length - 1;
  if (n < 1 || w <= box.l + box.r + 20) return null;
  let lo = Math.min(-1, ...fan.bands.p5);
  let hi = Math.max(targetR, ...fan.bands.p95);
  const pad = (hi - lo) * 0.06 + 0.1;
  lo -= pad;
  hi += pad;
  const innerW = w - box.l - box.r;
  const innerH = h - box.t - box.b;
  const x = (s: number): number => box.l + (s / n) * innerW;
  const y = (r: number): number => box.t + (1 - (r - lo) / (hi - lo)) * innerH;
  const area = (top: readonly number[], bottom: readonly number[]): string => {
    let d = line(x, y, top);
    for (let i = bottom.length - 1; i >= 0; i--) d += `L${x(i).toFixed(1)} ${y(bottom[i]!).toFixed(1)}`;
    return `${d}Z`;
  };
  const xTicks = niceTicks(0, n, 5).filter((t) => Number.isInteger(t));
  return {
    w,
    h,
    box,
    x,
    y,
    lo,
    hi,
    yTicks: niceTicks(lo, hi, 7),
    xTicks,
    band90: area(fan.bands.p95, fan.bands.p5),
    band50: area(fan.bands.p75, fan.bands.p25),
    median: line(x, y, fan.bands.p50),
    paths: fan.paths.map((p) => {
      const last = p.exit != null ? Math.min(p.exit, p.r.length - 1) : p.r.length - 1;
      // a path that ended at the target / the stop ends ON that line (the close of its last candle may lie beyond it)
      const vals = p.r.slice(0, last + 1);
      if (p.exit != null && p.kind === "target") vals[last] = targetR;
      else if (p.exit != null && p.kind === "stop") vals[last] = -1;
      return { d: line(x, y, vals, 0, last), kind: p.kind, end: p.exit != null ? { x: x(last), y: y(vals[last]!) } : null };
    }),
    stopY: y(-1),
    targetY: y(targetR),
    zeroY: y(0),
  };
}

export interface HistGeometry {
  w: number;
  h: number;
  box: Box;
  bars: { x: number; w: number; y: number; h: number; lo: number; hi: number; n: number; share: number }[];
  /** x of an R value (clamped to the plot) */
  x: (r: number) => number;
  max: number;
  yTicks: number[];
  xTicks: number[];
}

/** The histogram in a `w × h` box (bars from the base line; a non-empty bin is at least 2 px high). */
export function histGeometry(hist: Hist, runs: number, w: number, h: number, keep: readonly number[], box: Box = { l: 40, r: 10, t: 10, b: 36 }): HistGeometry | null {
  const bins = hist.bins;
  if (!bins.length || runs <= 0 || w <= box.l + box.r + 20) return null;
  const lo = bins[0]!.lo;
  const hi = bins[bins.length - 1]!.hi;
  const innerW = w - box.l - box.r;
  const innerH = h - box.t - box.b;
  const maxShare = Math.max(...bins.map((b) => b.n / runs));
  const topShare = Math.min(1, Math.ceil(maxShare * 20) / 20 || 0.05);
  const x = (r: number): number => box.l + ((Math.min(hi, Math.max(lo, r)) - lo) / (hi - lo)) * innerW;
  const gap = Math.min(1.5, (innerW / bins.length) * 0.12);
  return {
    w,
    h,
    box,
    x,
    max: topShare,
    bars: bins.map((b) => {
      const share = b.n / runs;
      const bh = b.n ? Math.max(2, (share / topShare) * innerH) : 0;
      const x0 = x(b.lo);
      return { x: x0 + gap / 2, w: Math.max(1, x(b.hi) - x0 - gap), y: box.t + innerH - bh, h: bh, lo: b.lo, hi: b.hi, n: b.n, share };
    }),
    yTicks: niceTicks(0, topShare * 100, 5).map((t) => t / 100),
    xTicks: [...new Set([...keep, 0].map((v) => Math.round(v * 100) / 100))].filter((v) => v >= lo && v <= hi),
  };
}
