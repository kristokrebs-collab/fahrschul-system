/**
 * Draws the simulated paths of the Zeitmaschine onto a 2D canvas: "alle 10 000 Pfade" (A3). Pure apart from the canvas it is given
 * (a `CanvasRenderingContext2D` or an `OffscreenCanvasRenderingContext2D`; tests pass a fake), so the SAME code runs in a worker on
 * an `OffscreenCanvas` and, where there is none, on the page.
 *
 * - **Alpha overlay**: every stroke is thin and nearly transparent, so where many paths run together the picture gets brighter; one
 *   lonely path stays faint. Nothing is averaged away – every drawn path is a real simulated session.
 * - **Bundled draw calls**: `BATCH` paths share one `beginPath() … stroke()`, so 10 000 paths are ~600 strokes, not 10 000.
 * - **Time slices**: `step(deadline)` draws batches until the deadline and returns; `runPaint` calls it in slices of a few
 *   milliseconds and gives the thread back in between, so no task runs anywhere near 50 ms. A batch is sized to FIT the time left in
 *   the slice (from the measured cost of one path): on a slow device or a throttled CPU it shrinks, down to one path per stroke.
 * - **Sampling**: `sampleOf` draws every k-th run (a regular sample of independent sessions) for weak devices; the title says how many
 *   were computed and how many drawn – never one number for both.
 * A path is drawn up to the candle where its trade ended (target / stop / moved stop – on the line it ended at) or to the end of the
 * session when it ended neither; values outside the picture are clipped.
 */
import type { TmPaths } from "@/domain/timemachine";

/** The part of a 2D context the painter uses (both browser contexts satisfy it). */
export interface PaintContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
}

export interface PaintGeometry {
  /** CSS pixels */
  w: number;
  h: number;
  box: { l: number; r: number; t: number; b: number };
  /** candles per session (the x axis runs 0 … steps) */
  steps: number;
  /** the y axis in R */
  lo: number;
  hi: number;
  targetR: number;
}

export interface PaintStyle {
  /** CSS colour of the strokes (opaque); the transparency is `alpha` */
  ink: string;
  lineWidth: number;
}

/** The data the painter reads (a `TmPaths` is one; so is its copy in the worker). */
export type PathData = Pick<TmPaths, "runs" | "stride" | "data" | "kind" | "exit">;

export interface SamplePlan {
  /** every `every`-th run is drawn (1 = all) */
  every: number;
  /** runs drawn */
  drawn: number;
  /** runs available */
  of: number;
}

/** Paths per stroke call (starting value; halves on a slow device). */
export const BATCH = 16;
/** Sample size for weak devices. */
export const SAMPLE_WEAK = 2000;

/** A regular sample: every k-th run so that about `want` are drawn (all when `want ≥ total`). */
export function sampleOf(total: number, want: number): SamplePlan {
  const n = Math.max(0, Math.floor(total));
  const every = want >= n || want <= 0 ? 1 : Math.ceil(n / want);
  return { every, drawn: n === 0 ? 0 : Math.ceil(n / every), of: n };
}

/** Transparency of one stroke so that the whole picture neither stays faint nor turns solid white. */
export function alphaFor(drawn: number, batch: number = BATCH): number {
  const batches = Math.max(1, Math.ceil(drawn / batch));
  // below about 1/255 an 8-bit canvas rounds a stroke away, so the floor stays above it
  return Math.min(0.4, Math.max(0.008, 3 / batches));
}

export interface PaintStats {
  /** paths drawn */
  drawn: number;
  batches: number;
  /** slices (calls of `step` between two gives of the thread) */
  slices: number;
  /** wall time of the whole drawing, ms */
  totalMs: number;
  /** longest single slice / batch, ms */
  maxSliceMs: number;
  maxBatchMs: number;
  /** batch size at the end (smaller than `BATCH` = the device was slow) */
  batch: number;
}

export class PathPainter {
  readonly total: number;
  done = 0;
  /** the smallest batch used so far (smaller than `BATCH` = the device was slow) */
  batch: number;
  maxBatchMs = 0;
  batches = 0;
  /** measured cost of one path in ms (exponential average); 0 = not measured yet */
  private perPath = 0;
  private readonly alpha: number;
  private readonly x: Float64Array;
  private readonly yScale: number;
  private readonly yOff: number;

  constructor(
    private readonly ctx: PaintContext,
    private readonly paths: PathData,
    private readonly geo: PaintGeometry,
    style: PaintStyle,
    private readonly plan: SamplePlan,
    dpr: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.total = plan.drawn;
    this.batch = BATCH;
    this.alpha = alphaFor(plan.drawn, BATCH);
    const { box, w, h, steps, lo, hi } = geo;
    const innerW = w - box.l - box.r;
    const innerH = h - box.t - box.b;
    this.x = Float64Array.from({ length: steps + 1 }, (_, s) => box.l + (s / steps) * innerW);
    this.yScale = -innerH / (hi - lo);
    this.yOff = box.t + innerH + (lo * innerH) / (hi - lo);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.l, box.t, innerW, innerH);
    ctx.clip();
    ctx.lineWidth = style.lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = style.ink;
    ctx.globalAlpha = this.alpha;
  }

  get progress(): number {
    return this.total ? this.done / this.total : 1;
  }

  private y(r: number): number {
    return r * this.yScale + this.yOff;
  }

  /** The run number of the j-th drawn path. */
  runOf(j: number): number {
    return j * this.plan.every;
  }

  private line(k: number): void {
    const { data, stride, kind, exit } = this.paths;
    const base = k * stride;
    const H = stride - 1;
    const e = exit[k]!;
    const last = e > 0 ? Math.min(e, H) : H;
    const ctx = this.ctx;
    ctx.moveTo(this.x[0]!, this.y(0));
    for (let s = 1; s <= last; s++) {
      let v = data[base + s]!;
      // a path that ended at the target / the stop ends ON that line (the close of its last candle may lie beyond it)
      if (e > 0 && s === last) {
        const kd = kind[k]!;
        if (kd === 0) v = this.geo.targetR;
        else if (kd === 1) v = -1;
      }
      ctx.lineTo(this.x[s]!, this.y(v));
    }
  }

  /** Draws batches until `deadline` (ms on the painter's clock) or the end; true when every path is drawn. */
  step(deadline: number): boolean {
    const ctx = this.ctx;
    while (this.done < this.total) {
      const t0 = this.now();
      // a batch that fits the time left in this slice (the very first one has no measurement and takes BATCH paths)
      const fit = this.perPath > 0 ? Math.floor(Math.max(0, deadline - t0) / this.perPath) : BATCH;
      const n = Math.min(BATCH, Math.max(1, fit), this.total - this.done);
      if (n < this.batch) this.batch = n;
      const end = this.done + n;
      // the transparency follows the batch: fewer paths per stroke would otherwise pile up and brighten the picture
      ctx.globalAlpha = Math.min(0.4, Math.max(this.alpha * (n / BATCH), 0.008));
      ctx.beginPath();
      for (let j = this.done; j < end; j++) {
        const k = this.runOf(j);
        if (this.paths.kind[k] === 255) continue;
        this.line(k);
      }
      ctx.stroke();
      this.done = end;
      this.batches++;
      const t1 = this.now();
      const took = t1 - t0;
      if (took > this.maxBatchMs) this.maxBatchMs = took;
      const each = took / n;
      this.perPath = this.perPath > 0 ? this.perPath * 0.6 + each * 0.4 : each;
      if (t1 >= deadline) break;
    }
    if (this.done >= this.total) this.finish();
    return this.done >= this.total;
  }

  private finished = false;
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.ctx.restore();
    this.ctx.globalAlpha = 1;
  }

  /** Stops drawing (the clip and alpha are given back). */
  cancel(): void {
    this.finish();
  }
}

export interface PaintRunOptions {
  /** work per slice, ms (default 8) */
  sliceMs?: number;
  /** gives the thread back (default: a macrotask) */
  yieldNow?: () => Promise<void>;
  now?: () => number;
  signal?: { readonly aborted: boolean };
  onProgress?: (done: number, total: number) => void;
}

const macrotask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Drives a painter in slices: work `sliceMs`, give the thread back, repeat. Resolves with the figures of the drawing. */
export async function runPaint(p: PathPainter, o: PaintRunOptions = {}): Promise<PaintStats> {
  const now = o.now ?? (() => performance.now());
  const slice = o.sliceMs ?? 8;
  const yieldNow = o.yieldNow ?? macrotask;
  const t0 = now();
  let slices = 0;
  let maxSlice = 0;
  while (!o.signal?.aborted) {
    const s0 = now();
    const finished = p.step(s0 + slice);
    const took = now() - s0;
    slices++;
    if (took > maxSlice) maxSlice = took;
    o.onProgress?.(p.done, p.total);
    if (finished) break;
    await yieldNow();
  }
  if (o.signal?.aborted) p.cancel();
  return { drawn: p.done, batches: p.batches, slices, totalMs: now() - t0, maxSliceMs: maxSlice, maxBatchMs: p.maxBatchMs, batch: p.batch };
}

/**
 * Weak device = fewer cores / little memory / a phone: the sample is the default there. A hint only – the reader can always switch.
 * (`deviceMemory` exists in Chromium; everything is read defensively.)
 */
export function weakDevice(nav: { hardwareConcurrency?: number; deviceMemory?: number } | undefined, coarse: boolean): boolean {
  if (!nav) return coarse;
  if (coarse) return true;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 4) return true;
  return false;
}
