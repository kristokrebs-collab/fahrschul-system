/**
 * The Monte-Carlo fan on the rich pages (Runde 10, `pulse-motion/references/design-linien.md`): one canvas, never one DOM
 * node per path. The picture is the statistics of ALL simulated runs (percentile bands 5 / 25 / 50 / 75 / 95 from every
 * run, `res.bands`) plus a sample of the kept paths as texture (`res.paths`, 120 of the 2 000 runs): thin lines with a low
 * alpha so overlaps read as density, green when the run ends above its start, red when it ends below, the median on top
 * with a soft glow, a start axis and the dashed start line, nice grid lines. The scene is painted ONCE into an offscreen
 * canvas (resize / theme / new result); the reveal only blits a growing left strip of it (ease-out, one `drawImage` per
 * frame – no path work while it draws) and rests afterwards. Hover and keyboard readouts are DOM (transforms), not redraws.
 */
import { cubicBezier, createFrameLoop } from "@/motion/pulse/engine";
import { ease, tween } from "@/motion/tokens";
import { ink, inkIsPaper } from "@/chart/ink";
import type { MonteCarloResult } from "@/domain/analytics";
import type { FanGeometry } from "./MonteCarloCard";

/** Canvas padding in CSS px (the same box the SVG fan used). */
export const FAN_PAD = { l: 4, r: 4, t: 10, b: 10 } as const;
/** Device-pixel-ratio ceiling of the canvas. */
export const FAN_MAX_DPR = 2;
/** The reveal runs `tween.draw` × this (the reference asks for ≈ 1.5 s). */
export const FAN_REVEAL_S = tween.draw.duration * 1.4;
/** Alpha of one sample line (overlaps add up to density). */
export const FAN_LINE_ALPHA = 0.15;

export interface FanFrame {
  w: number;
  h: number;
  /** steps of the horizon */
  n: number;
  lo: number;
  hi: number;
  x: (i: number) => number;
  y: (v: number) => number;
}

/** The pixel frame of a fan geometry (same mapping as `fanGeometry`). */
export function fanFrame(geo: FanGeometry, res: MonteCarloResult): FanFrame {
  const n = res.horizon;
  const { w, h, lo, hi } = geo;
  const span = hi - lo || 1;
  return {
    w,
    h,
    n,
    lo,
    hi,
    x: (i) => FAN_PAD.l + (n ? i / n : 0) * (w - FAN_PAD.l - FAN_PAD.r),
    y: (v) => FAN_PAD.t + (1 - (v - lo) / span) * (h - FAN_PAD.t - FAN_PAD.b),
  };
}

/** The step (0 … n) whose x is closest to the pixel `px`. */
export function stepAtX(frame: FanFrame, px: number): number {
  const inner = frame.w - FAN_PAD.l - FAN_PAD.r;
  if (inner <= 0 || frame.n <= 0) return 0;
  return Math.max(0, Math.min(frame.n, Math.round(((px - FAN_PAD.l) / inner) * frame.n)));
}

export interface StepStats {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** The percentile values of ALL runs after `i` trades (null without bands / outside the horizon). */
export function stepStats(res: MonteCarloResult, i: number): StepStats | null {
  const pick = (p: number) => res.bands.find((b) => b.p === p)?.values[i];
  const p5 = pick(5);
  const p25 = pick(25);
  const p50 = pick(50);
  const p75 = pick(75);
  const p95 = pick(95);
  if (p5 == null || p25 == null || p50 == null || p75 == null || p95 == null) return null;
  return { p5, p25, p50, p75, p95 };
}

/** How many of the drawn sample paths end above / below their start (0 counts as green). The picture's honest legend. */
export function sampleSplit(res: MonteCarloResult): { win: number; loss: number } {
  let win = 0;
  for (const p of res.paths) if ((p[p.length - 1] ?? 0) >= (p[0] ?? 0)) win++;
  return { win, loss: res.paths.length - win };
}

/** About `count` round values in [lo, hi] (1 / 2 / 5 × 10ⁿ steps). */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

export interface FanPaint {
  fg: string;
  win: string;
  loss: string;
  tick: string;
  /** the chart sits on paper: no additive blending, a quieter glow */
  paper: boolean;
}

/** The live palette (read at draw time, so a theme switch repaints in the new ink). */
export function readFanPaint(): FanPaint {
  return { fg: ink.fg, win: ink.win, loss: ink.loss, tick: ink.tick, paper: inkIsPaper() };
}

const hasAlpha = (ctx: CanvasRenderingContext2D, a: number, fn: () => void) => {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  fn();
  ctx.globalAlpha = prev;
};

/**
 * The scene as an ordered list of small steps (grid + bands, then ONE step per sample line, then median and axis): painting
 * them one after the other gives exactly the picture of a single call, and `paintFan` can hand the main thread back between
 * slices – on a slow phone no task of the paint runs long. Coordinates are CSS px (`setTransform(dpr …)` already applied).
 */
export function fanSceneSteps(ctx: CanvasRenderingContext2D, res: MonteCarloResult, geo: FanGeometry, paint: FanPaint, tickLabel: (v: number) => string): (() => void)[] {
  const f = fanFrame(geo, res);
  const band = (p: number) => res.bands.find((b) => b.p === p)?.values;
  const area = (top: readonly number[], bottom: readonly number[]) => {
    ctx.beginPath();
    top.forEach((v, i) => (i ? ctx.lineTo(f.x(i), f.y(v)) : ctx.moveTo(f.x(i), f.y(v))));
    for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(f.x(i), f.y(bottom[i]!));
    ctx.closePath();
  };
  const p5 = band(5);
  const p25 = band(25);
  const p50 = band(50);
  const p75 = band(75);
  const p95 = band(95);
  const steps: (() => void)[] = [];

  // grid, bands, dashed edges, the start line
  steps.push(() => {
    ctx.clearRect(0, 0, f.w, f.h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // grid: round values, hairlines, mono labels (the start line is the dashed one below)
    ctx.font = '9.5px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    for (const v of niceTicks(f.lo, f.hi, 4)) {
      // the start (0) is the dashed line below; labels keep clear of the two corner chips (top left, bottom right)
      if (v === 0) continue;
      const y = Math.round(f.y(v)) + 0.5;
      if (y < FAN_PAD.t - 1 || y > f.h - FAN_PAD.b + 1) continue;
      ctx.strokeStyle = paint.fg;
      hasAlpha(ctx, 0.06, () => {
        ctx.beginPath();
        ctx.moveTo(FAN_PAD.l, y);
        ctx.lineTo(f.w - FAN_PAD.r, y);
        ctx.lineWidth = 1;
        ctx.stroke();
      });
      if (y < 30 || y > f.h - 24) continue;
      ctx.fillStyle = paint.tick;
      ctx.fillText(tickLabel(v), FAN_PAD.l + 6, y - 2);
    }

    // percentile bands: soft areas (5 – 95 wide and faint, 25 – 75 the core), dashed outer edges
    if (p5 && p95) {
      ctx.fillStyle = paint.fg;
      hasAlpha(ctx, paint.paper ? 0.05 : 0.045, () => {
        area(p95, p5);
        ctx.fill();
      });
    }
    if (p25 && p75) {
      ctx.fillStyle = paint.fg;
      hasAlpha(ctx, paint.paper ? 0.08 : 0.075, () => {
        area(p75, p25);
        ctx.fill();
      });
    }
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = paint.fg;
    for (const edge of [p5, p95]) {
      if (!edge) continue;
      hasAlpha(ctx, 0.22, () => {
        ctx.beginPath();
        edge.forEach((v, i) => (i ? ctx.lineTo(f.x(i), f.y(v)) : ctx.moveTo(f.x(i), f.y(v))));
        ctx.stroke();
      });
    }

    // the start line (dashed) – the stake everything is measured against
    const y0 = f.y(res.bands[0]?.values[0] ?? 0);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = paint.tick;
    ctx.beginPath();
    ctx.moveTo(FAN_PAD.l, y0);
    ctx.lineTo(f.w - FAN_PAD.r, y0);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // sample lines: colour = outcome (end above / below the start), alpha = density; one small step per line
  const additive = !paint.paper;
  geo.pts.forEach((pts, k) => {
    const path = res.paths[k];
    if (!path || !pts.length) return;
    const win = (path[path.length - 1] ?? 0) >= (path[0] ?? 0);
    steps.push(() => {
      ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
      ctx.globalAlpha = FAN_LINE_ALPHA;
      ctx.lineWidth = 1.1;
      // thin lines: bevel joins are as good as round ones and far cheaper to stroke
      ctx.lineJoin = "bevel";
      ctx.strokeStyle = win ? paint.win : paint.loss;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.stroke();
    });
  });

  // the median on top, with a soft glow; the start axis: a vertical hairline that fades out at both ends
  steps.push(() => {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "round";
    if (p50) {
      ctx.save();
      ctx.shadowColor = paint.fg;
      ctx.shadowBlur = paint.paper ? 5 : 12;
      ctx.strokeStyle = paint.fg;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      p50.forEach((v, i) => (i ? ctx.lineTo(f.x(i), f.y(v)) : ctx.moveTo(f.x(i), f.y(v))));
      ctx.stroke();
      ctx.restore();
    }
    const grad = ctx.createLinearGradient(0, 0, 0, f.h);
    grad.addColorStop(0, "rgba(128,128,128,0)");
    grad.addColorStop(0.5, paint.tick);
    grad.addColorStop(1, "rgba(128,128,128,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(FAN_PAD.l + 0.5, 0);
    ctx.lineTo(FAN_PAD.l + 0.5, f.h);
    ctx.stroke();
  });
  return steps;
}

/** Paints the whole fan into `ctx` in one go (tests, and the sliced paint's reference picture). */
export function drawFanScene(ctx: CanvasRenderingContext2D, res: MonteCarloResult, geo: FanGeometry, paint: FanPaint, tickLabel: (v: number) => string): void {
  for (const step of fanSceneSteps(ctx, res, geo, paint, tickLabel)) step();
}

export interface PaintOptions {
  /** reveal from the left (ease-out) instead of showing the picture at once */
  animate: boolean;
  /** called once when the picture is complete (also when nothing animates) */
  onDone: () => void;
  tickLabel: (v: number) => string;
}

/** Time one slice of the scene paint may take before the main thread is handed back (ms). */
export const FAN_SLICE_MS = 8;

/**
 * Paints the fan into `canvas`: the scene into an offscreen canvas (dpr ≤ 2) in slices of at most `FAN_SLICE_MS` (the first
 * slice runs at once, the rest on the next frames – a slow phone never gets a long task out of it), then either one blit or an
 * ease-out left-to-right reveal (one `drawImage` of a growing strip per frame). The visible canvas keeps its old picture until
 * the new scene is complete (a resize never shows a blank fan). Returns the cleanup (stops a running paint / reveal).
 */
export function paintFan(canvas: HTMLCanvasElement, res: MonteCarloResult, geo: FanGeometry, { animate, onDone, tickLabel }: PaintOptions): () => void {
  const dpr = Math.min(FAN_MAX_DPR, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const W = Math.round(geo.w * dpr);
  const H = Math.round(geo.h * dpr);
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const octx = off.getContext("2d");
  if (!octx || !canvas.getContext("2d")) {
    onDone();
    return () => {};
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const steps = fanSceneSteps(octx, res, geo, readFanPaint(), tickLabel);
  const hasRaf = typeof requestAnimationFrame === "function";
  let stopped = false;
  let raf = 0;
  let stopReveal = () => {};

  const reveal = () => {
    if (stopped) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onDone();
      return;
    }
    const blit = (frac: number) => {
      const sw = Math.max(1, Math.min(W, Math.round(W * frac)));
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0, sw, H, 0, 0, sw, H);
    };
    if (!animate || !hasRaf) {
      blit(1);
      onDone();
      return;
    }
    const out = cubicBezier(...ease.out);
    let t = 0;
    const loop = createFrameLoop((dt) => {
      t += dt;
      const p = Math.min(1, t / FAN_REVEAL_S);
      blit(out(p));
      if (p >= 1) {
        onDone();
        return false;
      }
      return true;
    });
    blit(0);
    loop.wake();
    stopReveal = () => loop.stop();
  };

  let i = 0;
  const slice = () => {
    raf = 0;
    if (stopped) return;
    const t0 = performance.now();
    // at least one step per slice, then as many as fit the budget
    do steps[i++]!();
    while (i < steps.length && (!hasRaf || performance.now() - t0 < FAN_SLICE_MS));
    if (i < steps.length) raf = requestAnimationFrame(slice);
    else reveal();
  };
  slice();
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    stopReveal();
  };
}
