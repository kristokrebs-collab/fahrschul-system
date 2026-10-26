import { describe, expect, it } from "vitest";
import {
  cellCenter,
  createField,
  FIELD_DOT_OFFSET,
  FIELD_FOCUS_RADIUS,
  FIELD_MAX,
  FIELD_PITCH,
  FIELD_SEED_SHARE,
  fieldSize,
  invalidateField,
  seedField,
  stepField,
  type FlickerField,
} from "@/primitives/heroField";

/** Deterministic PRNG for repeatable fields. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const lit = (f: FlickerField) => Array.from(f.target).filter((v) => v > 0).length;

describe("hero flicker field", () => {
  it("covers the area on the 18 px grid of the static dots", () => {
    expect(fieldSize(0, 0)).toEqual({ cols: 1, rows: 1 });
    expect(fieldSize(900, 360)).toEqual({ cols: 51, rows: 21 });
    const f = createField(51, 21);
    expect(cellCenter(f, 0)).toEqual({ x: FIELD_DOT_OFFSET, y: FIELD_DOT_OFFSET });
    expect(cellCenter(f, 52)).toEqual({ x: FIELD_DOT_OFFSET + FIELD_PITCH, y: FIELD_DOT_OFFSET + FIELD_PITCH });
  });

  it("starts with a sparse lit share, drawn on the first step", () => {
    const f = createField(50, 20);
    seedField(f, lcg(1));
    const n = lit(f);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(Math.round(1000 * FIELD_SEED_SHARE));
    const dirty = new Int32Array(1000);
    // every cell is reported once (never drawn yet), then only the cells a step changed
    expect(stepField(f, lcg(2), null, dirty)).toBe(1000);
    const again = stepField(f, lcg(3), null, dirty);
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(100);
    for (const v of f.level) expect(v).toBeLessThanOrEqual(FIELD_MAX);
  });

  it("eases levels towards their targets (phosphor) and settles", () => {
    const f = createField(4, 4);
    f.target[5] = 0.5;
    const dirty = new Int32Array(16);
    const quiet = () => 0.99; // no re-roll lights a cell (rand ≥ lit chance) and no focus hit
    stepField(f, quiet, null, dirty);
    const first = f.level[5] as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    for (let k = 0; k < 20; k++) stepField(f, quiet, null, dirty);
    expect(f.level[5]).toBe(0.5);
    expect(stepField(f, quiet, null, dirty)).toBe(0);
  });

  it("lights cells around the pointer far more than elsewhere", () => {
    const f = createField(60, 30);
    const dirty = new Int32Array(f.cols * f.rows);
    const rand = lcg(7);
    const focus = { x: 500, y: 250 };
    for (let k = 0; k < 12; k++) stepField(f, rand, focus, dirty);
    let near = 0;
    let far = 0;
    let nearCells = 0;
    let farCells = 0;
    for (let i = 0; i < f.cols * f.rows; i++) {
      const c = cellCenter(f, i);
      const d = Math.hypot(c.x - focus.x, c.y - focus.y);
      if (d < FIELD_FOCUS_RADIUS * 0.6) {
        nearCells++;
        if ((f.target[i] as number) > 0) near++;
      } else if (d > FIELD_FOCUS_RADIUS * 1.5) {
        farCells++;
        if ((f.target[i] as number) > 0) far++;
      }
    }
    expect(near / nearCells).toBeGreaterThan(5 * (far / farCells));
  });

  it("reports a full buffer's leftovers on the next step instead of dropping them", () => {
    const f = createField(10, 10);
    seedField(f, lcg(4));
    const small = new Int32Array(30);
    const quiet = () => 0.99;
    let total = 0;
    for (let k = 0; k < 4; k++) total += stepField(f, quiet, null, small);
    expect(total).toBe(100);
    invalidateField(f);
    expect(stepField(f, quiet, null, new Int32Array(100))).toBe(100);
  });
});

describe("hero flicker field – text mask", () => {
  it("never lights blocked cells (seed, re-rolls, pointer focus) and darkens newly blocked cells at once", async () => {
    const { setBlocked } = await import("@/primitives/heroField");
    const f = createField(30, 12);
    seedField(f, lcg(3));
    // a text line across the top-left area
    const rect = { x: 0, y: 0, w: 300, h: 80 };
    const changed = setBlocked(f, [rect]);
    expect(changed).toBeGreaterThan(0);
    const blocked = (i: number) => f.blocked[i] === 1;
    for (let i = 0; i < f.cols * f.rows; i++) if (blocked(i)) expect(f.level[i]).toBe(0);
    const dirty = new Int32Array(f.cols * f.rows);
    const rand = lcg(9);
    for (let s = 0; s < 200; s++) stepField(f, rand, { x: 60, y: 40 }, dirty);
    for (let i = 0; i < f.cols * f.rows; i++) if (blocked(i)) expect(f.target[i]).toBe(0);
    // cells outside still twinkle
    expect(Array.from(f.target).some((v, i) => v > 0 && !blocked(i))).toBe(true);
    // unblocking frees them again; re-applying the same rects changes nothing
    expect(setBlocked(f, [rect])).toBe(0);
    expect(setBlocked(f, [])).toBe(changed);
  });
});
