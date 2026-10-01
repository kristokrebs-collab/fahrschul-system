/**
 * Flicker field of the hero backdrop (21st.dev "Flickering Grid", Nothing dot-matrix flavour): the static 18-px dot
 * grid gets a sparse, slowly twinkling layer of lit dots, denser and brighter around the pointer, with a rare
 * signal-red dot as the single accent. Pure state + step functions (allocation-free per step); the component draws
 * only the cells a step changed.
 */
import { fxTiming } from "@/motion/tokens";

/** Pitch of the static CSS dot grid (px). The canvas lights exactly those dots. */
export const FIELD_PITCH = 18;
/** Centre of the first dot (`radial-gradient(circle at 1px 1px, …)`). */
export const FIELD_DOT_OFFSET = 1;
/** Steps per second – a calm twinkle, cheap enough to run beside 120 Hz UI (`fxTiming.matrixFps`). */
export const FIELD_FPS = fxTiming.matrixFps;
/** Share of all cells re-rolled per step (≈ 1 %). */
export const FIELD_REROLL = 0.01;
/** A re-rolled cell lights up with this chance (otherwise it fades out). */
export const FIELD_LIT_CHANCE = 0.2;
/** Brightness range of a lit dot (alpha over the 7 % base grid). */
export const FIELD_MIN = 0.12;
export const FIELD_MAX = 0.5;
/** A lit dot is the red signal accent with this chance (≈ one every few seconds on a hero-sized field). */
export const FIELD_SIGNAL_CHANCE = 0.002;
/** Pointer focus: cells within this radius (px) twinkle often and bright. */
export const FIELD_FOCUS_RADIUS = 150;
export const FIELD_FOCUS_REROLL = 0.18;
export const FIELD_FOCUS_MAX = 0.9;
/** Phosphor: the shown level moves this fraction towards its target per step (soft rise and decay, `fxTiming.fieldEase`). */
export const FIELD_EASE = fxTiming.fieldEase;
/** Lit share of a freshly created field, so the backdrop never starts empty. */
export const FIELD_SEED_SHARE = 0.04;

export interface FlickerField {
  cols: number;
  rows: number;
  /** shown brightness per cell, 0..1 */
  level: Float32Array;
  /** brightness each cell eases towards */
  target: Float32Array;
  /** 1 = red signal dot */
  signal: Uint8Array;
  /** brightness last drawn, quantised to 1/100 (`-1` = never drawn) */
  drawn: Int16Array;
}

export interface FieldPoint {
  x: number;
  y: number;
}

/** Grid size covering a `width × height` px area. */
export function fieldSize(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.max(0, Math.ceil((width - FIELD_DOT_OFFSET) / FIELD_PITCH) + 1), rows: Math.max(0, Math.ceil((height - FIELD_DOT_OFFSET) / FIELD_PITCH) + 1) };
}

export function createField(cols: number, rows: number): FlickerField {
  const n = cols * rows;
  return { cols, rows, level: new Float32Array(n), target: new Float32Array(n), signal: new Uint8Array(n), drawn: new Int16Array(n).fill(-1) };
}

/** Centre of cell `i` in px. */
export function cellCenter(f: FlickerField, i: number): FieldPoint {
  return { x: FIELD_DOT_OFFSET + (i % f.cols) * FIELD_PITCH, y: FIELD_DOT_OFFSET + Math.floor(i / f.cols) * FIELD_PITCH };
}

function light(f: FlickerField, i: number, rand: () => number, max: number): void {
  f.target[i] = FIELD_MIN + rand() * (max - FIELD_MIN);
  f.signal[i] = rand() < FIELD_SIGNAL_CHANCE ? 1 : 0;
}

/** Lights a random `FIELD_SEED_SHARE` of the cells at full level (no fade-in on the first frame). */
export function seedField(f: FlickerField, rand: () => number): void {
  const n = f.cols * f.rows;
  const count = Math.round(n * FIELD_SEED_SHARE);
  for (let k = 0; k < count; k++) {
    const i = Math.floor(rand() * n);
    light(f, i, rand, FIELD_MAX);
    f.level[i] = f.target[i] as number;
  }
}

/**
 * One step: re-rolls ≈ `FIELD_REROLL` of the cells, re-rolls cells near `focus` often and brighter, eases every cell
 * towards its target and writes the indices whose quantised brightness changed into `dirty` (size it to the cell
 * count). Returns their count.
 */
export function stepField(f: FlickerField, rand: () => number, focus: FieldPoint | null, dirty: Int32Array): number {
  const n = f.cols * f.rows;
  if (n === 0) return 0;
  const rerolls = Math.max(1, Math.round(n * FIELD_REROLL));
  for (let k = 0; k < rerolls; k++) {
    const i = Math.floor(rand() * n);
    if (rand() < FIELD_LIT_CHANCE) light(f, i, rand, FIELD_MAX);
    else f.target[i] = 0;
  }
  if (focus) {
    const r = FIELD_FOCUS_RADIUS;
    const c0 = Math.max(0, Math.floor((focus.x - r - FIELD_DOT_OFFSET) / FIELD_PITCH));
    const c1 = Math.min(f.cols - 1, Math.ceil((focus.x + r - FIELD_DOT_OFFSET) / FIELD_PITCH));
    const r0 = Math.max(0, Math.floor((focus.y - r - FIELD_DOT_OFFSET) / FIELD_PITCH));
    const r1 = Math.min(f.rows - 1, Math.ceil((focus.y + r - FIELD_DOT_OFFSET) / FIELD_PITCH));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = FIELD_DOT_OFFSET + col * FIELD_PITCH - focus.x;
        const dy = FIELD_DOT_OFFSET + row * FIELD_PITCH - focus.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= r || rand() >= FIELD_FOCUS_REROLL) continue;
        const i = row * f.cols + col;
        const near = 1 - d / r;
        f.target[i] = rand() < 0.5 + near * 0.5 ? FIELD_MIN + near * near * (FIELD_FOCUS_MAX - FIELD_MIN) * (0.6 + 0.4 * rand()) : 0;
        f.signal[i] = 0;
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = f.target[i] as number;
    let v = f.level[i] as number;
    if (v !== t) {
      v += (t - v) * FIELD_EASE;
      if (Math.abs(t - v) < 0.01) v = t;
      f.level[i] = v;
    }
    const q = Math.round(v * 100);
    // a full `dirty` buffer leaves `drawn` stale, so the cell is simply reported again next step
    if (q !== f.drawn[i] && count < dirty.length) {
      f.drawn[i] = q;
      dirty[count++] = i;
    }
  }
  return count;
}

/** Marks every lit cell for a redraw (after the canvas was resized / cleared). */
export function invalidateField(f: FlickerField): void {
  f.drawn.fill(-1);
}
