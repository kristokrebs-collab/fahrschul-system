import { cancelFrame, frame, type FrameData, type MotionValue } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { observeInView } from "@/motion/inView";
import { fxTiming } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * LED dot matrix (rebuild of the 21st.dev "Matrix" by unlumen, Nothing glyph style).
 *
 * Differences to the original, all deliberate:
 * - zero React renders per frame: circles are rendered once, the engine writes their `opacity` attributes in
 *   motion's `frame.render` (only cells whose quantised value changed);
 * - ids come from `useId` (two matrices never share a gradient/filter);
 * - ONE blurred glow layer for the whole grid instead of a `feGaussianBlur` per lit pixel;
 * - no `aria-live` (an animating grid must not spam assistive tech): `role="img"` + a static label, or
 *   `aria-hidden` when decorative;
 * - phosphor decay is integrated per frame (fast rise, slow fall) instead of a CSS opacity transition;
 * - the loop sleeps when nothing changes, when the grid is off-screen and while the tab is hidden.
 */

export type Frame = number[][];

/* ------------------------------------------------------------------ pure frame helpers */

export function emptyFrame(rows: number, cols: number): Frame {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(0));
}

export function setPixel(f: Frame, row: number, col: number, value: number): void {
  const r = f[row];
  if (r && col >= 0 && col < r.length) r[col] = value;
}

const clamp01 = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0);

/** Pads/crops `f` to `rows × cols` and clamps every cell to `[0, 1]` (non-finite → 0). */
export function normalizeFrame(f: Frame, rows: number, cols: number): Frame {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const v = f[r]?.[c] ?? 0;
      return Number.isFinite(v) ? clamp01(v) : 0;
    }),
  );
}

export function frameSize(frames: readonly Frame[]): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const f of frames) {
    rows = Math.max(rows, f.length);
    for (const r of f) cols = Math.max(cols, r.length);
  }
  return { rows, cols };
}

/** 5 × 7 digits of the original component, verbatim. */
export const DIGIT_GLYPHS: readonly Frame[] = [
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  [[0, 0, 1, 0, 0], [0, 1, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 1, 1, 1, 0]],
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [1, 1, 1, 1, 1]],
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 1, 1, 0], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  [[0, 0, 0, 1, 0], [0, 0, 1, 1, 0], [0, 1, 0, 1, 0], [1, 0, 0, 1, 0], [1, 1, 1, 1, 1], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0]],
  [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  [[1, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [0, 1, 0, 0, 0], [0, 1, 0, 0, 0]],
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
];

/** 7-row glyphs beyond the digits (variable width; ' ' is a 3-column blank). */
const EXTRA_GLYPHS: Record<string, Frame> = {
  " ": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  "-": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  "−": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  "+": [[0, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 1], [0, 1, 0], [0, 0, 0], [0, 0, 0]],
  ".": [[0], [0], [0], [0], [0], [0], [1]],
  ",": [[0], [0], [0], [0], [0], [1], [1]],
  ":": [[0], [0], [1], [0], [1], [0], [0]],
  "%": [[1, 1, 0, 0, 1], [1, 1, 0, 1, 0], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [0, 1, 0, 1, 1], [1, 0, 0, 1, 1]],
};

/** Glyph for one character (digits, ` - − + . , : %`); unknown characters render as a blank. */
export function glyphFor(ch: string): Frame {
  const d = ch.charCodeAt(0) - 48;
  if (ch.length === 1 && d >= 0 && d <= 9) return DIGIT_GLYPHS[d] as Frame;
  return EXTRA_GLYPHS[ch] ?? (EXTRA_GLYPHS[" "] as Frame);
}

/** Composes a 7-row frame from `text`, glyphs separated by `spacing` blank columns. */
export function textFrame(text: string, spacing = 1): Frame {
  const rows = 7;
  const out: Frame = Array.from({ length: rows }, () => []);
  Array.from(text).forEach((ch, i) => {
    const g = glyphFor(ch);
    for (let r = 0; r < rows; r++) {
      const row = out[r] as number[];
      if (i > 0) for (let s = 0; s < spacing; s++) row.push(0);
      row.push(...(g[r] ?? []));
    }
  });
  return out;
}

/** 8 dots orbiting at r 2.5 on 7 × 7, 12 frames, trailing brightness `1 − i/10` (min .2) – verbatim. */
export const LOADER_FRAMES: readonly Frame[] = (() => {
  const frames: Frame[] = [];
  for (let k = 0; k < 12; k++) {
    const f = emptyFrame(7, 7);
    for (let i = 0; i < 8; i++) {
      const angle = (k / 12) * Math.PI * 2 + (i / 8) * Math.PI * 2;
      setPixel(f, Math.round(3 + Math.sin(angle) * 2.5), Math.round(3 + Math.cos(angle) * 2.5), Math.max(0.2, 1 - i / 10));
    }
    frames.push(f);
  }
  return frames;
})();

/** Lit centre plus a ring of radius `⌊(1−I)·3⌋+1` at `I·.6`, `I = (sin+1)/2`, 16 frames – verbatim. */
export const PULSE_FRAMES: readonly Frame[] = (() => {
  const frames: Frame[] = [];
  for (let k = 0; k < 16; k++) {
    const f = emptyFrame(7, 7);
    const intensity = (Math.sin((k / 16) * Math.PI * 2) + 1) / 2;
    setPixel(f, 3, 3, 1);
    const radius = Math.floor((1 - intensity) * 3) + 1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(Math.sqrt(dx * dx + dy * dy) - radius) < 0.7) setPixel(f, 3 + dy, 3 + dx, intensity * 0.6);
      }
    }
    frames.push(f);
  }
  return frames;
})();

/** Sine per column with anti-aliased neighbour rows, 24 frames on `rows × cols` (default 7 × 7, as the original). */
export function waveFrames(rows = 7, cols = 7, count = 24): Frame[] {
  const frames: Frame[] = [];
  const amp = (rows - 1) / 2 - 0.5;
  const mid = (rows - 1) / 2 + 0.5;
  for (let k = 0; k < count; k++) {
    const f = emptyFrame(rows, cols);
    const phase = (k / count) * Math.PI * 2;
    for (let c = 0; c < cols; c++) {
      const h = Math.sin(phase + (c / cols) * Math.PI * 2) * amp + mid;
      const row = Math.floor(h);
      if (row < 0 || row >= rows) continue;
      const frac = h - row;
      setPixel(f, row, c, 1);
      if (row > 0) setPixel(f, row - 1, c, 1 - frac);
      if (row < rows - 1) setPixel(f, row + 1, c, frac);
    }
    frames.push(f);
  }
  return frames;
}

export const WAVE_FRAMES: readonly Frame[] = waveFrames();

/** Inward spiral over 7 × 7 with a 5-cell tail fading `1 − i/5` – verbatim path, one frame per step. */
export const SNAKE_FRAMES: readonly Frame[] = (() => {
  const size = 7;
  const path: Array<[number, number]> = [];
  const visited = new Set<number>();
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  const free = (nx: number, ny: number) => nx >= 0 && nx < size && ny >= 0 && ny < size && !visited.has(ny * size + nx);
  while (path.length < size * size) {
    path.push([y, x]);
    visited.add(y * size + x);
    if (free(x + dx, y + dy)) {
      x += dx;
      y += dy;
      continue;
    }
    [dx, dy] = [-dy, dx];
    if (!free(x + dx, y + dy)) break;
    x += dx;
    y += dy;
  }
  return path.map((_, k) => {
    const f = emptyFrame(size, size);
    for (let i = 0; i < 5; i++) {
      const p = path[k - i];
      if (p) setPixel(f, p[0], p[1], 1 - i / 5);
    }
    return f;
  });
})();

/**
 * Marching chevrons (`›››` or `‹‹‹`) on 5 rows: the original's 5 × 5 chevron repeated every 4 columns and shifted
 * one column per frame (4 frames), brightening towards the direction of travel.
 */
export function chevronFrames(direction: 1 | -1 = 1, cols = 9): Frame[] {
  const period = 4;
  const shape = [0, 1, 2, 1, 0];
  const frames: Frame[] = [];
  for (let k = 0; k < period; k++) {
    const f = emptyFrame(5, cols);
    for (let c = 0; c < cols; c++) {
      const phase = (((c - direction * k) % period) + period) % period;
      for (let r = 0; r < 5; r++) {
        const off = shape[r] as number;
        const at = direction === 1 ? phase === off : phase === 2 - off;
        if (at) setPixel(f, r, c, 0.45 + 0.55 * ((direction === 1 ? c : cols - 1 - c) / Math.max(1, cols - 1)));
      }
    }
    frames.push(f);
  }
  return frames;
}

export type DotMatrixPreset = "loader" | "pulse" | "wave" | "snake" | "chevrons" | "chevrons-left";

const PRESETS: Record<DotMatrixPreset, readonly Frame[]> = {
  loader: LOADER_FRAMES,
  pulse: PULSE_FRAMES,
  wave: WAVE_FRAMES,
  snake: SNAKE_FRAMES,
  chevrons: chevronFrames(1),
  "chevrons-left": chevronFrames(-1),
};

/** Frame index for `elapsedMs` at `fps` (deterministic, no accumulator drift). */
export function frameIndexAt(elapsedMs: number, fps: number, count: number, loop = true): number {
  if (count <= 1 || !(fps > 0) || !(elapsedMs > 0)) return 0;
  const i = Math.floor((elapsedMs * fps) / 1000);
  return loop ? i % count : Math.min(i, count - 1);
}

/** Row brightness tiers of the original VU mode: top 30 % rows 1, middle .8, bottom .6. */
function vuTier(rowFromTop: number, rows: number): number {
  return rowFromTop < rows * 0.3 ? 1 : rowFromTop < rows * 0.6 ? 0.8 : 0.6;
}

/** Brightness of row `r` (top first) of an unsigned VU column at `level` 0..1. */
export function meterCell(level: number, r: number, rows: number): number {
  const lit = clamp01(Number.isFinite(level) ? level : 0) * rows;
  return clamp01(lit - (rows - 1 - r)) * vuTier(r, rows);
}

/** Resting brightness of the centre line of a signed meter. */
export const METER_BASELINE = 0.28;

/** Brightness of row `r` (top first) of a signed column at `level` −1..1 (see `signedMeterColumn`). */
export function signedMeterCell(level: number, r: number, rows: number): number {
  const mid = Math.floor(rows / 2);
  if (r === mid) return METER_BASELINE;
  const v = Math.max(-1, Math.min(1, Number.isFinite(level) ? level : 0));
  const k = v > 0 && r < mid ? mid - 1 - r : v < 0 && r > mid ? r - mid - 1 : -1;
  if (k < 0 || k >= mid) return 0;
  return clamp01(Math.abs(v) * mid - k) * (mid > 1 ? 0.7 + (0.3 * k) / (mid - 1) : 1);
}

/**
 * One VU column, top row first. `level` 0..1 lights `level · rows` cells from the bottom; the topmost lit cell is
 * fractional (anti-aliased), so a smoothed level glides instead of stepping.
 */
export function meterColumn(level: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, r) => meterCell(level, r, rows));
}

/**
 * Signed column (`level` −1..1), top row first: positive grows upwards from the centre row, negative downwards;
 * the centre row is a dim baseline. Brightness ramps .7 → 1 towards the outer cells, like a peak meter.
 */
export function signedMeterColumn(level: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, r) => signedMeterCell(level, r, rows));
}

/** Writes the meter for `levels` (one per column) into the row-major `out` buffer – allocation-free (runs per frame). */
export function fillMeter(out: Float32Array | Float64Array, levels: ArrayLike<number>, rows: number, cols: number, signed: boolean): void {
  const cell = signed ? signedMeterCell : meterCell;
  for (let c = 0; c < cols; c++) {
    const level = levels[c] ?? 0;
    for (let r = 0; r < rows; r++) out[r * cols + c] = cell(level, r, rows);
  }
}

/** Allocating twin of `fillMeter` (tests, static renders). */
export function meterFrame(levels: ArrayLike<number>, rows: number, signed = false): Frame {
  const cols = levels.length;
  const buf = new Float64Array(rows * cols);
  fillMeter(buf, levels, rows, cols, signed);
  return Array.from({ length: rows }, (_, r) => Array.from(buf.subarray(r * cols, (r + 1) * cols)));
}

/** Phosphor time constants (exponential approach, not a spring/tween): fast rise, slow trailing fall (`fxTiming`). */
const PHOSPHOR_RISE_MS = fxTiming.phosphorRise * 1000;
const PHOSPHOR_FALL_MS = fxTiming.phosphorFall * 1000;
const SNAP = 1 / 256;

/** One phosphor step of a cell towards `target` after `dtMs` (frame-rate independent). */
export function approach(current: number, target: number, dtMs: number): number {
  const tau = target > current ? PHOSPHOR_RISE_MS : PHOSPHOR_FALL_MS;
  const next = target + (current - target) * Math.exp(-Math.max(0, dtMs) / tau);
  return Math.abs(next - target) < SNAP ? target : next;
}

/** Glow contribution of a cell: only cells above half brightness bloom (original: `> .5` gets the glow). */
export function glowOf(b: number): number {
  return b > 0.5 ? (b - 0.5) * 2 : 0;
}

/* ------------------------------------------------------------------ engine (imperative, no React) */

interface EngineConfig {
  frames: readonly Frame[] | null;
  fps: number;
  playing: boolean;
  reduced: boolean;
  glow: boolean;
  signed: boolean;
  sampleMs: number;
  meter: MotionValue<number> | null;
}

/** Opacity quantised to 1/100 as an integer – written attributes are compared as ints (exact, unlike float32). */
const q100 = (v: number) => Math.round(v * 100);

/**
 * Owns the per-cell buffers and the frame loop. Reads nothing from the DOM; writes `opacity` attributes in
 * `frame.render`, only for cells whose quantised value changed.
 */
class MatrixEngine {
  private readonly n: number;
  private readonly target: Float32Array;
  private readonly shown: Float32Array;
  private readonly writtenOn: Int16Array;
  private readonly writtenGlow: Int16Array;
  private readonly history: Float32Array;
  private readonly display: Float32Array;
  private cfg: EngineConfig = { frames: null, fps: fxTiming.matrixFps, playing: true, reduced: false, glow: true, signed: false, sampleMs: 100, meter: null };
  private frameIndex = -1;
  private t0: number | null = null;
  private lastSample = -Infinity;
  private peak: number | null = null;
  private running = false;
  /** Meter: the next sample runs from this timer instead of a per-frame loop (`sampleMs`; reduced motion ≥ 1 s). */
  private timer: ReturnType<typeof setTimeout> | null = null;
  private visible = true;
  private pageVisible = true;

  constructor(
    private readonly rows: number,
    private readonly cols: number,
    private readonly onEls: ArrayLike<Element>,
    private readonly glowEls: ArrayLike<Element> | null,
  ) {
    this.n = rows * cols;
    this.target = new Float32Array(this.n);
    this.shown = new Float32Array(this.n);
    this.writtenOn = new Int16Array(this.n).fill(-1);
    this.writtenGlow = new Int16Array(this.n).fill(-1);
    this.history = new Float32Array(cols);
    this.display = new Float32Array(cols);
  }

  configure(next: EngineConfig): void {
    const prev = this.cfg;
    this.cfg = next;
    if (next.frames !== prev.frames || next.meter !== prev.meter) {
      this.frameIndex = -1;
      this.t0 = null;
      this.loadTarget(0);
    } else if (next.playing !== prev.playing || next.fps !== prev.fps) {
      this.t0 = null; // resume from the current frame instead of jumping
    }
    if (next.glow !== prev.glow) this.writtenGlow.fill(-1);
    if (next.reduced || !this.canAnimate()) this.settleNow();
    this.kick();
  }

  /** First paint: show the target directly (no fade-in from black). */
  primeStatic(): void {
    this.loadTarget(0);
    this.shown.set(this.target);
    this.write();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.kick();
    else this.stop();
  }

  setPageVisible(v: boolean): void {
    this.pageVisible = v;
    if (v) this.kick();
    else this.stop();
  }

  /** A meter value arrived: remember the strongest move of the sample window and wake the loop. */
  onMeter(v: number): void {
    if (!Number.isFinite(v)) return;
    if (this.peak === null || Math.abs(v) > Math.abs(this.peak)) this.peak = v;
    // a pending sample timer will pick the peak up – no frame per meter event
    if (this.cfg.meter && this.timer !== null) return;
    this.kick();
  }

  destroy(): void {
    this.stop();
  }

  private canAnimate(): boolean {
    return this.visible && this.pageVisible;
  }

  private animatedFrames(): boolean {
    const f = this.cfg.frames;
    return !!f && f.length > 1 && this.cfg.playing && !this.cfg.reduced;
  }

  private loadTarget(index: number): void {
    const { frames, meter, signed } = this.cfg;
    if (meter) {
      fillMeter(this.target, this.display, this.rows, this.cols, signed);
      return;
    }
    const f = frames?.[index];
    for (let r = 0; r < this.rows; r++) {
      const row = f?.[r];
      for (let c = 0; c < this.cols; c++) {
        const v = row?.[c] ?? 0;
        this.target[r * this.cols + c] = Number.isFinite(v) ? clamp01(v) : 0;
      }
    }
  }

  private settleNow(): void {
    if (this.cfg.meter && this.cfg.reduced) this.sampleMeter();
    this.shown.set(this.target);
    this.write();
  }

  private kick(): void {
    if (this.running || !this.canAnimate()) return;
    this.running = true;
    frame.render(this.tick, true);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.running) return;
    this.running = false;
    cancelFrame(this.tick);
  }

  /** Shifts the meter history one column left and appends the window's strongest value. */
  private sampleMeter(): void {
    const meter = this.cfg.meter;
    if (!meter) return;
    const v = this.peak ?? meter.get();
    this.peak = null;
    const sample = Number.isFinite(v) ? v : 0;
    const last = this.cols - 1;
    this.history.copyWithin(0, 1);
    this.display.copyWithin(0, 1);
    this.history[last] = sample;
    this.display[last] = sample;
  }

  private meterIdle(): boolean {
    const meter = this.cfg.meter;
    if (!meter || this.peak !== null) return false;
    const v = Math.fround(meter.get()); // the history is a Float32Array
    for (let c = 0; c < this.cols; c++) {
      if (this.history[c] !== v || Math.abs((this.display[c] as number) - v) > SNAP) return false;
    }
    return true;
  }

  private readonly tick = (data: FrameData): void => {
    const now = data.timestamp;
    const dt = Math.min(64, data.delta || 16.7);
    const { frames, fps, reduced, meter, sampleMs } = this.cfg;
    let busy = false;

    if (this.animatedFrames() && frames) {
      this.t0 ??= now - Math.max(0, this.frameIndex) * (1000 / fps);
      const i = frameIndexAt(now - this.t0, fps, frames.length, true);
      if (i !== this.frameIndex) {
        this.frameIndex = i;
        this.loadTarget(i);
      }
      busy = true;
    }

    const cadence = reduced ? Math.max(1000, sampleMs) : sampleMs;
    // meter: stepped at the sample cadence – a new column lands at once and the history scrolls one column, with no
    // per-frame column lerp or phosphor fade, so the cells are written once per sample and the frame loop sleeps in
    // between (a per-frame glide wrote up to rows × cols opacity attributes every frame: perf review perf-04)
    if (meter) {
      if (now - this.lastSample >= cadence) {
        this.lastSample = now;
        this.sampleMeter();
      }
      this.loadTarget(0);
      busy = !this.meterIdle();
    }

    let settling = false;
    for (let i = 0; i < this.n; i++) {
      const t = this.target[i] as number;
      const s = reduced || meter ? t : approach(this.shown[i] as number, t, dt);
      this.shown[i] = s;
      if (s !== t) settling = true;
    }
    this.write();
    // meter: one sample per cadence (reduced motion: per second), so no frame loop in between – stop and wake on a timer
    if (meter && !this.animatedFrames()) {
      this.stop();
      if (busy) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.kick();
        }, Math.max(0, cadence - (now - this.lastSample)));
      }
      return;
    }
    if (!busy && !settling) this.stop();
  };

  private write(): void {
    const glow = this.cfg.glow && !this.cfg.reduced;
    for (let i = 0; i < this.n; i++) {
      const b = q100(this.shown[i] as number);
      if (b !== this.writtenOn[i]) {
        this.writtenOn[i] = b;
        this.onEls[i]?.setAttribute("opacity", String(b / 100));
      }
      if (!this.glowEls) continue;
      const g = glow ? q100(glowOf(b / 100)) : 0;
      if (g !== this.writtenGlow[i]) {
        this.writtenGlow[i] = g;
        this.glowEls[i]?.setAttribute("opacity", String(g / 100));
      }
    }
  }
}

/* ------------------------------------------------------------------ component */

export type DotTone = "fg" | "mute" | "win" | "loss" | "signal" | "warn";

const TONE_COLOR: Record<DotTone, string> = {
  fg: "var(--color-fg)",
  mute: "var(--color-mute)",
  win: "var(--color-win)",
  loss: "var(--color-loss)",
  signal: "var(--color-signal)",
  warn: "var(--color-warn)",
};

export interface DotMatrixProps {
  /** Animated 7 × 7 / 5-row preset. */
  preset?: DotMatrixPreset;
  /**
   * Static 5 × 7 glyph text (digits and `- − + . , : %`); changes cross-fade through the phosphor decay as long as
   * the grid width stays the same – pad live values (`padStart`) or pass `cols`, a width change rebuilds the grid.
   */
  text?: string;
  /** Static custom frame (cells 0..1). */
  pattern?: Frame;
  /** Custom animation frames (cells 0..1), played at `fps`, looping. */
  frames?: readonly Frame[];
  /**
   * Meter mode: a scrolling VU history fed by a MotionValue, `0..1` (or `−1..1` with `signed`). One column is
   * sampled every `sampleMs` (the strongest value of that window), new columns land at once, old ones scroll left (stepped at the cadence: no per-frame work in between).
   */
  meter?: MotionValue<number>;
  /** Meter: mirror around the centre row – positive grows up in `tone`, negative grows down in `negativeTone`. */
  signed?: boolean;
  /** Grid size; defaults to the frames' size (meter: 7 × 24). Frames are padded/cropped to it. */
  rows?: number;
  cols?: number;
  /** Frame rate of animated presets/frames (default 12, as the original). */
  fps?: number;
  /** Meter sample cadence in ms (default 100). */
  sampleMs?: number;
  /** Dot diameter in px (default 4). */
  size?: number;
  /** Gap between dots in px (default 2). */
  gap?: number;
  tone?: DotTone;
  negativeTone?: DotTone;
  /** One shared bloom layer under the lit dots (default true; off under reduced motion). */
  glow?: boolean;
  /** Pause an animated preset on its current frame. */
  playing?: boolean;
  /** Static accessible label → `role="img"`; without it the matrix is decorative (`aria-hidden`). */
  label?: string;
  className?: string;
}

/**
 * LED dot-matrix display. Off cells are a static 8 % white grid; lit cells are radial-gradient dots whose opacity is
 * the cell brightness, with one blurred bloom copy underneath. Reduced motion → a single static frame (meters update
 * at most once per second, without smoothing), no glow, no player.
 */
export function DotMatrix({
  preset,
  text,
  pattern,
  frames: framesProp,
  meter,
  signed = false,
  rows: rowsProp,
  cols: colsProp,
  fps = fxTiming.matrixFps,
  sampleMs = 100,
  size = 4,
  gap = 2,
  tone = "fg",
  negativeTone = "signal",
  glow = true,
  playing = true,
  label,
  className,
}: DotMatrixProps) {
  const reduced = useReducedFx();
  const uid = `dm${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const onRef = useRef<SVGGElement>(null);
  const glowRef = useRef<SVGGElement>(null);
  const engineRef = useRef<MatrixEngine | null>(null);

  const frames = useMemo<readonly Frame[] | null>(() => {
    if (meter) return null;
    if (framesProp && framesProp.length > 0) return framesProp;
    if (pattern) return [pattern];
    if (text != null) return [textFrame(text)];
    if (preset) return PRESETS[preset];
    return [];
  }, [meter, framesProp, pattern, text, preset]);

  const natural = useMemo(() => (frames ? frameSize(frames) : { rows: 7, cols: 24 }), [frames]);
  const rows = Math.max(1, rowsProp ?? natural.rows);
  const cols = Math.max(1, colsProp ?? natural.cols);
  const showGlow = glow && !reduced;

  // Engine lifetime follows the grid structure; config changes are pushed into the running engine below, so a
  // `text` change fades through the phosphor instead of re-mounting.
  useLayoutEffect(() => {
    const on = onRef.current;
    if (!on) return;
    const engine = new MatrixEngine(rows, cols, on.children, glowRef.current?.children ?? null);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [rows, cols, showGlow]);

  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.configure({ frames, fps, playing, reduced, glow: showGlow, signed, sampleMs, meter: meter ?? null });
  }, [frames, fps, playing, reduced, showGlow, signed, sampleMs, meter, rows, cols]);

  // first paint of a fresh grid shows its first frame directly (also the only paint in jsdom / without rAF)
  useLayoutEffect(() => {
    engineRef.current?.primeStatic();
  }, [rows, cols, showGlow]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !meter) return;
    return meter.on("change", (v) => engine.onMeter(v));
  }, [meter, rows, cols, showGlow]);

  useEffect(() => {
    const engine = engineRef.current;
    const el = rootRef.current;
    if (!engine || !el) return;
    const unobserve = observeInView(el, (inView) => engine.setVisible(inView));
    if (typeof document === "undefined") return unobserve;
    const onVis = () => engine.setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unobserve();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [rows, cols, showGlow]);

  const pitch = size + gap;
  const width = cols * pitch - gap;
  const height = rows * pitch - gap;
  const r = size * 0.45;
  const mid = Math.floor(rows / 2);
  const toneAt = (row: number): DotTone => (meter && signed ? (row < mid ? tone : row > mid ? negativeTone : "fg") : tone);
  const tones = Array.from(new Set(Array.from({ length: rows }, (_, row) => toneAt(row))));
  const cells = Array.from({ length: rows * cols }, (_, i) => ({ row: Math.floor(i / cols), cx: (i % cols) * pitch + size / 2, cy: Math.floor(i / cols) * pitch + size / 2 }));

  return (
    <span
      ref={rootRef}
      className={cn("inline-block align-middle leading-none", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-matrix={meter ? "meter" : (preset ?? (text != null ? "text" : "frames"))}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible" aria-hidden="true" focusable="false">
        <defs>
          {tones.map((t) => (
            <radialGradient key={t} id={`${uid}-${t}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: TONE_COLOR[t], stopOpacity: 1 }} />
              <stop offset="70%" style={{ stopColor: TONE_COLOR[t], stopOpacity: 0.85 }} />
              <stop offset="100%" style={{ stopColor: TONE_COLOR[t], stopOpacity: 0.6 }} />
            </radialGradient>
          ))}
          {showGlow && (
            <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={Math.max(1, size * 0.45)} />
            </filter>
          )}
        </defs>
        <g fill="#fff" fillOpacity={0.08}>
          {cells.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={r} />
          ))}
        </g>
        {showGlow && (
          <g ref={glowRef} filter={`url(#${uid}-glow)`}>
            {cells.map((c, i) => (
              <circle key={i} cx={c.cx} cy={c.cy} r={r * 1.15} style={{ fill: TONE_COLOR[toneAt(c.row)] }} opacity={0} />
            ))}
          </g>
        )}
        <g ref={onRef}>
          {cells.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={r} fill={`url(#${uid}-${toneAt(c.row)})`} opacity={0} />
          ))}
        </g>
      </svg>
    </span>
  );
}
